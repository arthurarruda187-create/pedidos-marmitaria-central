-- Migração 03: pedidos vindos de apps de delivery (iFood, aiqfome, Keeta, 99Food)
alter table pedidos add column if not exists id_externo text;      -- número do pedido no app
alter table pedidos add column if not exists total_app numeric(10,2); -- valor cobrado no app (pode diferir do cardápio)

alter table pedidos drop constraint if exists pedidos_canal_check;
alter table pedidos add constraint pedidos_canal_check
  check (canal in ('cardapio','balcao','ifood','aiqfome','keeta','99food'));

alter table pedidos drop constraint if exists pedidos_pagamento_check;
alter table pedidos add constraint pedidos_pagamento_check
  check (pagamento in ('pix_online','cartao_online','dinheiro','cartao_entrega','pix_entrega','pago_app'));

create index if not exists pedidos_canal_idx on pedidos(canal);
-- evita lançar duas vezes o mesmo pedido do mesmo app
create unique index if not exists pedidos_externo_unico on pedidos(canal, id_externo) where id_externo is not null;
