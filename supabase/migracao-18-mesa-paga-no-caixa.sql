-- Migração 18: pedido da mesa (QR Code) sem escolher pagamento — "paga no caixa".
-- Quando o cliente paga, o painel troca para a forma real (dinheiro, cartão ou Pix) e marca como pago.
alter table pedidos drop constraint if exists pedidos_pagamento_check;
alter table pedidos add constraint pedidos_pagamento_check
  check (pagamento in ('pix_online','cartao_online','dinheiro','cartao_entrega','pix_entrega','pago_app','fiado','caixa'));
