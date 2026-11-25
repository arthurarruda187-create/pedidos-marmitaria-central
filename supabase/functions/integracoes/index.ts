// Função "integracoes": liga os apps de delivery (iFood, 99Food, Keeta) ao painel.
//  - sincronizar  (agendador, a cada 30 s): busca eventos novos, cria/atualiza pedidos e confirma o recebimento
//  - status       (gatilho do banco): mudança de status no painel → avisa o app
//  - verificar_codigo (link do entregador): confere o código de entrega no app e finaliza
//  - testar       (painel, só o dono): testa as chaves
//  - webhook      (Open Delivery: ?plataforma=keeta|99food): o app empurra o evento na hora
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-app-signature, x-app-id, x-app-merchantid",
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
const IFOOD_URL = (Deno.env.get("IFOOD_API_URL") ?? "https://merchant-api.ifood.com.br").replace(/\/$/, "");

type Cfg = { plataforma: string; ativo: boolean; client_id: string; client_secret: string; merchant_id: string | null; base_url: string | null;
  confirmar_auto: boolean; token: string | null; token_expira: string | null };
type Evento = { id: string; codigo: string; pedidoId: string; bruto: unknown };

class ErroApp extends Error { constructor(msg: string, public status = 0) { super(msg); } }

async function log(plataforma: string, acao: string, ok: boolean, detalhe = "", pedido_id: string | null = null) {
  await db.from("integracao_log").insert({ plataforma, acao, ok, detalhe: String(detalhe).slice(0, 1000), pedido_id });
}

async function hmacHex(chave: string, texto: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(chave), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(texto));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------- HTTP com os apps
async function chamar(cfg: Cfg, metodo: string, caminho: string, corpo?: unknown, extra: Record<string, string> = {}) {
  const od = cfg.plataforma !== "ifood";
  const base = od ? String(cfg.base_url || "").replace(/\/$/, "") : IFOOD_URL;
  if (!base) throw new ErroApp("Endereço da API do app não configurado.");
  const token = await obterToken(cfg);
  const texto = corpo === undefined ? "" : JSON.stringify(corpo);
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: "application/json", ...extra };
  if (corpo !== undefined) headers["Content-Type"] = "application/json";
  if (od) headers["X-App-Signature"] = await hmacHex(cfg.client_secret, texto);
  if (!od && cfg.merchant_id && caminho.includes("events:polling")) headers["x-polling-merchants"] = cfg.merchant_id;
  const r = await fetch(base + caminho, { method: metodo, headers, body: corpo === undefined ? undefined : texto });
  if (r.status === 401) { await db.from("integracoes").update({ token: null, token_expira: null }).eq("plataforma", cfg.plataforma); cfg.token = null; }
  const t = await r.text();
  let dados: any = null; try { dados = t ? JSON.parse(t) : null; } catch { dados = t; }
  if (!r.ok) throw new ErroApp(`${metodo} ${caminho} → ${r.status} ${typeof dados === "string" ? dados.slice(0, 200) : JSON.stringify(dados)?.slice(0, 200)}`, r.status);
  return { status: r.status, dados };
}

async function obterToken(cfg: Cfg): Promise<string> {
  if (cfg.token && cfg.token_expira && new Date(cfg.token_expira).getTime() > Date.now() + 60000) return cfg.token;
  if (!cfg.client_id || !cfg.client_secret) throw new ErroApp("Chaves do app (client id / secret) não configuradas.");
  let r: Response;
  if (cfg.plataforma === "ifood") {
    r = await fetch(`${IFOOD_URL}/authentication/v1.0/oauth/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grantType: "client_credentials", clientId: cfg.client_id, clientSecret: cfg.client_secret }) });
  } else {
    const base = String(cfg.base_url || "").replace(/\/$/, "");
    if (!base) throw new ErroApp("Endereço da API do app não configurado.");
    r = await fetch(`${base}/oauth/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: cfg.client_id, client_secret: cfg.client_secret, ...(cfg.plataforma === "keeta" ? { scope: "od.all" } : {}) }) });
  }
  const j = await r.json().catch(() => ({}));
  const token = j.accessToken ?? j.access_token;
  if (!r.ok || !token) throw new ErroApp(`Login no app recusado (${r.status}). Confira o client id e o client secret.`, r.status);
  const exp = new Date(Date.now() + (Number(j.expiresIn ?? j.expires_in) || 3600) * 1000).toISOString();
  cfg.token = token; cfg.token_expira = exp;
  await db.from("integracoes").update({ token, token_expira: exp }).eq("plataforma", cfg.plataforma);
  return token;
}

