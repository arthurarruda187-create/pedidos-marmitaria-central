-- =====================================================================
-- Migração 02: bairros, horários automáticos, cupons, entregadores,
-- promoções/destaques, pedido de balcão. Pode rodar mais de uma vez.
-- =====================================================================

-- Loja: capa, horário automático
alter table loja add column if not exists capa_url text;
alter table loja add column if not exists horario_automatico boolean not null default false;

-- Produtos: preço promocional e destaque
alter table produtos add column if not exists preco_promocional numeric(10,2) check (preco_promocional is null or preco_promocional >= 0);
alter table produtos add column if not exists destaque boolean not null default false;

-- Horários de funcionamento (vários por dia; fechamento depois da meia-noite é aceito)
create table if not exists horarios (
  id          uuid primary key default gen_random_uuid(),
  dia_semana  int  not null check (dia_semana between 0 and 6),  -- 0 = domingo
  abre        time not null,
  fecha       time not null
);

-- Bairros atendidos com taxa própria
create table if not exists bairros (
  id     uuid primary key default gen_random_uuid(),
  nome   text not null,
  taxa   numeric(10,2) not null default 0 check (taxa >= 0),
  ativo  boolean not null default true
);

-- Cupons
create table if not exists cupons (
  id               uuid primary key default gen_random_uuid(),
  codigo           text not null unique,
  tipo             text not null check (tipo in ('percentual','valor','frete')),
  valor            numeric(10,2) not null default 0 check (valor >= 0),
  pedido_minimo    numeric(10,2) not null default 0,
  primeira_compra  boolean not null default false,
  validade         date,
  limite_usos      int,
  usos             int not null default 0,
  ativo            boolean not null default true,
  criado_em        timestamptz not null default now()
);

-- Entregadores
create table if not exists entregadores (
  id        uuid primary key default gen_random_uuid(),
  nome      text not null,
  telefone  text not null default '',
  ativo     boolean not null default true
);

-- Pedidos: bairro, desconto, cupom, entregador, canal
alter table pedidos add column if not exists bairro text;
alter table pedidos add column if not exists desconto numeric(10,2) not null default 0;
alter table pedidos add column if not exists cupom_codigo text;
alter table pedidos add column if not exists entregador_id uuid references entregadores(id) on delete set null;
alter table pedidos add column if not exists canal text not null default 'cardapio';
alter table pedidos drop constraint if exists pedidos_canal_check;
alter table pedidos add constraint pedidos_canal_check check (canal in ('cardapio','balcao'));
-- pedido de balcão pode não ter telefone
alter table pedidos alter column cliente_telefone drop not null;

-- ---------------------------------------------------------------------
-- A loja está aberta agora? (botão manual + horário automático)
-- ---------------------------------------------------------------------
create or replace function loja_aberta_agora() returns boolean
language sql stable security definer set search_path = public as $$
  with l as (select * from loja where id = 1),
       a as (select (now() at time zone 'America/Sao_Paulo') as t)
  select case
    when not l.aberta then false
    when not l.horario_automatico then true
    else exists (
      select 1 from horarios h, a
      where (h.abre < h.fecha and extract(dow from a.t) = h.dia_semana
               and a.t::time >= h.abre and a.t::time < h.fecha)
         or (h.abre >= h.fecha and (
               (extract(dow from a.t) = h.dia_semana and a.t::time >= h.abre)
            or (extract(dow from a.t) = (h.dia_semana + 1) % 7 and a.t::time < h.fecha)))
    )
  end
  from l;
$$;

