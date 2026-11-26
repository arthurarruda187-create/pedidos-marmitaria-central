# Backup do sistema da Marmitaria

**Quando:** todo domingo às 03:17, automático (GitHub Actions → "Backup semanal").
**O que vai:** todas as tabelas do banco (cardápio, pedidos, clientes, cupons, entregadores, configurações) e as fotos do cardápio.
**Onde fica:** GitHub → repositório → aba **Actions** → **Backup semanal** → clique numa execução → **Artifacts**. Cada backup fica 90 dias.
**Segurança:** o arquivo é criptografado com a `BACKUP_SENHA`. Sem essa senha ninguém abre — nem você. Guarde-a num lugar seguro.

## Fazer um backup agora
Actions → Backup semanal → **Run workflow**.

## Abrir um backup (no PC com Git Bash, WSL ou Linux)
```bash
gpg --decrypt backup-marmitaria-AAAA-MM-DD.tar.gz.gpg > backup.tar.gz   # pede a BACKUP_SENHA
tar xzf backup.tar.gz
```
Dentro de `backup/`:
- `banco.dump` — cópia completa do banco (estrutura + dados), para restaurar com `pg_restore`
- `dados.sql` — só os dados, em SQL legível
- `fotos/` — as fotos do cardápio

## Restaurar num projeto Supabase novo
1. Rode no SQL Editor do projeto novo os arquivos `supabase/schema.sql` e as migrações em ordem (01 a 14).
2. Restaure os dados:
   ```bash
   pg_restore --data-only --no-owner --disable-triggers -d "STRING_DE_CONEXAO_DO_PROJETO_NOVO" backup/banco.dump
   ```
3. Envie a pasta `fotos/` para o bucket `fotos` (Storage) mantendo os nomes.
4. Troque `SUPABASE_URL` e a chave em `site/config.js`, publique as funções e refaça os segredos.