// ---------------------------------------------------------------- conversão do pedido do app → pedido do painel
const num = (v: any) => { if (v == null) return 0; if (typeof v === "object") return Number(v.value ?? v.amount ?? 0) || 0; return Number(v) || 0; };
const texto = (v: any, max = 300) => String(v ?? "").trim().slice(0, max);

function formaPagamento(metodos: any[], prepago: boolean) {
  if (prepago) return { pagamento: "pago_app", pagamento_status: "pago", troco_para: null as number | null };
  const m = (metodos || []).find((x: any) => !/ONLINE|PREPAID/i.test(String(x.type ?? ""))) ?? metodos?.[0] ?? {};
  const met = String(m.method ?? m.methodType ?? "").toUpperCase();
  const troco = num(m.cash?.changeFor ?? m.changeFor) || null;
  if (met.includes("CASH") || met.includes("DINHEIRO")) return { pagamento: "dinheiro", pagamento_status: "na_entrega", troco_para: troco };
  if (met.includes("PIX")) return { pagamento: "pix_entrega", pagamento_status: "na_entrega", troco_para: null };
  return { pagamento: "cartao_entrega", pagamento_status: "na_entrega", troco_para: null };
}

function converterIfood(o: any) {
  const entrega = o.orderType === "DELIVERY";
  const end = o.delivery?.deliveryAddress ?? {};
  const pagos = o.payments ?? {};
  const prepago = num(pagos.pending) === 0 && num(pagos.prepaid) > 0;
  const itens = (o.items ?? []).map((it: any) => ({
    nome: texto(it.name, 120), quantidade: Number(it.quantity) || 1, preco_unitario: num(it.unitPrice), total: num(it.totalPrice ?? it.price),
    observacao: texto(it.observations, 200), adicionais: (it.options ?? []).map((op: any) => ({ grupo: texto(op.groupName, 60), nome: texto(op.name, 120), quantidade: Number(op.quantity) || 1, preco: num(op.price ?? op.unitPrice) })),
  }));
  const tot = o.total ?? {};
  const fone = String(o.customer?.phone?.number ?? "").replace(/\D/g, "");
  return {
    canal: "ifood", api_pedido_id: String(o.id), id_externo: texto(o.displayId, 40) || null,
    cliente_nome: texto(o.customer?.name, 80) || "Cliente iFood",
    cliente_telefone: fone.length >= 10 ? fone : null,
    tipo: entrega ? "entrega" : "retirada",
    endereco: entrega ? texto([end.formattedAddress ?? [end.streetName, end.streetNumber].filter(Boolean).join(", "), end.complement, end.reference ? `Ref.: ${end.reference}` : ""].filter(Boolean).join(" - ")) : null,
    bairro: entrega ? texto(end.neighborhood, 80) || null : null,
    entrega_lat: end.coordinates?.latitude ?? null, entrega_lng: end.coordinates?.longitude ?? null,
    entrega_pelo_app: entrega && o.delivery?.deliveredBy === "IFOOD",
    itens, subtotal: num(tot.subTotal), taxa_entrega: num(tot.deliveryFee), desconto: num(tot.benefits),
    total: num(tot.orderAmount), total_app: num(tot.orderAmount),
    ...formaPagamento(pagos.methods ?? [], prepago),
    observacao: [texto(o.extraInfo, 250), o.delivery?.pickupCode ? `Cód. coleta: ${o.delivery.pickupCode}` : "", fone && o.customer?.phone?.localizer ? `Localizador: ${o.customer.phone.localizer}` : ""].filter(Boolean).join(" · ") || null,
    agendado_para: o.orderTiming === "SCHEDULED" ? (o.schedule?.deliveryDateTimeStart ?? null) : null,
    status: "novo",
  };
}

