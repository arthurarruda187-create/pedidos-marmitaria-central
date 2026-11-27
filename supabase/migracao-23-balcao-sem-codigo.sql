-- Migração 23: pedido lançado no balcão (telefone/loja) não usa código de entrega —
-- o entregador só aperta "Entreguei". O código continua nos pedidos do cardápio (cliente de fora).
create or replace function gerar_codigo_entrega() returns trigger language plpgsql as $$
begin
  if new.tipo = 'entrega' and new.codigo_entrega is null and new.canal = 'cardapio' then
    new.codigo_entrega := lpad(floor(random() * 10000)::int::text, 4, '0');
  end if;
  return new;
end $$;

-- pedidos de balcão que ainda estão abertos: tira o código
update pedidos set codigo_entrega = null
where canal = 'balcao' and codigo_entrega is not null and status in ('novo', 'preparo', 'pronto', 'saiu');
