-- Migração 07: mensagens automáticas no WhatsApp (Z-API) quando o pedido muda de status
create extension if not exists pg_net;
create extension if not exists pgcrypto;

alter table loja add column if not exists whatsapp_auto boolean not null default false;
alter table loja add column if not exists mensagens_auto jsonb not null default '{}'::jsonb; -- textos por status (vazio = padrão)
alter table loja add column if not exists site_url text;

-- Configuração privada (só o dono vê; a função lê com a chave de serviço)
create table if not exists config_privada (
  id                int primary key default 1 check (id = 1),
  segredo           text not null default encode(gen_random_bytes(24), 'hex'),
  url_funcao        text,
  chave_anon        text,
  zapi_instancia    text,
  zapi_token        text,
  zapi_client_token text
);
insert into config_privada (id) values (1) on conflict do nothing;
alter table config_privada enable row level security;
drop policy if exists "config admin" on config_privada;
create policy "config admin" on config_privada for all to authenticated using (is_admin()) with check (is_admin());
revoke all on config_privada from anon;
grant select, update on config_privada to authenticated;

-- Registro do que foi enviado (também impede mandar a mesma mensagem duas vezes)
create table if not exists mensagens_whatsapp (
  id         bigserial primary key,
  pedido_id  uuid references pedidos(id) on delete cascade,
  status     text not null,
  telefone   text,
  texto      text,
  ok         boolean,
  erro       text,
  criado_em  timestamptz not null default now()
);
create unique index if not exists mensagens_whatsapp_unico on mensagens_whatsapp (pedido_id, status);
alter table mensagens_whatsapp enable row level security;
drop policy if exists "msg admin" on mensagens_whatsapp;
create policy "msg admin" on mensagens_whatsapp for select to authenticated using (is_admin());
grant select on mensagens_whatsapp to authenticated;

-- Gatilho: quando o pedido é criado ou muda de status, chama a função avisar-whatsapp
create or replace function avisar_whatsapp() returns trigger
language plpgsql security definer set search_path = public as $$
declare c config_privada;
begin
  if new.cliente_telefone is null or new.status = 'aguardando_pagamento' then return new; end if;
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then return new; end if;
  if not exists (select 1 from loja where id = 1 and whatsapp_auto) then return new; end if;
  select * into c from config_privada where id = 1;
  if c.url_funcao is null then return new; end if;
  begin
    perform net.http_post(
      url := c.url_funcao,
      body := jsonb_build_object('pedido_id', new.id, 'status', new.status, 'segredo', c.segredo),
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || coalesce(c.chave_anon, ''), 'apikey', coalesce(c.chave_anon, ''))
    );
  exception when others then null; -- nunca impede o pedido de ser salvo
  end;
  return new;
end $$;
drop trigger if exists pedidos_avisar_whatsapp on pedidos;
create trigger pedidos_avisar_whatsapp after insert or update of status on pedidos
  for each row execute function avisar_whatsapp();
alter table config_privada add column if not exists zapi_tipo text not null default 'omni';
