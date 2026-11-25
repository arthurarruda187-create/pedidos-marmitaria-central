// Função "avisar-whatsapp": manda a mensagem de status do pedido no WhatsApp do cliente pela Z-API.
// Chamada pelo gatilho do banco (com o segredo interno) ou pelo painel (teste, com o login do dono).
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

function chaveServico(): string {
  const antiga = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (antiga) return antiga;
  const novas = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (novas) { try { const o = JSON.parse(novas); return o.default ?? Object.values(o)[0] as string; } catch { return novas; } }
  throw new Error("Chave de serviço do Supabase não encontrada");
}
const db = createClient(Deno.env.get("SUPABASE_URL")!, chaveServico(), { auth: { persistSession: false } });

// Textos padrão (o dono pode mudar no painel). Variáveis: {nome} {numero} {loja} {total} {link} {tempo} {entregador} {motivo} {pix}
export const PADRAO: Record<string, string> = {
  novo: "Olá, {nome}! 😊 Recebemos seu pedido *#{numero}* na *{loja}*.\nTotal: *{total}*\n{pix}Acompanhe aqui: {link}",
  preparo: "👨‍🍳 {nome}, seu pedido *#{numero}* foi aceito e já está sendo preparado! Previsão: {tempo}.",
  pronto: "✅ {nome}, seu pedido *#{numero}* está pronto! Pode vir buscar. 🏪",
  saiu: "🛵 {nome}, seu pedido *#{numero}* saiu para entrega{entregador}! Já já chega aí.{codigo}",
  entregue: "🎉 Pedido *#{numero}* entregue. Bom apetite, {nome}!\nConta pra gente como foi: {link}",
  cancelado: "❌ {nome}, seu pedido *#{numero}* foi cancelado.{motivo}\nQualquer dúvida, é só responder esta mensagem.",
};

const brl = (v: unknown) => "R$ " + Number(v || 0).toFixed(2).replace(".", ",");
const fone = (t: string) => { const d = String(t || "").replace(/\D/g, ""); return d.length >= 12 ? d : "55" + d; };

