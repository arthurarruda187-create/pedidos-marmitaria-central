// Função "criar-pedido": recebe o carrinho do cardápio (ou do PDV da loja), confere
// tudo no banco, aplica bairro/cupom, grava o pedido e, se for pagamento online,
// cria a cobrança no Mercado Pago.
import { createClient } from "npm:@supabase/supabase-js@2";

// ===== cálculo (de _shared/calculo.ts) =====
// Cálculo e validação do pedido. Roda no servidor: o preço que vale é o do banco,
// nunca o que veio do navegador do cliente.

export type Loja = {
  aceita_entrega: boolean;
  aceita_retirada: boolean;
  taxa_entrega: number;
  pedido_minimo: number;
  aceita_pix_online: boolean;
  aceita_cartao_online: boolean;
  aceita_dinheiro: boolean;
  aceita_cartao_entrega: boolean;
  aceita_pix_entrega?: boolean;
  modo_taxa?: "bairro" | "raio" | "mapa";
  faixas_km?: Faixa[] | null;
  lat?: number | null;
  lng?: number | null;
  aceita_mesa?: boolean;
  aceita_agendamento?: boolean;
  agendar_dias?: number;
};
export type Faixa = { ate: number; taxa: number };

export type Opcao = { id: string; grupo_id: string; nome: string; preco: number; esgotado: boolean };
export type Grupo = { id: string; produto_id: string; nome: string; minimo: number; maximo: number };
export type Produto = {
  id: string; nome: string; preco: number; preco_promocional?: number | null; esgotado: boolean; ativo: boolean;
  dias_semana?: number[] | null; // cardápio do dia (0 = domingo); vazio = todos os dias
};
export type Bairro = { id: string; nome: string; taxa: number | null; distancia_km?: number | null };
export type Cupom = { codigo: string; tipo: "percentual" | "valor" | "frete"; valor: number };

export type EntradaItem = {
  produto_id: string;
  quantidade: number;
  observacao?: string;
  para?: string; // nome de quem vai comer (pedido para empresas)
  adicionais?: { opcao_id: string; quantidade: number }[];
};

export type Pagamento = "pix_online" | "cartao_online" | "dinheiro" | "cartao_entrega" | "pix_entrega" | "pago_app" | "fiado" | "caixa";
export const APPS = ["ifood", "aiqfome", "keeta", "99food"] as const;
export type App = typeof APPS[number];

export type EntradaPedido = {
  cliente_nome: string;
  cliente_telefone?: string;
  cliente_email?: string;
  tipo: "entrega" | "retirada" | "mesa";
  mesa?: string;
  endereco?: string;
  bairro_id?: string;
  entrega_lat?: number | string | null; // ponto marcado no mapa (modo "mapa")
  entrega_lng?: number | string | null;
  observacao?: string;
  pagamento: Pagamento;
  troco_para?: number | string | null;
  cupom?: string;
  canal?: "cardapio" | "balcao" | "mesa";
  origem?: "balcao" | App;   // pedido lançado na loja: de onde veio
  id_externo?: string;       // número do pedido no app
  total_app?: number | string | null; // valor que o app cobrou do cliente
  agendado_para?: string | null;      // pedido agendado (data e hora)
  empresa?: string;                   // pedido para empresa
  taxa_manual?: number | string | null; // PDV: taxa de entrega digitada pela loja (vazio = automática)
  assinatura?: string;                // fiado: assinatura do cliente (imagem PNG em data URL)
  itens: EntradaItem[];
};

export type Extras = {
  aberta: boolean;          // resultado de loja_aberta_agora()
  bairros: Bairro[];        // bairros ativos (vazio = taxa fixa)
  cupom?: Cupom | null;     // cupom já validado pelo banco
  balcao?: boolean;         // pedido lançado pela loja (PDV)
  agora?: Date;             // relógio (para testes)
  agendaNoHorario?: boolean; // loja_funciona_em(agendado_para)
  taxaEspecial?: number | null; // cliente especial: taxa de entrega própria (só a loja vê/configura)
};

export type ItemCalculado = {
  produto_id: string;
  nome: string;
  quantidade: number;
  preco_unitario: number; // produto + adicionais, por unidade
  total: number;
  observacao: string;
  para?: string;
  adicionais: { grupo: string; nome: string; quantidade: number; preco: number }[];
};

