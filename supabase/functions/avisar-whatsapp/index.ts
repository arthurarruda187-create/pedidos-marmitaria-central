// Função "avisar-whatsapp": manda a mensagem de status do pedido no WhatsApp do cliente (Evolution API no PC da loja, ou Z-API).
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

// ---------- Evolution API (no PC da loja, exposta por um túnel) ----------
const INSTANCIA_PADRAO = "marmitaria";
class ErroEvo extends Error { constructor(m: string, public status = 0) { super(m); } }

async function evo(cfg: any, metodo: string, caminho: string, corpo?: unknown) {
  if (!cfg?.evo_url) throw new ErroEvo("O PC do WhatsApp ainda não se conectou. Confira se ele está ligado com o Docker aberto.");
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20000);
  let r: Response;
  try {
    r = await fetch(cfg.evo_url.replace(/\/$/, "") + caminho, {
      method: metodo, signal: ctl.signal,
      headers: { "Content-Type": "application/json", apikey: cfg.zapi_token },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
  } catch {
    throw new ErroEvo("Não consegui falar com o PC do WhatsApp (desligado, sem internet ou Docker fechado).");
  } finally { clearTimeout(t); }
  const d: any = await r.json().catch(() => ({}));
  if (!r.ok || d?.error === true) {
    const bruto = d?.response?.message ?? d?.message ?? d?.error ?? "";
    const m = (Array.isArray(bruto) ? bruto : [bruto]).map((x: unknown) => typeof x === "string" ? x : JSON.stringify(x)).join(" ");
    if (r.status === 401) throw new ErroEvo("A chave da Evolution está errada. Copie de novo com o VER-CHAVE no PC.", 401);
    if ([502, 503, 530].includes(r.status)) throw new ErroEvo("O PC do WhatsApp não respondeu (túnel caiu). Ele se reconecta sozinho em 1 minuto.", r.status);
    throw new ErroEvo(`Evolution respondeu ${r.status} ${String(m)}`.trim(), r.status);
  }
  return d;
}

async function evoEstado(cfg: any): Promise<string> {
  try { const d = await evo(cfg, "GET", `/instance/connectionState/${cfg.zapi_instancia || INSTANCIA_PADRAO}`); return d?.instance?.state || "close"; }
  catch (e) { if (e instanceof ErroEvo && e.status === 404) return "inexistente"; throw e; }
}

async function evoConectar(cfg: any) {
  const nome = cfg.zapi_instancia || INSTANCIA_PADRAO;
  const estado = await evoEstado(cfg);
  if (estado === "open") return { estado };
  let d: any;
  if (estado === "inexistente") {
    d = await evo(cfg, "POST", "/instance/create", { instanceName: nome, integration: "WHATSAPP-BAILEYS", qrcode: true });
    d = d?.qrcode ?? {};
    if (!d.base64) { await new Promise((r) => setTimeout(r, 2500)); d = await evo(cfg, "GET", `/instance/connect/${nome}`); }
  } else d = await evo(cfg, "GET", `/instance/connect/${nome}`);
  if (d?.instance?.state === "open") return { estado: "open" };
  return { estado: "qr", qr: d?.base64 || null };
}

function iguais(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

async function enviar(cfg: any, telefone: string, texto: string) {
  if (cfg?.zapi_tipo === "evolution") {
    if (!cfg.zapi_token) throw new Error("Cole a chave da Evolution no painel.");
    try {
      return await evo(cfg, "POST", `/message/sendText/${cfg.zapi_instancia || INSTANCIA_PADRAO}`, { number: fone(telefone), text: texto, delay: 1200 });
    } catch (e) {
      if (e instanceof ErroEvo && e.status !== 401 && e.status < 500 && e.status > 0) {
        const st = await evoEstado(cfg).catch(() => "");
        if (st && st !== "open") throw new Error("WhatsApp desconectado no PC — clique em Conectar WhatsApp no painel e leia o QR Code.");
        if (/exists.*false|not.*exist|number/i.test(e.message)) throw new Error("Esse número não tem WhatsApp.");
      }
      throw e;
    }
  }
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

  // O PC da loja avisa o endereço do túnel (a cada 5 min e sempre que ele muda). Autenticado pela chave da Evolution.
  if (e.evo === "registrar") {
    const url = String(e.url || "").trim().replace(/\/$/, "");
    if (!cfg || cfg.zapi_tipo !== "evolution" || !iguais(String(e.chave || ""), String(cfg.zapi_token || "")))
      return json({ erro: "chave não confere — cole a chave no painel (WhatsApp automático → Evolution)" }, 401);
    if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(url)) return json({ erro: "endereço inválido" }, 400);
    const { error } = await db.from("config_privada").update({ evo_url: url, evo_visto_em: new Date().toISOString() }).eq("id", 1);
    return error ? json({ erro: error.message }, 500) : json({ ok: true });
  }

  // Painel: estado / QR Code / desconectar
  if (e.evo === "estado" || e.evo === "conectar" || e.evo === "sair") {
    if (!(await ehAdmin(req))) return json({ erro: "Somente o dono da loja." }, 403);
    if (cfg?.zapi_tipo !== "evolution" || !cfg?.zapi_token) return json({ erro: "Salve a chave da Evolution primeiro." }, 400);
    const base = { visto_em: cfg.evo_visto_em || null, tem_url: !!cfg.evo_url };
    try {
      if (e.evo === "estado") return json({ ...base, estado: await evoEstado(cfg) });
      if (e.evo === "conectar") return json({ ...base, ...(await evoConectar(cfg)) });
      await evo(cfg, "DELETE", `/instance/logout/${cfg.zapi_instancia || INSTANCIA_PADRAO}`).catch((x) => { if (!(x instanceof ErroEvo && x.status === 400)) throw x; });
      return json({ ...base, estado: "close" });
    } catch (err) { return json({ ...base, estado: "offline", erro: (err as Error).message }); }
  }

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
