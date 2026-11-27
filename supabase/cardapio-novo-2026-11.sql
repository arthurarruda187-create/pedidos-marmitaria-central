-- Cardápio da Marmitaria Central atualizado pelas fotos de 26/11/2026
-- (marmitas fixas, cardápio do dia, fitness, turbine, bebidas). Roda uma vez só.
begin;

do $$ begin
  if exists (select 1 from categorias where nome = 'Fitness (250 g)') then
    raise exception 'Este cardápio já foi aplicado.';
  end if;
end $$;

-- Ajudantes (somem no fim da sessão)
create or replace function pg_temp.prod(p_nome text) returns uuid language sql as $$
  select id from produtos where nome = p_nome order by ordem limit 1 $$;

-- Tamanho: recria as 3 opções com os preços da foto
create or replace function pg_temp.tam(p uuid, a numeric, b numeric, c numeric, n1 text default 'Pequena', n2 text default 'Média', n3 text default 'Grande')
returns void language plpgsql as $$
declare g uuid;
begin
  if p is null then raise exception 'produto não encontrado'; end if;
  select id into g from grupos_adicionais where produto_id = p and nome = 'Tamanho' limit 1;
  if g is null then insert into grupos_adicionais (produto_id, nome, minimo, maximo, ordem) values (p, 'Tamanho', 1, 1, 0) returning id into g; end if;
  delete from opcoes_adicionais where grupo_id = g;
  insert into opcoes_adicionais (grupo_id, nome, preco, ordem) values (g, n1, a, 0), (g, n2, b, 1), (g, n3, c, 2);
end $$;

-- Copia os grupos de adicionais de um produto modelo (só os nomes pedidos, ou todos)
create or replace function pg_temp.clonar(de uuid, para uuid, so text[] default null)
returns void language plpgsql as $$
declare g record; ng uuid;
begin
  for g in select * from grupos_adicionais where produto_id = de and (so is null or nome = any(so)) order by ordem loop
    insert into grupos_adicionais (produto_id, nome, minimo, maximo, ordem) values (para, g.nome, g.minimo, g.maximo, g.ordem) returning id into ng;
    insert into opcoes_adicionais (grupo_id, nome, preco, esgotado, ordem)
      select ng, nome, preco, esgotado, ordem from opcoes_adicionais where grupo_id = g.id;
  end loop;
end $$;

-- Grupo de tamanhos para bebidas: lista de (nome, preço)
create or replace function pg_temp.tamanhos(p uuid, nomes text[], precos numeric[])
returns void language plpgsql as $$
declare g uuid;
begin
  if p is null then raise exception 'produto não encontrado'; end if;
  delete from grupos_adicionais where produto_id = p;
  insert into grupos_adicionais (produto_id, nome, minimo, maximo, ordem) values (p, 'Tamanho', 1, 1, 0) returning id into g;
  insert into opcoes_adicionais (grupo_id, nome, preco, ordem)
    select g, nomes[i], precos[i], i - 1 from generate_subscripts(nomes, 1) i;
end $$;

-- ---------------------------------------------------------------- Turbine (a cada 100 g)
update opcoes_adicionais o set nome = 'Arroz (100g)', preco = 5 from grupos_adicionais g
  where o.grupo_id = g.id and g.nome = 'Turbine a sua marmita' and o.nome = 'Arroz';
update opcoes_adicionais o set nome = 'Purê de Batata (100g)' from grupos_adicionais g
  where o.grupo_id = g.id and g.nome = 'Turbine a sua marmita' and o.nome = 'Purê de Batata';
update opcoes_adicionais o set nome = 'Refogado (100g)' from grupos_adicionais g
  where o.grupo_id = g.id and g.nome = 'Turbine a sua marmita' and o.nome = 'Refogado';
insert into opcoes_adicionais (grupo_id, nome, preco, ordem)
  select g.id, 'Feijão (100g)', 5, coalesce((select max(ordem) from opcoes_adicionais where grupo_id = g.id), 0) + 1
  from grupos_adicionais g where g.nome = 'Turbine a sua marmita'
    and not exists (select 1 from opcoes_adicionais where grupo_id = g.id and nome ilike 'Feij%');

