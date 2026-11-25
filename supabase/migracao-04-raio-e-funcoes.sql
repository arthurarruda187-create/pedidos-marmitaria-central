-- Migração 04: taxa por raio (faixas de km), bairros de Apucarana com distância,
-- "peça também", avaliação do pedido e pedido na mesa (QR Code).
-- Pode rodar mais de uma vez sem problema.

-- ===== Entrega por bairro ou por raio =====
alter table loja add column if not exists modo_taxa text not null default 'bairro';
alter table loja drop constraint if exists loja_modo_taxa_check;
alter table loja add constraint loja_modo_taxa_check check (modo_taxa in ('bairro','raio'));
alter table loja add column if not exists endereco_origem text not null default 'Rua Padre Severino Ceruti, 520, Apucarana - PR';
alter table loja add column if not exists lat double precision;
alter table loja add column if not exists lng double precision;
-- faixas: [{"ate": km, "taxa": reais}] em ordem crescente; acima da última = fora da área
alter table loja add column if not exists faixas_km jsonb not null default
  '[{"ate":2,"taxa":5},{"ate":4,"taxa":7},{"ate":6,"taxa":9},{"ate":8,"taxa":12},{"ate":12,"taxa":15}]';

-- taxa do bairro vazia = usa a faixa de km
alter table bairros alter column taxa drop not null;
alter table bairros alter column taxa drop default;
alter table bairros add column if not exists distancia_km numeric(6,2);
alter table bairros add column if not exists lat double precision;
alter table bairros add column if not exists lng double precision;
create unique index if not exists bairros_nome_unico on bairros (lower(nome));

-- ===== Peça também =====
alter table produtos add column if not exists sugerir boolean not null default false;

-- ===== Pedido na mesa =====
alter table loja add column if not exists aceita_mesa boolean not null default false;
alter table loja add column if not exists qtd_mesas int not null default 10 check (qtd_mesas between 1 and 200);
alter table pedidos add column if not exists mesa text;
alter table pedidos drop constraint if exists pedidos_tipo_check;
alter table pedidos add constraint pedidos_tipo_check check (tipo in ('entrega','retirada','mesa'));
alter table pedidos drop constraint if exists pedidos_canal_check;
alter table pedidos add constraint pedidos_canal_check
  check (canal in ('cardapio','balcao','mesa','ifood','aiqfome','keeta','99food'));

-- ===== Avaliação do pedido =====
create table if not exists avaliacoes (
  id         uuid primary key default gen_random_uuid(),
  pedido_id  uuid not null unique references pedidos(id) on delete cascade,
  nota       int not null check (nota between 1 and 5),
  comentario text,
  criado_em  timestamptz not null default now()
);
alter table avaliacoes enable row level security;
drop policy if exists "admin le avaliacoes" on avaliacoes;
create policy "admin le avaliacoes" on avaliacoes for select using (is_admin());
drop policy if exists "admin apaga avaliacoes" on avaliacoes;
create policy "admin apaga avaliacoes" on avaliacoes for delete using (is_admin());
grant select, delete on avaliacoes to authenticated;

-- o cliente avalia pelo link do pedido (só depois de entregue/retirado, uma vez só)
create or replace function avaliar_pedido(p_id uuid, p_nota int, p_comentario text)
returns text language plpgsql security definer set search_path = public as $$
declare st text;
begin
  select status into st from pedidos where id = p_id;
  if st is null then return 'Pedido não encontrado.'; end if;
  if st <> 'entregue' then return 'Você pode avaliar depois que receber o pedido.'; end if;
  if p_nota is null or p_nota < 1 or p_nota > 5 then return 'Escolha de 1 a 5 estrelas.'; end if;
  insert into avaliacoes (pedido_id, nota, comentario)
    values (p_id, p_nota, nullif(left(trim(coalesce(p_comentario, '')), 500), ''))
    on conflict (pedido_id) do nothing;
  if not found then return 'Este pedido já foi avaliado. Obrigado!'; end if;
  return 'ok';
end $$;
grant execute on function avaliar_pedido(uuid, int, text) to anon, authenticated;

-- acompanhamento do pedido: inclui mesa e se já foi avaliado
drop function if exists status_pedido(uuid);
create function status_pedido(p_id uuid)
returns table (
  numero int, status text, pagamento text, pagamento_status text,
  total numeric, tipo text, criado_em timestamptz,
  pix_copia_cola text, pix_qr_base64 text, checkout_url text, itens jsonb,
  cliente_nome text, cliente_telefone text, endereco text, taxa_entrega numeric, subtotal numeric,
  observacao text, troco_para numeric, desconto numeric, cupom_codigo text, bairro text,
  mesa text, avaliado boolean, nota int
)
language sql stable security definer set search_path = public as $$
  select p.numero, p.status, p.pagamento, p.pagamento_status, p.total, p.tipo, p.criado_em,
         p.pix_copia_cola, p.pix_qr_base64, p.checkout_url, p.itens,
         p.cliente_nome, p.cliente_telefone, p.endereco, p.taxa_entrega, p.subtotal, p.observacao, p.troco_para,
         p.desconto, p.cupom_codigo, p.bairro, p.mesa, a.id is not null, a.nota
  from pedidos p left join avaliacoes a on a.pedido_id = p.id
  where p.id = p_id;
$$;
grant execute on function status_pedido(uuid) to anon, authenticated;

-- realtime para o painel ver avaliações novas
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'avaliacoes') then
    execute 'alter publication supabase_realtime add table avaliacoes';
  end if;
end $$;
