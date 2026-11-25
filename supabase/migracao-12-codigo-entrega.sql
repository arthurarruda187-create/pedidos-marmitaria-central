-- Migração 12: código de entrega + link do entregador
-- O cliente vê um código de 4 números no acompanhamento; o entregador digita no link dele para finalizar.

alter table pedidos add column if not exists codigo_entrega text;
alter table pedidos add column if not exists codigo_tentativas int not null default 0;
alter table pedidos add column if not exists codigo_bloqueado_ate timestamptz;
alter table pedidos add column if not exists entregue_com_codigo boolean not null default false;
alter table pedidos add column if not exists api_pedido_id text;      -- id do pedido no app (iFood, 99Food, Keeta)
alter table pedidos add column if not exists entrega_pelo_app boolean not null default false; -- quem entrega é o app
alter table pedidos add column if not exists precisa_codigo_app boolean not null default false; -- app pediu o código do cliente
create unique index if not exists pedidos_api_unico on pedidos (canal, api_pedido_id) where api_pedido_id is not null;

-- gera o código nos pedidos de entrega do cardápio / balcão
create or replace function gerar_codigo_entrega() returns trigger language plpgsql as $$
begin
  if new.tipo = 'entrega' and new.codigo_entrega is null and new.canal in ('cardapio', 'balcao') then
    new.codigo_entrega := lpad(floor(random() * 10000)::int::text, 4, '0');
  end if;
  return new;
end $$;
drop trigger if exists pedidos_codigo_entrega on pedidos;
create trigger pedidos_codigo_entrega before insert on pedidos for each row execute function gerar_codigo_entrega();

-- link do entregador
alter table entregadores add column if not exists token text;
update entregadores set token = encode(gen_random_bytes(12), 'hex') where token is null;
alter table entregadores alter column token set default encode(gen_random_bytes(12), 'hex');
create unique index if not exists entregadores_token on entregadores (token);

-- o que o entregador vê no link (só os pedidos dele)
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
        'bloqueado_ate', p.codigo_bloqueado_ate
      ) order by p.criado_em)
      from pedidos p
      where p.entregador_id = e.id and p.tipo = 'entrega' and p.status in ('preparo', 'pronto', 'saiu')
        and p.criado_em > now() - interval '2 days'), '[]'::jsonb),
    'feitos_hoje', (select count(*) from pedidos p where p.entregador_id = e.id and p.status = 'entregue'
                     and p.atualizado_em >= date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')
  );
end $$;

-- entregador avisa que saiu
create or replace function entregador_saiu(p_token text, p_pedido uuid) returns text
language plpgsql security definer set search_path = public as $$
declare e entregadores%rowtype;
begin
  select * into e from entregadores where token = p_token and ativo;
  if not found then return 'Link inválido.'; end if;
  update pedidos set status = 'saiu' where id = p_pedido and entregador_id = e.id and status in ('preparo', 'pronto');
  if not found then return 'Esse pedido não está mais com você.'; end if;
  return 'ok';
end $$;

-- entregador finaliza com o código do cliente. Devolve 'ok', 'externo' (validar no app) ou a mensagem de erro.
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
  elsif p.api_pedido_id is not null and p.precisa_codigo_app then
    return 'externo'; -- o código é conferido no app (iFood/99Food/Keeta) pela função integracoes
  end if;
  update pedidos set status = 'entregue', entregue_com_codigo = p.codigo_entrega is not null, codigo_tentativas = 0 where id = p.id;
  return 'ok';
end $$;

grant execute on function entregador_dados(text) to anon, authenticated;
grant execute on function entregador_saiu(text, uuid) to anon, authenticated;
grant execute on function entregador_finalizar(text, uuid, text) to anon, authenticated;

-- acompanhamento do cliente: mostra o código quando o pedido está pronto / saiu
drop function if exists status_pedido(uuid);
create function status_pedido(p_id uuid)
returns table (
  numero int, status text, pagamento text, pagamento_status text,
  total numeric, tipo text, criado_em timestamptz,
  pix_copia_cola text, pix_qr_base64 text, checkout_url text, itens jsonb,
  cliente_nome text, cliente_telefone text, endereco text, taxa_entrega numeric, subtotal numeric,
  observacao text, troco_para numeric, desconto numeric, cupom_codigo text, bairro text,
  mesa text, avaliado boolean, nota int, agendado_para timestamptz, empresa text, codigo_entrega text
)
language sql stable security definer set search_path = public as $$
  select p.numero, p.status, p.pagamento, p.pagamento_status, p.total, p.tipo, p.criado_em,
         p.pix_copia_cola, p.pix_qr_base64, p.checkout_url, p.itens,
         p.cliente_nome, p.cliente_telefone, p.endereco, p.taxa_entrega, p.subtotal, p.observacao, p.troco_para,
         p.desconto, p.cupom_codigo, p.bairro, p.mesa, a.id is not null, a.nota, p.agendado_para, p.empresa,
         case when p.status in ('preparo', 'pronto', 'saiu') then p.codigo_entrega end
  from pedidos p left join avaliacoes a on a.pedido_id = p.id
  where p.id = p_id;
$$;
grant execute on function status_pedido(uuid) to anon, authenticated;
grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;