-- ---------------------------------------------------------------- Marmitas de todos os dias
update categorias set nome = 'Marmitas de todos os dias', ordem = 1 where nome = 'Marmitas - De Todos os Dias';
update produtos set descricao = 'Arroz, Feijão, Frango Empanado, Ovo Frito, Purê de Batata, Refogado, Salada.' where nome = 'Marmita Chicken';
update produtos set nome = 'Marmita Parmegiana de Frango', descricao = 'Arroz, Feijão, Parmegiana de Frango, Macarrão ao Molho Sugo, Batata Souté, Refogado, Salada.' where nome = 'Marmita Parmegiana de Frango';
update produtos set descricao = 'Arroz, Feijão, Bife Acebolado, Ovo Frito, Batata Souté, Refogado, Salada.' where nome = 'Marmita Brasileira';
update produtos set descricao = 'Arroz, Feijão, Strogonoff de Frango, Purê de Batata, Batata Souté, Refogado, Salada.' where nome = 'Marmita Strogonoff de Frango';
update produtos set nome = 'Marmita Vegetariana', descricao = 'Arroz, Feijão, Macarrão, Purê de Batata, Ovo Frito, Batata Frita, Refogado, Salada.' where nome = 'Marmita Vegetariano';
update produtos set descricao = 'Arroz, Feijão, Parmegiana de Boi, Macarrão ao Molho Sugo, Batata Frita, Refogado, Salada.' where nome = 'Marmita Parmegiana de Boi';
update produtos set descricao = 'Arroz, Feijão, Strogonoff de Boi, Purê de Batata, Batata Souté, Refogado, Salada.' where nome = 'Marmita Strogonoff de Boi';
select pg_temp.tam(pg_temp.prod('Marmita Parmegiana de Frango'), 24, 26, 32);
select pg_temp.tam(pg_temp.prod('Marmita Brasileira'), 25, 27, 33);
select pg_temp.tam(pg_temp.prod('Marmita Strogonoff de Frango'), 24, 26, 32);
select pg_temp.tam(pg_temp.prod('Marmita Chicken'), 24, 26, 32);
select pg_temp.tam(pg_temp.prod('Marmita Vegetariana'), 21, 23, 29);
select pg_temp.tam(pg_temp.prod('Marmita Parmegiana de Boi'), 28, 30, 36);
select pg_temp.tam(pg_temp.prod('Marmita Strogonoff de Boi'), 25, 27, 33);
update produtos set ordem = 0 where nome = 'Marmita Parmegiana de Frango';
update produtos set ordem = 1 where nome = 'Marmita Brasileira';
update produtos set ordem = 2 where nome = 'Marmita Strogonoff de Frango';
update produtos set ordem = 3 where nome = 'Marmita Chicken';
update produtos set ordem = 4 where nome = 'Marmita Vegetariana';
update produtos set ordem = 5 where nome = 'Marmita Parmegiana de Boi';
update produtos set ordem = 6 where nome = 'Marmita Strogonoff de Boi';

-- Novidade: Frango a Passarinho (econômica)
update produtos set nome = 'Marmita Frango a Passarinho (econômica)', preco = 0, ordem = 7, destaque = true, ativo = true,
  descricao = 'Novidade! Arroz, Feijão, Macarrão ao Molho Sugo, Frango a Passarinho, Ovo Frito e Farofa.'
  where nome = 'Marmita de Frango a passarinho (economico)';
delete from grupos_adicionais where produto_id = pg_temp.prod('Marmita Frango a Passarinho (econômica)');
select pg_temp.clonar(pg_temp.prod('Marmita Chicken'), pg_temp.prod('Marmita Frango a Passarinho (econômica)'));
select pg_temp.tam(pg_temp.prod('Marmita Frango a Passarinho (econômica)'), 18, 20, 26, 'Mini', 'Média', 'Grande');

