<#
  Pasang backend sebagai Windows Service (otomatis jalan saat server restart) memakai NSSM.
  Jalankan PowerShell sebagai Administrator:
    powershell -ExecutionPolicy Bypass -File .\install-service.ps1 -AppDir "D:\apps\ipad-asset" -Nssm "C:\tools\nssm\nssm.exe"
#>
param(
  [Parameter(Mandatory = $true)][string]$AppDir,
  [string]$Nssm = "C:\tools\nssm\nssm.exe",
  [string]$ServiceName = "IpadAssetApi",
  [string]$LogDir = "D:\ipad-asset-data\logs"
)
$ErrorActionPreference = "Stop"
$node = (Get-Command node).Source
$backend = Join-Path $AppDir "backend"
if (!(Test-Path (Join-Path $backend ".env"))) { throw "backend\.env belum ada" }
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

& $Nssm install $ServiceName $node "src\server.js"
& $Nssm set $ServiceName AppDirectory $backend
& $Nssm set $ServiceName DisplayName "iPad Asset Management API"
& $Nssm set $ServiceName Start SERVICE_AUTO_START
& $Nssm set $ServiceName AppStdout (Join-Path $LogDir "api.log")
& $Nssm set $ServiceName AppStderr (Join-Path $LogDir "api-error.log")
& $Nssm set $ServiceName AppRotateFiles 1
& $Nssm set $ServiceName AppRotateBytes 10485760
& $Nssm set $ServiceName AppExit Default Restart
& $Nssm set $ServiceName AppRestartDelay 5000
# Jalankan sebagai akun virtual dengan hak minimal (bukan LocalSystem)
& $Nssm set $ServiceName ObjectName "NT SERVICE\$ServiceName"

# Hak akses folder: service hanya boleh baca kode, tulis di folder data
icacls $AppDir /grant "NT SERVICE\${ServiceName}:(OI)(CI)RX" | Out-Null
icacls (Split-Path $LogDir) /grant "NT SERVICE\${ServiceName}:(OI)(CI)M" | Out-Null
# .env hanya bisa dibaca Administrators + service
icacls (Join-Path $backend ".env") /inheritance:r /grant:r "Administrators:F" "NT SERVICE\${ServiceName}:R" | Out-Null

Start-Service $ServiceName
Get-Service $ServiceName
Write-Host "Cek: http://127.0.0.1:4000/healthz"