-- ---------------------------------------------------------------------
-- Validação de cupom (usada pelo cardápio e pela função criar-pedido)
-- ---------------------------------------------------------------------
create or replace function validar_cupom(p_codigo text, p_subtotal numeric, p_telefone text)
returns table (valido boolean, mensagem text, codigo text, tipo text, valor numeric)
language plpgsql stable security definer set search_path = public as $$
declare c cupons%rowtype; tel text := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g');
begin
  select * into c from cupons where upper(cupons.codigo) = upper(trim(p_codigo));
  if not found or not c.ativo then
    return query select false, 'Cupom inválido.', null::text, null::text, null::numeric; return;
  end if;
  if c.validade is not null and c.validade < (now() at time zone 'America/Sao_Paulo')::date then
    return query select false, 'Este cupom expirou.', null::text, null::text, null::numeric; return;
  end if;
  if c.limite_usos is not null and c.usos >= c.limite_usos then
    return query select false, 'Este cupom esgotou.', null::text, null::text, null::numeric; return;
  end if;
  if coalesce(p_subtotal, 0) < c.pedido_minimo then
    return query select false, 'Pedido mínimo para este cupom: R$ ' || replace(to_char(c.pedido_minimo, 'FM999990.00'), '.', ','),
      null::text, null::text, null::numeric; return;
  end if;
  if c.primeira_compra then
    if length(tel) < 10 then
      return query select false, 'Informe seu WhatsApp para usar este cupom.', null::text, null::text, null::numeric; return;
    end if;
    if exists (select 1 from pedidos where cliente_telefone = tel and status <> 'cancelado') then
      return query select false, 'Cupom válido só na primeira compra.', null::text, null::text, null::numeric; return;
    end if;
  end if;
  return query select true, 'Cupom aplicado!', c.codigo, c.tipo, c.valor;
end $$;

-- ---------------------------------------------------------------------
-- Segurança
-- ---------------------------------------------------------------------
alter table horarios     enable row level security;
alter table bairros      enable row level security;
alter table cupons       enable row level security;
alter table entregadores enable row level security;

do $$
declare t text;
begin
  -- leitura pública (o cardápio precisa): horários e bairros
  foreach t in array array['horarios','bairros'] loop
    execute format('drop policy if exists %I on %I', t || '_leitura', t);
    execute format('create policy %I on %I for select to anon, authenticated using (true)', t || '_leitura', t);
  end loop;
  -- administração: só admins (cupons e entregadores ficam privados)
  foreach t in array array['horarios','bairros','cupons','entregadores'] loop
    execute format('drop policy if exists %I on %I', t || '_admin', t);
    execute format('create policy %I on %I for all to authenticated using (is_admin()) with check (is_admin())', t || '_admin', t);
  end loop;
end $$;

grant select on horarios, bairros to anon, authenticated;
grant select, insert, update, delete on horarios, bairros, cupons, entregadores to authenticated;
revoke all on cupons, entregadores from anon;
grant execute on function loja_aberta_agora() to anon, authenticated;
grant execute on function validar_cupom(text, numeric, text) to anon, authenticated;

-- acompanhamento do pedido: inclui desconto e bairro
drop function if exists status_pedido(uuid);
create function status_pedido(p_id uuid)
returns table (
  numero int, status text, pagamento text, pagamento_status text,
  total numeric, tipo text, criado_em timestamptz,
  pix_copia_cola text, pix_qr_base64 text, checkout_url text, itens jsonb,
  cliente_nome text, cliente_telefone text, endereco text, taxa_entrega numeric, subtotal numeric,
  observacao text, troco_para numeric, desconto numeric, cupom_codigo text, bairro text
)
language sql stable security definer set search_path = public as $$
  select numero, status, pagamento, pagamento_status, total, tipo, criado_em,
         pix_copia_cola, pix_qr_base64, checkout_url, itens,
         cliente_nome, cliente_telefone, endereco, taxa_entrega, subtotal, observacao, troco_para,
         desconto, cupom_codigo, bairro
  from pedidos where id = p_id;
$$;
grant execute on function status_pedido(uuid) to anon, authenticated;

-- conta o uso do cupom (só a função do servidor chama)
create or replace function usar_cupom(p_codigo text) returns void
language sql security definer set search_path = public as $$
  update cupons set usos = usos + 1 where upper(codigo) = upper(p_codigo);
$$;
revoke execute on function usar_cupom(text) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function usar_cupom(text) to service_role';
  end if;
end $$;
