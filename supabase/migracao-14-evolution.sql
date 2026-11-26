-- Migração 14: WhatsApp automático pela Evolution API (rodando no PC da loja)
-- zapi_tipo = 'evolution'  ·  zapi_token = chave da Evolution  ·  zapi_instancia = nome da instância
-- evo_url = endereço público do túnel (o PC avisa sozinho quando muda)  ·  evo_visto_em = último aviso do PC
alter table config_privada add column if not exists evo_url text;
alter table config_privada add column if not exists evo_visto_em timestamptz;