export const NOMES_DIA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
/** Dia da semana (0 = domingo) no horário de Brasília. */
export function diaSemanaBR(d: Date): number {
  const w = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short" }).format(d);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(w);
}

export class ErroPedido extends Error {}

const centavos = (v: number) => Math.round(Number(v) * 100);
const reais = (c: number) => c / 100;
const texto = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

export const precoEfetivo = (p: { preco: number; preco_promocional?: number | null }) =>
  p.preco_promocional != null && Number(p.preco_promocional) < Number(p.preco) ? Number(p.preco_promocional) : Number(p.preco);

/** Taxa de uma distância pelas faixas de km. null = fora da área. */
export function taxaPorFaixa(km: number, faixas: Faixa[]): number | null {
  const ord = [...faixas].filter((f) => Number(f.ate) > 0).sort((a, b) => Number(a.ate) - Number(b.ate));
  const f = ord.find((x) => km <= Number(x.ate));
  return f ? Number(f.taxa) : null;
}

/** Distância em linha reta (km) entre dois pontos — o "raio" do mapa. */
export function kmLinhaReta(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = (g: number) => g * Math.PI / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

/** Taxa de entrega de um bairro, conforme o modo da loja. null = fora da área. */
export function taxaDoBairro(loja: Loja, b: Bairro): number | null {
  const km = b.distancia_km == null ? null : Number(b.distancia_km);
  const faixas = loja.faixas_km ?? [];
  const pelaFaixa = km != null && faixas.length ? taxaPorFaixa(km, faixas) : undefined;
  if (loja.modo_taxa === "raio" || loja.modo_taxa === "mapa") {
    if (pelaFaixa !== undefined) return pelaFaixa;
    return b.taxa != null ? Number(b.taxa) : Number(loja.taxa_entrega);
  }
  if (b.taxa != null) return Number(b.taxa);
  if (pelaFaixa !== undefined) return pelaFaixa;
  return Number(loja.taxa_entrega);
}

export function calcularPedido(
  entrada: EntradaPedido,
  loja: Loja,
  produtos: Produto[],
  grupos: Grupo[],
  opcoes: Opcao[],
  extras: Extras,
) {
  const balcao = !!extras.balcao;
  // pedido agendado
  const agora = extras.agora ?? new Date();
  let agendado: Date | null = null;
  if (entrada.agendado_para) {
    agendado = new Date(String(entrada.agendado_para));
    if (isNaN(agendado.getTime())) throw new ErroPedido("Horário agendado inválido.");
    if (!balcao && !loja.aceita_agendamento) throw new ErroPedido("A loja não está aceitando pedidos agendados.");
    if (agendado.getTime() < agora.getTime() + (balcao ? 0 : 30) * 60000) throw new ErroPedido("Escolha um horário daqui a pelo menos 30 minutos.");
    const dias = Number(loja.agendar_dias ?? 2);
    if (agendado.getTime() > agora.getTime() + (dias + 1) * 86400000) throw new ErroPedido(`Dá para agendar com até ${dias} dia(s) de antecedência.`);
    if (!balcao && extras.agendaNoHorario === false) throw new ErroPedido("A loja não funciona nesse horário. Escolha outro.");
  }
  if (!balcao && !extras.aberta && !agendado) throw new ErroPedido("A loja está fechada no momento.");
  const diaPedido = diaSemanaBR(agendado ?? agora);

  const nome = texto(entrada.cliente_nome, 80) || (balcao ? "Balcão" : "");
  const telefone = texto(entrada.cliente_telefone, 20).replace(/\D/g, "");
  if (nome.length < 2) throw new ErroPedido("Informe seu nome.");
  if (!balcao && entrada.tipo !== "mesa" && telefone.length < 10) throw new ErroPedido("Informe um telefone com DDD.");
  if (!balcao && entrada.tipo === "mesa" && telefone && telefone.length < 10) throw new ErroPedido("Telefone incompleto (use DDD + número).");
  if (balcao && telefone && telefone.length < 10) throw new ErroPedido("Telefone incompleto (use DDD + número).");

  const mesaPedido = entrada.tipo === "mesa";
  if (entrada.tipo !== "entrega" && entrada.tipo !== "retirada" && !mesaPedido) throw new ErroPedido("Escolha entrega ou retirada.");
  const mesa = mesaPedido ? texto(entrada.mesa, 10) : "";
  if (mesaPedido && !mesa) throw new ErroPedido("Informe o número da mesa.");
  if (mesaPedido && !balcao && !loja.aceita_mesa) throw new ErroPedido("A loja não está aceitando pedidos na mesa.");
  if (!balcao && entrada.tipo === "entrega" && !loja.aceita_entrega) throw new ErroPedido("A loja não está fazendo entregas.");
  if (!balcao && entrada.tipo === "retirada" && !loja.aceita_retirada) throw new ErroPedido("A loja não está aceitando retirada.");
  const endereco = texto(entrada.endereco, 300);
  if (entrada.tipo === "entrega" && endereco.length < 8) throw new ErroPedido("Informe o endereço de entrega completo.");

  // taxa de entrega: por bairro (se houver bairros cadastrados) ou fixa
  let bairro: Bairro | null = null;
  if (entrada.tipo === "entrega" && extras.bairros.length) {
    bairro = extras.bairros.find((b) => b.id === entrada.bairro_id) ?? null;
    const temTaxaManual = balcao && entrada.taxa_manual != null && String(entrada.taxa_manual).trim() !== "";
    if (!bairro && !temTaxaManual && !(loja.modo_taxa === "mapa" && !balcao)) throw new ErroPedido("Escolha o seu bairro."); // no modo mapa vale o ponto
  }

  const origem = balcao && entrada.origem && (APPS as readonly string[]).includes(entrada.origem) ? entrada.origem as App : null;
  const pagamentosPermitidos: Record<string, boolean> = origem
    ? { pago_app: true, dinheiro: true, cartao_entrega: true }
    : balcao
    ? { dinheiro: true, cartao_entrega: true, pix_entrega: true, fiado: true, caixa: mesaPedido }
    : mesaPedido
    ? { caixa: true, dinheiro: true, cartao_entrega: true, pix_entrega: true }
    : {
      pix_online: loja.aceita_pix_online,
      cartao_online: loja.aceita_cartao_online,
      dinheiro: loja.aceita_dinheiro,
      cartao_entrega: loja.aceita_cartao_entrega,
      pix_entrega: !!loja.aceita_pix_entrega,
    };
  if (!pagamentosPermitidos[entrada.pagamento]) throw new ErroPedido("Forma de pagamento indisponível.");
  let assinatura: string | null = null;
  if (entrada.pagamento === "fiado") {
    if (telefone.length < 10) throw new ErroPedido("Para fiado, informe o telefone do cliente (é por ele que a conta é controlada).");
    if (nome === "Balcão") throw new ErroPedido("Para fiado, informe o nome do cliente.");
    const a = typeof entrada.assinatura === "string" ? entrada.assinatura : "";
    if (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(a) || a.length < 200) throw new ErroPedido("Falta a assinatura do cliente para o fiado.");
    if (a.length > 300000) throw new ErroPedido("Assinatura muito grande. Limpe e assine de novo.");
    assinatura = a;
  }

  if (!Array.isArray(entrada.itens) || entrada.itens.length === 0) throw new ErroPedido("O carrinho está vazio.");
  if (entrada.itens.length > 50) throw new ErroPedido("Pedido com itens demais.");

  const prodPorId = new Map(produtos.map((p) => [p.id, p]));
  const gruposPorProduto = new Map<string, Grupo[]>();
  for (const g of grupos) {
    const l = gruposPorProduto.get(g.produto_id) ?? [];
    l.push(g);
    gruposPorProduto.set(g.produto_id, l);
  }
  const opcaoPorId = new Map(opcoes.map((o) => [o.id, o]));
  const grupoPorId = new Map(grupos.map((g) => [g.id, g]));

  const itens: ItemCalculado[] = [];
  let subtotalC = 0;

  for (const it of entrada.itens) {
    const p = prodPorId.get(it.produto_id);
    if (!p || !p.ativo) throw new ErroPedido("Um item do carrinho não existe mais. Atualize a página.");
    if (p.esgotado) throw new ErroPedido(`"${p.nome}" está esgotado.`);
    if (!balcao && p.dias_semana?.length && !p.dias_semana.includes(diaPedido)) {
      throw new ErroPedido(`"${p.nome}" não está no cardápio de ${NOMES_DIA[diaPedido]}.`);
    }
    const qtd = Math.floor(Number(it.quantidade));
    if (!(qtd >= 1 && qtd <= 99)) throw new ErroPedido(`Quantidade inválida para "${p.nome}".`);

    const somaPorGrupo = new Map<string, number>();
    const adicionais: ItemCalculado["adicionais"] = [];
    let unitC = centavos(precoEfetivo(p));

    for (const a of it.adicionais ?? []) {
      const o = opcaoPorId.get(a.opcao_id);
      const g = o && grupoPorId.get(o.grupo_id);
      if (!o || !g || g.produto_id !== p.id) throw new ErroPedido(`Adicional inválido em "${p.nome}". Atualize a página.`);
      if (o.esgotado) throw new ErroPedido(`"${o.nome}" está esgotado.`);
      const aq = Math.floor(Number(a.quantidade));
      if (!(aq >= 1 && aq <= 20)) throw new ErroPedido(`Quantidade inválida para "${o.nome}".`);
      somaPorGrupo.set(g.id, (somaPorGrupo.get(g.id) ?? 0) + aq);
      unitC += centavos(o.preco) * aq;
      adicionais.push({ grupo: g.nome, nome: o.nome, quantidade: aq, preco: Number(o.preco) });
    }

    for (const g of gruposPorProduto.get(p.id) ?? []) {
      const soma = somaPorGrupo.get(g.id) ?? 0;
      if (soma < g.minimo) throw new ErroPedido(`Escolha ao menos ${g.minimo} em "${g.nome}" (${p.nome}).`);
      if (soma > g.maximo) throw new ErroPedido(`Escolha no máximo ${g.maximo} em "${g.nome}" (${p.nome}).`);
    }

    const totalC = unitC * qtd;
    subtotalC += totalC;
    itens.push({
      produto_id: p.id, nome: p.nome, quantidade: qtd,
      preco_unitario: reais(unitC), total: reais(totalC),
      observacao: texto(it.observacao, 200), ...(texto(it.para, 40) ? { para: texto(it.para, 40) } : {}), adicionais,
    });
  }

  if (!balcao && entrada.tipo === "entrega" && subtotalC < centavos(loja.pedido_minimo)) {
    throw new ErroPedido(`O pedido mínimo para entrega é R$ ${Number(loja.pedido_minimo).toFixed(2).replace(".", ",")}.`);
  }

  let taxaC = 0;
  let ponto: { lat: number; lng: number; km: number } | null = null;
  if (entrada.tipo === "entrega") {
    const la = Number(entrada.entrega_lat), ln = Number(entrada.entrega_lng);
    const temPonto = entrada.entrega_lat != null && entrada.entrega_lng != null && Number.isFinite(la) && Number.isFinite(ln)
      && Math.abs(la) <= 90 && Math.abs(ln) <= 180 && !(la === 0 && ln === 0);
    if (temPonto && loja.lat != null && loja.lng != null) ponto = { lat: la, lng: ln, km: Math.round(kmLinhaReta(Number(loja.lat), Number(loja.lng), la, ln) * 100) / 100 };
  }
  const tm = entrada.taxa_manual;
  const manual = balcao && entrada.tipo === "entrega" && tm != null && String(tm).trim() !== "" && Number.isFinite(Number(String(tm).replace(",", "."))) && Number(String(tm).replace(",", ".")) >= 0
    ? Number(String(tm).replace(",", ".")) : null;
  if (manual != null && manual > 1000) throw new ErroPedido("Taxa de entrega muito alta.");
  const especial = manual == null && entrada.tipo === "entrega" && extras.taxaEspecial != null && Number.isFinite(Number(extras.taxaEspecial)) && Number(extras.taxaEspecial) >= 0;
  if (manual != null) {
    taxaC = centavos(manual);
  } else if (entrada.tipo === "entrega" && loja.modo_taxa === "mapa" && !balcao && !especial) {
    // igual ao aiqfome: a taxa sai da distância em linha reta até o ponto que o cliente marcou no mapa
    if (!ponto) throw new ErroPedido("Marque no mapa o local da entrega.");
    const t = taxaPorFaixa(ponto.km, loja.faixas_km ?? []);
    if (t == null) {
      const max = Math.max(0, ...(loja.faixas_km ?? []).map((f) => Number(f.ate)));
      throw new ErroPedido(`Esse local fica a ${ponto.km.toFixed(1).replace(".", ",")} km da loja — entregamos até ${String(max).replace(".", ",")} km.`);
    }
    taxaC = centavos(t);
  } else if (especial) {
    taxaC = centavos(Number(extras.taxaEspecial));
  } else if (entrada.tipo === "entrega") {
    let t = bairro ? taxaDoBairro(loja, bairro) : Number(loja.taxa_entrega);
    if (t == null) {
      if (!balcao) throw new ErroPedido(`Infelizmente não entregamos no ${bairro!.nome} (fora da área de entrega).`);
      const fx = [...(loja.faixas_km ?? [])].sort((a, b) => Number(a.ate) - Number(b.ate));
      t = fx.length ? Number(fx[fx.length - 1].taxa) : Number(loja.taxa_entrega);
    }
    taxaC = centavos(t);
  }

  let descontoC = 0;
  const cupom = extras.cupom ?? null;
  if (cupom) {
    if (cupom.tipo === "percentual") descontoC = Math.round(subtotalC * Math.min(100, Number(cupom.valor)) / 100);
    else if (cupom.tipo === "valor") descontoC = Math.min(centavos(cupom.valor), subtotalC);
    else if (cupom.tipo === "frete") {
      if (entrada.tipo !== "entrega") throw new ErroPedido("Este cupom vale só para entrega.");
      descontoC = taxaC;
    }
  }

  const totalC = subtotalC + taxaC - descontoC;

  let troco: number | null = null;
  if (entrada.pagamento === "dinheiro" && entrada.troco_para != null && String(entrada.troco_para) !== "") {
    const t = Number(entrada.troco_para);
    if (!Number.isFinite(t) || centavos(t) < totalC) throw new ErroPedido("O valor para troco é menor que o total.");
    troco = t;
  }

  const online = entrada.pagamento === "pix_online" || entrada.pagamento === "cartao_online";

  let totalApp: number | null = null;
  if (origem && entrada.total_app != null && String(entrada.total_app) !== "") {
    totalApp = Number(String(entrada.total_app).replace(",", "."));
    if (!Number.isFinite(totalApp) || totalApp < 0) throw new ErroPedido("Valor cobrado no app inválido.");
  }

  return {
    subtotal: reais(subtotalC),
    registro: {
      cliente_nome: nome,
      cliente_telefone: telefone || null,
      tipo: entrada.tipo,
      endereco: entrada.tipo === "entrega" ? endereco : null,
      mesa: mesaPedido ? mesa : null,
      bairro: bairro?.nome ?? null,
      entrega_lat: ponto?.lat ?? null,
      entrega_lng: ponto?.lng ?? null,
      distancia_km: ponto?.km ?? null,
      observacao: texto(entrada.observacao, 300) || null,
      agendado_para: agendado ? agendado.toISOString() : null,
      empresa: texto(entrada.empresa, 80) || null,
      itens,
      subtotal: reais(subtotalC),
      taxa_entrega: reais(taxaC),
      desconto: reais(descontoC),
      cupom_codigo: cupom?.codigo ?? null,
      total: totalApp ?? reais(totalC),
      total_app: totalApp,
      id_externo: origem ? (texto(entrada.id_externo, 40) || null) : null,
      pagamento: entrada.pagamento,
      troco_para: troco,
      canal: origem ?? (balcao ? "balcao" : mesaPedido ? "mesa" : "cardapio"),
      status: online ? "aguardando_pagamento" : balcao ? "preparo" : "novo",
      pagamento_status: online || entrada.pagamento === "fiado" ? "pendente" : entrada.pagamento === "pago_app" ? "pago" : "na_entrega",
      assinatura,
    },
    email: texto(entrada.cliente_email, 120),
  };
}

// ===== função =====

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
  // cliente especial: taxa de entrega própria (cadastrada só no painel)
  let taxaEspecial: number | null = null;
  const telEsp = String(entrada.cliente_telefone ?? "").replace(/\D/g, "").slice(0, 20);
  if (entrada.tipo === "entrega" && telEsp.length >= 10) {
    const { data: esp } = await db.from("clientes_especiais").select("taxa_entrega").eq("telefone", telEsp).maybeSingle();
    if (esp && esp.taxa_entrega != null) taxaEspecial = Number(esp.taxa_entrega);
  }
  const extras = { aberta: !!abertaR.data, bairros: bairrosR.data ?? [], balcao, cupom: null as Cupom | null, agendaNoHorario, taxaEspecial };
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
