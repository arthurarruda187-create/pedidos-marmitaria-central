@echo off
cd /d "%~dp0"
echo Desligando o WhatsApp automatico (a conexao do WhatsApp fica salva)...
docker compose stop
pause