function converterOD(o: any, plataforma: string) {
  const entrega = o.type === "DELIVERY";
  const end = o.delivery?.deliveryAddress ?? {};
  const pagos = o.payments ?? {};
  const prepago = num(pagos.pending) === 0 && num(pagos.prepaid) > 0;
  const itens = (o.items ?? []).map((it: any) => ({
    nome: texto(it.name, 120), quantidade: Number(it.quantity) || 1, preco_unitario: num(it.unitPrice), total: num(it.totalPrice),
    observacao: texto(it.specialInstructions, 200), adicionais: (it.options ?? []).map((op: any) => ({ grupo: "", nome: texto(op.name, 120), quantidade: Number(op.quantity) || 1, preco: num(op.unitPrice) })),
  }));
  const taxa = (o.otherFees ?? []).filter((f: any) => /DELIVERY/i.test(f.type ?? "")).reduce((s: number, f: any) => s + num(f.price), 0);
  const tot = o.total ?? {};
  const fone = String(o.customer?.phone?.number ?? "").replace(/\D/g, "");
  return {
    canal: plataforma, api_pedido_id: String(o.id), id_externo: texto(o.displayId, 40) || null,
    cliente_nome: texto(o.customer?.name, 80) || `Cliente ${plataforma}`,
    cliente_telefone: fone.length >= 10 ? fone : null,
    tipo: entrega ? "entrega" : "retirada",
    endereco: entrega ? texto([end.formattedAddress ?? [end.street, end.number].filter(Boolean).join(", "), end.complement, end.reference ? `Ref.: ${end.reference}` : ""].filter(Boolean).join(" - ")) : null,
    bairro: entrega ? texto(end.district, 80) || null : null,
    entrega_lat: end.coordinates?.latitude ?? null, entrega_lng: end.coordinates?.longitude ?? null,
    entrega_pelo_app: entrega && /MARKETPLACE|PARTNER|PLATFORM/i.test(o.delivery?.deliveredBy ?? ""),
    itens, subtotal: num(tot.itemsPrice), taxa_entrega: taxa, desconto: num(tot.discount),
    total: num(tot.orderAmount), total_app: num(tot.orderAmount),
    ...formaPagamento(pagos.methods ?? [], prepago),
    observacao: texto(o.extraInfo, 250) || null,
    agendado_para: o.orderTiming === "SCHEDULED" ? (o.schedule?.scheduledDateTimeStart ?? null) : null,
    status: "novo",
  };
}

// ---------------------------------------------------------------- eventos
async function buscarEventos(cfg: Cfg): Promise<Evento[]> {
  if (cfg.plataforma === "ifood") {
    const { status, dados } = await chamar(cfg, "GET", "/order/v1.0/events:polling");
    if (status === 204 || !Array.isArray(dados)) return [];
    return dados.map((e: any) => ({ id: e.id, codigo: e.code ?? e.fullCode, pedidoId: e.orderId, bruto: e }));
  }
  const { status, dados } = await chamar(cfg, "GET", "/v1/events:polling");
  const lista = status === 204 ? [] : Array.isArray(dados) ? dados : (dados?.events ?? []);
  return lista.map((e: any) => ({ id: e.eventId ?? e.id, codigo: e.eventType, pedidoId: e.orderId, bruto: e }));
}
async function confirmarEventos(cfg: Cfg, evs: Evento[]) {
  if (!evs.length) return;
  if (cfg.plataforma === "ifood") await chamar(cfg, "POST", "/order/v1.0/events/acknowledgment", evs.map((e) => ({ id: e.id })));
  else await chamar(cfg, "POST", "/v1/events/acknowledgment", evs.map((e) => ({ id: e.id, orderId: e.pedidoId, eventType: e.codigo })));
}

const NOVO = new Set(["PLC", "PLACED", "CREATED"]);
const CANCELOU = new Set(["CAN", "CANCELLED", "ORDER_CANCELLED"]);
const CONCLUIU = new Set(["CON", "CONCLUDED", "DELIVERED"]);
const CONFIRMOU = new Set(["CFM", "CONFIRMED"]);
const SAIU = new Set(["DSP", "DISPATCHED"]);
const PRONTO = new Set(["RTP", "READY_FOR_PICKUP"]);
const PEDIU_CODIGO = new Set(["DDCR", "DELIVERY_DROP_CODE_REQUESTED"]);
const ORDEM = ["novo", "preparo", "pronto", "saiu", "entregue"];

