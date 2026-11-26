@echo off
cd /d "%~dp0"
echo Reiniciando o WhatsApp automatico...
docker compose restart
echo Pronto. Em ate 1 minuto o painel mostra o PC online.
pause