function montar(modelo: string, p: any, loja: any, ent: any) {
  const link = `${(loja.site_url || "").replace(/\/$/, "")}/?pedido=${p.id}`;
  const pix = p.pagamento === "pix_entrega" && loja.chave_pix
    ? `\n💠 *Pagamento por Pix*\nChave: *${loja.chave_pix}*${loja.nome_pix ? `\nNome: ${loja.nome_pix}` : ""}\nValor: *${brl(p.total)}*\nDepois é só mandar o comprovante aqui.\n\n` : "";
  const vars: Record<string, string> = {
    nome: String(p.cliente_nome || "").split(" ")[0], numero: String(p.numero), loja: loja.nome, total: brl(p.total), link,
    tempo: p.tipo === "entrega" ? loja.tempo_entrega : loja.tempo_retirada,
    entregador: ent?.nome ? ` com ${ent.nome}` : "", motivo: p.motivo_cancelamento ? `\nMotivo: ${p.motivo_cancelamento}` : "", pix,
    codigo: p.codigo_entrega ? `\n\n🔐 Código de entrega: *${p.codigo_entrega}*\nFale este código para o entregador só quando receber o pedido.` : "",
  };
  return modelo.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

async function enviar(cfg: any, telefone: string, texto: string) {
  if (!cfg?.zapi_instancia || !cfg?.zapi_token) throw new Error("Z-API não configurada no painel.");
  if (cfg.zapi_tipo !== "classica") {
    // Z-API Omni: POST /v1/channels/{id}/messages com Authorization: Bearer <chave>
    const omni = Deno.env.get("ZAPI_OMNI_URL") ?? "https://api.omni.z-api.io";
    const corpo = JSON.stringify({ recipient: { identifier: fone(telefone) }, content: { type: "TEXT", body: { message: texto } } });
    let ultimo = "";
    for (const url of [`${omni}/v1/channels/${cfg.zapi_instancia}/messages`, `${omni}/hermitage/v1/channels/${cfg.zapi_instancia}/messages`]) {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.zapi_token}` }, body: corpo });
      const d = await r.json().catch(() => ({}));
      if (r.ok) return d;
      ultimo = `${r.status} ${d.message || d.error || ""}`.trim();
      if (r.status === 422) throw new Error("WhatsApp desconectado na Z-API — leia o QR Code de novo.");
      if (![401, 403, 404, 405].includes(r.status)) break;
    }
    throw new Error("Z-API Omni recusou: " + ultimo);
  }
  const r = await fetch(`${Deno.env.get("ZAPI_URL") ?? "https://api.z-api.io"}/instances/${cfg.zapi_instancia}/token/${cfg.zapi_token}/send-text`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cfg.zapi_client_token ? { "Client-Token": cfg.zapi_client_token } : {}) },
    body: JSON.stringify({ phone: fone(telefone), message: texto, delayTyping: 2 }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(d.error || d.message || `Z-API respondeu ${r.status}`);
  return d;
}

async function ehAdmin(req: Request) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data } = await db.auth.getUser(token);
  if (!data?.user) return false;
  const { data: a } = await db.from("admins").select("user_id").eq("user_id", data.user.id).maybeSingle();
  return !!a;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let e: any; try { e = await req.json(); } catch { return json({ erro: "corpo inválido" }, 400); }
  const [{ data: cfg }, { data: loja }] = await Promise.all([
    db.from("config_privada").select("*").eq("id", 1).single(),
    db.from("loja").select("*").eq("id", 1).single(),
  ]);

  // Teste pelo painel
  if (e.teste) {
    if (!(await ehAdmin(req))) return json({ erro: "Somente o dono da loja." }, 403);
    try { await enviar(cfg, e.telefone, e.texto || `✅ Teste do WhatsApp automático da ${loja?.nome}. Está funcionando!`); return json({ ok: true }); }
    catch (err) { return json({ erro: (err as Error).message }, 502); }
  }

  // Chamada do gatilho do banco
  if (!cfg || e.segredo !== cfg.segredo) return json({ erro: "não autorizado" }, 401);
  if (!loja?.whatsapp_auto) return json({ ignorado: "desligado" });
  const { data: p } = await db.from("pedidos").select("*").eq("id", e.pedido_id).single();
  if (!p || !p.cliente_telefone) return json({ ignorado: "sem telefone" });
  if (["ifood", "aiqfome", "keeta", "99food"].includes(p.canal) || p.tipo === "mesa") return json({ ignorado: "canal" });
  if (p.status !== e.status) return json({ ignorado: "status mudou de novo" });
  if (p.status === "pronto" && p.tipo === "entrega") return json({ ignorado: "pronto (entrega)" });
  const modelo = (loja.mensagens_auto || {})[p.status] ?? PADRAO[p.status];
  if (!modelo || !String(modelo).trim()) return json({ ignorado: "sem mensagem para " + p.status });

  const { data: ent } = p.entregador_id ? await db.from("entregadores").select("nome").eq("id", p.entregador_id).maybeSingle() : { data: null };
  const texto = montar(String(modelo), p, loja, ent);
  // registra antes de enviar: se o gatilho disparar duas vezes, só a primeira passa
  const { data: reg, error: errReg } = await db.from("mensagens_whatsapp")
    .insert({ pedido_id: p.id, status: p.status, telefone: p.cliente_telefone, texto }).select("id").single();
  if (errReg) return json({ ignorado: "já enviada" });
  try {
    await enviar(cfg, p.cliente_telefone, texto);
    await db.from("mensagens_whatsapp").update({ ok: true }).eq("id", reg.id);
    return json({ ok: true });
  } catch (err) {
    await db.from("mensagens_whatsapp").update({ ok: false, erro: (err as Error).message.slice(0, 300) }).eq("id", reg.id);
    return json({ erro: (err as Error).message }, 502);
  }
});
