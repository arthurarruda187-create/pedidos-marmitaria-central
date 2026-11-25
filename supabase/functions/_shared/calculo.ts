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
  modo_taxa?: "bairro" | "raio";
  faixas_km?: Faixa[] | null;
  aceita_mesa?: boolean;
};
export type Faixa = { ate: number; taxa: number };

export type Opcao = { id: string; grupo_id: string; nome: string; preco: number; esgotado: boolean };
export type Grupo = { id: string; produto_id: string; nome: string; minimo: number; maximo: number };
export type Produto = {
  id: string; nome: string; preco: number; preco_promocional?: number | null; esgotado: boolean; ativo: boolean;
};
export type Bairro = { id: string; nome: string; taxa: number | null; distancia_km?: number | null };
export type Cupom = { codigo: string; tipo: "percentual" | "valor" | "frete"; valor: number };

export type EntradaItem = {
  produto_id: string;
  quantidade: number;
  observacao?: string;
  adicionais?: { opcao_id: string; quantidade: number }[];
};

export type Pagamento = "pix_online" | "cartao_online" | "dinheiro" | "cartao_entrega" | "pix_entrega" | "pago_app";
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
  observacao?: string;
  pagamento: Pagamento;
  troco_para?: number | string | null;
  cupom?: string;
  canal?: "cardapio" | "balcao" | "mesa";
  origem?: "balcao" | App;   // pedido lançado na loja: de onde veio
  id_externo?: string;       // número do pedido no app
  total_app?: number | string | null; // valor que o app cobrou do cliente
  itens: EntradaItem[];
};

export type Extras = {
  aberta: boolean;          // resultado de loja_aberta_agora()
  bairros: Bairro[];        // bairros ativos (vazio = taxa fixa)
  cupom?: Cupom | null;     // cupom já validado pelo banco
  balcao?: boolean;         // pedido lançado pela loja (PDV)
};

export type ItemCalculado = {
  produto_id: string;
  nome: string;
  quantidade: number;
  preco_unitario: number; // produto + adicionais, por unidade
  total: number;
  observacao: string;
  adicionais: { grupo: string; nome: string; quantidade: number; preco: number }[];
};

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

/** Taxa de entrega de um bairro, conforme o modo da loja. null = fora da área. */
export function taxaDoBairro(loja: Loja, b: Bairro): number | null {
  const km = b.distancia_km == null ? null : Number(b.distancia_km);
  const faixas = loja.faixas_km ?? [];
  const pelaFaixa = km != null && faixas.length ? taxaPorFaixa(km, faixas) : undefined;
  if (loja.modo_taxa === "raio") {
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
  if (!balcao && !extras.aberta) throw new ErroPedido("A loja está fechada no momento.");

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
    if (!bairro) throw new ErroPedido("Escolha o seu bairro.");
  }

  const origem = balcao && entrada.origem && (APPS as readonly string[]).includes(entrada.origem) ? entrada.origem as App : null;
  const pagamentosPermitidos: Record<string, boolean> = origem
    ? { pago_app: true, dinheiro: true, cartao_entrega: true }
    : balcao || mesaPedido
    ? { dinheiro: true, cartao_entrega: true, pix_entrega: true }
    : {
      pix_online: loja.aceita_pix_online,
      cartao_online: loja.aceita_cartao_online,
      dinheiro: loja.aceita_dinheiro,
      cartao_entrega: loja.aceita_cartao_entrega,
      pix_entrega: !!loja.aceita_pix_entrega,
    };
  if (!pagamentosPermitidos[entrada.pagamento]) throw new ErroPedido("Forma de pagamento indisponível.");

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
      observacao: texto(it.observacao, 200), adicionais,
    });
  }

  if (!balcao && entrada.tipo === "entrega" && subtotalC < centavos(loja.pedido_minimo)) {
    throw new ErroPedido(`O pedido mínimo para entrega é R$ ${Number(loja.pedido_minimo).toFixed(2).replace(".", ",")}.`);
  }

  let taxaC = 0;
  if (entrada.tipo === "entrega") {
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
      observacao: texto(entrada.observacao, 300) || null,
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
      pagamento_status: online ? "pendente" : entrada.pagamento === "pago_app" ? "pago" : "na_entrega",
    },
    email: texto(entrada.cliente_email, 120),
  };
}
