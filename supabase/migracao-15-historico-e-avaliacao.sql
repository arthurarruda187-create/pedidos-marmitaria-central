-- Migração 15: linha do tempo de cada pedido (histórico) + número de WhatsApp editável na avaliação

-- 1) Linha do tempo: cada mudança de status fica registrada com a hora
create table if not exists pedido_eventos (
  id        bigint generated always as identity primary key,
  pedido_id uuid not null references pedidos(id) on delete cascade,
  status    text not null,
  em        timestamptz not null default now()
);
create index if not exists pedido_eventos_pedido_idx on pedido_eventos (pedido_id, em);
alter table pedido_eventos enable row level security;
drop policy if exists "admin le eventos" on pedido_eventos;
create policy "admin le eventos" on pedido_eventos for select to authenticated using (is_admin());
grant select on pedido_eventos to authenticated;
grant all on pedido_eventos to service_role;

create or replace function registrar_evento_pedido() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into pedido_eventos (pedido_id, status) values (new.id, 'criado');
    if new.status <> 'novo' then insert into pedido_eventos (pedido_id, status) values (new.id, new.status); end if;
  elsif new.status is distinct from old.status then
    insert into pedido_eventos (pedido_id, status) values (new.id, new.status);
  end if;
  return new;
end $$;
drop trigger if exists pedidos_eventos on pedidos;
create trigger pedidos_eventos after insert or update of status on pedidos
  for each row execute function registrar_evento_pedido();

-- pedidos que já existiam: entram com a hora em que foram feitos e a última situação conhecida
insert into pedido_eventos (pedido_id, status, em)
  select p.id, 'criado', p.criado_em from pedidos p
  where not exists (select 1 from pedido_eventos e where e.pedido_id = p.id);
insert into pedido_eventos (pedido_id, status, em)
  select p.id, p.status, p.atualizado_em from pedidos p
  where p.status not in ('novo', 'aguardando_pagamento')
    and not exists (select 1 from pedido_eventos e where e.pedido_id = p.id and e.status = p.status);

-- 2) Avaliação: número de WhatsApp que o dono pode corrigir (vale mais que o do pedido)
alter table avaliacoes add column if not exists telefone text;
drop policy if exists "admin edita avaliacoes" on avaliacoes;
create policy "admin edita avaliacoes" on avaliacoes for update to authenticated using (is_admin()) with check (is_admin());
grant update (telefone) on avaliacoes to authenticated;
