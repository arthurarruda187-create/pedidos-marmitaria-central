-- Migração 06: logo preto e branco para a impressora térmica
alter table loja add column if not exists logo_impressao_url text;