async function pedidoDoApp(cfg: Cfg, apiId: string) {
  const { data } = await db.from("pedidos").select("*").eq("canal", cfg.plataforma).eq("api_pedido_id", apiId).maybeSingle();
  return data;
}
// muda o status vindo do app (sem mandar de volta)
async function statusDoApp(p: any, status: string, extra: Record<string, unknown> = {}) {
  if (!p || p.status === status || ["cancelado", "entregue"].includes(p.status) && status !== "cancelado") return;
  if (status !== "cancelado" && ORDEM.indexOf(status) <= ORDEM.indexOf(p.status)) return; // nunca volta para trás
  const { error } = await db.from("pedidos").update({ status, api_sincronizado: status, ...extra }).eq("id", p.id);
  if (error) throw new Error(error.message);
}

async function criarPedido(cfg: Cfg, apiId: string) {
  if (await pedidoDoApp(cfg, apiId)) return; // já existe
  const caminho = cfg.plataforma === "ifood" ? `/order/v1.0/orders/${apiId}` : `/v1/orders/${apiId}`;
  const { dados } = await chamar(cfg, "GET", caminho);
  const reg = cfg.plataforma === "ifood" ? converterIfood(dados) : converterOD(dados, cfg.plataforma);
  const { data: novo, error } = await db.from("pedidos").insert(reg).select("*").single();
  if (error) { if (error.code === "23505") return; throw new Error("Não consegui gravar o pedido: " + error.message); }
  await log(cfg.plataforma, "pedido novo", true, `#${novo.numero} (${reg.id_externo ?? apiId})`, novo.id);
  if (cfg.confirmar_auto) {
    try {
      await confirmarNoApp(cfg, novo);
      await db.from("pedidos").update({ status: "preparo", api_sincronizado: "preparo" }).eq("id", novo.id);
    } catch (e) { await log(cfg.plataforma, "confirmar", false, (e as Error).message, novo.id); }
  }
}

async function processar(cfg: Cfg, e: Evento) {
  const c = String(e.codigo || "").toUpperCase();
  if (NOVO.has(c)) return criarPedido(cfg, e.pedidoId);
  const p = await pedidoDoApp(cfg, e.pedidoId);
  if (!p) { if (CONFIRMOU.has(c)) return criarPedido(cfg, e.pedidoId); return; }
  if (CANCELOU.has(c)) { await statusDoApp(p, "cancelado", { motivo_cancelamento: `Cancelado no ${cfg.plataforma === "ifood" ? "iFood" : cfg.plataforma}` }); return log(cfg.plataforma, "cancelado no app", true, `#${p.numero}`, p.id); }
  if (CONCLUIU.has(c)) return statusDoApp(p, "entregue");
  if (CONFIRMOU.has(c)) return statusDoApp(p, "preparo");
  if (PRONTO.has(c)) return statusDoApp(p, "pronto");
  if (SAIU.has(c)) return statusDoApp(p, "saiu");
  if (PEDIU_CODIGO.has(c)) { await db.from("pedidos").update({ precisa_codigo_app: true }).eq("id", p.id); return; }
}

async function sincronizar(cfg: Cfg) {
  const evs = await buscarEventos(cfg);
  const feitos: Evento[] = [];
  for (const e of evs) {
    try { await processar(cfg, e); feitos.push(e); }
    catch (err) { await log(cfg.plataforma, `evento ${e.codigo}`, false, (err as Error).message); if (!(err instanceof ErroApp) || (err.status >= 400 && err.status < 500)) feitos.push(e); }
  }
  await confirmarEventos(cfg, feitos); // reconhece o que foi tratado (o resto volta no próximo polling)
  return evs.length;
}

