import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
export { SUPABASE_URL, SUPABASE_ANON_KEY };

export const brl = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const $ = (sel, el = document) => el.querySelector(sel);

export const NOMES_PAGAMENTO = {
  pix_online: "Pix online",
  cartao_online: "Cartão online",
  dinheiro: "Dinheiro",
  cartao_entrega: "Cartão (maquininha)",
  pix_entrega: "Pix (loja envia o código)",
  pago_app: "Pago no app",
  fiado: "Fiado",
};

export const CANAIS = {
  cardapio: { nome: "Cardápio digital", curto: "Cardápio", fundo: "#e4e4e7", texto: "#3f3f46" },
  balcao: { nome: "Balcão / telefone", curto: "Balcão", fundo: "#dbeafe", texto: "#1e40af" },
  mesa: { nome: "Mesa (QR Code)", curto: "Mesa", fundo: "#dcfce7", texto: "#166534" },
  ifood: { nome: "iFood", curto: "iFood", fundo: "#ea1d2c", texto: "#fff" },
  aiqfome: { nome: "aiqfome", curto: "aiqfome", fundo: "#7b1fa2", texto: "#fff" },
  keeta: { nome: "Keeta", curto: "Keeta", fundo: "#ffc300", texto: "#111" },
  "99food": { nome: "99Food", curto: "99Food", fundo: "#111", texto: "#ffdd00" },
};
export const APPS_DELIVERY = ["ifood", "aiqfome", "keeta", "99food"];

export const NOMES_STATUS = {
  aguardando_pagamento: "Aguardando pagamento",
  novo: "Recebido",
  preparo: "Em preparo",
  pronto: "Pronto",
  saiu: "Saiu para entrega",
  entregue: "Entregue",
  cancelado: "Cancelado",
};

export const NOMES_PAG_STATUS = { pendente: "pendente", pago: "PAGO", na_entrega: "a receber", falhou: "não aprovado" };

export const DIAS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

export const precoEfetivo = (p) =>
  p.preco_promocional != null && Number(p.preco_promocional) < Number(p.preco) ? Number(p.preco_promocional) : Number(p.preco);

/** Menor preço possível do produto, somando as opções obrigatórias mais baratas (ex.: marmita R$ 0 + tamanho). */
export function precoAPartir(p, grupos, opcoes) {
  let v = precoEfetivo(p);
  for (const g of grupos.filter((x) => x.produto_id === p.id && x.minimo > 0)) {
    const precos = opcoes.filter((o) => o.grupo_id === g.id && !o.esgotado).map((o) => Number(o.preco)).sort((a, b) => a - b);
    v += precos.slice(0, g.minimo).reduce((s, x) => s + x, 0);
  }
  return v;
}

export function foneWhats(tel) {
  const d = String(tel || "").replace(/\D/g, "");
  return d.startsWith("55") && d.length >= 12 ? d : "55" + d;
}

