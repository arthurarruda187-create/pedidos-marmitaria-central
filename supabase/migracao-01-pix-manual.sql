-- Migração 01: Pix enviado pela loja (sem pagamento online) — roda uma vez
alter table loja add column if not exists aceita_pix_entrega boolean not null default true;
alter table loja add column if not exists chave_pix text not null default '';
alter table loja add column if not exists nome_pix text not null default '';

alter table pedidos drop constraint if exists pedidos_pagamento_check;
alter table pedidos add constraint pedidos_pagamento_check
  check (pagamento in ('pix_online','cartao_online','dinheiro','cartao_entrega','pix_entrega'));

-- Desliga o pagamento online (loja usa maquininha e Pix enviado pelo WhatsApp)
update loja set aceita_pix_online = false, aceita_cartao_online = false where id = 1;
