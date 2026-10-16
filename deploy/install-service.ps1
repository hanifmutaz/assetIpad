<#
  Pasang backend sebagai Windows Service (NSSM). Jalankan PowerShell sebagai Administrator SETELAH `npm run build` di backend & frontend:
    powershell -ExecutionPolicy Bypass -File .\install-service.ps1 -AppDir "D:\apps\ipad-asset" -Nssm "C:\tools\nssm\nssm.exe"
#>
param([Parameter(Mandatory = $true)][string]$AppDir, [string]$Nssm = "C:\tools\nssm\nssm.exe", [string]$ServiceName = "IpadAssetApi", [string]$DataDir = "D:\ipad-asset-data")
$ErrorActionPreference = "Stop"
$node = (Get-Command node).Source
$backend = Join-Path $AppDir "backend"
if (!(Test-Path (Join-Path $backend ".env"))) { throw "backend\.env belum ada" }
if (!(Test-Path (Join-Path $backend "dist\src\server.js"))) { throw "Belum di-build: jalankan 'npm run build' di folder backend" }
$logs = Join-Path $DataDir "logs"
New-Item -ItemType Directory -Force -Path $logs, (Join-Path $DataDir "uploads") | Out-Null
& $Nssm install $ServiceName $node "dist\src\server.js"
& $Nssm set $ServiceName AppDirectory $backend
& $Nssm set $ServiceName DisplayName "iPad Asset Management API"
& $Nssm set $ServiceName Start SERVICE_AUTO_START
& $Nssm set $ServiceName AppStdout (Join-Path $logs "api.log")
& $Nssm set $ServiceName AppStderr (Join-Path $logs "api-error.log")
& $Nssm set $ServiceName AppRotateFiles 1
& $Nssm set $ServiceName AppRotateBytes 10485760
& $Nssm set $ServiceName AppExit Default Restart
& $Nssm set $ServiceName ObjectName "NT SERVICE\$ServiceName"
icacls $AppDir /grant "NT SERVICE\${ServiceName}:(OI)(CI)RX" | Out-Null
icacls $DataDir /grant "NT SERVICE\${ServiceName}:(OI)(CI)M" | Out-Null
icacls (Join-Path $backend ".env") /inheritance:r /grant:r "Administrators:F" "NT SERVICE\${ServiceName}:R" | Out-Null
Start-Service $ServiceName
Get-Service $ServiceName
Write-Host "Cek: http://127.0.0.1:4000/healthz"
