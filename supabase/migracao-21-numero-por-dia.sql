-- Migração 21: número do pedido recomeça do 1 todo dia (horário de Brasília).
create table if not exists pedido_contador (
  dia    date primary key,
  ultimo int not null default 0
);
alter table pedido_contador enable row level security; -- só o próprio banco mexe

create or replace function numerar_pedido_do_dia() returns trigger
language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'America/Sao_Paulo')::date; n int;
begin
  -- a linha do dia fica travada até o fim do pedido: dois pedidos ao mesmo tempo nunca pegam o mesmo número
  insert into pedido_contador (dia, ultimo) values (d, 1)
    on conflict (dia) do update set ultimo = pedido_contador.ultimo + 1
    returning ultimo into n;
  new.numero := n;
  return new;
end $$;

drop trigger if exists pedidos_numero_do_dia on pedidos;
create trigger pedidos_numero_do_dia before insert on pedidos
  for each row execute function numerar_pedido_do_dia();
