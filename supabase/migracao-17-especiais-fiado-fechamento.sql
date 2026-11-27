-- Migração 17: clientes especiais (taxa de entrega própria), fiado com assinatura
-- e pagamento dos entregadores (fixo por dia + valor por entrega) para o fechamento de caixa.

-- 1) Clientes especiais — só a loja vê (o cardápio não lê esta tabela)
create table if not exists clientes_especiais (
  telefone      text primary key check (telefone ~ '^[0-9]{10,13}$'),
  nome          text not null,
  taxa_entrega  numeric(10,2) check (taxa_entrega is null or taxa_entrega >= 0),
  permite_fiado boolean not null default true,
  limite_fiado  numeric(10,2) check (limite_fiado is null or limite_fiado >= 0),
  obs           text,
  criado_em     timestamptz not null default now()
);
alter table clientes_especiais enable row level security;
drop policy if exists clientes_especiais_admin on clientes_especiais;
create policy clientes_especiais_admin on clientes_especiais for all to authenticated using (is_admin()) with check (is_admin());

-- 2) Fiado
alter table pedidos drop constraint if exists pedidos_pagamento_check;
alter table pedidos add constraint pedidos_pagamento_check
  check (pagamento in ('pix_online','cartao_online','dinheiro','cartao_entrega','pix_entrega','pago_app','fiado'));
alter table pedidos add column if not exists assinatura text;
alter table pedidos add column if not exists fiado_pago_em timestamptz;
alter table pedidos add column if not exists fiado_pago_como text;
create index if not exists pedidos_fiado_aberto on pedidos (cliente_telefone) where pagamento = 'fiado' and fiado_pago_em is null;

-- 3) Pagamento dos entregadores
alter table entregadores add column if not exists valor_fixo numeric(10,2) not null default 0;
alter table entregadores add column if not exists valor_por_entrega numeric(10,2) not null default 0;
