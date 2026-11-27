-- Migração 22: pedidos de app (iFood, aiqfome, 99Food, Keeta) que o nosso sistema não fecha no app:
-- o entregador digita o código que o cliente falou, o pedido fica "Entregue" aqui e o painel
-- mostra o código para a loja dar baixa no app deles.
alter table pedidos add column if not exists codigo_app text;
alter table pedidos add column if not exists baixa_app_em timestamptz;

-- iFood integrado com código pedido pelo app: o próprio sistema confere no iFood (não precisa baixa)
create or replace function pedido_baixa_manual(p pedidos) returns boolean language sql immutable as $$
  select p.canal in ('ifood', 'aiqfome', 'keeta', '99food') and p.codigo_entrega is null
     and not (p.canal = 'ifood' and p.api_pedido_id is not null and p.precisa_codigo_app)
$$;

create or replace function entregador_dados(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e entregadores%rowtype;
begin
  select * into e from entregadores where token = p_token and ativo;
  if not found then return null; end if;
  return jsonb_build_object(
    'nome', e.nome,
    'loja', (select nome from loja where id = 1),
    'pedidos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'numero', p.numero, 'status', p.status, 'canal', p.canal, 'id_externo', p.id_externo,
        'cliente_nome', p.cliente_nome, 'cliente_telefone', p.cliente_telefone, 'endereco', p.endereco, 'bairro', p.bairro,
        'lat', p.entrega_lat, 'lng', p.entrega_lng, 'total', p.total, 'pagamento', p.pagamento, 'pagamento_status', p.pagamento_status,
        'troco_para', p.troco_para, 'observacao', p.observacao, 'agendado_para', p.agendado_para,
        'qtd_itens', (select coalesce(sum((i->>'quantidade')::int), 0) from jsonb_array_elements(p.itens) i),
        'tem_codigo', p.codigo_entrega is not null or (p.api_pedido_id is not null and p.precisa_codigo_app),
        'codigo_do_app', pedido_baixa_manual(p),
        'bloqueado_ate', p.codigo_bloqueado_ate
      ) order by p.criado_em)
      from pedidos p
      where p.entregador_id = e.id and p.tipo = 'entrega' and p.status in ('preparo', 'pronto', 'saiu')
        and p.criado_em > now() - interval '2 days'), '[]'::jsonb),
    'feitos_hoje', (select count(*) from pedidos p where p.entregador_id = e.id and p.status = 'entregue'
                     and p.atualizado_em >= date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')
  );
end $$;

create or replace function entregador_finalizar(p_token text, p_pedido uuid, p_codigo text) returns text
language plpgsql security definer set search_path = public as $$
declare e entregadores%rowtype; p pedidos%rowtype; cod text := regexp_replace(coalesce(p_codigo, ''), '\D', '', 'g');
begin
  select * into e from entregadores where token = p_token and ativo;
  if not found then return 'Link inválido.'; end if;
  select * into p from pedidos where id = p_pedido and entregador_id = e.id for update;
  if not found or p.status not in ('pronto', 'saiu') then return 'Esse pedido não está mais com você.'; end if;
  if p.codigo_bloqueado_ate is not null and p.codigo_bloqueado_ate > now() then
    return 'Muitas tentativas erradas. Espere alguns minutos ou peça para a loja finalizar.';
  end if;
  if p.codigo_entrega is not null then
    if cod <> p.codigo_entrega then
      update pedidos set
        codigo_bloqueado_ate = case when p.codigo_tentativas + 1 >= 5 then now() + interval '10 minutes' else null end,
        codigo_tentativas = case when p.codigo_tentativas + 1 >= 5 then 0 else p.codigo_tentativas + 1 end
      where id = p.id;
      return 'Código errado. Confira com o cliente.';
    end if;
  elsif pedido_baixa_manual(p) then
    -- código do app: guardamos para a loja dar baixa no app deles
    update pedidos set status = 'entregue', codigo_app = nullif(left(cod, 12), ''), codigo_tentativas = 0 where id = p.id;
    return 'ok';
  elsif p.api_pedido_id is not null and p.precisa_codigo_app then
    update pedidos set codigo_app = nullif(left(cod, 12), '') where id = p.id;
    return 'externo'; -- o código é conferido no iFood pela função integracoes
  end if;
  update pedidos set status = 'entregue', entregue_com_codigo = p.codigo_entrega is not null, codigo_tentativas = 0 where id = p.id;
  return 'ok';
end $$;
