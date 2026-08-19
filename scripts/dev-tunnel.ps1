# Book Sculptor — public HTTPS tunnel + Stripe webhooks for local/dev.
# Preferred over home-LAN binding for phones and Stripe Checkout/webhooks.
#
# One-time:
#   winget install Ngrok.Ngrok
#   winget install Stripe.StripeCli
#   winget install Cloudflare.cloudflared   # optional fallback (no ngrok account)
#   ngrok config add-authtoken <token>      # https://dashboard.ngrok.com/get-started/your-authtoken
#   stripe login
#
# With API :8000 and Next :3000 running:
#   powershell -ExecutionPolicy Bypass -File .\scripts\dev-tunnel.ps1
#   powershell -ExecutionPolicy Bypass -File .\scripts\dev-tunnel.ps1 -Provider cloudflare

param(
  [ValidateSet("ngrok", "cloudflare")]
  [string]$Provider = "ngrok"
)

$ErrorActionPreference = "Stop"

# Refresh PATH for tools installed in this session via winget
$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
  [System.Environment]::GetEnvironmentVariable("Path", "User")

$Root = Split-Path -Parent $PSScriptRoot
$ApiEnv = Join-Path $Root "apps\api\.env"

function Assert-Cmd($name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "Missing '$name'. Install it first (see script header)."
  }
}

Assert-Cmd "stripe"

Write-Host "Stripe listen → http://127.0.0.1:8000/api/v1/billing/webhook" -ForegroundColor Cyan
$stripeOut = Join-Path $env:TEMP "bs-stripe-listen.out"
$stripeErr = Join-Path $env:TEMP "bs-stripe-listen.err"
$stripeProc = Start-Process -FilePath "stripe" -ArgumentList @(
  "listen",
  "--forward-to", "127.0.0.1:8000/api/v1/billing/webhook"
) -PassThru -WindowStyle Minimized -RedirectStandardOutput $stripeOut -RedirectStandardError $stripeErr

Start-Sleep -Seconds 4
$secret = ""
try { $secret = (& stripe listen --print-secret 2>$null | Select-Object -First 1).ToString().Trim() } catch {}
if (-not $secret) {
  $joined = ((Get-Content $stripeErr -ErrorAction SilentlyContinue) + (Get-Content $stripeOut -ErrorAction SilentlyContinue)) -join "`n"
  if ($joined -match "whsec_[A-Za-z0-9]+") { $secret = $Matches[0] }
}

if ($secret -and (Test-Path $ApiEnv)) {
  $text = Get-Content $ApiEnv -Raw
  $text = [regex]::Replace($text, "(?m)^STRIPE_WEBHOOK_SECRET=.*$", "STRIPE_WEBHOOK_SECRET=$secret")
  Set-Content -Path $ApiEnv -Value $text -NoNewline
  Write-Host "Wrote STRIPE_WEBHOOK_SECRET to apps/api/.env — restart the API to load it." -ForegroundColor Green
} else {
  Write-Host "Webhook secret not auto-detected. Run: stripe listen --print-secret" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Next.js must use NEXT_PUBLIC_API_URL=same (proxies /api/v1 to FastAPI)." -ForegroundColor DarkGray
Write-Host "Add the public HTTPS URL to Clerk Allowed origins / Redirect URLs." -ForegroundColor Yellow
Write-Host ""

try {
  if ($Provider -eq "cloudflare") {
    Assert-Cmd "cloudflared"
    Write-Host "cloudflared tunnel → http://127.0.0.1:3000" -ForegroundColor Cyan
    & cloudflared tunnel --url http://127.0.0.1:3000
  } else {
    Assert-Cmd "ngrok"
    Write-Host "ngrok http 3000" -ForegroundColor Cyan
    & ngrok http 3000
  }
} finally {
  if ($stripeProc -and -not $stripeProc.HasExited) {
    Stop-Process -Id $stripeProc.Id -Force -ErrorAction SilentlyContinue
  }
}
