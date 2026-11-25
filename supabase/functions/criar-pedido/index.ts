// Função "criar-pedido": recebe o carrinho do cardápio (ou do PDV da loja), confere
// tudo no banco, aplica bairro/cupom, grava o pedido e, se for pagamento online,
// cria a cobrança no Mercado Pago.
import { createClient } from "npm:@supabase/supabase-js@2";
import { calcularPedido, ErroPedido, type Cupom, type EntradaPedido } from "../_shared/calculo.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const MP_TOKEN = Deno.env.get("MP_ACCESS_TOKEN") ?? "";
const MP_API = Deno.env.get("MP_API_URL") ?? "https://api.mercadopago.com"; // só muda em testes
const SITE_URL = (Deno.env.get("SITE_URL") ?? "").replace(/\/$/, "");
const EMAIL_PADRAO = Deno.env.get("EMAIL_PAGADOR_PADRAO") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const WEBHOOK_URL = `${SUPABASE_URL}/functions/v1/webhook-mercadopago`;

function chaveServico(): string {
  const antiga = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (antiga) return antiga;
  const novas = Deno.env.get("SUPABASE_SECRET_KEYS"); // formato novo: {"default":"sb_secret_..."}
  if (novas) { try { const o = JSON.parse(novas); return o.default ?? Object.values(o)[0] as string; } catch { return novas; } }
  throw new Error("Chave de serviço do Supabase não encontrada");
}

const db = createClient(SUPABASE_URL, chaveServico(), {
  auth: { persistSession: false },
});

async function mercadoPago(path: string, body: unknown, idempotencia: string) {
  const r = await fetch(`${MP_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${MP_TOKEN}`,
      "Content-Type": "application/json",
      "X-Idempotency-Key": idempotencia,
    },
    body: JSON.stringify(body),
  });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error("Mercado Pago", r.status, JSON.stringify(dados));
    throw new Error("Não foi possível gerar o pagamento online. Tente outra forma de pagamento.");
  }
  return dados;
}

