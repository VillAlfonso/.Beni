# Point the Beni tunnel at a (new) hostname. Already done once: beni.revelator.site.
# Use this only if you later want a different domain/subdomain:
#   powershell -ExecutionPolicy Bypass -File scripts\win\setup-named-tunnel.ps1 -Hostname beni.newdomain.com
# Writes ONLY %USERPROFILE%\.cloudflared\beni-config.yml — never touches config.yml
# (that file belongs to the Revelator tunnel).
param([Parameter(Mandatory = $true)][string]$Hostname)

$cf = Resolve-Path (Join-Path $PSScriptRoot "..\..\tools\cloudflared.exe")
$dir = Join-Path $env:USERPROFILE ".cloudflared"
$cfg = Join-Path $dir "beni-config.yml"

if (-not (Test-Path (Join-Path $dir "cert.pem"))) {
  # one-time browser login; needed only if the new domain is on a different Cloudflare account
  & $cf tunnel login
  if ($LASTEXITCODE -ne 0) { Write-Host "Login failed/cancelled."; exit 1 }
}

$tunnels = (& $cf tunnel list --output json) -join "`n" | ConvertFrom-Json
if (-not ($tunnels | Where-Object { $_.name -eq "beni" })) { & $cf tunnel create beni }
$tunnels = (& $cf tunnel list --output json) -join "`n" | ConvertFrom-Json
$id = ($tunnels | Where-Object { $_.name -eq "beni" }).id
if (-not $id) { Write-Host "Could not find beni tunnel id."; exit 1 }

$yml = "tunnel: beni`ncredentials-file: $dir\$id.json`ningress:`n  - hostname: $Hostname`n    service: http://localhost:3001`n  - service: http_status:404`n"
[System.IO.File]::WriteAllText($cfg, $yml)

# --config + raw id so the Revelator config.yml can never hijack the route target
& $cf tunnel --config $cfg route dns --overwrite-dns $id $Hostname
if ($LASTEXITCODE -ne 0) { Write-Host "DNS route failed — is $Hostname's domain on your Cloudflare account?"; exit 1 }

Write-Host ""
Write-Host "Done. https://$Hostname is yours. start-tunnel.bat serves it from now on."