export function foneBonito(tel) {
  const d = String(tel || "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d;
}

const hhmm = (t) => String(t || "").slice(0, 5);

/** Próxima abertura da loja a partir dos horários cadastrados (horário de Brasília). */
export function proximaAbertura(horarios, agora = new Date()) {
  if (!horarios?.length) return null;
  const br = new Date(agora.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const minAgora = br.getHours() * 60 + br.getMinutes();
  for (let d = 0; d < 8; d++) {
    const dia = (br.getDay() + d) % 7;
    const doDia = horarios.filter((h) => h.dia_semana === dia).sort((a, b) => hhmm(a.abre).localeCompare(hhmm(b.abre)));
    for (const h of doDia) {
      const [hh, mm] = hhmm(h.abre).split(":").map(Number);
      if (d === 0 && hh * 60 + mm <= minAgora) continue;
      const quando = d === 0 ? "hoje" : d === 1 ? "amanhã" : DIAS[dia].toLowerCase();
      return `abre ${quando} às ${hhmm(h.abre)}`;
    }
  }
  return null;
}

export function textoHorarios(horarios) {
  return DIAS.map((nome, i) => {
    const h = (horarios || []).filter((x) => x.dia_semana === i).sort((a, b) => hhmm(a.abre).localeCompare(hhmm(b.abre)));
    return { nome, faixas: h.map((x) => `${hhmm(x.abre)} – ${hhmm(x.fecha)}`) };
  });
}

// Texto do pedido para enviar no WhatsApp / imprimir
export function textoPedido(p, loja, linkAcompanhar) {
  const l = [];
  l.push(`*Pedido #${p.numero}* — ${loja?.nome ?? ""}${CANAIS[p.canal] && APPS_DELIVERY.includes(p.canal) ? ` (${CANAIS[p.canal].nome}${p.id_externo ? " nº " + p.id_externo : ""})` : ""}`);
  l.push(`Cliente: ${p.cliente_nome}${p.cliente_telefone ? " (" + foneBonito(p.cliente_telefone) + ")" : ""}`);
  l.push(p.tipo === "entrega" ? `Entrega: ${p.endereco}${p.bairro ? " — " + p.bairro : ""}` : p.tipo === "mesa" ? `*Mesa ${p.mesa}*` : "Retirada no local");
  l.push("");
  for (const it of p.itens || []) {
    l.push(`${it.quantidade}x ${it.nome} — ${brl(it.total)}`);
    for (const a of it.adicionais || []) l.push(`   + ${a.quantidade > 1 ? a.quantidade + "x " : ""}${a.nome}`);
    if (it.observacao) l.push(`   Obs: ${it.observacao}`);
  }
  l.push("");
  l.push(`Subtotal: ${brl(p.subtotal)}`);
  if (Number(p.taxa_entrega)) l.push(`Entrega: ${brl(p.taxa_entrega)}`);
  if (Number(p.desconto)) l.push(`Desconto${p.cupom_codigo ? " (" + p.cupom_codigo + ")" : ""}: -${brl(p.desconto)}`);
  l.push(`*Total: ${brl(p.total)}*`);
  l.push(`Pagamento: ${NOMES_PAGAMENTO[p.pagamento]} (${NOMES_PAG_STATUS[p.pagamento_status] ?? p.pagamento_status})`);
  if (p.troco_para) l.push(`Troco para: ${brl(p.troco_para)}`);
  if (p.observacao) l.push(`Observação: ${p.observacao}`);
  if (linkAcompanhar) l.push("", `Acompanhar: ${linkAcompanhar}`);
  return l.join("\n");
}

// ---------- Taxa de entrega (mesma regra do servidor) ----------
export function taxaPorFaixa(km, faixas) {
  const ord = [...(faixas || [])].filter((f) => Number(f.ate) > 0).sort((a, b) => Number(a.ate) - Number(b.ate));
  const f = ord.find((x) => km <= Number(x.ate));
  return f ? Number(f.taxa) : null;
}
/** null = fora da área de entrega */
export function taxaDoBairro(loja, b) {
  const km = b.distancia_km == null ? null : Number(b.distancia_km);
  const fx = loja.faixas_km || [];
  const pelaFaixa = km != null && fx.length ? taxaPorFaixa(km, fx) : undefined;
  if (loja.modo_taxa === "raio" || loja.modo_taxa === "mapa") {
    if (pelaFaixa !== undefined) return pelaFaixa;
    return b.taxa != null ? Number(b.taxa) : Number(loja.taxa_entrega);
  }
  if (b.taxa != null) return Number(b.taxa);
  if (pelaFaixa !== undefined) return pelaFaixa;
  return Number(loja.taxa_entrega);
}
export const kmBonito = (km) => km == null ? "" : Number(km).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " km";

// ---------- Ruas da cidade (autocompletar endereço) ----------
const semAcento = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
let ruasMem = null;
/** Lista [nome, bairro_id, faixa] — guardada no aparelho por 7 dias */
export async function carregarRuas() {
  if (ruasMem) return ruasMem;
  try { const c = JSON.parse(localStorage.getItem("cacheRuas")); if (c && Date.now() - c.t < 7 * 864e5 && c.d?.length) return ruasMem = c.d; } catch {}
  const lista = [];
  for (let de = 0; de < 20000; de += 1000) {
    const { data, error } = await sb.from("ruas").select("nome,bairro_id,faixa").order("nome").range(de, de + 999);
    if (error || !data) break;
    lista.push(...data.map((r) => [r.nome, r.bairro_id, r.faixa || ""]));
    if (data.length < 1000) break;
  }
  ruasMem = lista;
  try { localStorage.setItem("cacheRuas", JSON.stringify({ t: Date.now(), d: lista })); } catch {}
  return lista;
}
/** Busca por palavras em qualquer ordem ("flores jardim" acha "Rua das Flores"). Só bairros atendidos. */
export function buscarRuas(lista, termo, bairros, max = 8) {
  const ps = semAcento(termo).replace(/^(rua|r\.|av\.?|avenida|travessa|tv\.?)\s+/, "").split(/\s+/).filter((p) => p.length > 1);
  if (!ps.length || !lista) return [];
  const porId = new Map(bairros.map((b) => [b.id, b]));
  const out = [];
  for (const [nome, bid, faixa] of lista) {
    const b = porId.get(bid); if (!b) continue;
    const n = semAcento(nome);
    if (ps.every((p) => n.includes(p))) out.push({ nome, bairro: b, faixa, comeca: n.replace(/^(rua|avenida|travessa|praca|alameda|estrada|rodovia)\s+/, "").startsWith(ps[0]) });
  }
  return out.sort((a, b) => (b.comeca - a.comeca) || a.nome.localeCompare(b.nome)).slice(0, max);
}

// ---------- WhatsApp automático (mesmos textos padrão da função avisar-whatsapp) ----------
export const MSG_WHATS_PADRAO = {
  novo: "Olá, {nome}! 😊 Recebemos seu pedido *#{numero}* na *{loja}*.\nTotal: *{total}*\n{pix}Acompanhe aqui: {link}",
  preparo: "👨‍🍳 {nome}, seu pedido *#{numero}* foi aceito e já está sendo preparado! Previsão: {tempo}.",
  pronto: "✅ {nome}, seu pedido *#{numero}* está pronto! Pode vir buscar. 🏪",
  saiu: "🛵 {nome}, seu pedido *#{numero}* saiu para entrega{entregador}! Já já chega aí.{codigo}",
  entregue: "🎉 Pedido *#{numero}* entregue. Bom apetite, {nome}!\nConta pra gente como foi: {link}",
  cancelado: "❌ {nome}, seu pedido *#{numero}* foi cancelado.{motivo}\nQualquer dúvida, é só responder esta mensagem.",
};
export const MSG_WHATS_ROTULO = {
  novo: "📋 Pedido recebido", preparo: "👨‍🍳 Aceito / em preparo", pronto: "✅ Pronto para retirar",
  saiu: "🛵 Saiu para entrega", entregue: "🎉 Entregue", cancelado: "❌ Cancelado",
};

// ---------- Mapa (raio em linha reta, igual ao aiqfome) ----------
export function kmLinhaReta(lat1, lng1, lat2, lng2) {
  const r = (g) => g * Math.PI / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}
export const CORES_FAIXA = ["#16a34a", "#65a30d", "#ca8a04", "#ea580c", "#dc2626", "#be185d", "#7c3aed", "#2563eb"];
let leafletPromessa = null;
/** Carrega o Leaflet (mapa do OpenStreetMap) só quando precisar. */
export function carregarLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  return leafletPromessa ??= new Promise((ok, falha) => {
    const css = document.createElement("link"); css.rel = "stylesheet"; css.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"; document.head.appendChild(css);
    const js = document.createElement("script"); js.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    js.onload = () => ok(window.L); js.onerror = () => { leafletPromessa = null; falha(new Error("Não consegui carregar o mapa")); };
    document.head.appendChild(js);
  });
}
/** Desenha a loja e os círculos das faixas de km. Devolve as camadas criadas. */
export function desenharRaios(L, mapa, loja, faixas, { rotulos = true } = {}) {
  const camadas = [];
  const fx = [...(faixas || [])].filter((f) => Number(f.ate) > 0).sort((a, b) => b.ate - a.ate); // maior primeiro (fica embaixo)
  fx.forEach((f) => {
    const k = [...fx].reverse().indexOf(f), cor = CORES_FAIXA[k % CORES_FAIXA.length];
    const c = L.circle([loja.lat, loja.lng], { radius: Number(f.ate) * 1000, color: cor, weight: 2, fillColor: cor, fillOpacity: 0.08, interactive: false }).addTo(mapa);
    camadas.push(c);
    if (rotulos) {
      const topo = L.latLng(loja.lat + Number(f.ate) / 111.32, loja.lng);
      camadas.push(L.marker(topo, { interactive: false, icon: L.divIcon({ className: "rotulo-raio", html: `<span style="border-color:${cor};color:${cor}">até ${String(f.ate).replace(".", ",")} km · ${Number(f.taxa) ? brl(f.taxa) : "grátis"}</span>`, iconSize: null }) }).addTo(mapa));
    }
  });
  camadas.push(L.marker([loja.lat, loja.lng], { icon: L.divIcon({ className: "pino-loja", html: "🏪", iconSize: [30, 30], iconAnchor: [15, 15] }) }).addTo(mapa));
  return camadas;
}
export const CSS_MAPA = `.rotulo-raio span{display:inline-block;transform:translate(-50%,-50%);background:#fff;border:1.5px solid;border-radius:999px;padding:1px 7px;font:600 11px system-ui;white-space:nowrap}
.pino-loja{font-size:22px;line-height:30px;text-align:center;background:#fff;border-radius:50%;box-shadow:0 1px 4px #0005}
.pino-cliente{font-size:30px;line-height:30px;text-align:center;filter:drop-shadow(0 2px 2px #0006)}`;

// ---------- Pedido agendado / cardápio do dia ----------
/** Dia da semana (0 = domingo) no horário de Brasília. */
export function diaBR(d = new Date()) {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short" }).format(d));
}
/** O produto aparece nesse dia da semana? (vazio = todos os dias) */
export const doDia = (p, dia) => !p.dias_semana?.length || p.dias_semana.includes(dia);
/**
 * Horários para agendar, de 30 em 30 min, dentro do funcionamento, de hoje até `dias` dias.
 * Devolve [{ dia: "2026-11-26", rotulo: "Amanhã · qui 26/11", dow, horas: [{ iso, hora: "11:30" }] }]
 */
export function horariosParaAgendar(horarios, dias = 2, agora = new Date(), antecedenciaMin = 30) {
  const parte = (d) => Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(d).filter((x) => x.type !== "literal").map((x) => [x.type, x.value]));
  const limite = agora.getTime() + antecedenciaMin * 60000;
  const saida = [];
  for (let k = 0; k <= dias; k++) {
    const base = new Date(agora.getTime() + k * 86400000), p = parte(base), ymd = `${p.year}-${p.month}-${p.day}`;
    const dow = diaBR(new Date(`${ymd}T12:00:00-03:00`));
    const faixas = horarios?.length ? horarios.filter((h) => h.dia_semana === dow).map((h) => [hhmm(h.abre), hhmm(h.fecha)]) : [["08:00", "22:00"]];
    const horas = [];
    for (const [abre, fecha] of faixas) {
      const [ah, am] = abre.split(":").map(Number), [fh, fm] = fecha.split(":").map(Number);
      let ini = ah * 60 + am, fim = fh * 60 + fm; if (fim <= ini) fim = 24 * 60; // passa da meia-noite: até 23:30
      for (let t = Math.ceil(ini / 30) * 30; t < fim; t += 30) {
        const hora = `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
        const iso = new Date(`${ymd}T${hora}:00-03:00`).toISOString();
        if (new Date(iso).getTime() >= limite && !horas.some((x) => x.iso === iso)) horas.push({ iso, hora });
      }
    }
    horas.sort((a, b) => a.iso.localeCompare(b.iso));
    if (horas.length) saida.push({ dia: ymd, dow, horas, rotulo: `${k === 0 ? "Hoje · " : k === 1 ? "Amanhã · " : ""}${DIAS[dow].slice(0, 3).toLowerCase()} ${p.day}/${p.month}` });
  }
  return saida;
}
export const textoAgendado = (iso) => { const d = new Date(iso);
  return `${DIAS[diaBR(d)].slice(0, 3).toLowerCase()} ${d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" })} às ${d.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })}`; };