// ---------------------------------------------------------------- painel → app
async function confirmarNoApp(cfg: Cfg, p: any) {
  if (cfg.plataforma === "ifood") return chamar(cfg, "POST", `/order/v1.0/orders/${p.api_pedido_id}/confirm`);
  return chamar(cfg, "POST", `/v1/orders/${p.api_pedido_id}/confirm`, { reason: "Pedido aceito", createdAt: new Date().toISOString(), orderExternalCode: String(p.numero), preparationTime: 30 });
}
async function enviarStatus(cfg: Cfg, p: any, status: string) {
  const id = p.api_pedido_id, ifood = cfg.plataforma === "ifood";
  const ignorar4xx = async (f: () => Promise<unknown>) => { try { await f(); } catch (e) { if (!(e instanceof ErroApp && e.status >= 400 && e.status < 500)) throw e; } };
  if (status === "preparo") {
    if (!["preparo", "pronto", "saiu", "entregue"].includes(p.api_sincronizado ?? "")) await confirmarNoApp(cfg, p);
    if (ifood) await ignorar4xx(() => chamar(cfg, "POST", `/order/v1.0/orders/${id}/startPreparation`));
  } else if (status === "pronto") {
    if (p.tipo === "entrega" && !p.entrega_pelo_app) return; // entrega própria: o próximo passo é "saiu"
    if (ifood) await chamar(cfg, "POST", `/order/v1.0/orders/${id}/readyToPickup`);
    else await chamar(cfg, "POST", `/v1/orders/${id}/readyForPickup`);
  } else if (status === "saiu") {
    if (p.entrega_pelo_app) return; // quem leva é o app
    if (ifood) await chamar(cfg, "POST", `/order/v1.0/orders/${id}/dispatch`);
    else await chamar(cfg, "POST", `/v1/orders/${id}/dispatch`, {});
  } else if (status === "cancelado") {
    const motivo = texto(p.motivo_cancelamento || "Cancelado pela loja", 250);
    if (ifood) {
      let codigo = "501";
      try { const { dados } = await chamar(cfg, "GET", `/order/v1.0/orders/${id}/cancellationReasons`); if (Array.isArray(dados) && dados[0]?.cancelCodeId) codigo = dados[0].cancelCodeId; } catch { /* usa o padrão */ }
      await chamar(cfg, "POST", `/order/v1.0/orders/${id}/requestCancellation`, { reason: motivo, cancellationCode: codigo });
    } else await chamar(cfg, "POST", `/v1/orders/${id}/requestCancellation`, { reason: motivo, code: "SYSTEMIC_ISSUES", mode: "AUTO" });
  } else return; // entregue: o app conclui sozinho (ou pelo código de entrega)
  await db.from("pedidos").update({ api_sincronizado: status }).eq("id", p.id);
}

async function verificarCodigo(cfg: Cfg, p: any, codigo: string): Promise<boolean> {
  if (cfg.plataforma !== "ifood") return true; // Open Delivery: o código é conferido no próprio app
  const { dados } = await chamar(cfg, "POST", `/order/v1.0/orders/${p.api_pedido_id}/verifyDeliveryCode`, { code: codigo });
  return dados?.valid === true || dados?.success === true;
}

