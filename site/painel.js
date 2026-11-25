import { sb, SUPABASE_URL, SUPABASE_ANON_KEY, brl, esc, $, NOMES_PAGAMENTO, NOMES_PAG_STATUS, NOMES_STATUS, DIAS,
  foneWhats, foneBonito, textoPedido, precoEfetivo, precoAPartir, CANAIS, APPS_DELIVERY, taxaDoBairro, kmBonito, carregarRuas, buscarRuas, MSG_WHATS_PADRAO, MSG_WHATS_ROTULO } from "./comum.js";
import { ligarBotaoInstalar, manterTelaAcesa } from "./app.js";

// ======================================================================
// Estado
// ======================================================================
let loja = null;
let abertaAgora = false;
let pedidos = new Map();
let entregadores = [];
let aba = "pedidos";
let somAtivo = false, audio = null;
const C = () => $("#conteudo");
const hoje0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const hora = (iso) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const dataBR = (iso) => new Date(iso).toLocaleDateString("pt-BR");
const imgCss = (url) => url ? `background-image:url('${esc(url).replace(/'/g, "%27")}')` : "";
const num = (v) => Number(v || 0);

// ======================================================================
// Login
// ======================================================================
async function iniciar() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return mostrarLogin();
  const { data: admin } = await sb.rpc("is_admin");
  if (!admin) { await sb.auth.signOut(); return mostrarLogin("Este usuário não é administrador da loja."); }
  $("#telaLogin").classList.add("oculto");
  $("#app").classList.remove("oculto");
  $("#linkCardapio").href = new URL("./", location.href).href;
  ligarBotaoInstalar($("#btnInstalar"), "o Painel da Loja");
  await Promise.all([carregarLoja(), carregarEntregadores()]);
  await carregarPedidos();
  assinarTempoReal();
  irPara(location.hash.slice(1) || "pedidos");
}
function mostrarLogin(msg = "") {
  $("#app").classList.add("oculto");
  $("#telaLogin").classList.remove("oculto");
  $("#lErro").textContent = msg;
}
$("#lEntrar").onclick = async () => {
  $("#lErro").textContent = "";
  const { error } = await sb.auth.signInWithPassword({ email: $("#lEmail").value.trim(), password: $("#lSenha").value });
  if (error) { $("#lErro").textContent = "E-mail ou senha incorretos."; return; }
  iniciar();
};
$("#lSenha").onkeydown = (e) => { if (e.key === "Enter") $("#lEntrar").click(); };
$("#sair").onclick = async () => { await sb.auth.signOut(); location.reload(); };

// ======================================================================
// Navegação
// ======================================================================
const ABAS = { pedidos: telaPedidos, pdv: telaPdv, financeiro: telaFinanceiro, clientes: telaClientes, entregadores: telaEntregadores,
  cardapio: telaCardapio, cupons: telaCupons, entrega: telaEntrega, loja: telaLoja, avaliacoes: telaAvaliacoes, mesas: telaMesas, whatsapp: telaWhatsapp };
function irPara(nome) {
  if (!ABAS[nome]) nome = "pedidos";
  aba = nome;
  history.replaceState(null, "", "#" + nome);
  document.querySelectorAll("#menu button").forEach((b) => b.classList.toggle("ativa", b.dataset.aba === nome));
  $("#lateral").classList.remove("aberta");
  ABAS[nome]();
}
document.querySelectorAll("#menu button").forEach((b) => b.onclick = () => irPara(b.dataset.aba));
const botaoMenu = () => `<button class="btn sec menu-movel" onclick="document.getElementById('lateral').classList.add('aberta')">☰</button>`;
document.addEventListener("click", (e) => { const l = $("#lateral"); if (l.classList.contains("aberta") && !l.contains(e.target) && !e.target.closest(".menu-movel")) l.classList.remove("aberta"); });

function abrirModal(html, largura = 640) {
  const f = document.createElement("div");
  f.className = "fundo-modal";
  f.innerHTML = `<div class="modal" style="max-width:${largura}px"><button class="fechar" aria-label="Fechar">×</button>${html}</div>`;
  f.addEventListener("click", (e) => { if (e.target.closest(".fechar")) f.remove(); });
  $("#modais").appendChild(f);
  return f;
}


