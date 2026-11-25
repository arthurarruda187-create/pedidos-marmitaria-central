-- Migração 08: projetos novos do Supabase não dão acesso automático às tabelas para as funções do servidor.
-- Sem isto, a função criar-pedido responde "Erro ao ler o cardápio".
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;
