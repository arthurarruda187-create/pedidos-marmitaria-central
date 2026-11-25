-- Migração 11: cardápio do dia, pedido agendado, pedido para empresas e avaliação no Google

-- Cardápio do dia: dias da semana em que o produto aparece (0 = domingo … 6 = sábado). Vazio = todos os dias.
alter table produtos add column if not exists dias_semana int[];

-- Pedido agendado
alter table loja add column if not exists aceita_agendamento boolean not null default false;
alter table loja add column if not exists agendar_dias int not null default 2 check (agendar_dias between 0 and 14);
alter table pedidos add column if not exists agendado_para timestamptz;
create index if not exists pedidos_agendado on pedidos (agendado_para) where agendado_para is not null;

-- Pedido para empresas
alter table pedidos add column if not exists empresa text;

-- Avaliação no Google
alter table loja add column if not exists link_avaliacao_google text;

-- A loja funciona nesse momento pelos horários cadastrados? (não olha o botão aberta/fechada)
create or replace function loja_funciona_em(p_quando timestamptz) returns boolean
language sql stable security definer set search_path = public as $$
  with a as (select (p_quando at time zone 'America/Sao_Paulo') as t)
  select case
    when not exists (select 1 from horarios) then true
    else exists (
      select 1 from horarios h, a
      where (h.abre < h.fecha and extract(dow from a.t) = h.dia_semana
               and a.t::time >= h.abre and a.t::time < h.fecha)
         or (h.abre >= h.fecha and (
               (extract(dow from a.t) = h.dia_semana and a.t::time >= h.abre)
            or (extract(dow from a.t) = (h.dia_semana + 1) % 7 and a.t::time < h.fecha)))
    )
  end from a;
$$;
grant execute on function loja_funciona_em(timestamptz) to anon, authenticated, service_role;

-- acompanhamento: inclui o horário agendado
drop function if exists status_pedido(uuid);
create function status_pedido(p_id uuid)
returns table (
  numero int, status text, pagamento text, pagamento_status text,
  total numeric, tipo text, criado_em timestamptz,
  pix_copia_cola text, pix_qr_base64 text, checkout_url text, itens jsonb,
  cliente_nome text, cliente_telefone text, endereco text, taxa_entrega numeric, subtotal numeric,
  observacao text, troco_para numeric, desconto numeric, cupom_codigo text, bairro text,
  mesa text, avaliado boolean, nota int, agendado_para timestamptz, empresa text
)
language sql stable security definer set search_path = public as $$
  select p.numero, p.status, p.pagamento, p.pagamento_status, p.total, p.tipo, p.criado_em,
         p.pix_copia_cola, p.pix_qr_base64, p.checkout_url, p.itens,
         p.cliente_nome, p.cliente_telefone, p.endereco, p.taxa_entrega, p.subtotal, p.observacao, p.troco_para,
         p.desconto, p.cupom_codigo, p.bairro, p.mesa, a.id is not null, a.nota, p.agendado_para, p.empresa
  from pedidos p left join avaliacoes a on a.pedido_id = p.id
  where p.id = p_id;
$$;
grant execute on function status_pedido(uuid) to anon, authenticated;
