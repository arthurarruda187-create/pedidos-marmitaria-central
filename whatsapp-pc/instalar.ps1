# Instala/liga o WhatsApp automático da Marmitaria Central neste PC.
$ErrorActionPreference = "Continue"
Set-Location -LiteralPath $PSScriptRoot
$Host.UI.RawUI.WindowTitle = "WhatsApp automatico - Marmitaria Central"
Write-Host ""
Write-Host "  WhatsApp automático — Marmitaria Central" -ForegroundColor Green
Write-Host "  ----------------------------------------"
Write-Host ""

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Host "  O Docker Desktop não está instalado." -ForegroundColor Yellow
  Write-Host "  Vou abrir a página de download. Instale, reinicie o PC se ele pedir e rode o INSTALAR.bat de novo."
  Start-Process "https://www.docker.com/products/docker-desktop/"
  Read-Host "  Aperte Enter para fechar"; exit 1
}

docker info *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host "  Abrindo o Docker Desktop (pode levar 1 a 2 minutos)..."
  $exe = Join-Path $Env:ProgramFiles "Docker\Docker\Docker Desktop.exe"
  if (Test-Path $exe) { Start-Process $exe }
  for ($i = 0; $i -lt 60; $i++) { Start-Sleep -Seconds 5; docker info *> $null; if ($LASTEXITCODE -eq 0) { break } }
  if ($LASTEXITCODE -ne 0) {
    Write-Host "  O Docker não ligou. Abra o Docker Desktop, espere aparecer 'Engine running' e rode de novo." -ForegroundColor Red
    Read-Host "  Aperte Enter para fechar"; exit 1
  }
}

function NovoSegredo([int]$n) {
  $b = New-Object byte[] $n
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  ($b | ForEach-Object { $_.ToString("x2") }) -join ""
}

if (-not (Test-Path ".env")) {
  $conteudo = "CHAVE=$(NovoSegredo 24)`nSENHA_BANCO=$(NovoSegredo 16)`n"
  [System.IO.File]::WriteAllText((Join-Path $PSScriptRoot ".env"), $conteudo, (New-Object System.Text.UTF8Encoding $false))
  Write-Host "  Chave nova criada." -ForegroundColor Green
}

Write-Host "  Baixando e ligando (na primeira vez demora uns minutos)..."
docker compose up -d
if ($LASTEXITCODE -ne 0) {
  Write-Host "  Deu erro ao ligar. Tire um print desta janela e mande para o suporte." -ForegroundColor Red
  Read-Host "  Aperte Enter para fechar"; exit 1
}

$chave = ((Get-Content ".env" | Where-Object { $_ -like "CHAVE=*" }) -replace "^CHAVE=", "").Trim()
try { Set-Clipboard -Value $chave } catch {}

Write-Host ""
Write-Host "  Pronto! Tudo ligado." -ForegroundColor Green
Write-Host ""
Write-Host "  CHAVE DA EVOLUTION (já copiada — é só colar no painel):"
Write-Host ""
Write-Host "     $chave" -ForegroundColor Cyan
Write-Host ""
Write-Host "  No painel: WhatsApp automático -> Evolution -> cole a chave -> Salvar conexão."
Write-Host "  Depois clique em 'Conectar WhatsApp' e leia o QR Code com o celular da loja."
Write-Host ""
Write-Host "  IMPORTANTE: no Docker Desktop, em Settings -> General, deixe marcado"
Write-Host "  'Start Docker Desktop when you sign in to your computer'." -ForegroundColor Yellow
Write-Host ""
Start-Process "https://arthurarruda187-create.github.io/pedidos-marmitaria-central/painel.html#whatsapp"
Read-Host "  Aperte Enter para fechar"
