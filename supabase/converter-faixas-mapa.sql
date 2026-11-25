-- Ativa o modo "Raio no mapa" e converte as faixas de km de carro para linha reta,
-- usando a proporção real medida nos bairros (km de carro ÷ km em linha reta, mediana).
with dist as (
  select b.distancia_km::float / nullif(6371 * 2 * asin(sqrt(
           sin(radians(b.lat - l.lat) / 2) ^ 2 + cos(radians(l.lat)) * cos(radians(b.lat)) * sin(radians(b.lng - l.lng) / 2) ^ 2)), 0) as fator
  from bairros b, loja l
  where l.id = 1 and b.ativo and b.lat is not null and b.distancia_km is not null and b.distancia_km > 0
), r as (select percentile_cont(0.5) within group (order by fator) as k, count(*) as n from dist where fator between 1 and 3)
update loja set modo_taxa = 'mapa', faixas_km = (
  select jsonb_agg(jsonb_build_object('ate', greatest(0.5, round(((f->>'ate')::numeric / r.k::numeric) * 2) / 2)::float, 'taxa', (f->>'taxa')::float) order by (f->>'ate')::numeric)
  from jsonb_array_elements(loja.faixas_km) f)
from r
where loja.id = 1 and r.k is not null
returning (select round(k::numeric, 2) from r) as fator_carro_linha_reta, (select n from r) as bairros_medidos, modo_taxa, faixas_km;
