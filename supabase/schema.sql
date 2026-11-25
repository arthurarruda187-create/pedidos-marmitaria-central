-- =====================================================================
--  Sistema de pedidos — banco de dados (Supabase / PostgreSQL)
--  Rode este arquivo inteiro no SQL Editor do Supabase, uma vez.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Administradores do painel (quem pode ver pedidos e editar o cardápio)
-- ---------------------------------------------------------------------
create table if not exists admins (
  user_id uuid primary key,
  criado_em timestamptz not null default now()
);

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where user_id = auth.uid());
$$;

-- ---------------------------------------------------------------------
-- Configuração da loja (uma linha só)
-- ---------------------------------------------------------------------
create table if not exists loja (
  id                      int primary key default 1 check (id = 1),
  nome                    text not null default 'Minha Loja',
  descricao               text not null default '',
  whatsapp                text not null default '',   -- só números, com DDI: 5543999999999
  endereco                text not null default '',
  logo_url                text,
  cor                     text not null default '#e4002b',
  aberta                  boolean not null default true,
  mensagem_fechada        text not null default 'Estamos fechados no momento.',
  tempo_entrega           text not null default '30 a 50 min',
  tempo_retirada          text not null default '20 min',
  aceita_entrega          boolean not null default true,
  aceita_retirada         boolean not null default true,
  taxa_entrega            numeric(10,2) not null default 0 check (taxa_entrega >= 0),
  pedido_minimo           numeric(10,2) not null default 0 check (pedido_minimo >= 0),
  aceita_pix_online       boolean not null default false,
  aceita_cartao_online    boolean not null default false,
  aceita_dinheiro         boolean not null default true,
  aceita_cartao_entrega   boolean not null default true,
  aceita_pix_entrega      boolean not null default true,
  chave_pix               text not null default '',
  nome_pix                text not null default '',
  atualizado_em           timestamptz not null default now()
);
insert into loja (id) values (1) on conflict do nothing;

-- ---------------------------------------------------------------------
-- Cardápio: categoria -> produto -> grupo de adicionais -> opção
-- ---------------------------------------------------------------------
create table if not exists categorias (
  id      uuid primary key default gen_random_uuid(),
  nome    text not null,
  ordem   int  not null default 0,
  ativa   boolean not null default true
);

create table if not exists produtos (
  id            uuid primary key default gen_random_uuid(),
  categoria_id  uuid not null references categorias(id) on delete cascade,
  nome          text not null,
  descricao     text not null default '',
  preco         numeric(10,2) not null check (preco >= 0),
  foto_url      text,
  esgotado      boolean not null default false,
  ativo         boolean not null default true,
  ordem         int not null default 0
);
create index if not exists produtos_categoria_idx on produtos(categoria_id);

create table if not exists grupos_adicionais (
  id          uuid primary key default gen_random_uuid(),
  produto_id  uuid not null references produtos(id) on delete cascade,
  nome        text not null,
  minimo      int  not null default 0 check (minimo >= 0),
  maximo      int  not null default 1 check (maximo >= 1),
  ordem       int  not null default 0,
  check (minimo <= maximo)
);
create index if not exists grupos_produto_idx on grupos_adicionais(produto_id);

create table if not exists opcoes_adicionais (
  id        uuid primary key default gen_random_uuid(),
  grupo_id  uuid not null references grupos_adicionais(id) on delete cascade,
  nome      text not null,
  preco     numeric(10,2) not null default 0 check (preco >= 0),
  esgotado  boolean not null default false,
  ordem     int not null default 0
);
create index if not exists opcoes_grupo_idx on opcoes_adicionais(grupo_id);

-- ---------------------------------------------------------------------
-- Pedidos
-- ---------------------------------------------------------------------
create sequence if not exists pedido_numero_seq;

create table if not exists pedidos (
  id                uuid primary key default gen_random_uuid(),
  numero            int not null default nextval('pedido_numero_seq'),
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now(),
  status            text not null default 'novo' check (status in
                      ('aguardando_pagamento','novo','preparo','pronto','saiu','entregue','cancelado')),
  cliente_nome      text not null,
  cliente_telefone  text not null,
  tipo              text not null check (tipo in ('entrega','retirada')),
  endereco          text,
  observacao        text,
  itens             jsonb not null,             -- foto do pedido (nomes e preços no momento da compra)
  subtotal          numeric(10,2) not null,
  taxa_entrega      numeric(10,2) not null default 0,
  total             numeric(10,2) not null,
  pagamento         text not null check (pagamento in
                      ('pix_online','cartao_online','dinheiro','cartao_entrega','pix_entrega')),
  troco_para        numeric(10,2),
  pagamento_status  text not null default 'na_entrega' check (pagamento_status in
                      ('pendente','pago','na_entrega','falhou')),
  mp_pagamento_id   text,
  pix_copia_cola    text,
  pix_qr_base64     text,
  checkout_url      text,
  motivo_cancelamento text
);
create index if not exists pedidos_criado_idx on pedidos(criado_em desc);
create index if not exists pedidos_status_idx on pedidos(status);

