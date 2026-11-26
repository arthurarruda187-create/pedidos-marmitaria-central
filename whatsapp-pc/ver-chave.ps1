Set-Location -LiteralPath $PSScriptRoot
if (-not (Test-Path ".env")) { Write-Host "Ainda não instalado. Rode o INSTALAR.bat."; Read-Host "Enter para fechar"; exit }
$chave = ((Get-Content ".env" | Where-Object { $_ -like "CHAVE=*" }) -replace "^CHAVE=", "").Trim()
try { Set-Clipboard -Value $chave } catch {}
Write-Host ""; Write-Host "  Chave da Evolution (já copiada):"; Write-Host ""; Write-Host "     $chave" -ForegroundColor Cyan; Write-Host ""
Write-Host "  Situação dos serviços:"; docker compose ps --format "table {{.Service}}\t{{.Status}}"
Write-Host ""; Write-Host "  Últimos avisos ao painel:"; docker compose logs --tail 5 avisar
Read-Host "`n  Aperte Enter para fechar"
