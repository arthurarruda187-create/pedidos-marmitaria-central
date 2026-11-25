-- Migração 10: taxa pelo ponto no mapa (raio em linha reta, igual ao aiqfome)
alter table loja drop constraint if exists loja_modo_taxa_check;
alter table loja add constraint loja_modo_taxa_check check (modo_taxa in ('bairro', 'raio', 'mapa'));

alter table pedidos add column if not exists entrega_lat double precision;
alter table pedidos add column if not exists entrega_lng double precision;
alter table pedidos add column if not exists distancia_km numeric(6,2);
