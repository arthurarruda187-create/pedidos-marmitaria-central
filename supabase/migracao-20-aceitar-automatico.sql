-- Migração 20: aceitar pedido automático — o pedido já entra "Em preparo".
alter table loja add column if not exists aceitar_auto boolean not null default true;

create or replace function aceitar_pedido_auto() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- pedidos dos apps (iFood/99Food/Keeta) são aceitos pela integração, que também avisa o app
  if new.status = 'novo' and new.api_pedido_id is null
     and coalesce((select aceitar_auto from loja where id = 1), false) then
    new.status := 'preparo';
  end if;
  return new;
end $$;

drop trigger if exists pedidos_aceitar_auto on pedidos;
create trigger pedidos_aceitar_auto before insert or update of status on pedidos
  for each row execute function aceitar_pedido_auto();

-- integração dos apps: aceitar sozinho também
update integracoes set confirmar_auto = true;
