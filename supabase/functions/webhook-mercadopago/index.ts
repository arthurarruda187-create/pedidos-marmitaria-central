// Função "webhook-mercadopago": o Mercado Pago avisa aqui quando um pagamento muda.
// Confirmamos direto na API do Mercado Pago (não confiamos no corpo do aviso)
// e liberamos o pedido para a cozinha quando aprovado.
import { createClient } from "npm:@supabase/supabase-js@2";

const MP_TOKEN = Deno.env.get("MP_ACCESS_TOKEN") ?? "";
const MP_API = Deno.env.get("MP_API_URL") ?? "https://api.mercadopago.com"; // só muda em testes
const SEGREDO = Deno.env.get("MP_WEBHOOK_SECRET") ?? ""; // opcional, recomendado

function chaveServico(): string {
  const antiga = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (antiga) return antiga;
  const novas = Deno.env.get("SUPABASE_SECRET_KEYS"); // formato novo: {"default":"sb_secret_..."}
  if (novas) { try { const o = JSON.parse(novas); return o.default ?? Object.values(o)[0] as string; } catch { return novas; } }
  throw new Error("Chave de serviço do Supabase não encontrada");
}

const db = createClient(Deno.env.get("SUPABASE_URL")!, chaveServico(), {
  auth: { persistSession: false },
});

async function hmacHex(chave: string, msg: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(chave), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function assinaturaValida(req: Request, dataId: string) {
  if (!SEGREDO) return true;
  const xs = req.headers.get("x-signature") ?? "";
  const reqId = req.headers.get("x-request-id") ?? "";
  const partes = Object.fromEntries(xs.split(",").map((p) => p.trim().split("=", 2)));
  if (!partes.ts || !partes.v1) return false;
  const id = /^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId;
  let manifesto = `id:${id};`;
  if (reqId) manifesto += `request-id:${reqId};`;
  manifesto += `ts:${partes.ts};`;
  return (await hmacHex(SEGREDO, manifesto)) === partes.v1;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  let corpo: Record<string, any> = {};
  try { corpo = await req.json(); } catch { /* aviso sem corpo */ }

  const tipo = corpo.type ?? corpo.topic ?? url.searchParams.get("type") ?? url.searchParams.get("topic");
  const dataId = String(corpo.data?.id ?? url.searchParams.get("data.id") ?? url.searchParams.get("id") ?? "");

  if (tipo !== "payment" || !dataId) return new Response("ignorado", { status: 200 });
  if (!(await assinaturaValida(req, dataId))) return new Response("assinatura inválida", { status: 401 });

  const r = await fetch(`${MP_API}/v1/payments/${encodeURIComponent(dataId)}`, {
    headers: { Authorization: `Bearer ${MP_TOKEN}` },
  });
  if (!r.ok) {
    console.error("Falha ao consultar pagamento", dataId, r.status);
    return new Response("erro", { status: 500 }); // Mercado Pago tenta de novo
  }
  const pg = await r.json();
  const pedidoId = pg.external_reference;
  if (!pedidoId) return new Response("sem referência", { status: 200 });

  const { data: pedido } = await db.from("pedidos").select("id,status,total,pagamento,pagamento_status").eq("id", pedidoId).single();
  if (!pedido) return new Response("pedido não encontrado", { status: 200 });

  if (pg.status === "approved") {
    if (Math.abs(Number(pg.transaction_amount) - Number(pedido.total)) > 0.01) {
      console.error("Valor pago diferente do pedido", pedidoId, pg.transaction_amount, pedido.total);
      return new Response("valor divergente", { status: 200 });
    }
    await db.from("pedidos").update({
      pagamento_status: "pago",
      mp_pagamento_id: String(pg.id),
      status: pedido.status === "aguardando_pagamento" ? "novo" : pedido.status,
    }).eq("id", pedidoId);
  } else if (pg.status === "rejected" && pedido.pagamento === "cartao_online") {
    // cartão recusado: o cliente pode tentar outro cartão na mesma página; não cancela
  } else if (["rejected", "cancelled", "refunded", "charged_back"].includes(pg.status) && pedido.pagamento_status !== "pago") {
    await db.from("pedidos").update({
      pagamento_status: "falhou",
      status: pedido.status === "aguardando_pagamento" ? "cancelado" : pedido.status,
      motivo_cancelamento: pedido.status === "aguardando_pagamento" ? "Pagamento não aprovado" : null,
    }).eq("id", pedidoId);
  }
  return new Response("ok", { status: 200 });
});