-- ---------------------------------------------------------------- Cardápio do dia (0 = domingo … 6 = sábado)
update categorias set nome = 'Cardápio do dia', ordem = 0, ativa = true where nome = 'Cardapio dias vareados';
do $$
declare cat uuid; modelo uuid := pg_temp.prod('Marmita Chicken'); r record; novo uuid;
begin
  select id into cat from categorias where nome = 'Cardápio do dia';
  for r in select * from (values
    (0, 'Marmita de Carne Moída',     'Segunda-feira: Arroz, Feijão, Carne Moída, Porco, Ovo Frito, Refogado, Salada.', 1, 25, 27, 33),
    (1, 'Marmita de Frango Grelhado', 'Terça-feira: Arroz, Feijão, Frango Grelhado, Porco, Ovo Frito, Refogado, Salada.', 2, 24, 26, 32),
    (2, 'Marmita de Carne de Panela', 'Quarta-feira: Arroz, Feijão, Carne de Panela, Porco, Farofa, Ovo Frito, Refogado, Salada.', 3, 25, 27, 33),
    (3, 'Marmita de Frango Xadrez',   'Quinta-feira: Arroz, Feijão, Porquinho Alho e Óleo, Frango Xadrez, Ovo Frito, Refogado, Salada.', 4, 24, 26, 32),
    (4, 'Marmita de Almôndega',       'Sexta-feira: Arroz, Feijão, Almôndegas, Porco, Macarrão ao Molho Sugo, Batata Souté, Refogado, Salada.', 5, 25, 27, 33),
    (5, 'Marmita de Feijoada',        'Sábado: Arroz, Feijoada, Porco no Tacho, Farofa, Banana Frita, Couve, Vinagrete.', 6, 25, 27, 33)
  ) v(ordem, nome, descricao, dia, a, b, c) loop
    insert into produtos (categoria_id, nome, descricao, preco, ordem, dias_semana)
      values (cat, r.nome, r.descricao, 0, r.ordem, array[r.dia]) returning id into novo;
    perform pg_temp.clonar(modelo, novo);
    perform pg_temp.tam(novo, r.a, r.b, r.c);
  end loop;
  -- Marmita só de feijoada (apenas no sábado)
  insert into produtos (categoria_id, nome, descricao, preco, ordem, dias_semana)
    values (cat, 'Marmita só de Feijoada', 'Marmita só com feijoada. Apenas aos sábados.', 0, 6, array[6]) returning id into novo;
  perform pg_temp.clonar(modelo, novo, array['Precisa que envie garfinho?']);
  perform pg_temp.tam(novo, 27, 30, 35, 'Mini', 'Média', 'Grande');
end $$;

-- ---------------------------------------------------------------- Fitness (250 g)
insert into categorias (nome, ordem) values ('Fitness (250 g)', 2);
do $$
declare cat uuid; modelo uuid := pg_temp.prod('Marmita Chicken'); r record; novo uuid; g uuid;
begin
  select id into cat from categorias where nome = 'Fitness (250 g)';
  for r in select * from (values
    (0, 'Fitness Carne Moída',     'Arroz (branco ou integral), Feijão, Carne Moída, Refogado, Salada.', 1),
    (1, 'Fitness Frango Grelhado', 'Arroz (branco ou integral), Feijão, Frango Grelhado, Refogado, Salada.', 2),
    (2, 'Fitness Carne de Panela', 'Arroz (branco ou integral), Feijão, Carne de Panela, Refogado, Salada.', 3),
    (3, 'Fitness Frango Xadrez',   'Arroz (branco ou integral), Feijão, Frango Xadrez, Refogado, Salada.', 4),
    (4, 'Fitness Almôndega',       'Arroz (branco ou integral), Feijão, Almôndegas, Refogado, Salada.', 5),
    (5, 'Fitness Feijoada',        'Arroz (branco ou integral), Feijão, Porco no Tacho, Couve, Vinagrete.', 6)
  ) v(ordem, nome, descricao, dia) loop
    insert into produtos (categoria_id, nome, descricao, preco, ordem, dias_semana)
      values (cat, r.nome, r.descricao || ' 250 g. Fazemos pacotes mensais (desconto nas marmitas e na taxa de entrega) e peso personalizado: chame no WhatsApp.', 20, r.ordem, array[r.dia])
      returning id into novo;
    insert into grupos_adicionais (produto_id, nome, minimo, maximo, ordem) values (novo, 'Arroz', 1, 1, 0) returning id into g;
    insert into opcoes_adicionais (grupo_id, nome, preco, ordem) values (g, 'Arroz branco', 0, 0), (g, 'Arroz integral', 0, 1);
    perform pg_temp.clonar(modelo, novo, array['Precisa que envie garfinho?']);
  end loop;
end $$;