// ----------------------------------------------------------------------
// Popups do painel (substituem as janelas padrão do navegador)
// ----------------------------------------------------------------------
/** Formulário em popup. Resolve com {campo: valor} ou null se cancelar. */
function formulario({ titulo, texto = "", campos = [], botao = "Salvar", perigo = false, sugestoes = null, cancelar = "Cancelar" }) {
  return new Promise((resolver) => {
    const f = document.createElement("div");
    f.className = "fundo-modal";
    f.innerHTML = `<form class="modal popup" style="max-width:440px" novalidate>
      <h2 style="margin:0 0 .3rem">${titulo}</h2>
      ${texto ? `<p class="muted" style="margin:0 0 .4rem">${texto}</p>` : ""}
      ${campos.map((c, i) => `<label class="rot">${esc(c.rotulo)}${c.opcional ? ` <span class="muted">(opcional)</span>` : ""}</label>
        ${c.tipo === "textarea" ? `<textarea class="campo" name="${c.nome}" rows="3" placeholder="${esc(c.placeholder || "")}">${esc(c.valor ?? "")}</textarea>`
          : c.tipo === "select" ? `<select class="campo" name="${c.nome}">${(c.opcoes || []).map(([v, t]) => `<option value="${esc(v)}" ${String(c.valor ?? "") === String(v) ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>`
          : `<div style="position:relative">${c.prefixo ? `<span style="position:absolute;left:.75rem;top:50%;transform:translateY(-50%);color:var(--suave)">${c.prefixo}</span>` : ""}
             <input class="campo" name="${c.nome}" type="${c.tipo === "number" ? "text" : c.tipo || "text"}" ${c.tipo === "number" ? 'inputmode="decimal" autocomplete="off"' : ""}
               value="${esc(c.valor ?? "")}" placeholder="${esc(c.placeholder || "")}" ${c.prefixo ? 'style="padding-left:2.3rem"' : ""} ${i === 0 ? "autofocus" : ""}></div>`}
        ${c.sugestoes ? `<div class="chips" style="margin:.35rem 0 0">${c.sugestoes.map((t) => `<button type="button" data-sug-campo="${c.nome}" data-v="${esc(t)}">${esc(t)}</button>`).join("")}</div>` : ""}
        ${c.dica ? `<small class="muted">${esc(c.dica)}</small>` : ""}`).join("")}
      ${sugestoes ? `<div class="chips" style="margin:.6rem 0 0">${sugestoes.map((t) => `<button type="button" data-sug="${esc(t)}">${esc(t)}</button>`).join("")}</div>` : ""}
      <div class="erro" data-erro></div>
      <div style="display:flex;gap:.6rem;justify-content:flex-end;margin-top:.4rem">
        <button type="button" class="btn sec" data-cancelar>${cancelar}</button>
        <button type="submit" class="btn ${perigo ? "perigo-cheio" : ""}">${botao}</button>
      </div></form>`;
    const form = f.querySelector("form");
    const fechar = (v) => { f.remove(); document.removeEventListener("keydown", esc_); resolver(v); };
    const esc_ = (e) => { if (e.key === "Escape") fechar(null); };
    document.addEventListener("keydown", esc_);
    f.addEventListener("mousedown", (e) => { if (e.target === f) fechar(null); });
    form.querySelector("[data-cancelar]").onclick = () => fechar(null);
    form.querySelectorAll("[data-sug-campo]").forEach((b) => b.onclick = () => { form.elements[b.dataset.sugCampo].value = b.dataset.v; });
    form.querySelectorAll("[data-sug]").forEach((b) => b.onclick = () => { const t = form.querySelector("textarea,input"); t.value = b.dataset.sug; t.focus(); });
    form.onsubmit = (e) => {
      e.preventDefault();
      const dados = {};
      for (const c of campos) {
        const el = form.elements[c.nome];
        let v = el.value.trim();
        if (c.tipo === "number") v = v === "" ? null : Number(v.replace(/\s|R\$/g, "").replace(/\.(?=\d{3}(,|$))/g, "").replace(",", "."));
        if (!c.opcional && c.tipo !== "select" && (v === "" || v == null || (c.tipo === "number" && !(v >= 0)))) {
          form.querySelector("[data-erro]").textContent = `Preencha: ${c.rotulo}`; el.focus(); return;
        }
        dados[c.nome] = v;
      }
      fechar(dados);
    };
    $("#modais").appendChild(f);
    setTimeout(() => form.querySelector("input,textarea")?.focus(), 30);
  });
}

/** Confirmação em popup. Resolve true/false. */
function confirmar(titulo, texto = "", { botao = "Confirmar", perigo = false, cancelar = "Cancelar" } = {}) {
  return new Promise((resolver) => {
    const f = document.createElement("div");
    f.className = "fundo-modal";
    f.innerHTML = `<div class="modal popup" style="max-width:420px">
      <h2 style="margin:0 0 .4rem">${titulo}</h2>${texto ? `<p class="muted" style="margin:0">${texto}</p>` : ""}
      <div style="display:flex;gap:.6rem;justify-content:flex-end;margin-top:1.2rem">
        <button class="btn sec" data-nao>${cancelar}</button><button class="btn ${perigo ? "perigo-cheio" : ""}" data-sim>${botao}</button></div></div>`;
    const fechar = (v) => { f.remove(); document.removeEventListener("keydown", tecla); resolver(v); };
    const tecla = (e) => { if (e.key === "Escape") fechar(false); if (e.key === "Enter") fechar(true); };
    document.addEventListener("keydown", tecla);
    f.addEventListener("mousedown", (e) => { if (e.target === f) fechar(false); });
    f.querySelector("[data-nao]").onclick = () => fechar(false);
    f.querySelector("[data-sim]").onclick = () => fechar(true);
    $("#modais").appendChild(f);
    f.querySelector("[data-sim]").focus();
  });
}

/** Aviso rápido no canto da tela. tipo: "ok" | "erro" | "info" */
function aviso(msg, tipo = "info") {
  let caixa = $("#avisos");
  if (!caixa) { caixa = document.createElement("div"); caixa.id = "avisos"; document.body.appendChild(caixa); }
  const t = document.createElement("div");
  t.className = "toast " + tipo;
  t.innerHTML = `<span>${tipo === "ok" ? "✓" : tipo === "erro" ? "⚠" : "ℹ"}</span><div>${esc(msg)}</div>`;
  caixa.appendChild(t);
  setTimeout(() => { t.classList.add("saindo"); setTimeout(() => t.remove(), 300); }, tipo === "erro" ? 6000 : 3000);
}

// busca paginada (o Supabase devolve no máximo 1000 linhas por vez)
async function buscarTodos(montar) {
  const tudo = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await montar().range(de, de + 999);
    if (error) throw error;
    tudo.push(...data);
    if (data.length < 1000) break;
  }
  return tudo;
}

// ======================================================================
// Loja aberta / som
// ======================================================================
async function carregarLoja() {
  const [{ data }, { data: ab }] = await Promise.all([sb.from("loja").select("*").eq("id", 1).single(), sb.rpc("loja_aberta_agora")]);
  loja = data; abertaAgora = !!ab;
  $("#mNome").textContent = loja.nome;
  $("#mLogo").style.cssText = imgCss(loja.logo_url);
  $("#mLogo").textContent = loja.logo_url ? "" : (loja.nome || "?")[0];
  document.documentElement.style.setProperty("--cor", loja.cor || "#e4002b");
  const ch = $("#chaveAberta");
  ch.classList.toggle("on", abertaAgora);
  ch.querySelector("span").textContent = abertaAgora ? "Loja aberta" : "Loja fechada";
  ch.querySelector("small").textContent = !loja.aberta ? "pausada manualmente" : loja.horario_automatico ? "horário automático" : "clique para fechar";
}
$("#chaveAberta").onclick = async () => {
  const nova = !loja.aberta;
  if (!nova && !(await confirmar("Pausar a loja?", "O cardápio vai parar de aceitar pedidos até você reabrir.", { botao: "Pausar loja", perigo: true }))) return;
  const { error } = await sb.from("loja").update({ aberta: nova }).eq("id", 1);
  if (error) return aviso("Não foi possível alterar: " + error.message, "erro");
  await carregarLoja();
  aviso(nova ? "Loja reaberta" : "Loja pausada", "ok");
};
setInterval(carregarLoja, 60000);

function bip() {
  if (!somAtivo) return;
  audio ??= new AudioContext();
  const t = audio.currentTime;
  for (const [i, f] of [[0, 880], [0.18, 1175], [0.36, 880], [0.54, 1175]]) {
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = f; o.type = "square";
    g.gain.setValueAtTime(0.0001, t + i); g.gain.exponentialRampToValueAtTime(0.25, t + i + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + i + 0.16);
    o.connect(g).connect(audio.destination); o.start(t + i); o.stop(t + i + 0.17);
  }
}
function ligarSom(v) {
  somAtivo = v;
  if (somAtivo) { audio ??= new AudioContext(); audio.resume(); bip(); }
  manterTelaAcesa(somAtivo); // com a campainha ligada, a tela do celular/tablet não apaga
  const ch = $("#chaveSom");
  ch.classList.toggle("on", somAtivo);
  ch.querySelector("span").textContent = somAtivo ? "Som ligado" : "Som desligado";
  ch.querySelector("small").textContent = somAtivo ? "campainha · tela sempre acesa" : "clique para ligar";
  if (aba === "pedidos") telaPedidos();
}
$("#chaveSom").onclick = () => ligarSom(!somAtivo);
setInterval(() => {
  const novos = [...pedidos.values()].filter((p) => p.status === "novo").length;
  if (novos) bip();
  document.title = novos ? `(${novos}) NOVO PEDIDO` : "Painel da loja";
  const c = $("#contNovos"); c.textContent = novos; c.classList.toggle("oculto", !novos);
}, 4000);

// ======================================================================
// Pedidos (tempo real)
// ======================================================================
async function carregarPedidos() {
  const [a, h] = await Promise.all([
    sb.from("pedidos").select("*").in("status", ["aguardando_pagamento", "novo", "preparo", "pronto", "saiu"]).order("criado_em").limit(500),
    sb.from("pedidos").select("*").gte("criado_em", hoje0().toISOString()).order("criado_em").limit(1000),
  ]);
  pedidos = new Map();
  for (const p of [...(a.data || []), ...(h.data || [])]) pedidos.set(p.id, p);
  if (aba === "pedidos") telaPedidos();
  autoImprimir();
}
let conexao = "";
let colMovel = null, colMovelVisto = 0; // aba de coluna escolhida no celular
function assinarTempoReal() {
  sb.channel("pedidos")
    .on("postgres_changes", { event: "*", schema: "public", table: "pedidos" }, (msg) => {
      if (msg.eventType === "DELETE") pedidos.delete(msg.old.id); else pedidos.set(msg.new.id, msg.new);
      if (aba === "pedidos") telaPedidos();
      autoImprimir();
    })
    .subscribe((st) => { conexao = st; if (st === "SUBSCRIBED") carregarPedidos(); else if (aba === "pedidos") telaPedidos(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) carregarPedidos(); });
  setInterval(carregarPedidos, 20000);
}

async function carregarEntregadores() {
  const { data } = await sb.from("entregadores").select("*").order("nome");
  entregadores = data || [];
}

const lojaUltimaFaixa = () => { const fx = [...(loja.faixas_km || [])].sort((a, b) => a.ate - b.ate); return fx.length ? num(fx[fx.length - 1].taxa) : num(loja.taxa_entrega); };

function seloCanal(p) {
  if (!p.canal || p.canal === "cardapio") return "";
  const c = CANAIS[p.canal] || { curto: p.canal, fundo: "#eee", texto: "#333" };
  return `<span class="badge" style="background:${c.fundo};color:${c.texto}">${esc(c.curto)}${p.id_externo ? " nº " + esc(p.id_externo) : ""}</span>`;
}

function badgePagamento(p) {
  if (p.pagamento === "pago_app") return `<span class="badge ok">✓ PAGO NO APP</span>`;
  if (p.pagamento_status === "pago") return `<span class="badge ok">✓ PAGO · ${esc(NOMES_PAGAMENTO[p.pagamento])}</span>`;
  if (p.pagamento === "pix_entrega") return `<span class="badge roxo">💠 Pix a confirmar</span>`;
  if (p.pagamento_status === "na_entrega") return `<span class="badge">${esc(NOMES_PAGAMENTO[p.pagamento])}</span>`;
  return `<span class="badge alerta">${esc(NOMES_PAG_STATUS[p.pagamento_status])}</span>`;
}

// tempo desde o pedido: amarelo/vermelho quando está demorando
function atualizarTempos() {
  document.querySelectorAll(".tempo[data-desde]").forEach((el) => {
    const min = Math.max(0, Math.floor((Date.now() - new Date(el.dataset.desde)) / 60000));
    const [aten, atras] = el.dataset.st === "novo" ? [5, 10] : [35, 55];
    el.textContent = min < 60 ? `${min} min` : `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`;
    el.classList.toggle("atencao", min >= aten && min < atras); el.classList.toggle("atrasado", min >= atras);
    el.title = el.dataset.st === "novo" ? "Esperando aceitar" : "Tempo desde o pedido";
  });
}
setInterval(atualizarTempos, 30000);

function cardPedido(p) {
  const proximo = {
    novo: ["preparo", "✓ Aceitar pedido"], preparo: ["pronto", "Pronto"],
    pronto: p.tipo === "entrega" ? ["saiu", "🛵 Saiu para entrega"] : p.tipo === "mesa" ? ["entregue", "🍽️ Servido na mesa"] : ["entregue", "Retirado pelo cliente"],
    saiu: ["entregue", "Entregue"],
  }[p.status];
  const ent = entregadores.find((e) => e.id === p.entregador_id);
  return `<div class="card ${p.status === "novo" ? "piscar" : ""}" data-id="${p.id}">
    <div class="topo"><b>#${p.numero}</b><span style="display:flex;gap:.3rem;align-items:center">${seloCanal(p)}<span class="muted">${hora(p.criado_em)}</span>${["novo", "preparo", "pronto", "saiu"].includes(p.status) ? `<span class="tempo" data-desde="${p.criado_em}" data-st="${p.status}"></span>` : ""}</span></div>
    <div class="linha"><b>${esc(p.cliente_nome)}</b>${p.cliente_telefone ? ` · ${esc(foneBonito(p.cliente_telefone))}` : ""}</div>
    <div class="linha">${p.tipo === "entrega" ? `🛵 ${esc(p.endereco)}${p.bairro ? ` <b>· ${esc(p.bairro)}</b>` : ""}` : p.tipo === "mesa" ? `<b style="font-size:1.05rem">🍽️ MESA ${esc(p.mesa)}</b>` : "🏪 Retirada no local"}</div>
    <ul>${(p.itens || []).map((it) => `<li><b>${it.quantidade}x</b> ${esc(it.nome)}
      ${(it.adicionais || []).map((a) => `<small>+ ${a.quantidade > 1 ? a.quantidade + "x " : ""}${esc(a.nome)}</small>`).join("")}
      ${it.observacao ? `<small>📝 ${esc(it.observacao)}</small>` : ""}</li>`).join("")}</ul>
    ${p.observacao ? `<div class="linha">📝 ${esc(p.observacao)}</div>` : ""}
    <div class="linha" style="display:flex;justify-content:space-between;align-items:center;gap:.4rem"><b style="font-size:1rem">${brl(p.total)}</b>${badgePagamento(p)}</div>
    ${num(p.desconto) ? `<div class="linha muted">Desconto ${esc(p.cupom_codigo || "")}: −${brl(p.desconto)}</div>` : ""}
    ${p.troco_para ? `<div class="linha">💵 Troco para ${brl(p.troco_para)} <b>(levar ${brl(p.troco_para - p.total)})</b></div>` : ""}
    ${p.tipo === "entrega" && entregadores.length ? `<div class="linha"><select class="campo" data-entregador>
      <option value="">— escolher entregador —</option>${entregadores.filter((e) => e.ativo || e.id === p.entregador_id).map((e) => `<option value="${e.id}" ${e.id === p.entregador_id ? "selected" : ""}>${esc(e.nome)}</option>`).join("")}</select></div>` : ""}
    <div class="acoes">
      ${proximo ? `<button class="btn ${p.status === "novo" ? "ok" : "escuro"} principal" data-acao="status" data-para="${proximo[0]}">${proximo[1]}</button>` : ""}
      ${p.pagamento === "pix_entrega" && p.pagamento_status !== "pago" ? `<button class="btn sec peq" data-acao="enviarpix">💠 Enviar Pix</button><button class="btn sec peq" data-acao="pago">✓ Marcar pago</button>` : ""}
      <button class="btn sec peq" data-acao="imprimir">🖨 Imprimir</button>
      ${p.cliente_telefone ? `<button class="btn sec peq" data-acao="whats">💬 Cliente</button>` : ""}
      ${ent?.telefone ? `<button class="btn sec peq" data-acao="whatsent">🛵 Entregador</button>` : ""}
      <button class="btn perigo peq" data-acao="cancelar">Cancelar</button>
    </div></div>`;
}

function telaPedidos() {
  const lista = [...pedidos.values()].sort((a, b) => a.criado_em.localeCompare(b.criado_em));
  const de = (...st) => lista.filter((p) => st.includes(p.status));
  const ini = hoje0().toISOString();
  const validos = lista.filter((p) => p.criado_em >= ini && !["cancelado", "aguardando_pagamento"].includes(p.status));
  const aguard = de("aguardando_pagamento");
  const fim = lista.filter((p) => ["entregue", "cancelado"].includes(p.status) && p.criado_em >= ini).reverse();
  const novos = de("novo"), preparo = de("preparo"), prontos = de("pronto", "saiu");
  if (colMovel == null) colMovel = novos.length ? 0 : preparo.length ? 1 : 0;
  if (novos.length && colMovelVisto < novos.length) { colMovel = 0; colMovelVisto = novos.length; } // pedido novo chegou: mostra a aba Novos
  if (!novos.length) colMovelVisto = 0;
  let nCol = -1;
  const col = (titulo, cor, arr) => `<div class="coluna ${++nCol === colMovel ? "vis" : ""}"><h3><span class="ponto" style="background:${cor}"></span>${titulo}<span class="n">${arr.length}</span></h3>
    ${arr.map(cardPedido).join("") || `<p class="vazio">Nenhum pedido</p>`}</div>`;
  C().innerHTML = `
    <div class="topo-pag">${botaoMenu()}<h1>Pedidos</h1>
      <div class="resumo-dia">
        <span class="badge">Hoje: <b>&nbsp;${validos.length}</b>&nbsp;pedidos</span>
        <span class="badge ok">${brl(validos.reduce((s, p) => s + num(p.total), 0))}</span>
        ${conexao === "SUBSCRIBED" ? `<span class="badge ok">● ao vivo</span>` : `<span class="badge alerta">● atualizando a cada 20 s</span>`}
        <button class="badge chip-acao" id="editTempo" title="Mudar o tempo mostrado no cardápio">⏱ ${esc(loja.tempo_entrega)} ✎</button>
        <button class="badge chip-acao ${impAuto() ? "ok" : ""}" id="btnImpAuto" title="Impressão automática neste aparelho">🖨 ${impAuto() === "chegar" ? "auto: ao chegar" : impAuto() === "aceitar" ? "auto: ao aceitar" : "impressão"}</button>
        <button class="btn peq" onclick="location.hash='pdv'" id="novoBalcao">+ Lançar pedido</button>
      </div></div>
    ${!somAtivo ? `<div class="aviso-som"><span>🔔 O som de novos pedidos está desligado.</span><button class="btn peq" id="ligaSom">Ligar campainha</button></div>` : ""}
    <div class="abas-col">${[["Novos", novos.length, "#dc2626"], ["Em preparo", preparo.length, "#d97706"], ["Prontos", prontos.length, "#16a34a"]]
      .map(([t, n, cor], i) => `<button data-col="${i}" class="${i === colMovel ? "ativo" : ""}"><i style="background:${cor}"></i>${t}<b>${n}</b></button>`).join("")}</div>
    <div class="quadro">${col("Novos", "#dc2626", novos)}${col("Em preparo", "#d97706", preparo)}${col("Prontos / em entrega", "#16a34a", prontos)}</div>
    ${aguard.length ? `<div class="caixa" style="margin-top:1rem"><h2>Aguardando pagamento online (${aguard.length})</h2><table class="t">${aguard.map((p) =>
      `<tr><td>#${p.numero}</td><td>${hora(p.criado_em)}</td><td>${esc(p.cliente_nome)}</td><td>${esc(NOMES_PAGAMENTO[p.pagamento])}</td><td class="num">${brl(p.total)}</td></tr>`).join("")}</table></div>` : ""}
    <div class="caixa" style="margin-top:1rem"><h2>Finalizados hoje (${fim.length})</h2>
      ${fim.length ? `<table class="t"><tr><th>#</th><th>Hora</th><th>Cliente</th><th>Tipo</th><th>Situação</th><th class="num">Total</th><th></th></tr>${fim.map((p) =>
        `<tr><td>#${p.numero}</td><td>${hora(p.criado_em)}</td><td>${esc(p.cliente_nome)}</td><td>${p.tipo === "entrega" ? "Entrega" : p.tipo === "mesa" ? "Mesa " + esc(p.mesa) : "Retirada"} ${seloCanal(p)}</td>
        <td>${p.status === "cancelado" ? `<span class="badge perigo">Cancelado</span>` : `<span class="badge ok">Entregue</span>`} ${p.status !== "cancelado" ? badgePagamento(p) : ""}</td>
        <td class="num">${brl(p.total)}</td><td class="num"><button class="btn sec peq" data-reimprimir="${p.id}">🖨</button>${p.pagamento === "pix_entrega" && p.pagamento_status !== "pago" && p.status !== "cancelado" ? ` <button class="btn sec peq" data-pagofim="${p.id}">✓ pago</button>` : ""}</td></tr>`).join("")}</table>` : `<p class="vazio">Nenhum ainda</p>`}
    </div>`;
  atualizarTempos();
  $("#ligaSom")?.addEventListener("click", () => ligarSom(true));
  $("#editTempo").onclick = editarTempo;
  $("#btnImpAuto").onclick = configurarImpAuto;
  C().querySelectorAll("[data-col]").forEach((b) => b.onclick = () => { colMovel = Number(b.dataset.col); telaPedidos(); });
  C().querySelectorAll(".card [data-acao]").forEach((b) => b.onclick = () => acao(b.dataset.acao, b.closest(".card").dataset.id, b.dataset.para));
  C().querySelectorAll(".card [data-entregador]").forEach((s) => s.onchange = async () => {
    const id = s.closest(".card").dataset.id;
    const { data, error } = await sb.from("pedidos").update({ entregador_id: s.value || null }).eq("id", id).select().single();
    if (error) return aviso(error.message, "erro");
    pedidos.set(id, data); telaPedidos();
  });
  C().querySelectorAll("[data-reimprimir]").forEach((b) => b.onclick = () => imprimir(pedidos.get(b.dataset.reimprimir)));
  C().querySelectorAll("[data-pagofim]").forEach((b) => b.onclick = () => acao("pago", b.dataset.pagofim));
}

async function atualizarPedido(id, campos) {
  const { data, error } = await sb.from("pedidos").update(campos).eq("id", id).select().single();
  if (error) { aviso("Não foi possível atualizar: " + error.message, "erro"); return null; }
  pedidos.set(id, data);
  if (aba === "pedidos") telaPedidos();
  return data;
}

const MSG_STATUS = {
  novo: "recebemos seu pedido! 😊",
  preparo: "seu pedido foi aceito e já está em preparo! 👨‍🍳",
  pronto: "seu pedido está pronto para retirada! 🏪",
  saiu: "seu pedido saiu para entrega! 🛵",
  entregue: "obrigado pela preferência! 😊",
  cancelado: "infelizmente seu pedido precisou ser cancelado.",
};

async function acao(tipo, id, para) {
  const p = pedidos.get(id);
  if (tipo === "status") {
    const ok = await atualizarPedido(id, { status: para });
    if (ok && para === "preparo" && impAuto() === "aceitar" && !impressos().has(id)) imprimir(pedidos.get(id) || p, { auto: true });
    return ok;
  }
  if (tipo === "imprimir") return imprimir(p);
  if (tipo === "whats") {
    const msg = `Olá, ${p.cliente_nome.split(" ")[0]}! Pedido #${p.numero}: ${MSG_STATUS[p.status] ?? "estamos com seu pedido."}`;
    return window.open(`https://wa.me/${foneWhats(p.cliente_telefone)}?text=${encodeURIComponent(msg)}`, "_blank");
  }
  if (tipo === "whatsent") {
    const e = entregadores.find((x) => x.id === p.entregador_id);
    const msg = `🛵 Entrega #${p.numero}\n${p.cliente_nome}${p.cliente_telefone ? " — " + foneBonito(p.cliente_telefone) : ""}\n📍 ${p.endereco}${p.bairro ? " — " + p.bairro : ""}\n💰 ${brl(p.total)} — ${NOMES_PAGAMENTO[p.pagamento]}${p.pagamento_status === "pago" ? " (JÁ PAGO)" : ""}${p.troco_para ? `\n💵 Levar troco para ${brl(p.troco_para)}` : ""}\nMapa: https://maps.google.com/?q=${encodeURIComponent((p.endereco || "") + " " + (p.bairro || ""))}`;
    return window.open(`https://wa.me/${foneWhats(e.telefone)}?text=${encodeURIComponent(msg)}`, "_blank");
  }
  if (tipo === "enviarpix") {
    if (!loja.chave_pix) return aviso("Cadastre a chave Pix em Loja.", "erro");
    if (!p.cliente_telefone) return aviso("Este pedido não tem telefone do cliente.", "erro");
    const msg = `Olá, ${p.cliente_nome.split(" ")[0]}! Pedido #${p.numero} — total *${brl(p.total)}*.\n\nPague com Pix:\nChave: *${loja.chave_pix}*${loja.nome_pix ? `\nNome: ${loja.nome_pix}` : ""}\nValor: *${brl(p.total)}*\n\nDepois é só mandar o comprovante aqui. Obrigado!`;
    return window.open(`https://wa.me/${foneWhats(p.cliente_telefone)}?text=${encodeURIComponent(msg)}`, "_blank");
  }
  if (tipo === "pago") return atualizarPedido(id, { pagamento_status: "pago" });
  if (tipo === "cancelar") {
    const r = await formulario({ titulo: `Cancelar o pedido #${p.numero}?`, texto: `${esc(p.cliente_nome)} · ${brl(p.total)}`,
      campos: [{ nome: "motivo", rotulo: "Motivo do cancelamento", tipo: "textarea", opcional: true, placeholder: "Escreva ou toque numa sugestão" }],
      sugestoes: ["Cliente desistiu", "Produto em falta", "Endereço fora da área", "Pedido duplicado", "Loja fechando"],
      botao: "Cancelar pedido", perigo: true, cancelar: "Voltar" });
    if (!r) return;
    if (await atualizarPedido(id, { status: "cancelado", motivo_cancelamento: r.motivo || "Cancelado pela loja" })) aviso(`Pedido #${p.numero} cancelado`, "ok");
    if (p.pagamento_status === "pago" && ["pix_online", "cartao_online"].includes(p.pagamento)) confirmar("Estorno necessário", "Este pedido foi pago online. Faça o estorno pelo painel do Mercado Pago.", { botao: "Entendi", cancelar: "Fechar" });
  }
}

// ----- cupom impresso (impressora térmica 80 mm ou 58 mm) -----
const confImp = () => { try { return { papel: localStorage.getItem("impPapel") || "80", vias: Number(localStorage.getItem("impVias") || 1) }; } catch { return { papel: "80", vias: 1 }; } };
function cupomHtml(p, via = "") {
  const ent = entregadores.find((x) => x.id === p.entregador_id);
  const canal = CANAIS[p.canal];
  const dt = new Date(p.criado_em);
  const tipo = p.tipo === "entrega" ? "🛵 ENTREGA" : p.tipo === "mesa" ? `🍽️ MESA ${esc(p.mesa || "")}` : "🏪 RETIRADA";
  const pago = p.pagamento_status === "pago" || p.pagamento === "pago_app";
  const troco = p.pagamento === "dinheiro" && p.troco_para ? num(p.troco_para) - num(p.total) : null;
  const ln = (a, b, cls = "") => `<div class="ln ${cls}"><span>${a}</span><span>${b}</span></div>`;
  return `<section class="cupom">
    ${via ? `<div class="via">${via}</div>` : ""}
    ${loja.logo_impressao_url ? `<img class="logo" src="${esc(loja.logo_impressao_url)}" alt="">` : ""}
    <div class="loja">${esc(loja.nome)}</div>
    <div class="num">#${p.numero}</div>
    <div class="data">${dt.toLocaleDateString("pt-BR")} às ${dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</div>
    ${p.canal && p.canal !== "cardapio" ? `<div class="canal">${esc(canal?.nome || p.canal)}${p.id_externo ? ` · Nº ${esc(p.id_externo)}` : ""}</div>` : ""}
    <div class="tipo">${tipo}</div>

    <div class="bloco">
      <div class="cli">${esc(p.cliente_nome)}</div>
      ${p.cliente_telefone ? `<div>📞 ${esc(foneBonito(p.cliente_telefone))}</div>` : ""}
      ${p.tipo === "entrega" ? `<div class="end">${esc(p.endereco || "")}</div>${p.bairro ? `<div class="bairro">${esc(p.bairro)}</div>` : ""}` : ""}
    </div>

    <div class="titulo">ITENS</div>
    ${(p.itens || []).map((it) => `<div class="item">
      <div class="ln"><span><b class="q">${it.quantidade}x</b> <b>${esc(it.nome)}</b></span><span>${brl(it.total)}</span></div>
      ${(it.adicionais || []).map((a) => `<div class="ad">+ ${a.quantidade > 1 ? a.quantidade + "x " : ""}${esc(a.nome)}</div>`).join("")}
      ${it.observacao ? `<div class="obs-item">⚠ ${esc(it.observacao)}</div>` : ""}
    </div>`).join("")}

    ${p.observacao ? `<div class="obs">📝 OBSERVAÇÃO<br><b>${esc(p.observacao)}</b></div>` : ""}

    <div class="totais">
      ${ln("Subtotal", brl(p.subtotal))}
      ${num(p.taxa_entrega) ? ln("Entrega", brl(p.taxa_entrega)) : ""}
      ${num(p.desconto) ? ln(`Desconto${p.cupom_codigo ? " (" + esc(p.cupom_codigo) + ")" : ""}`, "−" + brl(p.desconto)) : ""}
      ${ln("TOTAL", brl(p.total), "total")}
    </div>

    <div class="pag ${pago ? "pago" : "cobrar"}">
      ${pago ? `✓ PAGO${p.pagamento === "pago_app" ? " NO APP" : ""}<small>${esc(NOMES_PAGAMENTO[p.pagamento] || "")}</small>`
        : `COBRAR ${brl(p.total)}<small>${esc(NOMES_PAGAMENTO[p.pagamento] || "")}</small>`}
    </div>
    ${troco != null && troco > 0 ? `<div class="troco">💵 Troco para ${brl(p.troco_para)}<br>LEVAR <b>${brl(troco)}</b> DE TROCO</div>` : ""}
    ${ent ? `<div class="entregador">Entregador: <b>${esc(ent.nome)}</b></div>` : ""}
    <div class="rodape">Obrigado pela preferência! 😊</div>
  </section>`;
}
function imprimir(p, { auto = false } = {}) {
  if (!p) return;
  marcarImpresso(p.id);
  const { papel, vias } = confImp();
  const larg = papel === "58" ? 48 : 72; // área útil em mm
  // clique manual: janela própria (o jeito mais confiável com drivers de impressora térmica);
  // impressão automática: quadro fora da tela, com tamanho de verdade (quadro de tamanho zero pode sair em branco)
  let w = auto ? null : window.open("", "impressao", "width=420,height=720");
  if (!w) {
    document.getElementById("frameImp")?.remove();
    const fr = document.createElement("iframe");
    fr.id = "frameImp"; fr.style.cssText = `position:fixed;left:-10000px;top:0;width:${papel}mm;height:300mm;border:0;visibility:visible`;
    document.body.appendChild(fr);
    w = fr.contentWindow;
  }
  w.document.open();
  const nomesVia = vias > 1 ? ["VIA DA COZINHA", p.tipo === "entrega" ? "VIA DO ENTREGADOR" : "VIA DO CAIXA", "3ª VIA"] : [""];
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Pedido ${p.numero}</title><style>
    @page { size: ${papel}mm auto; margin: 2mm; }
    * { box-sizing: border-box; }
    body { margin: 0; width: ${larg}mm; font: ${papel === "58" ? 12 : 13}px/1.35 Arial, Helvetica, sans-serif; color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .cupom { padding: 1mm 0 4mm; }
    .cupom + .cupom { page-break-before: always; border-top: 1px dashed #000; }
    .via { text-align: center; font-size: .8em; font-weight: 700; letter-spacing: .1em; border: 1px solid #000; padding: 1px 0; margin-bottom: 2mm; }
    .logo { display: block; margin: 0 auto 1.5mm; width: ${papel === "58" ? 34 : 44}mm; height: auto; image-rendering: pixelated; }
    .loja { text-align: center; font-weight: 700; font-size: 1.05em; text-transform: uppercase; }
    .num { text-align: center; font-size: 3em; font-weight: 900; line-height: 1; margin: 1mm 0; }
    .data { text-align: center; font-size: .9em; }
    .canal { text-align: center; font-weight: 700; border: 2px solid #000; border-radius: 3px; margin: 1.5mm 6mm 0; padding: 1px; }
    .tipo { background: #000; color: #fff; text-align: center; font-weight: 900; font-size: 1.35em; padding: 1.5mm 0; margin: 2mm 0; border-radius: 2px; }
    .bloco { border-bottom: 1px dashed #000; padding-bottom: 2mm; margin-bottom: 2mm; }
    .cli { font-size: 1.2em; font-weight: 700; }
    .end { font-size: 1.15em; font-weight: 700; margin-top: 1mm; }
    .bairro { font-size: 1.1em; font-weight: 900; text-transform: uppercase; }
    .titulo { font-weight: 900; font-size: .85em; letter-spacing: .15em; border-bottom: 2px solid #000; margin-bottom: 1mm; }
    .item { padding: 1.2mm 0; border-bottom: 1px dotted #888; }
    .item .q { font-size: 1.25em; }
    .item b { font-size: 1.05em; }
    .ad { padding-left: 5mm; font-size: .95em; }
    .obs-item { margin: 1mm 0 0 4mm; padding: .5mm 1.5mm; border: 1.5px solid #000; font-weight: 700; display: inline-block; }
    .obs { border: 2px solid #000; padding: 1.5mm; margin: 2mm 0; font-size: 1.05em; }
    .ln { display: flex; justify-content: space-between; gap: 2mm; }
    .ln span:last-child { white-space: nowrap; }
    .totais { margin-top: 2mm; }
    .totais .total { font-size: 1.45em; font-weight: 900; border-top: 2px solid #000; margin-top: 1mm; padding-top: 1mm; }
    .pag { text-align: center; font-weight: 900; font-size: 1.3em; padding: 1.5mm; margin-top: 2mm; }
    .pag small { display: block; font-size: .65em; font-weight: 600; }
    .pag.pago { border: 2px solid #000; }
    .pag.cobrar { background: #000; color: #fff; }
    .troco { text-align: center; border: 2px dashed #000; padding: 1.5mm; margin-top: 2mm; font-size: 1.05em; }
    .troco b { font-size: 1.3em; }
    .entregador { margin-top: 2mm; text-align: center; }
    .rodape { text-align: center; font-size: .85em; margin-top: 3mm; }
  </style></head><body>${nomesVia.slice(0, Math.max(1, vias)).map((v) => cupomHtml(p, v)).join("")}</body></html>`);
  w.document.close();
  // espera a logo carregar (no máx. 2,5 s) antes de mandar para a impressora
  const imgs = [...w.document.images];
  Promise.race([Promise.all(imgs.map((i) => i.complete ? 0 : new Promise((ok) => { i.onload = i.onerror = ok; }))), new Promise((ok) => setTimeout(ok, 2500))])
    .then(() => setTimeout(() => {
      try {
        w.focus(); w.print();
        if (w !== document.getElementById("frameImp")?.contentWindow) setTimeout(() => { try { w.close(); } catch {} }, 1500);
      } catch (e) { aviso("Não foi possível imprimir: " + e.message, "erro"); }
    }, 150));
}

// Logo em preto e branco pontilhado (dithering), como a impressora térmica imprime
async function gerarLogoTermica(src, ajuste = 0, largura = 360) {
  const img = await new Promise((ok, falha) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => ok(i); i.onerror = () => falha(new Error("não consegui abrir a logo")); i.src = src; });
  const h = Math.round(img.naturalHeight * largura / img.naturalWidth);
  const c = document.createElement("canvas"); c.width = largura; c.height = h;
  const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, largura, h); x.drawImage(img, 0, 0, largura, h);
  const d = x.getImageData(0, 0, largura, h), px = d.data, g = new Float32Array(largura * h);
  for (let i = 0; i < g.length; i++) {
    // níveis: fundo claro vira branco puro (sem sujeira) e os tons médios escurecem pela curva (gama)
    const v = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
    const n = Math.max(0, Math.min(1, (v - 35) / (222 - 35)));
    g[i] = 255 * Math.pow(n, 1.7 * Math.pow(2, ajuste / 30)); // ajuste > 0 = mais escuro
  }
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < largura; xx++) {
    const i = yy * largura + xx, novo = g[i] < 128 ? 0 : 255, erro = g[i] - novo; g[i] = novo;
    if (xx + 1 < largura) g[i + 1] += erro * 7 / 16;
    if (yy + 1 < h) { if (xx > 0) g[i + largura - 1] += erro * 3 / 16; g[i + largura] += erro * 5 / 16; if (xx + 1 < largura) g[i + largura + 1] += erro / 16; }
  }
  for (let i = 0; i < g.length; i++) { px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = g[i]; px[i * 4 + 3] = 255; }
  x.putImageData(d, 0, 0);
  return new Promise((ok) => c.toBlob(ok, "image/png"));
}
async function salvarLogoTermica(blob) {
  const caminho = `loja/${Date.now()}-logo-impressao.png`;
  const up = await sb.storage.from("fotos").upload(caminho, blob, { contentType: "image/png" });
  if (up.error) throw up.error;
  const url = sb.storage.from("fotos").getPublicUrl(caminho).data.publicUrl;
  const { error } = await sb.from("loja").update({ logo_impressao_url: url }).eq("id", 1);
  if (error) throw error;
  await carregarLoja();
  return url;
}


// ----- impressão automática (configurada por aparelho) -----
const impAuto = () => { try { return localStorage.getItem("impAuto") || ""; } catch { return ""; } };
const impressos = () => { try { return new Set(JSON.parse(localStorage.getItem("impressos") || "[]")); } catch { return new Set(); } };
function marcarImpresso(id) {
  const s = impressos(); s.add(id);
  try { localStorage.setItem("impressos", JSON.stringify([...s].slice(-400))); } catch {}
}
let filaImp = [], imprimindo = false;
function autoImprimir() {
  if (impAuto() !== "chegar") return;
  const ja = impressos(), limite = Date.now() - 30 * 60000;
  for (const p of pedidos.values())
    if (p.status === "novo" && !ja.has(p.id) && new Date(p.criado_em) > limite && !filaImp.includes(p.id)) filaImp.push(p.id);
  proximaImpressao();
}
function proximaImpressao() {
  if (imprimindo || !filaImp.length) return;
  const p = pedidos.get(filaImp.shift()); if (!p) return proximaImpressao();
  imprimindo = true; imprimir(p, { auto: true });
  setTimeout(() => { imprimindo = false; proximaImpressao(); }, 4000);
}
async function configurarImpAuto() {
  const r = await formulario({ titulo: "Impressão", texto: "Vale só para este aparelho (o computador ligado na impressora).", campos: [
    { nome: "modo", rotulo: "Imprimir sozinho", tipo: "select", valor: impAuto(), opcoes: [["", "Desligada"], ["chegar", "Assim que o pedido chegar"], ["aceitar", "Quando eu aceitar o pedido"]],
      dica: "Para imprimir sem nem abrir a janela de impressão, abra o Chrome com a opção --kiosk-printing (eu explico como no guia)." },
    { nome: "papel", rotulo: "Largura do papel", tipo: "select", valor: confImp().papel, opcoes: [["80", "80 mm (mais comum)"], ["58", "58 mm (bobina pequena)"]] },
    { nome: "vias", rotulo: "Quantas vias", tipo: "select", valor: String(confImp().vias), opcoes: [["1", "1 via"], ["2", "2 vias (cozinha + entregador/caixa)"]] }],
    botao: "Salvar", extra: "teste" });
  if (!r) return;
  try { localStorage.setItem("impAuto", r.modo); localStorage.setItem("impPapel", r.papel); localStorage.setItem("impVias", r.vias); } catch {}
  if (r.modo === "chegar") [...pedidos.values()].forEach((p) => marcarImpresso(p.id)); // não reimprime os que já estão na tela
  aviso("Impressão configurada", "ok");
  const ex = [...pedidos.values()].sort((a, b) => b.criado_em.localeCompare(a.criado_em))[0];
  if (ex && await confirmar("Imprimir um teste?", `Vou imprimir o pedido #${ex.numero} para você ver como fica.`, { botao: "🖨 Imprimir teste", cancelar: "Agora não" })) imprimir(ex);
  telaPedidos();
}
async function editarTempo() {
  const r = await formulario({ titulo: "Tempo mostrado no cardápio", texto: "Mude na hora do movimento para o cliente saber quanto vai esperar.", campos: [
    { nome: "tempo_entrega", rotulo: "Entrega", valor: loja.tempo_entrega, sugestoes: ["30–40 min", "40–60 min", "50–70 min", "60–90 min"] },
    { nome: "tempo_retirada", rotulo: "Retirada", valor: loja.tempo_retirada, sugestoes: ["15–20 min", "20–30 min", "30–40 min"] }], botao: "Salvar" });
  if (!r) return;
  const { error } = await sb.from("loja").update({ tempo_entrega: r.tempo_entrega.trim() || loja.tempo_entrega, tempo_retirada: r.tempo_retirada.trim() || loja.tempo_retirada }).eq("id", 1);
  if (error) return aviso(error.message, "erro");
  await carregarLoja(); aviso("Tempo atualizado", "ok"); telaPedidos();
}

// ======================================================================
// PDV — pedido de balcão / telefone
// ======================================================================
const pdv = { itens: [], tipo: "retirada", pag: "cartao_entrega", cat: "", busca: "", cliente: {}, origem: "balcao" };
let cardapioCache = null;
async function carregarCardapio(forcar = false) {
  if (cardapioCache && !forcar) return cardapioCache;
  if (!cardapioCache && !forcar) { try { const c = JSON.parse(localStorage.getItem("cacheCardapioPainel")); if (c?.prods) { cardapioCache = c; carregarCardapio(true); return c; } } catch {} }
  const [c, p, g, o, b] = await Promise.all([
    sb.from("categorias").select("*").order("ordem").order("nome"),
    sb.from("produtos").select("*").order("ordem").order("nome"),
    sb.from("grupos_adicionais").select("*").order("ordem"),
    sb.from("opcoes_adicionais").select("*").order("ordem").order("nome"),
    sb.from("bairros").select("*").order("nome"),
  ]);
  if (c.error || p.error) return cardapioCache;
  cardapioCache = { cats: c.data || [], prods: p.data || [], grupos: g.data || [], opcoes: o.data || [], bairros: b.data || [] };
  try { localStorage.setItem("cacheCardapioPainel", JSON.stringify(cardapioCache)); } catch {}
  return cardapioCache;
}

// índice de clientes (telefone → últimos dados) para autopreencher no PDV
let indiceClientes = null, maisVendidos = [];
async function carregarIndiceClientes(forcar = false) {
  if (indiceClientes && !forcar) return indiceClientes;
  const { data } = await sb.from("pedidos").select("cliente_nome,cliente_telefone,tipo,endereco,bairro,itens,criado_em,status")
    .neq("status", "cancelado").order("criado_em", { ascending: false }).limit(1500);
  const idx = new Map(), cont = new Map();
  for (const p of data || []) {
    for (const it of p.itens || []) cont.set(it.produto_id, (cont.get(it.produto_id) || 0) + it.quantidade);
    if (!p.cliente_telefone || idx.has(p.cliente_telefone)) continue;
    idx.set(p.cliente_telefone, { tel: p.cliente_telefone, nome: p.cliente_nome, end: p.endereco, bairro: p.bairro, tipo: p.tipo, itens: p.itens || [], quando: p.criado_em });
  }
  maisVendidos = [...cont.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id).slice(0, 12);
  return indiceClientes = idx;
}

async function telaPdv() {
  const cd = await carregarCardapio();
  carregarCardapio(true).then((n) => { if (aba === "pdv") Object.assign(cd, n); });
  carregarIndiceClientes().then(() => { if (aba === "pdv") desenharProdutos(); });
  const bairrosAtivos = () => cd.bairros.filter((b) => b.ativo);
  const linha = (i) => {
    const p = cd.prods.find((x) => x.id === i.produto_id);
    const ads = i.adicionais.map((a) => ({ ...a, o: cd.opcoes.find((o) => o.id === a.opcao_id) })).filter((a) => a.o);
    return { p, ads, total: (precoEfetivo(p) + ads.reduce((s, a) => s + a.quantidade * num(a.o.preco), 0)) * i.quantidade };
  };
  const ehApp = () => APPS_DELIVERY.includes(pdv.origem);
  const subtotal = () => pdv.itens.reduce((s, i) => s + linha(i).total, 0);
  const taxa = () => {
    if (pdv.tipo !== "entrega") return 0;
    const bs = bairrosAtivos(), b = bs.find((x) => x.id === pdv.cliente.bairro_id);
    return bs.length ? (b ? taxaDoBairro(loja, b) ?? lojaUltimaFaixa() : 0) : num(loja.taxa_entrega);
  };
  const total = () => ehApp() && pdv.cliente.totalApp ? (Number(String(pdv.cliente.totalApp).replace(",", ".")) || 0) : subtotal() + taxa();
  const qtdNoPedido = (id) => pdv.itens.filter((i) => i.produto_id === id).reduce((s, i) => s + i.quantidade, 0);
  const impAoLancar = () => { try { return localStorage.getItem("pdvImprimir") === "1"; } catch { return false; } };

  C().innerHTML = `<div id="telaPdv">
    <div class="topo-pag">${botaoMenu()}<h1>Lançar pedido</h1><span class="muted atalhos">Atalhos: <kbd>/</kbd> buscar · <kbd>Enter</kbd> adiciona o 1º · <kbd>Ctrl</kbd>+<kbd>Enter</kbd> lança</span></div>
    <div class="pdv">
      <div class="caixa coluna-prod">
        <div class="busca-pdv"><input class="campo" id="pBusca" placeholder="🔎 Buscar produto (atalho: /)" autocomplete="off" value="${esc(pdv.busca)}"><button class="btn sec peq" id="pBuscaLimpa" title="Limpar">×</button></div>
        <div class="chips" id="pCats"></div>
        <div class="grade-prod" id="pProds"></div>
      </div>
      <div class="caixa carrinho-pdv" id="pCarrinho"></div>
    </div>
    <button class="btn barra-pdv" id="pBarra"></button></div>`;

  function desenharProdutos() {
    const termo = pdv.busca.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    $("#pCats").innerHTML = [["", "Todos"], ...(maisVendidos.length ? [["top", "⭐ Mais vendidos"]] : []), ...cd.cats.filter((c) => cd.prods.some((p) => p.ativo && p.categoria_id === c.id)).map((c) => [c.id, c.nome])]
      .map(([v, t]) => `<button data-cat="${v}" class="${pdv.cat === v ? "ativo" : ""}">${esc(t)}</button>`).join("");
    let prods = cd.prods.filter((p) => p.ativo);
    if (termo) prods = prods.filter((p) => p.nome.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").includes(termo));
    else if (pdv.cat === "top") prods = maisVendidos.map((id) => prods.find((p) => p.id === id)).filter(Boolean);
    else if (pdv.cat) prods = prods.filter((p) => p.categoria_id === pdv.cat);
    $("#pProds").innerHTML = prods.map((p, k) => {
      const q = qtdNoPedido(p.id), ap = precoEfetivo(p) === 0 ? precoAPartir(p, cd.grupos, cd.opcoes) : 0;
      return `<button data-p="${p.id}" class="${q ? "no-pedido" : ""} ${termo && k === 0 ? "primeiro" : ""}" ${p.esgotado ? "disabled" : ""}>
        ${q ? `<span class="qtd-badge">${q}</span>` : ""}
        <div class="img" ${p.foto_url ? `data-bg="${esc(p.foto_url)}"` : ""}>${p.foto_url ? "" : "🍽️"}</div><b>${esc(p.nome)}</b>
        <span class="preco-p">${p.esgotado ? "Esgotado" : ap > 0 ? "a partir de " + brl(ap) : brl(precoEfetivo(p))}</span>
        ${cd.grupos.some((g) => g.produto_id === p.id) ? `<span class="tem-op">opções</span>` : ""}</button>`;
    }).join("") || `<p class="vazio">Nenhum produto${termo ? " com esse nome" : ""}</p>`;
    carregarImagens($("#pProds"));
  }

  function desenharCarrinho() {
    const app = ehApp(), sub = subtotal(), tx = taxa(), tot = total();
    const formasPag = app ? [["pago_app", "✓ Pago no app"], ["cartao_entrega", "💳 Cartão"], ["dinheiro", "💵 Dinheiro"]]
      : [["cartao_entrega", "💳 Cartão"], ["pix_entrega", "💠 Pix"], ["dinheiro", "💵 Dinheiro"]];
    if (!formasPag.some(([v]) => v === pdv.pag)) pdv.pag = formasPag[0][0];
    const tipos = [["retirada", "🏪 Retirada"], ["entrega", "🛵 Entrega"], ...(app ? [] : [["mesa", "🍽️ Mesa"]])];
    if (!tipos.some(([v]) => v === pdv.tipo)) pdv.tipo = "retirada";
    const n = pdv.itens.reduce((s, i) => s + i.quantidade, 0);
    const troco = pdv.pag === "dinheiro" && pdv.cliente.troco ? Number(String(pdv.cliente.troco).replace(",", ".")) - tot : null;
    $("#pCarrinho").innerHTML = `
      <div class="cab-carrinho"><h2>Pedido ${n ? `<span class="badge">${n} ${n === 1 ? "item" : "itens"}</span>` : ""}</h2><button class="btn sec peq fechar-movel" id="pFecharMovel">Voltar aos produtos</button></div>
      <div class="chips origem">${["balcao", ...APPS_DELIVERY].map((o) => `<button data-origem="${o}" class="${pdv.origem === o ? "ativo" : ""}"
        style="${pdv.origem === o ? `background:${CANAIS[o].fundo};color:${CANAIS[o].texto};border-color:${CANAIS[o].fundo}` : ""}">${CANAIS[o].curto}</button>`).join("")}</div>
      ${app ? `<div class="grade2"><div><label class="rot">Nº no ${CANAIS[pdv.origem].curto}</label><input class="campo" data-f="ext" value="${esc(pdv.cliente.ext || "")}" placeholder="ex.: 4821"></div>
        <div><label class="rot">Valor no app <span class="muted">(opcional)</span></label><input class="campo" data-f="totalApp" data-redesenha inputmode="decimal" value="${esc(pdv.cliente.totalApp || "")}" placeholder="${brl(sub + tx).replace("R$", "").trim()}"></div></div>` : ""}
      <div class="itens-pdv">${pdv.itens.length ? pdv.itens.map((i, k) => { const l = linha(i); return `<div class="item-c"><div><b>${i.quantidade}x ${esc(l.p.nome)}</b>
        ${l.ads.map((a) => `<small>+ ${a.quantidade > 1 ? a.quantidade + "x " : ""}${esc(a.o.nome)}</small>`).join("")}${i.observacao ? `<small>📝 ${esc(i.observacao)}</small>` : ""}</div>
        <div class="dir">${brl(l.total)}<span class="qtd"><button data-menos="${k}" aria-label="Menos">${i.quantidade === 1 ? "🗑" : "−"}</button><button data-mais="${k}" aria-label="Mais">+</button></span></div></div>`; }).join("")
        : `<p class="vazio">Toque nos produtos para adicionar</p>`}</div>
      <div class="grade2"><div><label class="rot">WhatsApp</label><input class="campo" data-f="tel" id="pTel" inputmode="tel" autocomplete="off" value="${esc(pdv.cliente.tel || "")}" placeholder="busca cliente"></div>
        <div><label class="rot">Nome</label><input class="campo" data-f="nome" id="pNome" value="${esc(pdv.cliente.nome || "")}" placeholder="Balcão"></div></div>
      <div id="pSugCli"></div>
      <div class="seg tres">${tipos.map(([v, t]) => `<button data-tipo="${v}" class="${pdv.tipo === v ? "ativo" : ""}">${t}</button>`).join("")}</div>
      ${pdv.tipo === "mesa" ? `<label class="rot">Número da mesa</label><input class="campo curto" data-f="mesa" inputmode="numeric" value="${esc(pdv.cliente.mesa || "")}">` : ""}
      ${pdv.tipo === "entrega" ? `<label class="rot">Endereço</label><div class="auto"><input class="campo" data-f="end" id="pEnd" autocomplete="off" value="${esc(pdv.cliente.end || "")}" placeholder="digite a rua → escolha → número">
          <div id="pRuaLista" class="lista-bairros"></div></div>
        ${bairrosAtivos().length ? `<label class="rot">Bairro</label><input class="campo" id="pBairroBusca" placeholder="🔎 digite o bairro (ou escolha a rua acima)" autocomplete="off" value="${esc(cd.bairros.find((b) => b.id === pdv.cliente.bairro_id)?.nome || "")}">
          <div id="pBairroLista" class="lista-bairros"></div>` : ""}` : ""}
      <label class="rot">Pagamento</label>
      <div class="seg">${formasPag.map(([v, t]) => `<button data-pag="${v}" class="${pdv.pag === v ? "ativo" : ""}">${t}</button>`).join("")}</div>
      ${pdv.pag === "dinheiro" ? `<label class="rot">Troco para</label><div class="troco"><input class="campo curto" data-f="troco" data-redesenha inputmode="decimal" value="${esc(pdv.cliente.troco || "")}">
        ${[20, 50, 100, 200].filter((v) => v > tot).slice(0, 3).map((v) => `<button class="btn sec peq" data-troco="${v}">${v}</button>`).join("")}<button class="btn sec peq" data-troco="">sem troco</button></div>
        ${troco != null && troco >= 0 ? `<div class="troco-info">Devolver <b>${brl(troco)}</b></div>` : ""}` : ""}
      <label class="rot">Observação</label><input class="campo" data-f="obs" value="${esc(pdv.cliente.obs || "")}">
      <div class="totais">
        <div><span>Subtotal</span><span>${brl(sub)}</span></div>
        ${pdv.tipo === "entrega" ? `<div><span>Entrega</span><span>${brl(tx)}</span></div>` : ""}
        <div class="total"><span>Total</span><span>${brl(tot)}${app && pdv.cliente.totalApp ? " <small class='muted'>(app)</small>" : ""}</span></div>
      </div>
      <div class="erro" id="pErro"></div>
      <button class="btn bloco ok grande" id="pFinalizar" ${pdv.itens.length ? "" : "disabled"}>Lançar pedido · ${brl(tot)}</button>
      <div class="rodape-pdv"><label class="check" style="margin:0"><input type="checkbox" id="pImp" ${impAoLancar() ? "checked" : ""}> 🖨 imprimir ao lançar</label>
        ${pdv.itens.length || pdv.cliente.nome || pdv.cliente.tel ? `<button class="link" id="pLimpar">Limpar tudo</button>` : ""}</div>`;
    $("#pBarra").innerHTML = `<span>🧾 Ver pedido${n ? ` (${n})` : ""}</span><span>${brl(tot)}</span>`;
    $("#pBarra").classList.toggle("oculto", !n);
    sugerirCliente();
    desenharBairros();
  }

  function desenharBairros() {
    const box = $("#pBairroLista"), inp = $("#pBairroBusca"); if (!box || !inp) return;
    const sel = cd.bairros.find((b) => b.id === pdv.cliente.bairro_id);
    const t = inp.value.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    if (sel && inp.value === sel.nome) { const tx = taxaDoBairro(loja, sel); box.innerHTML = `<div class="bairro-ok">✓ ${esc(sel.nome)} · ${tx == null ? "fora da área" : brl(tx)}${sel.distancia_km != null ? ` · ${kmBonito(sel.distancia_km)}` : ""}</div>`; return; }
    if (!t) { box.innerHTML = ""; return; }
    const ls = bairrosAtivos().filter((b) => b.nome.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").includes(t)).slice(0, 6);
    box.innerHTML = ls.map((b) => { const tx = taxaDoBairro(loja, b); return `<button data-bairro="${b.id}">${esc(b.nome)} <span class="muted">${tx == null ? "fora da área" : brl(tx)}</span></button>`; }).join("") || `<div class="muted" style="padding:.3rem">Nenhum bairro</div>`;
  }

  let ruasAchadas = [], ruasCidade = null;
  carregarRuas().then((l) => { ruasCidade = l; });
  function sugerirRua(v) {
    const box = $("#pRuaLista"); if (!box) return;
    ruasAchadas = v.includes(",") ? [] : buscarRuas(ruasCidade, v, bairrosAtivos(), 6);
    box.innerHTML = ruasAchadas.map((r, k) => { const tx = taxaDoBairro(loja, r.bairro);
      return `<button data-rua="${k}">${esc(r.nome)} <span class="muted">${esc(r.bairro.nome)}${r.faixa ? " · " + esc(r.faixa) : ""} · ${tx == null ? "fora" : brl(tx)}</span></button>`; }).join("");
  }

  function sugerirCliente() {
    const box = $("#pSugCli"); if (!box) return;
    const tel = String(pdv.cliente.tel || "").replace(/\D/g, "");
    if (tel.length < 8 || !indiceClientes) { box.innerHTML = ""; return; }
    const c = [...indiceClientes.values()].find((x) => x.tel.endsWith(tel) || x.tel === tel);
    if (!c || (pdv.cliente.nome === c.nome && pdv.cliente.tel === c.tel)) { box.innerHTML = ""; return; }
    box.innerHTML = `<div class="sug-cli"><div><b>${esc(c.nome)}</b><small>${c.end ? esc(c.end) + (c.bairro ? " · " + esc(c.bairro) : "") : "retirada"} · último ${dataBR(c.quando)}</small></div>
      <div class="acs"><button class="btn peq" data-usar-cli>Usar</button>${c.itens.length ? `<button class="btn sec peq" data-repetir-cli>Repetir último</button>` : ""}</div></div>`;
    const usar = () => {
      Object.assign(pdv.cliente, { tel: c.tel, nome: c.nome, end: c.end || pdv.cliente.end });
      const b = c.bairro && cd.bairros.find((x) => x.nome === c.bairro && x.ativo);
      if (c.tipo === "entrega" && !ehApp()) pdv.tipo = "entrega";
      if (b) pdv.cliente.bairro_id = b.id;
    };
    box.querySelector("[data-usar-cli]").onclick = () => { usar(); desenharCarrinho(); };
    const rep = box.querySelector("[data-repetir-cli]");
    if (rep) rep.onclick = () => {
      usar();
      const validos = c.itens.filter((it) => cd.prods.some((p) => p.id === it.produto_id && p.ativo && !p.esgotado));
      pdv.itens.push(...validos.map((it) => ({ produto_id: it.produto_id, quantidade: it.quantidade, observacao: it.observacao || "",
        adicionais: (it.adicionais || []).map((a) => {
          const o = cd.opcoes.find((x) => x.nome === a.nome && !x.esgotado && cd.grupos.some((g) => g.id === x.grupo_id && g.produto_id === it.produto_id && g.nome === a.grupo));
          return o ? { opcao_id: o.id, quantidade: a.quantidade } : null; }).filter(Boolean) })));
      if (validos.length < c.itens.length) aviso("Alguns itens do último pedido não estão disponíveis", "info");
      desenharCarrinho(); desenharProdutos();
    };
  }

  function adicionar(id) {
    const p = cd.prods.find((x) => x.id === id); if (!p || p.esgotado) return;
    const gs = cd.grupos.filter((g) => g.produto_id === p.id);
    const feito = () => { desenharCarrinho(); desenharProdutos(); const b = C().querySelector(`[data-p="${id}"]`); b?.classList.add("pulo"); };
    if (!gs.length) { const ex = pdv.itens.find((i) => i.produto_id === p.id && !i.adicionais.length && !i.observacao); if (ex) ex.quantidade++; else pdv.itens.push({ produto_id: p.id, quantidade: 1, adicionais: [], observacao: "" }); feito(); return; }
    escolherAdicionais(p, gs, cd.opcoes, (item) => { pdv.itens.push(item); feito(); });
  }

  async function lancar() {
    if (!pdv.itens.length) return;
    const btn = $("#pFinalizar"); if (btn.disabled) return;
    const app = ehApp();
    if (pdv.tipo === "entrega" && bairrosAtivos().length && !pdv.cliente.bairro_id) return $("#pErro").textContent = "Escolha o bairro da entrega.";
    if (pdv.tipo === "mesa" && !String(pdv.cliente.mesa || "").trim()) return $("#pErro").textContent = "Informe o número da mesa.";
    if (app && !pdv.cliente.ext && !(await confirmar("Lançar sem o número do pedido?", `Com o número do ${CANAIS[pdv.origem].curto} fica fácil achar o pedido depois e o sistema impede lançar duas vezes.`, { botao: "Lançar assim mesmo", cancelar: "Voltar" }))) return;
    btn.disabled = true; btn.textContent = "Lançando…";
    const corpo = { canal: "balcao", cliente_nome: pdv.cliente.nome || "Balcão", cliente_telefone: pdv.cliente.tel || "", tipo: pdv.tipo, mesa: pdv.cliente.mesa || "",
      endereco: pdv.cliente.end || "", bairro_id: pdv.cliente.bairro_id || null, pagamento: pdv.pag, troco_para: pdv.cliente.troco ? String(pdv.cliente.troco).replace(",", ".") : null,
      observacao: pdv.cliente.obs || "", itens: pdv.itens, origem: pdv.origem, id_externo: pdv.cliente.ext || "", total_app: app ? (pdv.cliente.totalApp || null) : null };
    try {
      const { data: { session } } = await sb.auth.getSession();
      const r = await fetch(`${SUPABASE_URL}/functions/v1/criar-pedido`, { method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify(corpo) });
      const res = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(res.erro || "Erro ao lançar o pedido.");
      pdv.itens = []; pdv.cliente = {}; pdv.busca = ""; if (pdv.tipo === "mesa") pdv.tipo = "retirada";
      $("#pBusca").value = ""; desenharCarrinho(); desenharProdutos(); $("#pBusca").focus();
      document.body.classList.remove("pdv-carrinho-aberto");
      carregarPedidos().then(() => {
        const novo = pedidos.get(res.id);
        if (novo && impAoLancar()) imprimir(novo);
        avisoAcao(`Pedido #${res.numero} lançado ✓`, novo && !impAoLancar() ? "🖨 Imprimir" : null, () => imprimir(pedidos.get(res.id)));
      });
      carregarIndiceClientes(true);
    } catch (e) { $("#pErro").textContent = e.message; btn.disabled = false; btn.textContent = "Lançar pedido"; }
  }

  // eventos (delegados: a tela não é redesenhada a cada tecla)
  const raiz = $("#telaPdv");
  raiz.addEventListener("click", (e) => {
    const t = e.target.closest("button,[data-bairro]"); if (!t) return;
    if (t.dataset.p) return adicionar(t.dataset.p);
    if (t.dataset.cat !== undefined) { pdv.cat = t.dataset.cat; pdv.busca = ""; $("#pBusca").value = ""; return desenharProdutos(); }
    if (t.dataset.tipo) { pdv.tipo = t.dataset.tipo; return desenharCarrinho(); }
    if (t.dataset.pag) { pdv.pag = t.dataset.pag; return desenharCarrinho(); }
    if (t.dataset.origem) { pdv.origem = t.dataset.origem; pdv.pag = APPS_DELIVERY.includes(pdv.origem) ? "pago_app" : "cartao_entrega"; return desenharCarrinho(); }
    if (t.dataset.menos !== undefined) { const i = pdv.itens[t.dataset.menos]; if (--i.quantidade <= 0) pdv.itens.splice(t.dataset.menos, 1); desenharCarrinho(); return desenharProdutos(); }
    if (t.dataset.mais !== undefined) { pdv.itens[t.dataset.mais].quantidade++; desenharCarrinho(); return desenharProdutos(); }
    if (t.dataset.troco !== undefined) { pdv.cliente.troco = t.dataset.troco; return desenharCarrinho(); }
    if (t.dataset.bairro) { pdv.cliente.bairro_id = t.dataset.bairro; return desenharCarrinho(); }
    if (t.dataset.rua !== undefined) {
      const r = ruasAchadas[t.dataset.rua];
      pdv.cliente.end = r.nome + ", ";
      if (taxaDoBairro(loja, r.bairro) != null) pdv.cliente.bairro_id = r.bairro.id;
      desenharCarrinho(); const i = $("#pEnd"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); return;
    }
    if (t.id === "pFinalizar") return lancar();
    if (t.id === "pLimpar") { pdv.itens = []; pdv.cliente = {}; desenharCarrinho(); return desenharProdutos(); }
    if (t.id === "pBuscaLimpa") { pdv.busca = ""; $("#pBusca").value = ""; $("#pBusca").focus(); return desenharProdutos(); }
    if (t.id === "pBarra") return document.body.classList.add("pdv-carrinho-aberto");
    if (t.id === "pFecharMovel") return document.body.classList.remove("pdv-carrinho-aberto");
  });
  raiz.addEventListener("input", (e) => {
    const t = e.target;
    if (t.id === "pBusca") { pdv.busca = t.value; return desenharProdutos(); }
    if (t.id === "pBairroBusca") { if (pdv.cliente.bairro_id) { pdv.cliente.bairro_id = null; } return desenharBairros(); }
    if (t.dataset.f) { pdv.cliente[t.dataset.f] = t.value; if (t.dataset.f === "tel") sugerirCliente(); if (t.dataset.f === "end") sugerirRua(t.value); }
  });
  raiz.addEventListener("change", (e) => {
    if (e.target.dataset.redesenha !== undefined) desenharCarrinho();
    if (e.target.id === "pImp") { try { localStorage.setItem("pdvImprimir", e.target.checked ? "1" : "0"); } catch {} }
    if (e.target.id === "pBairroBusca" && pdv.tipo === "entrega") desenharCarrinho();
  });
  raiz.addEventListener("keydown", (e) => {
    if (e.target.id === "pBusca" && e.key === "Enter") { const p = raiz.querySelector("#pProds [data-p]:not([disabled])"); if (p) { adicionar(p.dataset.p); pdv.busca = ""; e.target.value = ""; desenharProdutos(); } }
    if (e.target.id === "pBairroBusca" && e.key === "Enter") { e.preventDefault(); raiz.querySelector("[data-bairro]")?.click(); }
    if (e.target.id === "pEnd" && e.key === "Enter") { const b = raiz.querySelector("[data-rua]"); if (b) { e.preventDefault(); b.click(); } }
  });
  atalhosPdv = (e) => {
    if (aba !== "pdv" || document.querySelector(".fundo-modal")) return;
    if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) { e.preventDefault(); $("#pBusca").focus(); }
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); lancar(); }
    if (e.key === "F2") { e.preventDefault(); lancar(); }
  };
  desenharProdutos(); desenharCarrinho();
  if (matchMedia("(min-width: 900px)").matches) $("#pBusca").focus();
}
let atalhosPdv = null;
document.addEventListener("keydown", (e) => atalhosPdv?.(e));

// carrega fotos só quando aparecem na tela (mais rápido)
const obsImg = "IntersectionObserver" in window ? new IntersectionObserver((ents) => {
  for (const en of ents) if (en.isIntersecting) { const el = en.target; el.style.backgroundImage = `url('${el.dataset.bg.replace(/'/g, "%27")}')`; obsImg.unobserve(el); }
}, { rootMargin: "200px" }) : null;
function carregarImagens(raiz) {
  raiz.querySelectorAll("[data-bg]").forEach((el) => obsImg ? obsImg.observe(el) : (el.style.backgroundImage = `url('${el.dataset.bg}')`));
}

function avisoAcao(msg, botao, acaoFn) {
  let caixa = $("#avisos");
  if (!caixa) { caixa = document.createElement("div"); caixa.id = "avisos"; document.body.appendChild(caixa); }
  const t = document.createElement("div");
  t.className = "toast ok";
  t.innerHTML = `<span>✓</span><div>${esc(msg)}</div>${botao ? `<button class="toast-acao">${esc(botao)}</button>` : ""}`;
  if (botao) t.querySelector("button").onclick = () => { acaoFn(); t.remove(); };
  caixa.appendChild(t);
  setTimeout(() => { t.classList.add("saindo"); setTimeout(() => t.remove(), 300); }, botao ? 8000 : 3000);
}

function escolherAdicionais(p, gs, opcoes, pronto) {
  const escolha = {};
  const m = abrirModal(`<h2>${esc(p.nome)}</h2>
    ${gs.map((g) => `<div style="margin-top:.8rem"><b>${esc(g.nome)}</b> <span class="muted">${g.minimo ? `(escolha ${g.minimo === g.maximo ? g.minimo : g.minimo + " a " + g.maximo})` : `(até ${g.maximo})`}</span>
      ${opcoes.filter((o) => o.grupo_id === g.id && !o.esgotado).map((o) => `<div class="opcao-m"><span>${esc(o.nome)} ${num(o.preco) ? `<span class="muted">+ ${brl(o.preco)}</span>` : ""}</span>
        <span class="qtd" data-o="${o.id}" data-g="${g.id}"><button data-d="-1">−</button><b>0</b><button data-d="1">+</button></span></div>`).join("")}</div>`).join("")}
    <label class="rot">Observação</label><input class="campo" id="aObs">
    <div class="erro" id="aErro"></div><button class="btn bloco" id="aOk">Adicionar</button>`, 520);
  const soma = (gid) => opcoes.filter((o) => o.grupo_id === gid).reduce((s, o) => s + (escolha[o.id] || 0), 0);
  m.querySelectorAll(".qtd button").forEach((b) => b.onclick = () => {
    const box = b.parentElement, g = gs.find((x) => x.id === box.dataset.g), d = Number(b.dataset.d);
    if (d > 0 && soma(g.id) >= g.maximo) { if (g.maximo === 1) opcoes.filter((o) => o.grupo_id === g.id).forEach((o) => delete escolha[o.id]); else return; }
    escolha[box.dataset.o] = Math.max(0, (escolha[box.dataset.o] || 0) + d);
    m.querySelectorAll(".qtd").forEach((q) => q.querySelector("b").textContent = escolha[q.dataset.o] || 0);
  });
  $("#aOk", m).onclick = () => {
    for (const g of gs) if (soma(g.id) < g.minimo) return $("#aErro", m).textContent = `Escolha ${g.minimo} em "${g.nome}".`;
    pronto({ produto_id: p.id, quantidade: 1, observacao: $("#aObs", m).value, adicionais: Object.entries(escolha).filter(([, q]) => q).map(([opcao_id, quantidade]) => ({ opcao_id, quantidade })) });
    m.remove();
  };
}

// ======================================================================
// Financeiro
// ======================================================================
const periodo = { tipo: "7d", de: "", ate: "" };
function intervalo() {
  const h = hoje0(), d = (n) => { const x = new Date(h); x.setDate(x.getDate() + n); return x; };
  switch (periodo.tipo) {
    case "hoje": return [h, d(1), "Hoje"];
    case "ontem": return [d(-1), h, "Ontem"];
    case "7d": return [d(-6), d(1), "Últimos 7 dias"];
    case "30d": return [d(-29), d(1), "Últimos 30 dias"];
    case "mes": return [new Date(h.getFullYear(), h.getMonth(), 1), d(1), "Este mês"];
    case "mespassado": return [new Date(h.getFullYear(), h.getMonth() - 1, 1), new Date(h.getFullYear(), h.getMonth(), 1), "Mês passado"];
    default: {
      const a = periodo.de ? new Date(periodo.de + "T00:00") : d(-6), b = periodo.ate ? new Date(periodo.ate + "T00:00") : h;
      b.setDate(b.getDate() + 1); return [a, b, "Período"];
    }
  }
}

function barrasH(lista, fmt = brl) {
  const max = Math.max(1, ...lista.map((x) => x.v));
  return lista.map((x) => `<div class="barra-h"><span title="${esc(x.k)}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(x.k)}</span>
    <div class="trilho"><i style="width:${(x.v / max * 100).toFixed(1)}%"></i></div><span class="num">${fmt(x.v)}${x.extra ? `<br><small class="muted">${x.extra}</small>` : ""}</span></div>`).join("") || `<p class="vazio">Sem dados</p>`;
}

async function telaFinanceiro() {
  const [ini, fim, rotulo] = intervalo();
  C().innerHTML = `<div class="topo-pag">${botaoMenu()}<h1>Financeiro</h1>
    <div class="filtros">${[["hoje", "Hoje"], ["ontem", "Ontem"], ["7d", "7 dias"], ["30d", "30 dias"], ["mes", "Este mês"], ["mespassado", "Mês passado"], ["custom", "Escolher datas"]]
      .map(([k, t]) => `<button data-per="${k}" class="${periodo.tipo === k ? "ativo" : ""}">${t}</button>`).join("")}
      ${periodo.tipo === "custom" ? `<input type="date" class="campo" id="fDe" style="width:auto" value="${periodo.de}"> até <input type="date" class="campo" id="fAte" style="width:auto" value="${periodo.ate}">` : ""}
    </div></div><div id="fCorpo"><p class="muted">Carregando…</p></div>`;
  C().querySelectorAll("[data-per]").forEach((b) => b.onclick = () => { periodo.tipo = b.dataset.per; telaFinanceiro(); });
  $("#fDe")?.addEventListener("change", (e) => { periodo.de = e.target.value; telaFinanceiro(); });
  $("#fAte")?.addEventListener("change", (e) => { periodo.ate = e.target.value; telaFinanceiro(); });

  let todos;
  try {
    todos = await buscarTodos(() => sb.from("pedidos").select("id,numero,criado_em,status,canal,tipo,bairro,itens,subtotal,taxa_entrega,desconto,total,pagamento,pagamento_status,cliente_nome,cliente_telefone,entregador_id,cupom_codigo")
      .gte("criado_em", ini.toISOString()).lt("criado_em", fim.toISOString()).order("criado_em"));
  } catch (e) { $("#fCorpo").innerHTML = `<p class="erro">Erro ao carregar: ${esc(e.message)}</p>`; return; }

  const validos = todos.filter((p) => !["cancelado", "aguardando_pagamento"].includes(p.status));
  const cancelados = todos.filter((p) => p.status === "cancelado");
  const soma = (arr, f) => arr.reduce((s, p) => s + num(p[f]), 0);
  const fat = soma(validos, "total");
  const pixAberto = validos.filter((p) => p.pagamento === "pix_entrega" && p.pagamento_status !== "pago");

  // vendas por dia (ou por hora se for um dia só)
  const umDia = (fim - ini) <= 86400000;
  const baldes = new Map();
  if (umDia) for (let h = 0; h < 24; h++) baldes.set(h, 0);
  else for (let d = new Date(ini); d < fim; d.setDate(d.getDate() + 1)) baldes.set(d.toISOString().slice(0, 10), 0);
  const chaveDia = (iso) => { const d = new Date(iso); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().slice(0, 10); };
  for (const p of validos) { const k = umDia ? new Date(p.criado_em).getHours() : chaveDia(p.criado_em); if (baldes.has(k)) baldes.set(k, baldes.get(k) + num(p.total)); }
  const maxB = Math.max(1, ...baldes.values());
  const rotB = (k) => umDia ? `${k}h` : `${k.slice(8, 10)}/${k.slice(5, 7)}`;
  const mostrarCada = baldes.size > 16 ? Math.ceil(baldes.size / 12) : 1;

  const agrupar = (arr, chave, valor = (p) => num(p.total)) => {
    const m = new Map();
    for (const p of arr) { const k = chave(p); if (k == null) continue; const x = m.get(k) || { k, v: 0, n: 0 }; x.v += valor(p); x.n++; m.set(k, x); }
    return [...m.values()].sort((a, b) => b.v - a.v);
  };
  const porPag = agrupar(validos, (p) => NOMES_PAGAMENTO[p.pagamento]).map((x) => ({ ...x, extra: `${x.n} pedidos` }));
  const porCanal = agrupar(validos, (p) => CANAIS[p.canal]?.nome || p.canal).map((x) => ({ ...x, extra: `${x.n} pedidos` }));
  const porTipo = agrupar(validos, (p) => p.tipo === "entrega" ? "Entrega" : "Retirada").map((x) => ({ ...x, extra: `${x.n} pedidos` }));
  const porBairro = agrupar(validos.filter((p) => p.tipo === "entrega"), (p) => p.bairro || "Sem bairro").map((x) => ({ ...x, extra: `${x.n} pedidos` })).slice(0, 10);
  const prods = new Map();
  for (const p of validos) for (const it of p.itens || []) { const x = prods.get(it.nome) || { k: it.nome, v: 0, q: 0 }; x.v += num(it.total); x.q += it.quantidade; prods.set(it.nome, x); }
  const topProd = [...prods.values()].sort((a, b) => b.q - a.q).slice(0, 10);
  const porHora = new Array(24).fill(0); for (const p of validos) porHora[new Date(p.criado_em).getHours()]++;
  const maxH = Math.max(1, ...porHora);
  const cupons = agrupar(validos.filter((p) => p.cupom_codigo), (p) => p.cupom_codigo, (p) => num(p.desconto)).map((x) => ({ ...x, extra: `${x.n} usos` }));

  $("#fCorpo").innerHTML = `
    <div class="kpis">
      <div class="kpi"><span>Faturamento · ${esc(rotulo)}</span><b>${brl(fat)}</b><small>${validos.length} pedidos</small></div>
      <div class="kpi"><span>Ticket médio</span><b>${brl(validos.length ? fat / validos.length : 0)}</b><small>por pedido</small></div>
      <div class="kpi"><span>Produtos vendidos</span><b>${brl(soma(validos, "subtotal"))}</b><small>sem taxa de entrega</small></div>
      <div class="kpi"><span>Taxas de entrega</span><b>${brl(soma(validos, "taxa_entrega"))}</b><small>${validos.filter((p) => p.tipo === "entrega").length} entregas</small></div>
      <div class="kpi"><span>Descontos (cupons)</span><b>${brl(soma(validos, "desconto"))}</b><small>${validos.filter((p) => num(p.desconto)).length} pedidos</small></div>
      <div class="kpi"><span>Pix a confirmar</span><b style="color:${pixAberto.length ? "var(--alerta)" : "inherit"}">${brl(soma(pixAberto, "total"))}</b><small>${pixAberto.length} pedidos</small></div>
      <div class="kpi"><span>Cancelados</span><b style="color:${cancelados.length ? "var(--perigo)" : "inherit"}">${cancelados.length}</b><small>${brl(soma(cancelados, "total"))}</small></div>
    </div>
    <div class="caixa"><h2>${umDia ? "Vendas por hora" : "Vendas por dia"} <button class="btn sec peq" id="exportar">⬇ Exportar planilha (CSV)</button></h2>
      <div class="graf-barras">${[...baldes.entries()].map(([k, v], i) => `<div class="b"><span class="tip">${rotB(k)}: ${brl(v)}</span><i style="height:${(v / maxB * 100).toFixed(1)}%"></i><small>${i % mostrarCada ? "&nbsp;" : rotB(k)}</small></div>`).join("")}</div>
    </div>
    <div class="grade2" style="gap:1rem">
      <div class="caixa"><h2>Formas de pagamento</h2>${barrasH(porPag)}</div>
      <div class="caixa"><h2>Canal e tipo</h2>${barrasH(porCanal)}${barrasH(porTipo)}</div>
      <div class="caixa"><h2>Produtos mais vendidos</h2>${barrasH(topProd.map((x) => ({ k: x.k, v: x.q, extra: brl(x.v) })), (v) => v + " un.")}</div>
      <div class="caixa"><h2>Bairros</h2>${barrasH(porBairro)}</div>
      <div class="caixa"><h2>Horários de pico</h2><div class="graf-barras" style="height:150px">${porHora.map((v, h) => `<div class="b"><span class="tip">${h}h: ${v} pedidos</span><i style="height:${(v / maxH * 100).toFixed(1)}%"></i><small>${h % 3 ? "&nbsp;" : h + "h"}</small></div>`).join("")}</div></div>
      <div class="caixa"><h2>Cupons usados</h2>${barrasH(cupons)}</div>
    </div>`;
  $("#exportar").onclick = () => {
    const cab = ["numero", "data", "hora", "status", "canal", "tipo", "bairro", "cliente", "telefone", "subtotal", "taxa_entrega", "desconto", "total", "pagamento", "situacao_pagamento", "cupom", "itens"];
    const linhas = todos.map((p) => [p.numero, dataBR(p.criado_em), hora(p.criado_em), NOMES_STATUS[p.status], p.canal, p.tipo, p.bairro || "", p.cliente_nome, p.cliente_telefone || "",
      num(p.subtotal).toFixed(2).replace(".", ","), num(p.taxa_entrega).toFixed(2).replace(".", ","), num(p.desconto).toFixed(2).replace(".", ","), num(p.total).toFixed(2).replace(".", ","),
      NOMES_PAGAMENTO[p.pagamento], NOMES_PAG_STATUS[p.pagamento_status], p.cupom_codigo || "", (p.itens || []).map((i) => `${i.quantidade}x ${i.nome}`).join(" | ")]);
    const csv = "﻿" + [cab, ...linhas].map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `pedidos-${ini.toISOString().slice(0, 10)}.csv`; a.click();
  };
}

// ======================================================================
// Clientes
// ======================================================================
let buscaCli = "";
async function telaClientes() {
  C().innerHTML = `<div class="topo-pag">${botaoMenu()}<h1>Clientes</h1><input class="campo" id="cBusca" style="max-width:320px" placeholder="🔎 Nome ou telefone" value="${esc(buscaCli)}"></div><div id="cCorpo"><p class="muted">Carregando…</p></div>`;
  let todos;
  try {
    todos = await buscarTodos(() => sb.from("pedidos").select("cliente_nome,cliente_telefone,total,criado_em,status,bairro,endereco").neq("status", "cancelado").not("cliente_telefone", "is", null).order("criado_em"));
  } catch (e) { $("#cCorpo").innerHTML = `<p class="erro">${esc(e.message)}</p>`; return; }
  const m = new Map();
  for (const p of todos) {
    if (p.status === "aguardando_pagamento") continue;
    const c = m.get(p.cliente_telefone) || { tel: p.cliente_telefone, n: 0, v: 0, primeiro: p.criado_em };
    c.nome = p.cliente_nome; c.n++; c.v += num(p.total); c.ultimo = p.criado_em; c.bairro = p.bairro || c.bairro; c.end = p.endereco || c.end;
    m.set(p.cliente_telefone, c);
  }
  const clientes = [...m.values()].sort((a, b) => b.v - a.v);
  const lerLS = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const camp = lerLS("campanha", { ativa: false, dias: 30, msg: "Oi, {nome}! Sentimos sua falta aqui na {loja} 😊\nPra você voltar, use o cupom *VOLTA10* e ganhe 10% de desconto no próximo pedido:\n{link}" });
  const enviados = lerLS("campanhaEnviados", {});
  const salvarCamp = () => { try { localStorage.setItem("campanha", JSON.stringify(camp)); localStorage.setItem("campanhaEnviados", JSON.stringify(enviados)); } catch {} };
  const linkCard = new URL("./", location.href).href;
  const textoCamp = (c) => camp.msg.replaceAll("{nome}", c.nome.split(" ")[0]).replaceAll("{loja}", loja.nome).replaceAll("{link}", linkCard);
  const desenhar = () => {
    const t = buscaCli.trim().toLowerCase(), td = t.replace(/\D/g, "");
    const dias = (iso) => Math.floor((Date.now() - new Date(iso)) / 86400000);
    const lista = clientes.filter((c) => (!t || c.nome.toLowerCase().includes(t) || (td && c.tel.includes(td))) && (!camp.ativa || dias(c.ultimo) >= camp.dias))
      .sort((a, b) => camp.ativa ? (enviados[a.tel] ? 1 : 0) - (enviados[b.tel] ? 1 : 0) || b.v - a.v : 0);
    $("#cCorpo").innerHTML = `<div class="kpis">
        <div class="kpi"><span>Clientes</span><b>${clientes.length}</b></div>
        <div class="kpi"><span>Voltaram a comprar</span><b>${clientes.filter((c) => c.n > 1).length}</b><small>${clientes.length ? Math.round(clientes.filter((c) => c.n > 1).length / clientes.length * 100) : 0}% dos clientes</small></div>
        <div class="kpi"><span>Novos nos últimos 30 dias</span><b>${clientes.filter((c) => dias(c.primeiro) <= 30).length}</b></div>
        <div class="kpi"><span>Sumidos há +30 dias</span><b>${clientes.filter((c) => dias(c.ultimo) > 30).length}</b><small>bom para mandar cupom</small></div>
      </div>
      <div class="caixa"><h2>📣 Campanha para cliente sumido <label class="check" style="margin:0;font-size:.95rem;font-weight:500"><input type="checkbox" id="campAtiva" ${camp.ativa ? "checked" : ""}> mostrar só os sumidos</label></h2>
        ${camp.ativa ? `<div class="grade2"><div><label class="rot">Sem pedir há pelo menos</label><div style="display:flex;gap:.4rem;align-items:center"><input class="campo curto" id="campDias" inputmode="numeric" value="${camp.dias}"> dias
            <span class="muted">· ${lista.length} cliente(s) · ${lista.filter((c) => enviados[c.tel]).length} já chamados</span></div>
            <p class="muted" style="font-size:.85rem">Crie o cupom (ex.: VOLTA10) na aba Cupons antes de enviar. Toque em 📣 em cada cliente: abre o WhatsApp com a mensagem pronta, é só enviar.</p></div>
          <div><label class="rot">Mensagem <span class="muted">({nome}, {loja} e {link} são trocados sozinhos)</span></label><textarea class="campo" id="campMsg" rows="4">${esc(camp.msg)}</textarea></div></div>`
          : `<p class="muted" style="margin:0">Liste quem não pede há um tempo e mande uma mensagem com cupom pelo WhatsApp, um por um.</p>`}</div>
      <div class="caixa"><table class="t"><tr><th>Cliente</th><th>WhatsApp</th><th>Bairro</th><th class="num">Pedidos</th><th class="num">Total gasto</th><th class="num">Ticket</th><th>Último pedido</th><th></th></tr>
      ${lista.slice(0, 300).map((c) => `<tr><td><b>${esc(c.nome)}</b></td><td>${esc(foneBonito(c.tel))}</td><td>${esc(c.bairro || "—")}</td><td class="num">${c.n}</td><td class="num">${brl(c.v)}</td><td class="num">${brl(c.v / c.n)}</td>
        <td>${dataBR(c.ultimo)} <span class="muted">(${dias(c.ultimo) === 0 ? "hoje" : dias(c.ultimo) + " dias"})</span></td>
        <td style="white-space:nowrap">${camp.ativa ? `<a class="btn ${enviados[c.tel] ? "sec" : ""} peq" data-camp="${esc(c.tel)}" target="_blank" href="https://wa.me/${foneWhats(c.tel)}?text=${encodeURIComponent(textoCamp(c))}">📣 ${enviados[c.tel] ? "enviado " + dataBR(enviados[c.tel]).slice(0, 5) : "Enviar"}</a>`
          : `<a class="btn sec peq" target="_blank" href="https://wa.me/${foneWhats(c.tel)}?text=${encodeURIComponent(`Olá, ${c.nome.split(" ")[0]}! Aqui é da ${loja.nome} 😊`)}">💬</a>`}</td></tr>`).join("") || `<tr><td colspan="8" class="vazio">Nenhum cliente encontrado</td></tr>`}</table>
      ${lista.length > 300 ? `<p class="muted">Mostrando 300 de ${lista.length}. Use a busca.</p>` : ""}</div>`;
  };
  $("#cBusca").oninput = (e) => { buscaCli = e.target.value; desenhar(); };
  $("#cCorpo").addEventListener("change", (e) => {
    if (e.target.id === "campAtiva") { camp.ativa = e.target.checked; salvarCamp(); desenhar(); }
    if (e.target.id === "campDias") { const d = parseInt(e.target.value); camp.dias = Number.isFinite(d) && d >= 0 ? d : 30; salvarCamp(); desenhar(); }
    if (e.target.id === "campMsg") { camp.msg = e.target.value; salvarCamp(); desenhar(); }
  });
  $("#cCorpo").addEventListener("click", (e) => {
    const a = e.target.closest("[data-camp]"); if (!a) return;
    enviados[a.dataset.camp] = new Date().toISOString(); salvarCamp(); setTimeout(desenhar, 300);
  });
  desenhar();
}

// ======================================================================
// Entregadores
// ======================================================================
const perEnt = { tipo: "hoje", dia: "", mes: "" };
function intervaloEnt() {
  const h = hoje0(), d = (n) => { const x = new Date(h); x.setDate(x.getDate() + n); return x; };
  const mesIni = (y, m) => new Date(y, m, 1);
  const nomeMes = (dt) => dt.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  switch (perEnt.tipo) {
    case "ontem": return [d(-1), h, "Ontem, " + dataBR(d(-1))];
    case "mes": return [mesIni(h.getFullYear(), h.getMonth()), d(1), "Este mês (" + nomeMes(h) + ")"];
    case "mespassado": { const a = mesIni(h.getFullYear(), h.getMonth() - 1); return [a, mesIni(h.getFullYear(), h.getMonth()), nomeMes(a)]; }
    case "dia": { if (!perEnt.dia) return [h, d(1), "Hoje"]; const [y, m, dd] = perEnt.dia.split("-").map(Number); const a = new Date(y, m - 1, dd); const b = new Date(y, m - 1, dd + 1); return [a, b, dataBR(a)]; }
    case "escolhermes": { if (!perEnt.mes) return [mesIni(h.getFullYear(), h.getMonth()), d(1), nomeMes(h)]; const [y, m] = perEnt.mes.split("-").map(Number); const a = mesIni(y, m - 1); return [a, mesIni(y, m), nomeMes(a)]; }
    default: return [h, d(1), "Hoje, " + dataBR(h)];
  }
}
async function telaEntregadores() {
  await carregarEntregadores();
  const [de, ate, rotulo] = intervaloEnt();
  C().innerHTML = `<div class="topo-pag">${botaoMenu()}<h1>Entregadores</h1><button class="btn" id="novoEnt">+ Entregador</button></div>
    <div class="caixa">
      <div class="chips periodo-ent">${[["hoje", "Hoje"], ["ontem", "Ontem"], ["mes", "Este mês"], ["mespassado", "Mês passado"]].map(([v, t]) => `<button data-pe="${v}" class="${perEnt.tipo === v ? "ativo" : ""}">${t}</button>`).join("")}
        <label class="chip-data ${perEnt.tipo === "dia" ? "ativo" : ""}">📅 Dia <input type="date" id="peDia" value="${perEnt.dia}"></label>
        <label class="chip-data ${perEnt.tipo === "escolhermes" ? "ativo" : ""}">🗓 Mês <input type="month" id="peMes" value="${perEnt.mes}"></label></div>
      <h2 style="margin:.8rem 0 0">${esc(rotulo)}</h2></div>
    <div id="entRel"><p class="muted">Carregando…</p></div>
    <div class="caixa"><h2>Cadastro</h2><table class="t"><tr><th>Nome</th><th>WhatsApp</th><th>Ativo</th><th></th></tr>
    ${entregadores.map((e) => `<tr data-e="${e.id}">
      <td><input class="campo" data-c="nome" value="${esc(e.nome)}"></td><td><input class="campo" data-c="telefone" value="${esc(e.telefone)}" placeholder="43999999999"></td>
      <td><input type="checkbox" data-c="ativo" ${e.ativo ? "checked" : ""}></td>
      <td style="white-space:nowrap"><button class="btn sec peq" data-salvar>Salvar</button> <button class="btn perigo peq" data-apagar>×</button></td></tr>`).join("") || `<tr><td colspan="4" class="vazio">Cadastre seus entregadores para escolher quem leva cada pedido.</td></tr>`}
    </table><p class="muted" style="margin-bottom:0">Só entram na conta do entregador os pedidos em que ele foi escolhido no card do pedido.</p></div>`;

  C().querySelectorAll("[data-pe]").forEach((b) => b.onclick = () => { perEnt.tipo = b.dataset.pe; telaEntregadores(); });
  $("#peDia").onchange = (e) => { perEnt.dia = e.target.value; perEnt.tipo = "dia"; telaEntregadores(); };
  $("#peMes").onchange = (e) => { perEnt.mes = e.target.value; perEnt.tipo = "escolhermes"; telaEntregadores(); };

  let peds = [];
  try {
    peds = await buscarTodos(() => sb.from("pedidos").select("id,numero,criado_em,cliente_nome,bairro,endereco,total,taxa_entrega,pagamento,pagamento_status,entregador_id,status")
      .eq("tipo", "entrega").neq("status", "cancelado").gte("criado_em", de.toISOString()).lt("criado_em", ate.toISOString()).order("criado_em"));
  } catch (e) { $("#entRel").innerHTML = `<p class="erro">${esc(e.message)}</p>`; return; }
  const cobrar = (p) => p.pagamento_status !== "pago" && p.pagamento !== "pago_app";
  const grupos = [...entregadores.map((e) => ({ e, ps: peds.filter((p) => p.entregador_id === e.id) })),
    { e: { id: "", nome: "Sem entregador escolhido", telefone: "" }, ps: peds.filter((p) => !p.entregador_id || !entregadores.some((x) => x.id === p.entregador_id)) }]
    .filter((g) => g.e.id || g.ps.length);
  const resumo = (ps) => ({ n: ps.length, total: ps.reduce((s, p) => s + num(p.total), 0), taxas: ps.reduce((s, p) => s + num(p.taxa_entrega), 0),
    dinheiro: ps.filter((p) => cobrar(p) && p.pagamento === "dinheiro").reduce((s, p) => s + num(p.total), 0),
    cartao: ps.filter((p) => cobrar(p) && p.pagamento === "cartao_entrega").reduce((s, p) => s + num(p.total), 0) });
  const geral = resumo(peds);
  const varios = perEnt.tipo === "mes" || perEnt.tipo === "mespassado" || perEnt.tipo === "escolhermes";
  $("#entRel").innerHTML = `<div class="kpis"><div class="kpi"><span>Entregas</span><b>${geral.n}</b></div><div class="kpi"><span>Valor dos pedidos</span><b>${brl(geral.total)}</b></div>
      <div class="kpi"><span>Taxas de entrega</span><b>${brl(geral.taxas)}</b></div><div class="kpi"><span>Recebido na entrega</span><b>${brl(geral.dinheiro + geral.cartao)}</b><small>💵 ${brl(geral.dinheiro)} · 💳 ${brl(geral.cartao)}</small></div></div>
    ${grupos.map((g) => { const r = resumo(g.ps); return `<div class="caixa ent-card ${g.e.id ? "" : "sem-ent"}" data-ent="${g.e.id}">
      <div class="ent-topo"><div><h2 style="margin:0">${g.e.id ? "🛵 " : "⚠ "}${esc(g.e.nome)}</h2>
        <span class="muted">${r.n} entrega${r.n === 1 ? "" : "s"} · pedidos ${brl(r.total)} · taxas <b>${brl(r.taxas)}</b>${r.dinheiro ? ` · 💵 dinheiro ${brl(r.dinheiro)}` : ""}${r.cartao ? ` · 💳 maquininha ${brl(r.cartao)}` : ""}</span></div>
        <div class="acs">${r.n ? `<button class="btn sec peq" data-ver>Ver pedidos</button>` : ""}${g.e.telefone && r.n ? `<button class="btn sec peq" data-zap>💬 Mandar resumo</button>` : ""}${r.n ? `<button class="btn sec peq" data-imp>🖨</button>` : ""}</div></div>
      <div class="ent-lista oculto">${varios ? porDia(g.ps) : ""}<table class="t"><tr><th>#</th><th>${varios ? "Data" : "Hora"}</th><th>Cliente</th><th>Bairro</th><th>Pagamento</th><th class="num">Taxa</th><th class="num">Total</th></tr>
        ${g.ps.map((p) => `<tr><td>#${p.numero}</td><td>${varios ? dataBR(p.criado_em).slice(0, 5) + " " : ""}${hora(p.criado_em)}</td><td>${esc(p.cliente_nome)}</td><td>${esc(p.bairro || "—")}</td>
          <td>${cobrar(p) ? esc(NOMES_PAGAMENTO[p.pagamento] || p.pagamento) : `<span class="badge ok">pago</span>`}</td><td class="num">${brl(p.taxa_entrega)}</td><td class="num">${brl(p.total)}</td></tr>`).join("")}</table></div></div>`; }).join("")
    || `<p class="vazio">Nenhuma entrega neste período.</p>`}`;

  function porDia(ps) {
    const m = new Map(); ps.forEach((p) => { const k = dataBR(p.criado_em); const x = m.get(k) || { n: 0, t: 0 }; x.n++; x.t += num(p.taxa_entrega); m.set(k, x); });
    return `<div class="por-dia">${[...m.entries()].map(([k, x]) => `<span><b>${k.slice(0, 5)}</b> ${x.n} ent. · ${brl(x.t)}</span>`).join("")}</div>`;
  }
  const grupoDe = (el) => grupos.find((g) => g.e.id === el.closest("[data-ent]").dataset.ent);
  C().querySelectorAll("[data-ver]").forEach((b) => b.onclick = () => { const l = b.closest(".ent-card").querySelector(".ent-lista"); l.classList.toggle("oculto"); b.textContent = l.classList.contains("oculto") ? "Ver pedidos" : "Esconder"; });
  const textoResumo = (g) => {
    const r = resumo(g.ps);
    return [`🛵 *Resumo de entregas — ${g.e.nome}*`, rotulo, "", ...g.ps.map((p) => `#${p.numero} ${varios ? dataBR(p.criado_em).slice(0, 5) + " " : ""}${hora(p.criado_em)} · ${p.bairro || ""} · taxa ${brl(p.taxa_entrega)}${cobrar(p) ? ` · cobrar ${brl(p.total)} (${NOMES_PAGAMENTO[p.pagamento]})` : ""}`),
      "", `*Entregas:* ${r.n}`, `*Total de taxas:* ${brl(r.taxas)}`, r.dinheiro ? `*Dinheiro recebido:* ${brl(r.dinheiro)}` : "", r.cartao ? `*Maquininha:* ${brl(r.cartao)}` : ""].filter((x, i, a) => x !== "" || a[i - 1] !== "").join("\n");
  };
  C().querySelectorAll("[data-zap]").forEach((b) => b.onclick = () => { const g = grupoDe(b); window.open(`https://wa.me/${foneWhats(g.e.telefone)}?text=${encodeURIComponent(textoResumo(g))}`, "_blank"); });
  C().querySelectorAll("[data-imp]").forEach((b) => b.onclick = () => {
    const g = grupoDe(b), r = resumo(g.ps);
    const w = window.open("", "impressao", "width=420,height=720"); if (!w) return aviso("Permita pop-ups para imprimir.", "erro");
    const larg = confImp().papel === "58" ? 48 : 72;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Entregas ${esc(g.e.nome)}</title><style>@page{margin:2mm}body{width:${larg}mm;margin:0;font:12px/1.35 Arial,sans-serif}
      h1{font-size:16px;margin:0;text-align:center}.c{text-align:center}.ln{display:flex;justify-content:space-between;border-bottom:1px dotted #888;padding:1mm 0}.tot{font-weight:900;font-size:14px;border-top:2px solid #000;margin-top:2mm;padding-top:1mm}</style></head>
      <body><h1>ENTREGAS — ${esc(g.e.nome.toUpperCase())}</h1><div class="c">${esc(rotulo)}</div><br>
      ${g.ps.map((p) => `<div class="ln"><span>#${p.numero} ${varios ? dataBR(p.criado_em).slice(0, 5) : hora(p.criado_em)} ${esc(p.bairro || "")}</span><span>${brl(p.taxa_entrega)}</span></div>`).join("")}
      <div class="ln tot"><span>${r.n} entregas · TAXAS</span><span>${brl(r.taxas)}</span></div>
      ${r.dinheiro ? `<div class="ln"><span>Dinheiro recebido</span><span>${brl(r.dinheiro)}</span></div>` : ""}${r.cartao ? `<div class="ln"><span>Maquininha</span><span>${brl(r.cartao)}</span></div>` : ""}
      <br><div class="c">Assinatura: ______________________</div></body></html>`);
    w.document.close(); setTimeout(() => { w.focus(); w.print(); setTimeout(() => { try { w.close(); } catch {} }, 1500); }, 300);
  });

  $("#novoEnt").onclick = async () => {
    const r = await formulario({ titulo: "Novo entregador", campos: [
      { nome: "nome", rotulo: "Nome", placeholder: "Ex.: Carlos" },
      { nome: "telefone", rotulo: "WhatsApp", tipo: "tel", opcional: true, placeholder: "(43) 99999-9999", dica: "Usado para mandar o endereço da entrega e o resumo do dia." }],
      botao: "Cadastrar" });
    if (!r) return;
    const { error } = await sb.from("entregadores").insert({ nome: r.nome, telefone: (r.telefone || "").replace(/\D/g, "") }); if (error) return aviso(error.message, "erro");
    aviso(`${r.nome} cadastrado`, "ok");
    telaEntregadores();
  };
  C().querySelectorAll("[data-salvar]").forEach((b) => b.onclick = async () => {
    const tr = b.closest("tr"), v = (c) => tr.querySelector(`[data-c=${c}]`);
    const { error } = await sb.from("entregadores").update({ nome: v("nome").value, telefone: v("telefone").value.replace(/\D/g, ""), ativo: v("ativo").checked }).eq("id", tr.dataset.e);
    if (error) return aviso(error.message, "erro");
    aviso("Entregador salvo", "ok"); await carregarEntregadores();
  });
  C().querySelectorAll("[data-apagar]").forEach((b) => b.onclick = async () => {
    if (!(await confirmar("Remover este entregador?", "Os pedidos antigos continuam registrados.", { botao: "Remover", perigo: true }))) return;
    const { error } = await sb.from("entregadores").delete().eq("id", b.closest("tr").dataset.e); if (error) return aviso(error.message, "erro");
    aviso("Entregador removido", "ok");
    telaEntregadores();
  });
}

// ======================================================================
// Cardápio
// ======================================================================
async function telaCardapio() {
  const cd = await carregarCardapio(true);
  const { cats, prods } = cd;
  C().innerHTML = `<div class="topo-pag">${botaoMenu()}<h1>Cardápio</h1><button class="btn" id="novaCat">+ Categoria</button></div>
    <div class="caixa"><h2>Categorias</h2>
      ${cats.length ? `<table class="t"><tr><th>Nome</th><th style="width:90px">Ordem</th><th>Ativa</th><th></th></tr>${cats.map((k) => `<tr data-cat="${k.id}">
        <td><input class="campo" value="${esc(k.nome)}" data-campo="nome"></td><td><input class="campo" type="number" value="${k.ordem}" data-campo="ordem"></td>
        <td><input type="checkbox" data-campo="ativa" ${k.ativa ? "checked" : ""}></td>
        <td style="white-space:nowrap"><button class="btn sec peq" data-salvar-cat>Salvar</button> <button class="btn perigo peq" data-apagar-cat>Apagar</button></td></tr>`).join("")}</table>`
        : `<p class="vazio">Crie a primeira categoria (ex.: Salgados, Lanches, Bebidas).</p>`}
    </div>
    ${cats.map((k) => `<div class="caixa"><h2>${esc(k.nome)} <button class="btn peq" data-novo-prod="${k.id}">+ Produto</button></h2>
      ${prods.filter((x) => x.categoria_id === k.id).map((x) => `
        <div class="linha-prod ${x.ativo ? "" : "inativo"}">
          <div class="mini" style="${imgCss(x.foto_url)}"></div>
          <div><b>${esc(x.nome)}</b> ${x.destaque ? `<span class="badge alerta">⭐ destaque</span>` : ""}${x.sugerir ? ` <span class="badge">➕ peça também</span>` : ""}<br>
            <span class="muted">${precoEfetivo(x) < num(x.preco) ? `<b style="color:var(--ok)">${brl(precoEfetivo(x))}</b> <s>${brl(x.preco)}</s>` : num(x.preco) === 0 && precoAPartir(x, cd.grupos, cd.opcoes) > 0 ? `a partir de ${brl(precoAPartir(x, cd.grupos, cd.opcoes))} (preço pelo tamanho)` : brl(x.preco)}${x.ativo ? "" : " · oculto"}</span></div>
          <label class="check"><input type="checkbox" data-esgotar="${x.id}" ${x.esgotado ? "checked" : ""}>Esgotado</label>
          <button class="btn sec peq" data-editar="${x.id}">Editar</button><span></span>
        </div>`).join("") || `<p class="vazio">Nenhum produto.</p>`}</div>`).join("")}`;

  $("#novaCat").onclick = async () => {
    const r = await formulario({ titulo: "Nova categoria", campos: [{ nome: "nome", rotulo: "Nome da categoria", placeholder: "Ex.: Salgados, Lanches, Bebidas" }], botao: "Criar" });
    if (!r) return;
    const { error } = await sb.from("categorias").insert({ nome: r.nome, ordem: cats.length }); if (error) return aviso(error.message, "erro");
    aviso("Categoria criada", "ok");
    telaCardapio();
  };
  C().querySelectorAll("[data-salvar-cat]").forEach((b) => b.onclick = async () => {
    const row = b.closest("[data-cat]"), v = (c) => row.querySelector(`[data-campo=${c}]`);
    const { error } = await sb.from("categorias").update({ nome: v("nome").value, ordem: Number(v("ordem").value) || 0, ativa: v("ativa").checked }).eq("id", row.dataset.cat);
    if (error) return aviso(error.message, "erro");
    aviso("Categoria salva", "ok");
    telaCardapio();
  });
  C().querySelectorAll("[data-apagar-cat]").forEach((b) => b.onclick = async () => {
    const id = b.closest("[data-cat]").dataset.cat, n = prods.filter((x) => x.categoria_id === id).length;
    if (!(await confirmar("Apagar a categoria?", n ? `Os ${n} produtos dela também serão apagados.` : "", { botao: "Apagar", perigo: true }))) return;
    const { error } = await sb.from("categorias").delete().eq("id", id); if (error) return aviso(error.message, "erro");
    aviso("Categoria apagada", "ok");
    telaCardapio();
  });
  C().querySelectorAll("[data-esgotar]").forEach((cb) => cb.onchange = async () => {
    const { error } = await sb.from("produtos").update({ esgotado: cb.checked }).eq("id", cb.dataset.esgotar);
    if (error) { aviso(error.message, "erro"); cb.checked = !cb.checked; } else aviso(cb.checked ? "Marcado como esgotado" : "Disponível de novo", "ok");
  });
  C().querySelectorAll("[data-novo-prod]").forEach((b) => b.onclick = () => editarProduto(cd, null, b.dataset.novoProd));
  C().querySelectorAll("[data-editar]").forEach((b) => b.onclick = () => editarProduto(cd, b.dataset.editar));
}

async function enviarFoto(arq, pasta) {
  const ext = (arq.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  const caminho = `${pasta}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const up = await sb.storage.from("fotos").upload(caminho, arq, { upsert: true, contentType: arq.type });
  if (up.error) throw up.error;
  return sb.storage.from("fotos").getPublicUrl(caminho).data.publicUrl;
}

async function editarProduto(cd, id, categoriaId) {
  const novo = !id;
  const p = novo ? { id: crypto.randomUUID(), categoria_id: categoriaId, nome: "", descricao: "", preco: "", preco_promocional: null, foto_url: null, esgotado: false, ativo: true, destaque: false, ordem: cd.prods.length }
    : { ...cd.prods.find((x) => x.id === id) };
  let gs = [];
  if (!novo) {
    const g = cd.grupos.filter((x) => x.produto_id === id);
    gs = g.map((x) => ({ ...x, opcoes: cd.opcoes.filter((y) => y.grupo_id === x.id).map((y) => ({ ...y })) }));
  }
  const m = abrirModal(`<h2>${novo ? "Novo produto" : "Editar produto"}</h2>
    <div class="grade3">
      <div style="grid-column:span 2"><label class="rot">Nome</label><input class="campo" id="pNome" maxlength="80" value="${esc(p.nome)}"></div>
      <div><label class="rot">Categoria</label><select class="campo" id="pCat">${cd.cats.map((k) => `<option value="${k.id}" ${k.id === p.categoria_id ? "selected" : ""}>${esc(k.nome)}</option>`).join("")}</select></div>
    </div>
    <label class="rot">Descrição</label><textarea class="campo" id="pDesc" rows="2" maxlength="500">${esc(p.descricao)}</textarea>
    <div class="grade3">
      <div><label class="rot">Preço (R$)</label><input class="campo" id="pPreco" type="number" min="0" step="0.01" value="${p.preco}"></div>
      <div><label class="rot">Preço promocional <span class="muted">(opcional)</span></label><input class="campo" id="pPromo" type="number" min="0" step="0.01" value="${p.preco_promocional ?? ""}"></div>
      <div><label class="rot">Ordem</label><input class="campo" id="pOrdem" type="number" value="${p.ordem}"></div>
    </div>
    <div style="display:flex;gap:1rem;align-items:center;margin-top:.7rem">
      <div class="mini" id="pPrev" style="width:64px;height:64px;border-radius:10px;background:#f4f4f5 center/cover;${imgCss(p.foto_url)}"></div>
      <div style="flex:1"><label class="rot" style="margin-top:0">Foto</label><input class="campo" id="pFoto" type="file" accept="image/*"></div>
    </div>
    <div style="display:flex;gap:1.4rem;flex-wrap:wrap;margin-top:.5rem">
      <label class="check"><input type="checkbox" id="pAtivo" ${p.ativo ? "checked" : ""}>Aparece no cardápio</label>
      <label class="check"><input type="checkbox" id="pDest" ${p.destaque ? "checked" : ""}>⭐ Destaque</label>
      <label class="check"><input type="checkbox" id="pSug" ${p.sugerir ? "checked" : ""}>➕ Sugerir na sacola ("Peça também")</label>
      <label class="check"><input type="checkbox" id="pEsg" ${p.esgotado ? "checked" : ""}>Esgotado</label>
    </div>
    <h3 style="margin:1.1rem 0 .2rem">Adicionais / opções</h3>
    <p class="muted" style="margin:0;font-size:.82rem">Ex.: "Sabor" mínimo 1 máximo 1 (obrigatório escolher um); "Extras" mínimo 0 máximo 5.</p>
    <div id="grupos"></div>
    <button class="btn sec peq" id="addGrupo" style="margin-top:.6rem">+ Grupo de adicionais</button>
    <div class="erro" id="pErro"></div>
    <div style="display:flex;gap:.6rem;margin-top:.8rem">${novo ? "" : `<button class="btn perigo" id="pApagar">Apagar</button>`}<button class="btn" id="pSalvar" style="flex:1">Salvar</button></div>`, 720);

  $("#pFoto", m).onchange = (e) => { const f = e.target.files[0]; if (f) $("#pPrev", m).style.backgroundImage = `url(${URL.createObjectURL(f)})`; };
  const lerTela = () => m.querySelectorAll(".grupo-ed").forEach((ge, gi) => {
    const g = gs[gi];
    g.nome = ge.querySelector("[data-g=nome]").value; g.minimo = Number(ge.querySelector("[data-g=min]").value) || 0; g.maximo = Number(ge.querySelector("[data-g=max]").value) || 1;
    ge.querySelectorAll(".op-ed").forEach((oe, oi) => { const o = g.opcoes[oi]; o.nome = oe.querySelector("[data-o=nome]").value; o.preco = Number(oe.querySelector("[data-o=preco]").value) || 0; o.esgotado = oe.querySelector("[data-o=esg]").checked; });
  });
  const desenharGrupos = () => {
    $("#grupos", m).innerHTML = gs.map((g, gi) => `<div class="grupo-ed" data-gi="${gi}">
      <div class="grade3"><div><label class="rot">Nome do grupo</label><input class="campo" data-g="nome" value="${esc(g.nome)}"></div>
      <div><label class="rot">Mínimo</label><input class="campo" data-g="min" type="number" min="0" value="${g.minimo}"></div>
      <div><label class="rot">Máximo</label><input class="campo" data-g="max" type="number" min="1" value="${g.maximo}"></div></div>
      ${g.opcoes.map((o, oi) => `<div class="op-ed"><input class="campo" data-o="nome" placeholder="Opção" value="${esc(o.nome)}">
        <input class="campo" data-o="preco" type="number" min="0" step="0.01" placeholder="R$" value="${o.preco}">
        <label class="check"><input type="checkbox" data-o="esg" ${o.esgotado ? "checked" : ""}>Esgotado</label>
        <button class="btn perigo peq" data-rem-op="${oi}">×</button></div>`).join("")}
      <div style="display:flex;gap:.4rem;margin-top:.5rem"><button class="btn sec peq" data-add-op>+ Opção</button><button class="btn perigo peq" data-rem-grupo>Remover grupo</button></div></div>`).join("");
    m.querySelectorAll("[data-add-op]").forEach((b) => b.onclick = () => { lerTela(); gs[b.closest(".grupo-ed").dataset.gi].opcoes.push({ id: crypto.randomUUID(), nome: "", preco: 0, esgotado: false }); desenharGrupos(); });
    m.querySelectorAll("[data-rem-op]").forEach((b) => b.onclick = () => { lerTela(); gs[b.closest(".grupo-ed").dataset.gi].opcoes.splice(Number(b.dataset.remOp), 1); desenharGrupos(); });
    m.querySelectorAll("[data-rem-grupo]").forEach((b) => b.onclick = () => { lerTela(); gs.splice(Number(b.closest(".grupo-ed").dataset.gi), 1); desenharGrupos(); });
  };
  $("#addGrupo", m).onclick = () => { lerTela(); gs.push({ id: crypto.randomUUID(), nome: "", minimo: 0, maximo: 1, opcoes: [] }); desenharGrupos(); };
  desenharGrupos();

  if (!novo) $("#pApagar", m).onclick = async () => {
    if (!(await confirmar(`Apagar "${esc(p.nome)}"?`, 'Para só esconder do cardápio, desmarque "Aparece no cardápio".', { botao: "Apagar", perigo: true }))) return;
    const { error } = await sb.from("produtos").delete().eq("id", p.id); if (error) return aviso(error.message, "erro");
    aviso("Produto apagado", "ok");
    m.remove(); telaCardapio();
  };
  $("#pSalvar", m).onclick = async () => {
    lerTela();
    const erro = $("#pErro", m), btn = $("#pSalvar", m);
    erro.textContent = "";
    const nome = $("#pNome", m).value.trim(), preco = Number($("#pPreco", m).value);
    const promoTxt = $("#pPromo", m).value.trim(), promo = promoTxt === "" ? null : Number(promoTxt);
    if (!nome) return erro.textContent = "Informe o nome.";
    if (!($("#pPreco", m).value !== "" && preco >= 0)) return erro.textContent = "Informe o preço.";
    if (promo != null && !(promo >= 0 && promo < preco)) return erro.textContent = "O preço promocional precisa ser menor que o preço normal.";
    if (!cd.cats.length) return erro.textContent = "Crie uma categoria antes.";
    for (const g of gs) {
      if (!g.nome.trim()) return erro.textContent = "Dê um nome a cada grupo de adicionais.";
      if (g.minimo > g.maximo) return erro.textContent = `No grupo "${g.nome}" o mínimo é maior que o máximo.`;
      if (!g.opcoes.length) return erro.textContent = `O grupo "${g.nome}" não tem opções.`;
      if (g.opcoes.some((o) => !o.nome.trim())) return erro.textContent = `Há opção sem nome em "${g.nome}".`;
    }
    btn.disabled = true; btn.textContent = "Salvando…";
    try {
      let foto_url = p.foto_url;
      const arq = $("#pFoto", m).files[0];
      if (arq) foto_url = await enviarFoto(arq, "produtos");
      let r = await sb.from("produtos").upsert({ id: p.id, categoria_id: $("#pCat", m).value, nome, descricao: $("#pDesc", m).value.trim(), preco, preco_promocional: promo,
        foto_url, ordem: Number($("#pOrdem", m).value) || 0, ativo: $("#pAtivo", m).checked, esgotado: $("#pEsg", m).checked, destaque: $("#pDest", m).checked, sugerir: $("#pSug", m).checked });
      if (r.error) throw r.error;
      const gIds = gs.map((g) => g.id);
      let del = sb.from("grupos_adicionais").delete().eq("produto_id", p.id);
      if (gIds.length) del = del.not("id", "in", `(${gIds.join(",")})`);
      r = await del; if (r.error) throw r.error;
      if (gs.length) {
        r = await sb.from("grupos_adicionais").upsert(gs.map((g, i) => ({ id: g.id, produto_id: p.id, nome: g.nome.trim(), minimo: g.minimo, maximo: g.maximo, ordem: i }))); if (r.error) throw r.error;
        const oIds = gs.flatMap((g) => g.opcoes.map((o) => o.id));
        r = await sb.from("opcoes_adicionais").delete().in("grupo_id", gIds).not("id", "in", `(${oIds.join(",")})`); if (r.error) throw r.error;
        r = await sb.from("opcoes_adicionais").upsert(gs.flatMap((g) => g.opcoes.map((o, i) => ({ id: o.id, grupo_id: g.id, nome: o.nome.trim(), preco: o.preco, esgotado: o.esgotado, ordem: i })))); if (r.error) throw r.error;
      }
      m.remove(); telaCardapio(); aviso("Produto salvo", "ok");
    } catch (e) { erro.textContent = "Erro ao salvar: " + (e.message || e); btn.disabled = false; btn.textContent = "Salvar"; }
  };
}

// ======================================================================
// Cupons
// ======================================================================
const NOME_TIPO_CUPOM = { percentual: "% de desconto", valor: "R$ de desconto", frete: "Frete grátis" };
async function telaCupons() {
  const { data: cupons } = await sb.from("cupons").select("*").order("criado_em", { ascending: false });
  const desc = (c) => c.tipo === "percentual" ? `${num(c.valor)}% off` : c.tipo === "valor" ? `${brl(c.valor)} off` : "Frete grátis";
  C().innerHTML = `<div class="topo-pag">${botaoMenu()}<h1>Cupons</h1><button class="btn" id="novoCupom">+ Cupom</button></div>
    <div class="caixa"><table class="t"><tr><th>Código</th><th>Desconto</th><th>Pedido mínimo</th><th>Regras</th><th class="num">Usos</th><th>Ativo</th><th></th></tr>
    ${(cupons || []).map((c) => `<tr><td><b style="font-family:monospace;font-size:.95rem">${esc(c.codigo)}</b></td><td>${desc(c)}</td><td>${num(c.pedido_minimo) ? brl(c.pedido_minimo) : "—"}</td>
      <td>${[c.primeira_compra && `<span class="badge azul">1ª compra</span>`, c.validade && `<span class="badge ${new Date(c.validade + "T23:59") < new Date() ? "perigo" : ""}">até ${dataBR(c.validade + "T12:00")}</span>`].filter(Boolean).join(" ") || "—"}</td>
      <td class="num">${c.usos}${c.limite_usos ? " / " + c.limite_usos : ""}</td>
      <td><input type="checkbox" data-ativo="${c.id}" ${c.ativo ? "checked" : ""}></td>
      <td style="white-space:nowrap"><button class="btn sec peq" data-ed="${c.id}">Editar</button> <button class="btn perigo peq" data-del="${c.id}">×</button></td></tr>`).join("") || `<tr><td colspan="7" class="vazio">Nenhum cupom ainda. Ideias: BEMVINDO10 (10% na 1ª compra), FRETEGRATIS (acima de R$ 50).</td></tr>`}
    </table></div>`;
  $("#novoCupom").onclick = () => editarCupom(null);
  C().querySelectorAll("[data-ed]").forEach((b) => b.onclick = () => editarCupom(cupons.find((c) => c.id === b.dataset.ed)));
  C().querySelectorAll("[data-ativo]").forEach((cb) => cb.onchange = async () => { const { error } = await sb.from("cupons").update({ ativo: cb.checked }).eq("id", cb.dataset.ativo); if (error) aviso(error.message, "erro"); else aviso(cb.checked ? "Cupom ativado" : "Cupom desativado", "ok"); });
  C().querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => { if (!(await confirmar("Apagar este cupom?", "", { botao: "Apagar", perigo: true }))) return; const { error } = await sb.from("cupons").delete().eq("id", b.dataset.del); if (error) return aviso(error.message, "erro"); aviso("Cupom apagado", "ok"); telaCupons(); });
}
function editarCupom(c) {
  const novo = !c;
  c = c || { codigo: "", tipo: "percentual", valor: 10, pedido_minimo: 0, primeira_compra: false, validade: "", limite_usos: "", ativo: true };
  const m = abrirModal(`<h2>${novo ? "Novo cupom" : "Editar cupom"}</h2>
    <div class="grade2"><div><label class="rot">Código</label><input class="campo" id="kCod" style="text-transform:uppercase" maxlength="30" value="${esc(c.codigo)}" placeholder="BEMVINDO10"></div>
      <div><label class="rot">Tipo</label><select class="campo" id="kTipo">${Object.entries(NOME_TIPO_CUPOM).map(([k, t]) => `<option value="${k}" ${c.tipo === k ? "selected" : ""}>${t}</option>`).join("")}</select></div></div>
    <div class="grade2"><div id="kValorBox"><label class="rot" id="kValorRot">Valor</label><input class="campo" id="kValor" type="number" min="0" step="0.01" value="${c.valor}"></div>
      <div><label class="rot">Pedido mínimo (R$)</label><input class="campo" id="kMin" type="number" min="0" step="0.01" value="${c.pedido_minimo}"></div></div>
    <div class="grade2"><div><label class="rot">Válido até <span class="muted">(opcional)</span></label><input class="campo" id="kVal" type="date" value="${c.validade || ""}"></div>
      <div><label class="rot">Limite de usos <span class="muted">(opcional)</span></label><input class="campo" id="kLim" type="number" min="1" value="${c.limite_usos ?? ""}"></div></div>
    <label class="check" style="margin-top:.8rem"><input type="checkbox" id="kPrim" ${c.primeira_compra ? "checked" : ""}>Só na primeira compra do cliente</label>
    <label class="check"><input type="checkbox" id="kAtivo" ${c.ativo ? "checked" : ""}>Ativo</label>
    <div class="erro" id="kErro"></div><button class="btn bloco" id="kSalvar">Salvar</button>`, 520);
  const ajustar = () => { const t = $("#kTipo", m).value; $("#kValorBox", m).classList.toggle("oculto", t === "frete"); $("#kValorRot", m).textContent = t === "percentual" ? "Porcentagem (%)" : "Valor (R$)"; };
  $("#kTipo", m).onchange = ajustar; ajustar();
  $("#kSalvar", m).onclick = async () => {
    const codigo = $("#kCod", m).value.trim().toUpperCase().replace(/\s+/g, "");
    const tipo = $("#kTipo", m).value, valor = tipo === "frete" ? 0 : Number($("#kValor", m).value);
    if (!codigo) return $("#kErro", m).textContent = "Informe o código.";
    if (tipo !== "frete" && !(valor > 0)) return $("#kErro", m).textContent = "Informe o valor do desconto.";
    if (tipo === "percentual" && valor > 100) return $("#kErro", m).textContent = "A porcentagem vai até 100.";
    const dados = { codigo, tipo, valor, pedido_minimo: Number($("#kMin", m).value) || 0, validade: $("#kVal", m).value || null,
      limite_usos: $("#kLim", m).value ? Number($("#kLim", m).value) : null, primeira_compra: $("#kPrim", m).checked, ativo: $("#kAtivo", m).checked };
    const r = novo ? await sb.from("cupons").insert(dados) : await sb.from("cupons").update(dados).eq("id", c.id);
    if (r.error) return $("#kErro", m).textContent = r.error.code === "23505" ? "Já existe um cupom com esse código." : r.error.message;
    m.remove(); telaCupons(); aviso("Cupom salvo", "ok");
  };
}

// ======================================================================
// Entrega e horários
// ======================================================================
async function telaEntrega() {
  const [{ data: bairrosDb }, { data: horarios }] = await Promise.all([sb.from("bairros").select("*").order("nome"), sb.from("horarios").select("*")]);
  let bairros = bairrosDb || [];
  const faixas = DIAS.map((_, i) => (horarios || []).filter((h) => h.dia_semana === i).map((h) => ({ abre: h.abre.slice(0, 5), fecha: h.fecha.slice(0, 5) })).sort((a, b) => a.abre.localeCompare(b.abre)));
  const desenharHorarios = () => DIAS.map((d, i) => `<tr><td style="width:110px"><b>${d}</b></td><td>
    ${faixas[i].map((f, k) => `<div class="faixa"><input class="campo" type="time" data-d="${i}" data-k="${k}" data-c="abre" value="${f.abre}"> às
      <input class="campo" type="time" data-d="${i}" data-k="${k}" data-c="fecha" value="${f.fecha}"><button class="btn perigo peq" data-rem-f="${i}-${k}">×</button></div>`).join("") || `<span class="muted">Fechado</span>`}
    </td><td style="width:1%;white-space:nowrap"><button class="btn sec peq" data-add-f="${i}">+ horário</button>${i > 0 ? ` <button class="btn sec peq" data-copiar="${i}" title="Copiar do dia anterior">⧉ igual ${DIAS[i - 1].slice(0, 3).toLowerCase()}</button>` : ""}</td></tr>`).join("");
  let fx = [...(loja.faixas_km || [])].sort((a, b) => a.ate - b.ate);
  let modo = loja.modo_taxa || "bairro";
  let buscaB = "", soSemKm = false;
  const lojaTmp = () => ({ ...loja, modo_taxa: modo, faixas_km: fx });
  const desenharFaixas = () => fx.map((f, k) => `<tr><td>até <input class="campo curto" data-fx="${k}" data-c="ate" inputmode="decimal" value="${String(f.ate).replace(".", ",")}"> km</td>
    <td>R$ <input class="campo curto" data-fx="${k}" data-c="taxa" inputmode="decimal" value="${num(f.taxa).toFixed(2).replace(".", ",")}"></td>
    <td><button class="btn perigo peq" data-rem-fx="${k}">×</button></td></tr>`).join("") + `<tr><td colspan="3" class="muted" style="font-size:.85rem">Acima de ${fx.length ? String(fx[fx.length - 1].ate).replace(".", ",") : "0"} km: <b>não entrega</b></td></tr>`;
  const desenharBairros = () => {
    const t = buscaB.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const lista = [...bairros].sort((a, b) => (b.ativo - a.ativo) || a.nome.localeCompare(b.nome)).filter((b) => (!t || b.nome.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(t)) && (!soSemKm || b.distancia_km == null));
    return lista.map((b) => { const cobra = taxaDoBairro(lojaTmp(), b);
      return `<tr data-b="${b.id}" class="${b.ativo ? "" : "inativo"}"><td><input class="campo" data-c="nome" value="${esc(b.nome)}"></td>
      <td><input class="campo curto" data-c="distancia_km" inputmode="decimal" placeholder="?" value="${b.distancia_km == null ? "" : String(b.distancia_km).replace(".", ",")}"></td>
      <td><input class="campo curto" data-c="taxa" inputmode="decimal" placeholder="faixa" value="${b.taxa == null ? "" : num(b.taxa).toFixed(2).replace(".", ",")}"></td>
      <td><b>${cobra == null ? `<span class="badge perigo">fora da área</span>` : brl(cobra)}</b></td>
      <td><input type="checkbox" data-c="ativo" ${b.ativo ? "checked" : ""}></td><td><button class="btn perigo peq" data-del-b>×</button></td></tr>`; }).join("")
      || `<tr><td colspan="6" class="vazio">${bairros.length ? "Nenhum bairro na busca" : "Nenhum bairro — usando taxa fixa."}</td></tr>`;
  };
  const semKm = () => bairros.filter((b) => b.ativo && b.distancia_km == null).length;
  C().innerHTML = `<div class="topo-pag">${botaoMenu()}<h1>Entrega e horários</h1></div>
    <div class="caixa"><h2>Como cobrar a entrega</h2>
      <div class="seg" style="max-width:420px">${[["bairro", "📍 Por bairro"], ["raio", "📏 Por raio (km)"]].map(([v, t]) => `<button data-modo="${v}" class="${modo === v ? "ativo" : ""}">${t}</button>`).join("")}</div>
      <p class="muted" id="explicaModo" style="margin:.6rem 0"></p>
      <div class="grade2">
        <div><label class="rot">Endereço da loja (ponto de partida)</label><input class="campo" id="eOrigem" value="${esc(loja.endereco_origem || "")}">
          <label class="rot">Coordenadas da loja <span class="muted">(preenche sozinho; pode colar do Google Maps)</span></label>
          <input class="campo" id="eCoord" placeholder="-23.55, -51.46" value="${loja.lat != null ? loja.lat.toFixed(6) + ", " + loja.lng.toFixed(6) : ""}"></div>
        <div><label class="rot">Faixas de distância</label><table class="t" id="tabFx">${desenharFaixas()}</table>
          <button class="btn sec peq" id="addFx" style="margin-top:.4rem">+ faixa</button></div>
      </div>
      <div class="erro" id="eErro"></div><button class="btn" id="eSalvar">Salvar forma de cobrança</button>
    </div>
    <div class="caixa"><h2><span>Bairros (<span id="nB">${bairros.length}</span>)</span> <span style="display:flex;gap:.4rem;flex-wrap:wrap">
        <button class="btn sec peq" id="calcKm">📏 Calcular distâncias</button><button class="btn peq" id="addBairro">+ Bairro</button></span></h2>
      <p class="muted" style="margin-top:0">O cliente escolhe o bairro na sacola. <b>Taxa vazia</b> = usa a faixa de km. Desmarque "ativo" para bairros que você não atende. As mudanças salvam sozinhas.</p>
      <div id="progKm" class="oculto aviso-som" style="margin-bottom:.6rem"></div>
      <div style="display:flex;gap:.6rem;align-items:center;flex-wrap:wrap;margin-bottom:.5rem">
        <input class="campo" id="bBusca" placeholder="🔎 Buscar bairro" style="max-width:280px">
        <label class="check" style="margin:0"><input type="checkbox" id="bSemKm"> só os sem km (<span id="nSemKm">${semKm()}</span>)</label></div>
      <div class="rolagem"><table class="t" id="tabB"><tr><th>Bairro</th><th style="width:90px">km</th><th style="width:110px">Taxa própria</th><th>Cobra</th><th>Ativo</th><th></th></tr><tbody id="corpoB">${desenharBairros()}</tbody></table></div>
    </div>
    <div class="caixa"><h2>Horário de funcionamento</h2>
      <label class="check"><input type="checkbox" id="hAuto" ${loja.horario_automatico ? "checked" : ""}><b>Abrir e fechar a loja automaticamente nestes horários</b></label>
      <p class="muted" style="margin:.2rem 0 .6rem">O botão "Loja aberta/fechada" do menu continua funcionando para pausar a loja quando precisar. Para horário que passa da meia-noite, use por exemplo 18:00 às 02:00.</p>
      <table class="t" id="tabHor">${desenharHorarios()}</table>
      <div class="erro" id="hErro"></div><button class="btn" id="hSalvar">Salvar horários</button>
    </div>`;
  const lerFaixas = () => C().querySelectorAll("#tabHor input[type=time]").forEach((i) => faixas[i.dataset.d][i.dataset.k][i.dataset.c] = i.value);
  const ligarHorarios = () => {
    C().querySelectorAll("[data-add-f]").forEach((b) => b.onclick = () => { lerFaixas(); faixas[b.dataset.addF].push({ abre: "18:00", fecha: "23:00" }); $("#tabHor").innerHTML = desenharHorarios(); ligarHorarios(); });
    C().querySelectorAll("[data-rem-f]").forEach((b) => b.onclick = () => { lerFaixas(); const [d, k] = b.dataset.remF.split("-"); faixas[d].splice(k, 1); $("#tabHor").innerHTML = desenharHorarios(); ligarHorarios(); });
    C().querySelectorAll("[data-copiar]").forEach((b) => b.onclick = () => { lerFaixas(); const i = Number(b.dataset.copiar); faixas[i] = faixas[i - 1].map((f) => ({ ...f })); $("#tabHor").innerHTML = desenharHorarios(); ligarHorarios(); });
  };
  ligarHorarios();
  $("#hSalvar").onclick = async () => {
    lerFaixas();
    const linhas = faixas.flatMap((fs, d) => fs.map((f) => ({ dia_semana: d, abre: f.abre, fecha: f.fecha })));
    if (linhas.some((l) => !l.abre || !l.fecha || l.abre === l.fecha)) return $("#hErro").textContent = "Confira os horários (abertura e fechamento iguais ou vazios).";
    const auto = $("#hAuto").checked;
    if (auto && !linhas.length) return $("#hErro").textContent = "Cadastre ao menos um horário para usar o modo automático.";
    let r = await sb.from("horarios").delete().not("id", "is", null); if (r.error) return $("#hErro").textContent = r.error.message;
    if (linhas.length) { r = await sb.from("horarios").insert(linhas); if (r.error) return $("#hErro").textContent = r.error.message; }
    r = await sb.from("loja").update({ horario_automatico: auto }).eq("id", 1); if (r.error) return $("#hErro").textContent = r.error.message;
    await carregarLoja();
    $("#hErro").textContent = ""; $("#hSalvar").textContent = "Salvo ✓"; setTimeout(() => $("#hSalvar") && ($("#hSalvar").textContent = "Salvar horários"), 1500);
  };

  const explicar = () => $("#explicaModo").innerHTML = modo === "raio"
    ? "A taxa sai da <b>distância de carro</b> entre a loja e o bairro, pelas faixas abaixo. A taxa própria do bairro é ignorada."
    : "Cada bairro usa a <b>taxa própria</b>. Bairro com taxa vazia usa a faixa de km. Sem km nem taxa, vale a taxa fixa da aba Loja.";
  const lerFx = () => C().querySelectorAll("[data-fx]").forEach((i) => fx[i.dataset.fx][i.dataset.c] = Number(i.value.replace(",", ".")) || 0);
  const ligarFx = () => {
    C().querySelectorAll("[data-rem-fx]").forEach((b) => b.onclick = () => { lerFx(); fx.splice(b.dataset.remFx, 1); $("#tabFx").innerHTML = desenharFaixas(); ligarFx(); redesenharB(); });
    C().querySelectorAll("[data-fx]").forEach((i) => i.onchange = () => { lerFx(); redesenharB(); });
  };
  const redesenharB = () => { $("#corpoB").innerHTML = desenharBairros(); $("#nSemKm").textContent = semKm(); $("#nB").textContent = bairros.length; ligarB(); };
  explicar(); ligarFx();
  C().querySelectorAll("[data-modo]").forEach((b) => b.onclick = () => { modo = b.dataset.modo; C().querySelectorAll("[data-modo]").forEach((x) => x.classList.toggle("ativo", x === b)); explicar(); redesenharB(); });
  $("#addFx").onclick = () => { lerFx(); const ult = fx[fx.length - 1]; fx.push({ ate: ult ? ult.ate + 2 : 2, taxa: ult ? ult.taxa + 2 : 5 }); $("#tabFx").innerHTML = desenharFaixas(); ligarFx(); };
  const lerCoord = () => { const m = $("#eCoord").value.match(/(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)/); return m ? { lat: Number(m[1]), lng: Number(m[2]) } : null; };
  $("#eSalvar").onclick = async () => {
    lerFx();
    const faixas = fx.filter((f) => f.ate > 0).sort((a, b) => a.ate - b.ate);
    if (modo === "raio" && !faixas.length) return $("#eErro").textContent = "Cadastre ao menos uma faixa de km.";
    const c = lerCoord();
    const { error } = await sb.from("loja").update({ modo_taxa: modo, faixas_km: faixas, endereco_origem: $("#eOrigem").value.trim(), ...(c ? c : {}) }).eq("id", 1);
    if (error) return $("#eErro").textContent = error.message;
    $("#eErro").textContent = ""; await carregarLoja(); fx = [...loja.faixas_km]; $("#tabFx").innerHTML = desenharFaixas(); ligarFx();
    aviso("Forma de cobrança salva", "ok");
  };
  $("#bBusca").oninput = (e) => { buscaB = e.target.value; redesenharB(); };
  $("#bSemKm").onchange = (e) => { soSemKm = e.target.checked; redesenharB(); };
  function ligarB() {
    C().querySelectorAll("#corpoB [data-c]").forEach((inp) => inp.onchange = async () => {
      const tr = inp.closest("tr"), b = bairros.find((x) => x.id === tr.dataset.b), c = inp.dataset.c;
      let v = inp.type === "checkbox" ? inp.checked : inp.value.trim();
      if (c === "taxa" || c === "distancia_km") v = v === "" ? null : Number(String(v).replace(",", "."));
      if ((c === "taxa" || c === "distancia_km") && v != null && !(v >= 0)) return aviso("Número inválido", "erro");
      if (c === "nome" && !v) return aviso("O nome não pode ficar vazio", "erro");
      const { error } = await sb.from("bairros").update({ [c]: v }).eq("id", b.id);
      if (error) return aviso(error.message, "erro");
      b[c] = v; aviso(`${b.nome} salvo`, "ok");
      if (c !== "nome") redesenharB();
    });
    C().querySelectorAll("#corpoB [data-del-b]").forEach((bt) => bt.onclick = async () => {
      const b = bairros.find((x) => x.id === bt.closest("tr").dataset.b);
      if (!(await confirmar(`Remover ${b.nome}?`, "Se quiser só parar de atender, é melhor desmarcar \"ativo\".", { botao: "Remover", perigo: true }))) return;
      const { error } = await sb.from("bairros").delete().eq("id", b.id); if (error) return aviso(error.message, "erro");
      bairros = bairros.filter((x) => x !== b); redesenharB(); aviso("Bairro removido", "ok");
    });
  }
  ligarB();
  $("#addBairro").onclick = async () => {
    const r = await formulario({ titulo: "Novo bairro", campos: [
      { nome: "nome", rotulo: "Nome do bairro", placeholder: "Ex.: Jardim Novo" },
      { nome: "distancia_km", rotulo: "Distância da loja (km)", tipo: "number", opcional: true, dica: "Deixe vazio e use \"Calcular distâncias\"." },
      { nome: "taxa", rotulo: "Taxa própria", tipo: "number", prefixo: "R$", opcional: true, dica: "Vazio = usa a faixa de km." }], botao: "Adicionar" });
    if (!r) return;
    const { data, error } = await sb.from("bairros").insert({ nome: r.nome, taxa: r.taxa, distancia_km: r.distancia_km }).select().single();
    if (error) return aviso(error.code === "23505" ? "Esse bairro já existe." : error.message, "erro");
    bairros.push(data); bairros.sort((a, b) => a.nome.localeCompare(b.nome)); redesenharB(); aviso(`${r.nome} adicionado`, "ok");
  };
  $("#calcKm").onclick = async () => {
    const todos = semKm() === 0;
    const alvo = bairros.filter((b) => b.ativo && (todos || b.distancia_km == null));
    if (!alvo.length) return aviso("Nenhum bairro ativo para calcular.", "erro");
    if (!(await confirmar("Calcular distâncias?", `Vou localizar ${alvo.length} bairro(s) no mapa (OpenStreetMap) e medir a distância de carro até a loja. Leva uns ${Math.ceil(alvo.length * 1.2 / 60)} min — deixe esta tela aberta.${todos ? " Todos já têm km: vou recalcular." : ""}`, { botao: "Calcular" }))) return;
    const prog = $("#progKm"); prog.classList.remove("oculto");
    const msg = (t) => prog.innerHTML = `<span>${t}</span>`;
    try {
      let origem = lerCoord();
      if (!origem) {
        msg("Localizando a loja…");
        origem = await localizarEndereco($("#eOrigem").value);
        if (!origem) { msg("❌ Não achei o endereço da loja no mapa. Cole as coordenadas (Google Maps → clique no local → copie os números) e tente de novo."); return; }
        $("#eCoord").value = origem.lat.toFixed(6) + ", " + origem.lng.toFixed(6);
        await sb.from("loja").update({ lat: origem.lat, lng: origem.lng, endereco_origem: $("#eOrigem").value.trim() }).eq("id", 1);
      }
      const cidade = cidadeDe($("#eOrigem").value);
      let feitos = 0, achados = 0;
      const pontos = [];
      for (const b of alvo) {
        msg(`Localizando bairros… ${++feitos}/${alvo.length} <b>${esc(b.nome)}</b>`);
        const pt = await localizarBairro(b.nome, cidade, origem);
        if (pt) { pontos.push({ b, ...pt }); achados++; }
        await esperar(1100); // regra de uso do OpenStreetMap: 1 consulta por segundo
      }
      msg(`Medindo distâncias de carro… (${achados} bairros achados)`);
      const kms = await distanciasCarro(origem, pontos);
      let salvos = 0;
      for (let k = 0; k < pontos.length; k++) {
        const { b, lat, lng } = pontos[k], km = kms[k];
        if (km == null) continue;
        const { error } = await sb.from("bairros").update({ lat, lng, distancia_km: km }).eq("id", b.id);
        if (!error) { b.lat = lat; b.lng = lng; b.distancia_km = km; salvos++; }
      }
      redesenharB();
      const falt = alvo.length - salvos;
      msg(`✅ Pronto: ${salvos} bairro(s) com distância.${falt ? ` ${falt} não foram achados no mapa — marque "só os sem km" e digite o km deles (ou desative).` : ""}`);
    } catch (e) { msg("❌ Erro: " + esc(e.message || String(e)) + ". Tente de novo em alguns minutos."); }
  };
}

// ----- mapa (OpenStreetMap) — roda no navegador de quem usa o painel -----
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const cidadeDe = (end) => (String(end).match(/,\s*([^,\-]+?)\s*(?:-\s*[A-Za-z]{2})?\s*$/) || [])[1]?.trim() || "";
function kmReta(a, b) {
  const R = 6371, r = (x) => x * Math.PI / 180, dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const MAPA = { busca: "https://nominatim.openstreetmap.org/search", rotas: "https://router.project-osrm.org" };
async function nominatim(params) {
  const u = MAPA.busca + "?" + new URLSearchParams({ format: "json", limit: "5", countrycodes: "br", ...params });
  const r = await fetch(u, { headers: { "Accept-Language": "pt-BR" } });
  if (!r.ok) throw new Error("mapa indisponível (" + r.status + ")");
  return (await r.json()).map((x) => ({ lat: Number(x.lat), lng: Number(x.lon), nome: x.display_name }));
}
async function localizarEndereco(end) {
  let res = await nominatim({ q: end });
  if (!res.length) { await esperar(1100); res = await nominatim({ q: end.replace(/,?\s*\d+\s*(?=,)/, "") }); } // sem o número
  return res[0] || null;
}
async function localizarBairro(nome, cidade, origem) {
  const simples = nome.replace(/^(Loteamento Residencial|Loteamento|Núcleo Habitacional|Conjunto Habitacional|Parque Residencial|Vila Residencial|Jardim Residencial|Residencial|Residêncial)\s+/i, "");
  const tentativas = [...new Set([nome, simples])];
  for (const [k, t] of tentativas.entries()) {
    if (k) await esperar(1100);
    const res = await nominatim({ q: `${t}, ${cidade}, Paraná` });
    const perto = res.find((x) => kmReta(origem, x) < 25); // descarta homônimos de outras cidades
    if (perto) return { lat: perto.lat, lng: perto.lng };
  }
  return null;
}
async function distanciasCarro(origem, pontos) {
  const out = [];
  for (let i = 0; i < pontos.length; i += 80) {
    const lote = pontos.slice(i, i + 80);
    const coords = [origem, ...lote].map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(";");
    let kms = null;
    try {
      const r = await fetch(`${MAPA.rotas}/table/v1/driving/${coords}?sources=0&annotations=distance`);
      const j = await r.json();
      if (j.code === "Ok") kms = j.distances[0].slice(1).map((m) => m == null ? null : Math.round(m / 100) / 10);
    } catch {}
    // sem a rota de carro, usa a linha reta + 30% (aproximação)
    out.push(...lote.map((p, k) => kms?.[k] ?? Math.round(kmReta(origem, p) * 13) / 10));
    await esperar(500);
  }
  return out;
}

// ======================================================================
// Avaliações
// ======================================================================
async function telaAvaliacoes() {
  C().innerHTML = `<div class="topo-pag">${botaoMenu()}<h1>Avaliações</h1></div><div id="avCorpo"><p class="muted">Carregando…</p></div>`;
  const { data, error } = await sb.from("avaliacoes").select("*").order("criado_em", { ascending: false }).limit(500);
  if (error) return $("#avCorpo").innerHTML = `<p class="erro">${esc(error.message)}</p>`;
  const av = data || [];
  const ids = av.map((a) => a.pedido_id);
  const { data: ps } = ids.length ? await sb.from("pedidos").select("id,numero,cliente_nome,cliente_telefone").in("id", ids) : { data: [] };
  const porId = new Map((ps || []).map((p) => [p.id, p]));
  av.forEach((a) => a.pedidos = porId.get(a.pedido_id));
  const media = av.length ? av.reduce((s, a) => s + a.nota, 0) / av.length : 0;
  const est = (n) => `<span style="color:#f5a524;letter-spacing:.05rem">${"★".repeat(n)}${"☆".repeat(5 - n)}</span>`;
  $("#avCorpo").innerHTML = `<div class="kpis">
      <div class="kpi"><span>Nota média</span><b>${av.length ? media.toFixed(1).replace(".", ",") : "—"} ${av.length ? est(Math.round(media)) : ""}</b><small>${av.length} avaliações</small></div>
      ${[5, 4, 3, 2, 1].map((n) => `<div class="kpi"><span>${est(n)}</span><b>${av.filter((a) => a.nota === n).length}</b></div>`).join("")}</div>
    <div class="caixa">${av.length ? `<table class="t"><tr><th>Data</th><th>Pedido</th><th>Cliente</th><th>Nota</th><th>Comentário</th><th></th></tr>${av.map((a) => `<tr>
      <td>${dataBR(a.criado_em)}</td><td>#${a.pedidos?.numero ?? "—"}</td><td>${esc(a.pedidos?.cliente_nome || "")}</td><td style="white-space:nowrap">${est(a.nota)}</td>
      <td>${a.comentario ? esc(a.comentario) : `<span class="muted">—</span>`}</td>
      <td>${a.pedidos?.cliente_telefone ? `<a class="btn sec peq" target="_blank" href="https://wa.me/${foneWhats(a.pedidos.cliente_telefone)}?text=${encodeURIComponent(`Olá, ${(a.pedidos.cliente_nome || "").split(" ")[0]}! Obrigado pela avaliação do pedido #${a.pedidos.numero} 😊`)}">💬</a>` : ""}</td></tr>`).join("")}</table>`
      : `<p class="vazio">Nenhuma avaliação ainda. Depois que o pedido é marcado como entregue, o cliente vê as estrelinhas na página do pedido.</p>`}</div>`;
}

// ======================================================================
// Mesas (QR Code)
// ======================================================================
let libQr = null;
function carregarQr() {
  return libQr ??= new Promise((ok, falha) => {
    if (window.qrcode) return ok(window.qrcode);
    const sc = document.createElement("script");
    sc.src = "https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js";
    sc.onload = () => ok(window.qrcode); sc.onerror = () => { libQr = null; falha(new Error("não carregou o gerador de QR Code")); };
    document.head.appendChild(sc);
  });
}
async function telaMesas() {
  const base = new URL("./", location.href).href;
  C().innerHTML = `<div class="topo-pag">${botaoMenu()}<h1>Pedido na mesa</h1></div>
    <div class="caixa"><h2>Configuração</h2>
      <label class="check"><input type="checkbox" id="mAtiva" ${loja.aceita_mesa ? "checked" : ""}><b>Aceitar pedidos pelo QR Code da mesa</b></label>
      <p class="muted">O cliente aponta a câmera, abre o cardápio já com o número da mesa e pede sem precisar de endereço. O pedido chega no quadro com <b>🍽️ MESA</b> em destaque e é pago no caixa.</p>
      <div style="display:flex;gap:.6rem;align-items:end;flex-wrap:wrap"><div><label class="rot">Quantas mesas</label><input class="campo curto" id="mQtd" inputmode="numeric" value="${loja.qtd_mesas || 10}"></div>
        <button class="btn" id="mSalvar">Salvar</button><button class="btn sec" id="mImprimir">🖨 Imprimir QR Codes</button></div>
    </div>
    <div class="caixa"><h2>QR Codes</h2><div id="gradeQr" class="grade-qr"><p class="muted">Gerando…</p></div></div>`;
  const desenharQr = async () => {
    const n = Math.min(200, Math.max(1, parseInt($("#mQtd").value) || 10));
    try {
      const qrcode = await carregarQr();
      $("#gradeQr").innerHTML = Array.from({ length: n }, (_, k) => {
        const url = `${base}?mesa=${k + 1}`, q = qrcode(0, "M"); q.addData(url); q.make();
        return `<div class="qr"><div class="qr-loja">${esc(loja.nome)}</div>${q.createSvgTag({ cellSize: 5, margin: 2, scalable: true })}<b>MESA ${k + 1}</b><small>Aponte a câmera e faça seu pedido</small></div>`;
      }).join("");
    } catch (e) { $("#gradeQr").innerHTML = `<p class="erro">${esc(e.message)}</p>`; }
  };
  desenharQr();
  $("#mQtd").onchange = desenharQr;
  $("#mSalvar").onclick = async () => {
    const qtd = Math.min(200, Math.max(1, parseInt($("#mQtd").value) || 10));
    const { error } = await sb.from("loja").update({ aceita_mesa: $("#mAtiva").checked, qtd_mesas: qtd }).eq("id", 1);
    if (error) return aviso(error.message, "erro");
    await carregarLoja(); aviso("Mesas salvas", "ok");
  };
  $("#mImprimir").onclick = () => {
    document.getElementById("frameImp")?.remove();
    const fr = document.createElement("iframe"); fr.id = "frameImp"; fr.style.cssText = "position:fixed;width:0;height:0;border:0";
    document.body.appendChild(fr);
    const w = fr.contentWindow;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>QR Codes das mesas</title><style>
      body{font-family:system-ui,sans-serif;margin:0}.g{display:grid;grid-template-columns:repeat(3,1fr);gap:6mm;padding:6mm}
      .qr{border:1px dashed #999;border-radius:4mm;padding:4mm;text-align:center;break-inside:avoid}.qr svg{width:100%;height:auto}
      .qr-loja{font-weight:700;font-size:12pt}.qr b{display:block;font-size:20pt;margin-top:1mm}.qr small{font-size:9pt;color:#444}</style></head>
      <body><div class="g">${$("#gradeQr").innerHTML}</div></body></html>`);
    w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 400);
  };
}

// ======================================================================
// WhatsApp automático (Z-API)
// ======================================================================
async function telaWhatsapp() {
  C().innerHTML = `<div class="topo-pag">${botaoMenu()}<h1>WhatsApp automático</h1></div><div id="wCorpo"><p class="muted">Carregando…</p></div>`;
  const [{ data: cfg }, { data: log }] = await Promise.all([
    sb.from("config_privada").select("*").eq("id", 1).maybeSingle(),
    sb.from("mensagens_whatsapp").select("*").order("criado_em", { ascending: false }).limit(40),
  ]);
  const ids = [...new Set((log || []).map((m) => m.pedido_id).filter(Boolean))];
  const { data: ps } = ids.length ? await sb.from("pedidos").select("id,numero,cliente_nome").in("id", ids) : { data: [] };
  const porId = new Map((ps || []).map((p) => [p.id, p]));
  const msgs = { ...(loja.mensagens_auto || {}) };
  const conectado = !!(cfg?.zapi_instancia && cfg?.zapi_token);
  $("#wCorpo").innerHTML = `
    <div class="caixa"><h2>Envio automático</h2>
      <label class="chave-grande"><input type="checkbox" id="wAtivo" ${loja.whatsapp_auto ? "checked" : ""} ${conectado ? "" : "disabled"}>
        <span><b>${loja.whatsapp_auto ? "✅ Ligado" : "Desligado"}</b> — o cliente recebe uma mensagem a cada mudança no pedido</span></label>
      ${conectado ? "" : `<p class="aviso-som" style="margin-top:.6rem"><span>Primeiro conecte a Z-API logo abaixo.</span></p>`}
      <p class="muted" style="margin-bottom:0">Não envia para pedidos do iFood/aiqfome/Keeta/99Food, pedidos de mesa ou sem telefone.</p></div>
    <div class="caixa"><h2>Conectar a Z-API ${conectado ? `<span class="badge ok">conectada</span>` : `<span class="badge alerta">não conectada</span>`}</h2>
      <div class="seg" style="max-width:420px;margin-bottom:.7rem">${[["omni", "Z-API Omni (nova)"], ["classica", "Z-API clássica"]].map(([v, t]) => `<button data-ztipo="${v}" class="${(cfg?.zapi_tipo || "omni") === v ? "ativo" : ""}">${t}</button>`).join("")}</div>
      <div id="zOmni" class="${(cfg?.zapi_tipo || "omni") === "omni" ? "" : "oculto"}">
        <ol class="passos-z"><li>Em <b>Mensageria → Conexões</b>, abra <b>Detalhes</b> da conexão e copie o <b>ID do canal</b>.</li>
          <li>No menu <b>Segurança</b> da Z-API Omni, gere/copie a <b>Secret Key</b> (se não achar, use o <b>Token</b> que aparece nos Detalhes da conexão).</li></ol>
        <div class="grade2"><div><label class="rot">ID do canal</label><input class="campo" id="oId" autocomplete="off" placeholder="${cfg?.zapi_tipo !== "classica" && cfg?.zapi_instancia ? "salvo ✓ (cole para trocar)" : ""}"></div>
          <div><label class="rot">Secret Key (ou Token do canal)</label><input class="campo" id="oKey" type="password" autocomplete="off" placeholder="${cfg?.zapi_tipo !== "classica" && cfg?.zapi_token ? "salvo ✓ (cole para trocar)" : ""}"></div></div></div>
      <div id="zClassica" class="${cfg?.zapi_tipo === "classica" ? "" : "oculto"}">
      <ol class="passos-z">
        <li>Crie a instância em <a href="https://z-api.io" target="_blank" rel="noopener">z-api.io</a> e leia o <b>QR Code</b> com o WhatsApp da loja.</li>
        <li>Copie o <b>ID da instância</b> e o <b>Token da instância</b>. Em <b>Segurança</b>, copie o <b>Client-Token</b> da conta.</li></ol>
      <div class="grade3"><div><label class="rot">ID da instância</label><input class="campo" id="zInst" autocomplete="off" placeholder="${cfg?.zapi_tipo === "classica" && cfg?.zapi_instancia ? "salvo ✓ (cole para trocar)" : ""}"></div>
        <div><label class="rot">Token da instância</label><input class="campo" id="zTok" type="password" autocomplete="off" placeholder="${cfg?.zapi_tipo === "classica" && cfg?.zapi_token ? "salvo ✓ (cole para trocar)" : ""}"></div>
        <div><label class="rot">Client-Token (Segurança)</label><input class="campo" id="zCli" type="password" autocomplete="off" placeholder="${cfg?.zapi_client_token ? "salvo ✓ (cole para trocar)" : ""}"></div></div></div>
      <div class="erro" id="zErro"></div><button class="btn" id="zSalvar">Salvar conexão</button>
      <div style="display:flex;gap:.5rem;align-items:end;margin-top:1rem;flex-wrap:wrap"><div><label class="rot">Testar: enviar para</label><input class="campo" id="zTel" inputmode="tel" placeholder="43 99999-9999"></div>
        <button class="btn sec" id="zTeste" ${conectado ? "" : "disabled"}>📲 Enviar mensagem de teste</button></div></div>
    <div class="caixa"><h2>Mensagens</h2>
      <p class="muted" style="margin-top:0">Palavras entre chaves são trocadas sozinhas: <code>{nome}</code> <code>{numero}</code> <code>{total}</code> <code>{link}</code> <code>{tempo}</code> <code>{entregador}</code> <code>{motivo}</code> <code>{pix}</code> (chave e valor do Pix, quando o cliente escolhe Pix). Deixe uma mensagem vazia para não enviar naquele momento.</p>
      ${Object.keys(MSG_WHATS_PADRAO).map((st) => `<div class="msg-st"><div class="cab"><b>${MSG_WHATS_ROTULO[st]}</b><button class="link" data-padrao="${st}" style="color:var(--suave)">restaurar padrão</button></div>
        <textarea class="campo" rows="3" data-msg="${st}">${esc(msgs[st] ?? MSG_WHATS_PADRAO[st])}</textarea></div>`).join("")}
      <button class="btn" id="mSalvarTxt">Salvar mensagens</button></div>
    <div class="caixa"><h2>Últimos envios</h2>${(log || []).length ? `<table class="t"><tr><th>Quando</th><th>Pedido</th><th>Mensagem</th><th>Situação</th></tr>${log.map((m) => `<tr>
      <td>${dataBR(m.criado_em)} ${hora(m.criado_em)}</td><td>#${porId.get(m.pedido_id)?.numero ?? "—"} ${esc(porId.get(m.pedido_id)?.cliente_nome || "")}</td>
      <td>${esc(MSG_WHATS_ROTULO[m.status] || m.status)}</td><td>${m.ok ? `<span class="badge ok">✓ enviada</span>` : m.ok === false ? `<span class="badge perigo" title="${esc(m.erro || "")}">erro: ${esc((m.erro || "").slice(0, 60))}</span>` : `<span class="badge">enviando…</span>`}</td></tr>`).join("")}</table>`
      : `<p class="vazio">Nenhuma mensagem enviada ainda.</p>`}</div>`;

  $("#wAtivo").onchange = async (e) => {
    const { error } = await sb.from("loja").update({ whatsapp_auto: e.target.checked, site_url: new URL("./", location.href).href }).eq("id", 1);
    if (error) { e.target.checked = !e.target.checked; return aviso(error.message, "erro"); }
    await carregarLoja(); telaWhatsapp(); aviso(e.target.checked ? "WhatsApp automático ligado" : "WhatsApp automático desligado", "ok");
  };
  let zTipo = cfg?.zapi_tipo || "omni";
  C().querySelectorAll("[data-ztipo]").forEach((b) => b.onclick = () => {
    zTipo = b.dataset.ztipo; C().querySelectorAll("[data-ztipo]").forEach((x) => x.classList.toggle("ativo", x === b));
    $("#zOmni").classList.toggle("oculto", zTipo !== "omni"); $("#zClassica").classList.toggle("oculto", zTipo !== "classica");
  });
  $("#zSalvar").onclick = async () => {
    const d = { url_funcao: `${SUPABASE_URL}/functions/v1/avisar-whatsapp`, chave_anon: SUPABASE_ANON_KEY };
    d.zapi_tipo = zTipo;
    const omni = zTipo === "omni";
    const inst = (omni ? $("#oId") : $("#zInst")).value.trim(), tok = (omni ? $("#oKey") : $("#zTok")).value.trim(), cli = $("#zCli").value.trim();
    if (inst) d.zapi_instancia = inst; if (tok) d.zapi_token = tok; if (cli && !omni) d.zapi_client_token = cli;
    const trocouTipo = (cfg?.zapi_tipo || "omni") !== zTipo;
    if ((!cfg?.zapi_instancia || trocouTipo) && (!inst || !tok)) return $("#zErro").textContent = omni ? "Cole o ID do canal e a Secret Key." : "Cole o ID e o Token da instância.";
    const { error } = await sb.from("config_privada").update(d).eq("id", 1);
    if (error) return $("#zErro").textContent = error.message;
    await sb.from("loja").update({ site_url: new URL("./", location.href).href }).eq("id", 1);
    aviso("Conexão salva", "ok"); telaWhatsapp();
  };
  $("#zTeste").onclick = async () => {
    const tel = $("#zTel").value.replace(/\D/g, "");
    if (tel.length < 10) return aviso("Digite o número com DDD", "erro");
    const b = $("#zTeste"); b.disabled = true; b.textContent = "Enviando…";
    try {
      const { data: { session } } = await sb.auth.getSession();
      const r = await fetch(`${SUPABASE_URL}/functions/v1/avisar-whatsapp`, { method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ teste: true, telefone: tel }) });
      const res = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(res.erro || "Falhou");
      aviso("Mensagem de teste enviada! Confira o WhatsApp.", "ok");
    } catch (e) { aviso("Não enviou: " + e.message, "erro"); }
    b.disabled = false; b.textContent = "📲 Enviar mensagem de teste";
  };
  C().querySelectorAll("[data-padrao]").forEach((b) => b.onclick = () => { C().querySelector(`[data-msg="${b.dataset.padrao}"]`).value = MSG_WHATS_PADRAO[b.dataset.padrao]; });
  $("#mSalvarTxt").onclick = async () => {
    const novo = {};
    C().querySelectorAll("[data-msg]").forEach((t) => { const v = t.value.trim(); if (v !== MSG_WHATS_PADRAO[t.dataset.msg]) novo[t.dataset.msg] = v; });
    const { error } = await sb.from("loja").update({ mensagens_auto: novo }).eq("id", 1);
    if (error) return aviso(error.message, "erro");
    await carregarLoja(); aviso("Mensagens salvas", "ok");
  };
}

// ======================================================================
// Loja
// ======================================================================
function telaLoja() {
  const l = loja;
  const ck = (c, t) => `<label class="check"><input type="checkbox" data-c="${c}" ${l[c] ? "checked" : ""}>${t}</label>`;
  const tx = (c, t, extra = "") => `<div><label class="rot">${t}</label><input class="campo" data-c="${c}" value="${esc(l[c] ?? "")}" ${extra}></div>`;
  const linkCardapio = new URL("./", location.href).href;
  C().innerHTML = `<div class="topo-pag">${botaoMenu()}<h1>Loja</h1></div>
    <div class="caixa"><h2>Link do cardápio</h2>
      <div style="display:flex;gap:.5rem"><input class="campo" readonly value="${esc(linkCardapio)}" id="lkC"><button class="btn sec" id="copLk">Copiar</button></div>
      <p class="muted" style="margin-bottom:0">Coloque na bio do Instagram, no perfil e na mensagem automática do WhatsApp Business.</p></div>
    <div class="caixa"><h2>Visual</h2>
      <div class="grade2">
        <div><label class="rot">Logo (quadrado)</label><div style="display:flex;gap:.7rem;align-items:center"><div id="prevLogo" style="width:64px;height:64px;border-radius:50%;background:#f4f4f5 center/cover;${imgCss(l.logo_url)}"></div><input class="campo" type="file" accept="image/*" id="upLogo"></div></div>
        <div><label class="rot">Capa (foto larga, ex.: 1200×400)</label><div style="display:flex;gap:.7rem;align-items:center"><div id="prevCapa" style="width:120px;height:44px;border-radius:8px;background:#f4f4f5 center/cover;${imgCss(l.capa_url)}"></div><input class="campo" type="file" accept="image/*" id="upCapa"></div></div>
      </div>
      <div class="grade2"><div><label class="rot">Cor principal</label><input data-c="cor" type="color" value="${esc(l.cor)}" style="height:42px;width:100%;border:1px solid var(--linha);border-radius:10px"></div>${tx("descricao", "Frase curta (aparece abaixo do nome)")}</div>
    </div>
    <div class="caixa"><h2>Logo na impressão</h2>
      <p class="muted" style="margin-top:0">A impressora térmica só imprime preto. Aqui a logo vira preto e branco pontilhado — ajuste até ficar nítida.</p>
      <div class="logo-imp">
        <div class="papel-prev"><img id="liPrev" ${l.logo_impressao_url ? `src="${esc(l.logo_impressao_url)}"` : ""} alt=""><span id="liVazio" class="muted ${l.logo_impressao_url ? "oculto" : ""}">sem logo na impressão</span></div>
        <div style="flex:1;min-width:220px">
          <label class="rot">Mais clara ⟷ Mais escura</label><input type="range" id="liAjuste" min="-60" max="60" value="0" style="width:100%">
          <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.6rem">
            <button class="btn sec" id="liGerar">🔄 Gerar da logo</button><button class="btn" id="liSalvar" disabled>Salvar logo da impressão</button>
            ${l.logo_impressao_url ? `<button class="btn perigo" id="liTirar">Não imprimir logo</button>` : ""}</div>
          <p class="muted" style="font-size:.85rem">Bematech MP-4200 TH: use papel 80 mm (botão 🖨 na tela de Pedidos).</p></div>
      </div></div>
    <div class="caixa"><h2>Dados da loja</h2>
      <div class="grade2">${tx("nome", "Nome")}${tx("whatsapp", "WhatsApp que recebe pedidos (55 + DDD + número)", 'inputmode="numeric" placeholder="5543999999999"')}</div>
      ${tx("endereco", "Endereço (aparece para retirada)")}
      ${tx("mensagem_fechada", "Mensagem quando a loja estiver fechada")}
    </div>
    <div class="caixa"><h2>Entrega e retirada</h2>
      <div style="display:flex;gap:1.5rem">${ck("aceita_entrega", "Faz entrega")}${ck("aceita_retirada", "Aceita retirada no local")}</div>
      <div class="grade4">${tx("taxa_entrega", "Taxa fixa (R$)", 'type="number" min="0" step="0.01"')}${tx("pedido_minimo", "Pedido mínimo (R$)", 'type="number" min="0" step="0.01"')}${tx("tempo_entrega", "Tempo de entrega")}${tx("tempo_retirada", "Tempo de retirada")}</div>
      <p class="muted" style="margin-bottom:0">A taxa fixa só vale para bairro sem km e sem taxa própria (ou se não houver bairros). Faixas de km e bairros ficam em "Entrega e horários". O tempo também pode ser mudado direto na tela de Pedidos.</p>
    </div>
    <div class="caixa"><h2>Pagamento</h2>
      ${ck("aceita_cartao_entrega", "💳 Cartão na maquininha")}
      ${ck("aceita_pix_entrega", "💠 Pix — a loja envia a chave e o valor pelo WhatsApp")}
      ${ck("aceita_dinheiro", "💵 Dinheiro")}
      <div class="grade2">${tx("chave_pix", "Chave Pix da loja")}${tx("nome_pix", "Nome do titular do Pix")}</div>
      <details style="margin-top:.9rem"><summary class="muted" style="cursor:pointer">Pagamento online (precisa do Mercado Pago configurado)</summary>
        ${ck("aceita_pix_online", "Pix online (confirma sozinho)")}${ck("aceita_cartao_online", "Cartão online")}</details>
    </div>
    <div class="erro" id="sErro"></div>
    <button class="btn" id="sSalvar" style="padding:.8rem 1.4rem">Salvar configurações</button>`;
  $("#copLk").onclick = async () => { try { await navigator.clipboard.writeText($("#lkC").value); $("#copLk").textContent = "Copiado ✓"; } catch { $("#lkC").select(); } };
  const subir = (inp, prev, campo, pasta) => $(inp).onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    $(prev).style.backgroundImage = `url(${URL.createObjectURL(f)})`;
    try { const url = await enviarFoto(f, pasta); const { error } = await sb.from("loja").update({ [campo]: url }).eq("id", 1); if (error) throw error; await carregarLoja();
      if (campo === "logo_url") { try { await salvarLogoTermica(await gerarLogoTermica(url)); telaLoja(); } catch {} } }
    catch (err) { aviso("Erro ao enviar a imagem: " + (err.message || err), "erro"); return; }
    aviso("Imagem atualizada", "ok");
  };
  subir("#upLogo", "#prevLogo", "logo_url", "loja"); subir("#upCapa", "#prevCapa", "capa_url", "loja");
  let liBlob = null;
  const gerarPrev = async () => {
    if (!loja.logo_url) return aviso("Envie a logo da loja primeiro (campo Logo acima).", "erro");
    try { liBlob = await gerarLogoTermica(loja.logo_url, Number($("#liAjuste").value)); $("#liPrev").src = URL.createObjectURL(liBlob); $("#liVazio").classList.add("oculto"); $("#liSalvar").disabled = false; }
    catch (e) { aviso(e.message, "erro"); }
  };
  $("#liGerar").onclick = gerarPrev;
  $("#liAjuste").onchange = gerarPrev;
  $("#liSalvar").onclick = async () => {
    if (!liBlob) return;
    $("#liSalvar").disabled = true;
    try { await salvarLogoTermica(liBlob); aviso("Logo da impressão salva", "ok"); telaLoja(); } catch (e) { aviso("Erro: " + e.message, "erro"); $("#liSalvar").disabled = false; }
  };
  $("#liTirar")?.addEventListener("click", async () => { await sb.from("loja").update({ logo_impressao_url: null }).eq("id", 1); await carregarLoja(); telaLoja(); aviso("A logo não sai mais na impressão", "ok"); });

  $("#sSalvar").onclick = async () => {
    const dados = {};
    C().querySelectorAll("[data-c]").forEach((i) => { dados[i.dataset.c] = i.type === "checkbox" ? i.checked : i.type === "number" ? Number(i.value) || 0 : i.value.trim(); });
    dados.whatsapp = String(dados.whatsapp).replace(/\D/g, "");
    if (!dados.aceita_entrega && !dados.aceita_retirada) return $("#sErro").textContent = "Ative entrega ou retirada.";
    if (dados.aceita_pix_entrega && !dados.chave_pix) return $("#sErro").textContent = "Informe a chave Pix da loja.";
    if (!["aceita_pix_online", "aceita_cartao_online", "aceita_dinheiro", "aceita_cartao_entrega", "aceita_pix_entrega"].some((k) => dados[k])) return $("#sErro").textContent = "Ative ao menos uma forma de pagamento.";
    const { error } = await sb.from("loja").update(dados).eq("id", 1);
    if (error) return $("#sErro").textContent = error.message;
    $("#sErro").textContent = "";
    await carregarLoja();
    $("#sSalvar").textContent = "Salvo ✓"; setTimeout(() => $("#sSalvar") && ($("#sSalvar").textContent = "Salvar configurações"), 1500);
  };
}

window.addEventListener("hashchange", () => { const n = location.hash.slice(1); if (n && n !== aba) irPara(n); });
iniciar();
