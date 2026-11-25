-- Migração 05: ruas da cidade (para autocompletar o endereço e escolher o bairro sozinho)
create table if not exists ruas (
  id        bigserial primary key,
  nome      text not null,
  bairro_id uuid not null references bairros(id) on delete cascade,
  cep       text,
  faixa     text            -- ex.: "até 693/694" quando a rua passa por mais de um bairro
);
create index if not exists ruas_nome_idx on ruas (lower(nome));
create unique index if not exists ruas_unico on ruas (lower(nome), bairro_id, coalesce(faixa, ''));

alter table ruas enable row level security;
drop policy if exists "ruas leitura" on ruas;
create policy "ruas leitura" on ruas for select using (true);
drop policy if exists "ruas admin" on ruas;
create policy "ruas admin" on ruas for all using (is_admin()) with check (is_admin());
grant select on ruas to anon, authenticated;
grant insert, update, delete on ruas to authenticated;
grant usage, select on sequence ruas_id_seq to authenticated;
