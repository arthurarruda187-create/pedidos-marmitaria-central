-- Migração 16: cada avaliação nova chega no WhatsApp que o dono escolher (tela Avaliações)
-- O número fica em config_privada (só o dono vê; a tabela loja é pública para o cardápio).
alter table config_privada add column if not exists whatsapp_avaliacoes text;

create or replace function avisar_avaliacao() returns trigger
language plpgsql security definer set search_path = public as $$
declare c config_privada;
begin
  select * into c from config_privada where id = 1;
  if c.url_funcao is null or coalesce(c.whatsapp_avaliacoes, '') = '' then return new; end if;
  begin
    perform net.http_post(
      url := c.url_funcao,
      body := jsonb_build_object('avaliacao_id', new.id, 'segredo', c.segredo),
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || coalesce(c.chave_anon, ''), 'apikey', coalesce(c.chave_anon, ''))
    );
  exception when others then null; -- nunca impede a avaliação de ser salva
  end;
  return new;
end $$;
drop trigger if exists avaliacoes_avisar on avaliacoes;
create trigger avaliacoes_avisar after insert on avaliacoes
  for each row execute function avisar_avaliacao();
