-- Migração 09: proteções para quando várias pessoas usam o sistema ao mesmo tempo.
-- 1) Cupom: o uso é reservado de forma atômica (limite de usos e "primeira compra" não estouram)
-- 2) Pedido repetido: o mesmo envio (clique duplo / internet caindo) não vira dois pedidos
-- 3) Status: pedido cancelado não volta a andar; entregue só pode ser cancelado

-- 1) Cupom ------------------------------------------------------------------
create table if not exists cupom_usos (
  cupom_id  uuid not null references cupons(id) on delete cascade,
  telefone  text not null,
  em        timestamptz not null default now(),
  primary key (cupom_id, telefone)
);
alter table cupom_usos enable row level security;
revoke all on cupom_usos from anon, authenticated;

-- Reserva 1 uso do cupom. Devolve null se deu certo, ou a mensagem de erro.
create or replace function reservar_cupom(p_codigo text, p_telefone text) returns text
language plpgsql security definer set search_path = public as $$
declare c cupons%rowtype; tel text := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g');
begin
  update cupons set usos = usos + 1
   where upper(codigo) = upper(trim(p_codigo)) and ativo
     and (limite_usos is null or usos < limite_usos)
  returning * into c;
  if not found then return 'Este cupom esgotou.'; end if;
  if c.primeira_compra then
    insert into cupom_usos (cupom_id, telefone) values (c.id, tel) on conflict do nothing;
    if not found then raise exception using errcode = 'P0001', message = 'Cupom válido só na primeira compra.'; end if;
  end if;
  return null;
exception when sqlstate 'P0001' then
  return sqlerrm; -- desfaz a contagem (a exceção volta o update)
end $$;

-- Devolve o uso (quando o pedido não chegou a ser gravado)
create or replace function liberar_cupom(p_codigo text, p_telefone text) returns void
language plpgsql security definer set search_path = public as $$
declare c cupons%rowtype; tel text := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g');
begin
  update cupons set usos = greatest(usos - 1, 0) where upper(codigo) = upper(trim(p_codigo)) returning * into c;
  if found then delete from cupom_usos where cupom_id = c.id and telefone = tel; end if;
end $$;

revoke execute on function reservar_cupom(text, text) from public, anon, authenticated;
revoke execute on function liberar_cupom(text, text) from public, anon, authenticated;
grant execute on function reservar_cupom(text, text) to service_role;
grant execute on function liberar_cupom(text, text) to service_role;

-- 2) Pedido repetido ---------------------------------------------------------
alter table pedidos add column if not exists chave_envio text;
create unique index if not exists pedidos_chave_envio on pedidos (chave_envio) where chave_envio is not null;

-- 3) Status ------------------------------------------------------------------
create or replace function proteger_status() returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status then
    if old.status = 'cancelado' then
      raise exception using errcode = 'P0001', message = 'Este pedido já foi cancelado (por outra pessoa ou outro aparelho).';
    end if;
    if old.status = 'entregue' and new.status <> 'cancelado' then
      raise exception using errcode = 'P0001', message = 'Este pedido já foi finalizado.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists pedidos_proteger_status on pedidos;
create trigger pedidos_proteger_status before update of status on pedidos
  for each row execute function proteger_status();

grant all on cupom_usos to service_role;