// ---------------------------------------------------------------- entrada
async function config(plataforma: string): Promise<Cfg | null> {
  const { data } = await db.from("integracoes").select("*").eq("plataforma", plataforma).maybeSingle();
  return data as Cfg | null;
}
async function segredoOk(s: unknown) {
  const { data } = await db.from("config_privada").select("segredo").eq("id", 1).single();
  return !!data?.segredo && s === data.segredo;
}
async function ehAdmin(req: Request) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const { data } = await db.auth.getUser(token);
  if (!data?.user) return false;
  const { data: a } = await db.from("admins").select("user_id").eq("user_id", data.user.id).maybeSingle();
  return !!a;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erro: "Método não permitido" }, 405);
  const url = new URL(req.url);
  const bruto = await req.text();
  let b: any = {}; try { b = bruto ? JSON.parse(bruto) : {}; } catch { return json({ erro: "JSON inválido" }, 400); }

  // Open Delivery empurrando evento (webhook)
  const webhookDe = url.searchParams.get("plataforma");
  if (webhookDe) {
    const cfg = await config(webhookDe);
    if (!cfg?.ativo || !cfg.client_secret) return json({ erro: "integração desligada" }, 404);
    const assinatura = req.headers.get("x-app-signature") ?? "";
    if (assinatura.toLowerCase() !== (await hmacHex(cfg.client_secret, bruto))) { await log(webhookDe, "webhook", false, "assinatura inválida"); return json({ erro: "assinatura inválida" }, 401); }
    const lista = Array.isArray(b) ? b : [b];
    for (const e of lista) {
      try { await processar(cfg, { id: e.eventId ?? e.id, codigo: e.eventType, pedidoId: e.orderId, bruto: e }); }
      catch (err) { await log(webhookDe, `webhook ${e.eventType}`, false, (err as Error).message); }
    }
    return json({ ok: true }, 202);
  }

  try {
    if (b.acao === "sincronizar") {
      if (!(await segredoOk(b.segredo))) return json({ erro: "não autorizado" }, 401);
      const { data: cfgs } = await db.from("integracoes").select("*").eq("ativo", true).neq("plataforma", "aiqfome");
      const resumo: Record<string, unknown> = {};
      for (const cfg of (cfgs ?? []) as Cfg[]) {
        try {
          resumo[cfg.plataforma] = await sincronizar(cfg);
          await db.from("integracoes").update({ ultimo_sync: new Date().toISOString(), ultimo_erro: null }).eq("plataforma", cfg.plataforma);
        } catch (e) {
          resumo[cfg.plataforma] = (e as Error).message;
          await db.from("integracoes").update({ ultimo_erro: (e as Error).message.slice(0, 500), ultimo_erro_em: new Date().toISOString() }).eq("plataforma", cfg.plataforma);
        }
      }
      return json({ ok: true, resumo });
    }

    if (b.acao === "status") {
      if (!(await segredoOk(b.segredo))) return json({ erro: "não autorizado" }, 401);
      const { data: p } = await db.from("pedidos").select("*").eq("id", b.pedido_id).maybeSingle();
      if (!p?.api_pedido_id) return json({ ok: true, ignorado: true });
      const cfg = await config(p.canal);
      if (!cfg?.ativo) return json({ ok: true, ignorado: true });
      try { await enviarStatus(cfg, p, String(b.status)); await log(cfg.plataforma, `status ${b.status}`, true, `#${p.numero}`, p.id); }
      catch (e) { await log(cfg.plataforma, `status ${b.status}`, false, (e as Error).message, p.id); return json({ ok: false, erro: (e as Error).message }, 502); }
      return json({ ok: true });
    }

    if (b.acao === "verificar_codigo") {
      const { data: ent } = await db.from("entregadores").select("id").eq("token", String(b.token ?? "")).eq("ativo", true).maybeSingle();
      if (!ent) return json({ ok: false, erro: "Link inválido." }, 401);
      const { data: p } = await db.from("pedidos").select("*").eq("id", b.pedido_id).eq("entregador_id", ent.id).maybeSingle();
      if (!p || !["pronto", "saiu"].includes(p.status)) return json({ ok: false, erro: "Esse pedido não está mais com você." });
      const cfg = await config(p.canal);
      if (!cfg?.ativo) return json({ ok: false, erro: "A integração com o app está desligada. Peça para a loja finalizar." });
      const codigo = String(b.codigo ?? "").replace(/\D/g, "");
      let valido = false;
      try { valido = await verificarCodigo(cfg, p, codigo); }
      catch (e) { await log(cfg.plataforma, "código de entrega", false, (e as Error).message, p.id); return json({ ok: false, erro: "Não consegui falar com o app agora. Tente de novo." }); }
      if (!valido) { await log(cfg.plataforma, "código de entrega", false, "código errado", p.id); return json({ ok: false, erro: "Código errado. Confira com o cliente." }); }
      await db.from("pedidos").update({ status: "entregue", api_sincronizado: "entregue", entregue_com_codigo: true }).eq("id", p.id);
      await log(cfg.plataforma, "código de entrega", true, `#${p.numero}`, p.id);
      return json({ ok: true });
    }

    if (b.acao === "testar") {
      if (!(await ehAdmin(req))) return json({ erro: "não autorizado" }, 401);
      const cfg = await config(String(b.plataforma));
      if (!cfg) return json({ erro: "app desconhecido" }, 400);
      cfg.token = null; cfg.token_expira = null;
      await obterToken(cfg);
      let info = "Login no app OK.";
      if (cfg.plataforma === "ifood" && cfg.merchant_id) {
        const { dados } = await chamar(cfg, "GET", `/merchant/v1.0/merchants/${cfg.merchant_id}/status`);
        const st = Array.isArray(dados) ? dados.map((x: any) => `${x.operation ?? ""}: ${x.state ?? x.available ?? ""}`).join(", ") : "";
        info += st ? ` Loja: ${st}` : "";
      }
      await log(cfg.plataforma, "testar", true, info);
      return json({ ok: true, info });
    }

    return json({ erro: "ação desconhecida" }, 400);
  } catch (e) {
    return json({ ok: false, erro: (e as Error).message }, 500);
  }
});
