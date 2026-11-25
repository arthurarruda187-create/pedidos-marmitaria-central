-- Migração 13: integração com os apps de delivery (iFood, 99Food, Keeta)
-- As chaves de cada app ficam aqui (só o dono da loja vê). A função "integracoes" busca os pedidos
-- a cada 30 segundos e devolve para o app cada mudança de status feita no painel.

create table if not exists integracoes (
  plataforma      text primary key check (plataforma in ('ifood', '99food', 'keeta', 'aiqfome')),
  ativo           boolean not null default false,
  client_id       text,
  client_secret   text,
  merchant_id     text,
  base_url        text,          -- Open Delivery (99Food, Keeta): endereço da API do app
  confirmar_auto  boolean not null default true,
  token           text,
  token_expira    timestamptz,
  ultimo_sync     timestamptz,
  ultimo_erro     text,
  ultimo_erro_em  timestamptz,
  atualizado_em   timestamptz not null default now()
);
insert into integracoes (plataforma, base_url) values
  ('ifood', null), ('99food', null), ('keeta', 'https://open.mykeeta.com/api/open/opendelivery'), ('aiqfome', null)
on conflict do nothing;
alter table integracoes enable row level security;
drop policy if exists "integracoes admin" on integracoes;
create policy "integracoes admin" on integracoes for all to authenticated using (is_admin()) with check (is_admin());
revoke all on integracoes from anon;
grant select, update on integracoes to authenticated;

create table if not exists integracao_log (
  id         bigserial primary key,
  em         timestamptz not null default now(),
  plataforma text,
  pedido_id  uuid,
  acao       text,
  ok         boolean,
  detalhe    text
);
create index if not exists integracao_log_em on integracao_log (em desc);
alter table integracao_log enable row level security;
drop policy if exists "log admin" on integracao_log;
create policy "log admin" on integracao_log for select to authenticated using (is_admin());
revoke all on integracao_log from anon;
grant select on integracao_log to authenticated;

-- último status já combinado com o app (evita mandar de volta o que veio de lá)
alter table pedidos add column if not exists api_sincronizado text;

alter table config_privada add column if not exists url_integracoes text;

-- mudança de status no painel → avisa o app
create or replace function avisar_integracao() returns trigger language plpgsql security definer set search_path = public as $$
declare c config_privada;
begin
  if new.api_pedido_id is null or new.status is not distinct from old.status
     or new.status is not distinct from new.api_sincronizado then return new; end if;
  select * into c from config_privada where id = 1;
  if c.url_integracoes is null then return new; end if;
  begin
    perform net.http_post(
      url := c.url_integracoes,
      body := jsonb_build_object('acao', 'status', 'segredo', c.segredo, 'pedido_id', new.id, 'status', new.status),
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || coalesce(c.chave_anon, ''), 'apikey', coalesce(c.chave_anon, ''))
    );
  exception when others then null; -- nunca trava o painel por causa do app
  end;
  return new;
end $$;
drop trigger if exists pedidos_avisar_integracao on pedidos;
create trigger pedidos_avisar_integracao after update of status on pedidos
  for each row execute function avisar_integracao();

-- a cada 30 s busca pedidos novos (só quando algum app está ligado)
do $$ begin
  begin
    create extension if not exists pg_cron;
  exception when others then raise notice 'pg_cron indisponível aqui: %', sqlerrm;
  end;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'integracoes-sync';
    perform cron.schedule('integracoes-sync', '30 seconds', $job$
      select net.http_post(
        url := c.url_integracoes,
        body := jsonb_build_object('acao', 'sincronizar', 'segredo', c.segredo),
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || coalesce(c.chave_anon, ''), 'apikey', coalesce(c.chave_anon, ''))
      )
      from config_privada c
      where c.id = 1 and c.url_integracoes is not null and exists (select 1 from integracoes where ativo)
    $job$);
  end if;
end $$;

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
