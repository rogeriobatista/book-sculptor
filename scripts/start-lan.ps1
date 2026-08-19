# Start Book Sculptor for home LAN access (Windows).
# Usage (from repo root):
#   powershell -ExecutionPolicy Bypass -File .\scripts\start-lan.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot

function Get-LanIPv4 {
  $candidates = @(
    Get-NetIPAddress -AddressFamily IPv4 |
      Where-Object {
        $_.IPAddress -notlike "127.*" -and
        $_.IPAddress -notlike "169.254.*" -and
        $_.InterfaceAlias -notmatch "WSL|Hyper-V|vEthernet|Loopback|Docker|Virtual"
      } |
      Sort-Object -Property @{ Expression = "PrefixLength"; Descending = $true } |
      Select-Object -ExpandProperty IPAddress -Unique
  )
  if (-not $candidates -or $candidates.Count -eq 0) {
    throw "Could not detect a LAN IPv4 address. Set LAN_HOST manually."
  }
  return [string]$candidates[0]
}

$LanHost = Get-LanIPv4
Write-Host "LAN host: $LanHost" -ForegroundColor Cyan
Write-Host "Web:  http://${LanHost}:3000" -ForegroundColor Green
Write-Host "API:  http://${LanHost}:8000" -ForegroundColor Green
Write-Host ""
Write-Host "Clerk: add http://${LanHost}:3000 to Allowed origins / Redirect URLs in the Clerk dashboard." -ForegroundColor Yellow

# Firewall (best-effort; may need admin)
foreach ($port in @(3000, 8000)) {
  $rule = "BookSculptor-LAN-$port"
  $exists = Get-NetFirewallRule -DisplayName $rule -ErrorAction SilentlyContinue
  if (-not $exists) {
    try {
      New-NetFirewallRule -DisplayName $rule -Direction Inbound -Protocol TCP -LocalPort $port -Action Allow -Profile Private |
        Out-Null
      Write-Host "Firewall rule added for port $port (Private)." -ForegroundColor DarkGreen
    } catch {
      Write-Host "Could not add firewall rule for $port (run PowerShell as Admin if devices cannot connect)." -ForegroundColor DarkYellow
    }
  }
}

# Patch API .env LAN fields (keep other secrets intact)
$ApiEnv = Join-Path $Root "apps\api\.env"
if (Test-Path $ApiEnv) {
  $text = Get-Content $ApiEnv -Raw
  if ($text -match "(?m)^LAN_HOST=") {
    $text = [regex]::Replace($text, "(?m)^LAN_HOST=.*$", "LAN_HOST=$LanHost")
  } else {
    $text += "`nLAN_HOST=$LanHost`n"
  }
  if ($text -match "(?m)^API_ALLOW_LAN=") {
    $text = [regex]::Replace($text, "(?m)^API_ALLOW_LAN=.*$", "API_ALLOW_LAN=true")
  } else {
    $text += "API_ALLOW_LAN=true`n"
  }
  if ($text -notmatch [regex]::Escape("http://$LanHost`:3000")) {
    $text = [regex]::Replace(
      $text,
      "(?m)^API_CORS_ORIGINS=(.*)$",
      { param($m) "$($m.Groups[0].Value -replace '\r','')"; },
      1
    )
    # Safer: rewrite CORS line explicitly
    $text = [regex]::Replace(
      $text,
      "(?m)^API_CORS_ORIGINS=.*$",
      "API_CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000,http://${LanHost}:3000"
    )
  }
  $text = [regex]::Replace($text, "(?m)^STRIPE_SUCCESS_URL=.*$", "STRIPE_SUCCESS_URL=http://${LanHost}:3000/en/pricing?success=1")
  $text = [regex]::Replace($text, "(?m)^STRIPE_CANCEL_URL=.*$", "STRIPE_CANCEL_URL=http://${LanHost}:3000/en/pricing?canceled=1")
  Set-Content -Path $ApiEnv -Value $text -NoNewline
}

# Patch web .env.local API URL (NEXT_PUBLIC_* must be set before next starts)
$WebEnv = Join-Path $Root "apps\web\.env.local"
if (Test-Path $WebEnv) {
  $webText = Get-Content $WebEnv -Raw
  if ($webText -match "(?m)^NEXT_PUBLIC_API_URL=") {
    $webText = [regex]::Replace($webText, "(?m)^NEXT_PUBLIC_API_URL=.*$", "NEXT_PUBLIC_API_URL=http://${LanHost}:8000")
  } else {
    $webText = "NEXT_PUBLIC_API_URL=http://${LanHost}:8000`n" + $webText
  }
  Set-Content -Path $WebEnv -Value $webText -NoNewline
}

# Free ports if already bound
foreach ($port in @(8000, 3000)) {
  Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object {
      try { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } catch {}
    }
}
Start-Sleep -Seconds 1

$ApiDir = Join-Path $Root "apps\api"
$WebDir = Join-Path $Root "apps\web"
$Uvicorn = Join-Path $ApiDir ".venv\Scripts\uvicorn.exe"

if (-not (Test-Path $Uvicorn)) {
  throw "API venv missing. Create it first: cd apps/api; python -m venv .venv; .\.venv\Scripts\pip install -r requirements.txt"
}

Start-Process -FilePath "powershell" -ArgumentList @(
  "-NoExit",
  "-Command",
  "Set-Location '$ApiDir'; & '$Uvicorn' app.main:app --host 0.0.0.0 --port 8000"
) | Out-Null

Start-Process -FilePath "powershell" -ArgumentList @(
  "-NoExit",
  "-Command",
  "Set-Location '$WebDir'; npm run dev -- -H 0.0.0.0 -p 3000"
) | Out-Null

Write-Host ""
Write-Host "Started API and Web in new windows." -ForegroundColor Cyan
Write-Host "On phones/tablets in your Wi-Fi, open: http://${LanHost}:3000" -ForegroundColor Green