create or replace function tocar_atualizado_em() returns trigger language plpgsql as $$
begin new.atualizado_em := now(); return new; end $$;

drop trigger if exists pedidos_atualizado on pedidos;
create trigger pedidos_atualizado before update on pedidos
  for each row execute function tocar_atualizado_em();

drop trigger if exists loja_atualizado on loja;
create trigger loja_atualizado before update on loja
  for each row execute function tocar_atualizado_em();

-- ---------------------------------------------------------------------
-- Acompanhamento do pedido pelo cliente (só quem tem o id do pedido)
-- ---------------------------------------------------------------------
drop function if exists status_pedido(uuid);
create function status_pedido(p_id uuid)
returns table (
  numero int, status text, pagamento text, pagamento_status text,
  total numeric, tipo text, criado_em timestamptz,
  pix_copia_cola text, pix_qr_base64 text, checkout_url text, itens jsonb,
  cliente_nome text, cliente_telefone text, endereco text, taxa_entrega numeric, subtotal numeric,
  observacao text, troco_para numeric
)
language sql stable security definer set search_path = public as $$
  select numero, status, pagamento, pagamento_status, total, tipo, criado_em,
         pix_copia_cola, pix_qr_base64, checkout_url, itens,
         cliente_nome, cliente_telefone, endereco, taxa_entrega, subtotal, observacao, troco_para
  from pedidos where id = p_id;
$$;

-- ---------------------------------------------------------------------
-- Segurança (RLS)
--   * Qualquer pessoa lê a loja e o cardápio.
--   * Só administradores alteram o cardápio e veem/alteram pedidos.
--   * Pedidos são criados somente pela função "criar-pedido" (chave de serviço),
--     que recalcula os preços no servidor.
-- ---------------------------------------------------------------------
alter table admins             enable row level security;
alter table loja               enable row level security;
alter table categorias         enable row level security;
alter table produtos           enable row level security;
alter table grupos_adicionais  enable row level security;
alter table opcoes_adicionais  enable row level security;
alter table pedidos            enable row level security;

drop policy if exists admins_select on admins;
create policy admins_select on admins for select to authenticated using (user_id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array['loja','categorias','produtos','grupos_adicionais','opcoes_adicionais'] loop
    execute format('drop policy if exists %I on %I', t || '_leitura', t);
    execute format('create policy %I on %I for select to anon, authenticated using (true)', t || '_leitura', t);
    execute format('drop policy if exists %I on %I', t || '_admin', t);
    execute format('create policy %I on %I for all to authenticated using (is_admin()) with check (is_admin())', t || '_admin', t);
  end loop;
end $$;

drop policy if exists pedidos_admin on pedidos;
create policy pedidos_admin on pedidos for all to authenticated using (is_admin()) with check (is_admin());

grant usage on schema public to anon, authenticated;
grant select on loja, categorias, produtos, grupos_adicionais, opcoes_adicionais to anon, authenticated;
grant insert, update, delete on loja, categorias, produtos, grupos_adicionais, opcoes_adicionais to authenticated;
grant select, update on pedidos to authenticated;
grant select on admins to authenticated;
grant execute on function status_pedido(uuid) to anon, authenticated;
grant execute on function is_admin() to anon, authenticated;

-- ---------------------------------------------------------------------
-- Tempo real: o painel recebe pedidos novos na hora
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and tablename = 'pedidos') then
    execute 'alter publication supabase_realtime add table pedidos';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Fotos dos produtos (Supabase Storage, bucket público "fotos")
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public) values ('fotos', 'fotos', true)
      on conflict (id) do nothing;
    execute 'drop policy if exists fotos_admin_insert on storage.objects';
    execute $p$create policy fotos_admin_insert on storage.objects for insert to authenticated
              with check (bucket_id = 'fotos' and public.is_admin())$p$;
    execute 'drop policy if exists fotos_admin_update on storage.objects';
    execute $p$create policy fotos_admin_update on storage.objects for update to authenticated
              using (bucket_id = 'fotos' and public.is_admin())$p$;
    execute 'drop policy if exists fotos_admin_delete on storage.objects';
    execute $p$create policy fotos_admin_delete on storage.objects for delete to authenticated
              using (bucket_id = 'fotos' and public.is_admin())$p$;
  end if;
end $$;