// Pedido de balcão só pode vir de um administrador logado no painel
async function ehAdmin(req: Request): Promise<boolean> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user) return false;
  const { data: adm } = await db.from("admins").select("user_id").eq("user_id", data.user.id).maybeSingle();
  return !!adm;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erro: "Método não permitido" }, 405);

  let entrada: EntradaPedido;
  try {
    entrada = await req.json();
  } catch {
    return json({ erro: "Pedido inválido." }, 400);
  }

  // mesmo envio repetido (clique duplo, internet caiu e o cliente tentou de novo): devolve o pedido já gravado
  const chave = typeof (entrada as any).chave_envio === "string" ? (entrada as any).chave_envio.slice(0, 64) : null;
  if (chave) {
    const { data: ja } = await db.from("pedidos").select("id,numero,pix_copia_cola,pix_qr_base64,checkout_url").eq("chave_envio", chave).maybeSingle();
    if (ja) return json({ id: ja.id, numero: ja.numero, pix_copia_cola: ja.pix_copia_cola, pix_qr_base64: ja.pix_qr_base64, checkout_url: ja.checkout_url });
  }

  const balcao = entrada.canal === "balcao";
  if (balcao && !(await ehAdmin(req))) return json({ erro: "Somente a loja pode lançar pedido de balcão." }, 403);

  const ids = [...new Set((entrada.itens ?? []).map((i) => i.produto_id).filter(Boolean))];
  const semIds = ["00000000-0000-0000-0000-000000000000"];
  const [lojaR, abertaR, bairrosR, prodR, grupR] = await Promise.all([
    db.from("loja").select("*").eq("id", 1).single(),
    db.rpc("loja_aberta_agora"),
    db.from("bairros").select("id,nome,taxa,distancia_km").eq("ativo", true),
    db.from("produtos").select("id,nome,preco,preco_promocional,esgotado,ativo,dias_semana").in("id", ids.length ? ids : semIds),
    db.from("grupos_adicionais").select("id,produto_id,nome,minimo,maximo").in("produto_id", ids.length ? ids : semIds),
  ]);
  const erroLeitura = lojaR.error ?? abertaR.error ?? bairrosR.error ?? prodR.error ?? grupR.error;
  if (erroLeitura) {
    console.error(erroLeitura);
    return json({ erro: "Erro ao ler o cardápio. Tente de novo." }, 500);
  }
  const grupoIds = (grupR.data ?? []).map((g) => g.id);
  const opcR = grupoIds.length
    ? await db.from("opcoes_adicionais").select("id,grupo_id,nome,preco,esgotado").in("grupo_id", grupoIds)
    : { data: [], error: null };
  if (opcR.error) return json({ erro: "Erro ao ler o cardápio. Tente de novo." }, 500);

  let agendaNoHorario: boolean | undefined;
  if (entrada.agendado_para && !isNaN(new Date(String(entrada.agendado_para)).getTime())) {
    const { data: ok } = await db.rpc("loja_funciona_em", { p_quando: new Date(String(entrada.agendado_para)).toISOString() });
    agendaNoHorario = !!ok;
  }
  const extras = { aberta: !!abertaR.data, bairros: bairrosR.data ?? [], balcao, cupom: null as Cupom | null, agendaNoHorario };
  let calc;
  try {
    calc = calcularPedido(entrada, lojaR.data, prodR.data ?? [], grupR.data ?? [], opcR.data ?? [], extras);
    if (entrada.cupom && String(entrada.cupom).trim()) {
      const { data: v, error } = await db.rpc("validar_cupom", {
        p_codigo: String(entrada.cupom), p_subtotal: calc.subtotal, p_telefone: calc.registro.cliente_telefone ?? "",
      });
      if (error) throw error;
      const c = v?.[0];
      if (!c?.valido) throw new ErroPedido(c?.mensagem ?? "Cupom inválido.");
      extras.cupom = { codigo: c.codigo, tipo: c.tipo, valor: Number(c.valor) };
      calc = calcularPedido(entrada, lojaR.data, prodR.data ?? [], grupR.data ?? [], opcR.data ?? [], extras);
    }
  } catch (e) {
    if (e instanceof ErroPedido) return json({ erro: e.message }, 422);
    console.error(e);
    return json({ erro: "Erro ao conferir o pedido. Tente de novo." }, 500);
  }

  const online = calc.registro.pagamento === "pix_online" || calc.registro.pagamento === "cartao_online";
  if (online && !MP_TOKEN) return json({ erro: "Pagamento online ainda não configurado na loja." }, 422);

  // reserva o cupom antes de gravar (com várias pessoas ao mesmo tempo o limite não estoura)
  const tel = calc.registro.cliente_telefone ?? "";
  if (calc.registro.cupom_codigo) {
    const { data: msg, error: eCup } = await db.rpc("reservar_cupom", { p_codigo: calc.registro.cupom_codigo, p_telefone: tel });
    if (eCup) { console.error(eCup); return json({ erro: "Erro ao conferir o cupom. Tente de novo." }, 500); }
    if (msg) return json({ erro: msg }, 422);
  }
  const { data: pedido, error } = await db.from("pedidos").insert({ ...calc.registro, chave_envio: chave }).select("id,numero,total").single();
  if (error) {
    if (calc.registro.cupom_codigo) await db.rpc("liberar_cupom", { p_codigo: calc.registro.cupom_codigo, p_telefone: tel });
    if (error.code === "23505" && chave && String(error.message).includes("chave_envio")) {
      const { data: ja } = await db.from("pedidos").select("id,numero").eq("chave_envio", chave).maybeSingle();
      if (ja) return json({ id: ja.id, numero: ja.numero });
    }
    if (error.code === "23505") return json({ erro: "Este pedido do app já foi lançado (mesmo número)." }, 409);
    console.error(error);
    return json({ erro: "Não foi possível registrar o pedido." }, 500);
  }

  if (!online) return json({ id: pedido.id, numero: pedido.numero });

  const descricao = `Pedido #${pedido.numero} - ${lojaR.data.nome}`.slice(0, 120);
  try {
    if (calc.registro.pagamento === "pix_online") {
      const email = calc.email || EMAIL_PADRAO;
      const expira = new Date(Date.now() + 30 * 60 * 1000).toISOString().replace("Z", "+00:00");
      const pg = await mercadoPago("/v1/payments", {
        transaction_amount: Number(pedido.total),
        description: descricao,
        payment_method_id: "pix",
        external_reference: pedido.id,
        notification_url: WEBHOOK_URL,
        date_of_expiration: expira,
        payer: { email, first_name: calc.registro.cliente_nome.split(" ")[0] },
      }, `pix-${pedido.id}`);
      const td = pg.point_of_interaction?.transaction_data ?? {};
      await db.from("pedidos").update({
        mp_pagamento_id: String(pg.id),
        pix_copia_cola: td.qr_code ?? null,
        pix_qr_base64: td.qr_code_base64 ?? null,
      }).eq("id", pedido.id);
      return json({ id: pedido.id, numero: pedido.numero, pix_copia_cola: td.qr_code, pix_qr_base64: td.qr_code_base64 });
    }

    // Cartão online: página de pagamento do Mercado Pago (Checkout Pro)
    const volta = `${SITE_URL}/?pedido=${pedido.id}`;
    const pref = await mercadoPago("/checkout/preferences", {
      items: [{ id: pedido.id, title: descricao, quantity: 1, unit_price: Number(pedido.total), currency_id: "BRL" }],
      external_reference: pedido.id,
      notification_url: WEBHOOK_URL,
      back_urls: { success: volta, pending: volta, failure: volta },
      auto_return: "approved",
      payment_methods: { excluded_payment_types: [{ id: "ticket" }], installments: 1 },
      statement_descriptor: lojaR.data.nome.slice(0, 13),
    }, `pref-${pedido.id}`);
    await db.from("pedidos").update({ checkout_url: pref.init_point }).eq("id", pedido.id);
    return json({ id: pedido.id, numero: pedido.numero, checkout_url: pref.init_point });
  } catch (e) {
    await db.from("pedidos").update({ status: "cancelado", pagamento_status: "falhou", motivo_cancelamento: "Falha ao gerar pagamento" }).eq("id", pedido.id);
    return json({ erro: (e as Error).message }, 502);
  }
});
