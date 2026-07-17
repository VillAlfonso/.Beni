# Point the Beni tunnel at a hostname. Currently live: beni.revelator.site.
#
# Moving to a NEW domain (e.g. quert.site), after the domain is active on your
# Cloudflare account (Add site + nameserver change at the registrar):
#   powershell -ExecutionPolicy Bypass -File scripts\win\setup-named-tunnel.ps1 -Hostname quert.site -Relogin
# -Relogin opens the browser once so you can pick the new domain's zone; the old
# cert is backed up as cert-backup-*.pem first. Same Cloudflare account required
# (tunnels are account-level).
#
# Writes ONLY %USERPROFILE%\.cloudflared\beni-config.yml — never touches config.yml
# (that file belongs to the Revelator tunnel).
param(
  [Parameter(Mandatory = $true)][string]$Hostname,
  [switch]$Relogin
)

$cf = Resolve-Path (Join-Path $PSScriptRoot "..\..\tools\cloudflared.exe")
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$dir = Join-Path $env:USERPROFILE ".cloudflared"
$cfg = Join-Path $dir "beni-config.yml"
$cert = Join-Path $dir "cert.pem"

if ($Relogin -and (Test-Path $cert)) {
  $bak = Join-Path $dir ("cert-backup-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".pem")
  Move-Item $cert $bak
  Write-Host "Old certificate backed up to $bak"
}
if (-not (Test-Path $cert)) {
  & $cf tunnel login   # browser opens: pick the zone that $Hostname belongs to
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $cert)) {
    Write-Host "Login failed/cancelled."
    $bak = Get-ChildItem $dir -Filter "cert-backup-*.pem" | Sort-Object Name -Descending | Select-Object -First 1
    if ($bak) { Move-Item $bak.FullName $cert; Write-Host "Restored previous certificate." }
    exit 1
  }
}

$tunnels = (& $cf tunnel list --output json) -join "`n" | ConvertFrom-Json
if (-not ($tunnels | Where-Object { $_.name -eq "beni" })) { & $cf tunnel create beni }
$tunnels = (& $cf tunnel list --output json) -join "`n" | ConvertFrom-Json
$id = ($tunnels | Where-Object { $_.name -eq "beni" }).id
if (-not $id) { Write-Host "Could not find beni tunnel id."; exit 1 }

# apex domain (quert.site) → serve www too
$isApex = ($Hostname.Split(".").Count -eq 2)
$hosts = @($Hostname); if ($isApex) { $hosts += "www.$Hostname" }

$rules = ($hosts | ForEach-Object { "  - hostname: $_`n    service: http://localhost:3001" }) -join "`n"
$yml = "tunnel: beni`ncredentials-file: $dir\$id.json`ningress:`n$rules`n  - service: http_status:404`n"
[System.IO.File]::WriteAllText($cfg, $yml)

# --config + raw id so the Revelator config.yml can never hijack the route target
foreach ($h in $hosts) {
  & $cf tunnel --config $cfg route dns --overwrite-dns $id $h
  if ($LASTEXITCODE -ne 0) { Write-Host "DNS route failed for $h — is its domain active on THIS Cloudflare account?"; exit 1 }
}

# bounce the connector so the new ingress takes effect
Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" |
  Where-Object { $_.CommandLine -match "beni-config" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -Confirm:$false }
Start-Process -FilePath (Join-Path $root "start-tunnel.bat") -WorkingDirectory $root

Write-Host ""
Write-Host "Done. https://$Hostname is Beni's home now (allow ~a minute, then check /api/health)."
Write-Host "Phones that installed the PWA on the old URL: open the new URL, log in, reinstall once."
