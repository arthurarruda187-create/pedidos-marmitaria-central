-- Migração 19: fechar mesa — a conta da mesa junta os pedidos até alguém "fechar".
-- Depois de fechada, a mesa fica livre e os próximos pedidos começam uma conta nova.
alter table pedidos add column if not exists mesa_fechada_em timestamptz;
create index if not exists pedidos_mesa_aberta on pedidos (mesa) where tipo = 'mesa' and mesa_fechada_em is null;
-- pedidos de mesa antigos (antes de hoje) já contam como mesa fechada
update pedidos set mesa_fechada_em = now() where tipo = 'mesa' and mesa_fechada_em is null and criado_em < current_date;