-- ---------------------------------------------------------------- Individuais (a cada 100 g)
update categorias set nome = 'Turbine: porções (a cada 100 g)', ordem = 3 where nome = 'Individuais (a cada 100g)';
update produtos set nome = 'Macarrão (300 g)', preco = 12 where nome = 'Macarrão' and categoria_id = (select id from categorias where nome = 'Turbine: porções (a cada 100 g)');
update produtos set preco = 5 where nome = 'Arroz' and categoria_id = (select id from categorias where nome = 'Turbine: porções (a cada 100 g)');
insert into produtos (categoria_id, nome, preco, ordem)
  select id, 'Feijão', 5, 10 from categorias where nome = 'Turbine: porções (a cada 100 g)'
  and not exists (select 1 from produtos p where p.categoria_id = categorias.id and p.nome = 'Feijão');
update produtos set ordem = 11 where nome = 'Ovo 1 Unidade';
update produtos set ordem = 12 where nome = 'Pacote de Salada';
update produtos set ordem = 13 where nome = 'Macarrão (300 g)';

-- ---------------------------------------------------------------- Bebidas (um item por bebida, com o tamanho)
update categorias set ordem = 4 where nome = 'Bebidas';
update produtos set nome = 'Coca-Cola', descricao = '', preco = 0, ordem = 0 where nome = 'Coca-Cola Original 2l';
update produtos set nome = 'Coca-Cola Zero', descricao = '', preco = 0, ordem = 1 where nome = 'Refrigerante Coca Cola Zero Açúcar 2 Litros';
update produtos set nome = 'Guaraná Antarctica', descricao = '', preco = 0, ordem = 2 where nome = 'Refrigerante Guaraná Antárctica 2 L';
update produtos set nome = 'Guaraná Antarctica Zero', descricao = '', preco = 0, ordem = 3 where nome = 'Refr Guarana Antarctica Zero 2l';
update produtos set nome = 'Fanta Uva', descricao = '', preco = 0, ordem = 4 where nome = 'Fanta Uva 2l';
update produtos set nome = 'Fanta Laranja', descricao = '', preco = 0, ordem = 5 where nome = 'Refrigerante de Laranja Fanta 2l';
update produtos set nome = 'Sprite', descricao = '', preco = 0, ordem = 6 where nome = 'Sprite Original 2l';
update produtos set nome = 'Suco Tampico', descricao = 'Frutas cítricas.', preco = 0, ordem = 8 where nome = 'Suco de Frutas Citricas Tampico 2 Litros';
select pg_temp.tamanhos(pg_temp.prod('Coca-Cola'),      array['200 ml','Lata 350 ml','600 ml','1 litro','2 litros'], array[4,6,8,10,16]);
select pg_temp.tamanhos(pg_temp.prod('Coca-Cola Zero'), array['Lata 350 ml','600 ml','1 litro','2 litros'], array[6,8,10,16]);
select pg_temp.tamanhos(pg_temp.prod(n), array['200 ml','Lata 350 ml','600 ml','1 litro','2 litros'], array[4,6,8,10,15])
  from unnest(array['Guaraná Antarctica','Guaraná Antarctica Zero','Fanta Uva','Fanta Laranja','Sprite']) n;
select pg_temp.tamanhos(pg_temp.prod('Suco Tampico'), array['450 ml','2 litros'], array[8,15]);
-- os itens antigos de um tamanho só ficam desativados (dá para reativar no painel)
update produtos set ativo = false where categoria_id = (select id from categorias where nome = 'Bebidas') and nome in (
  'Refrigerante Coca Cola Lata', 'Refrigerante Guaraná Antarctica 350ml', 'Coca-Cola Original 200 Ml', 'Coca-Cola Original 600ml',
  'Coca Cola Zero Lata 350ml', 'Fanta Uva 350ml', 'Suco Tampico Frutas Cítricas 450 Ml', 'Fanta Laranja 350ml',
  'Refrigerante Sprite 350ml Lata Original', 'Tampico 2 litros', 'Tampico 450 ml');
do $$
declare cat uuid; novo uuid;
begin
  select id into cat from categorias where nome = 'Bebidas';
  insert into produtos (categoria_id, nome, preco, ordem) values (cat, 'Sunap', 0, 7) returning id into novo;
  perform pg_temp.tamanhos(novo, array['330 ml','900 ml'], array[8,15]);
  insert into produtos (categoria_id, nome, preco, ordem) values (cat, 'Água sem gás', 5, 9), (cat, 'Água com gás', 5, 10), (cat, 'Água Tônica', 6, 11);
end $$;

-- conferência
select c.ordem, c.nome as categoria, count(p.*) filter (where p.ativo) as itens_ativos
from categorias c left join produtos p on p.categoria_id = c.id group by c.id order by c.ordem;

commit;
