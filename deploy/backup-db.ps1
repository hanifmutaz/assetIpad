<# Backup harian (Task Scheduler). Password ipad_owner di %APPDATA%\postgresql\pgpass.conf akun penjalan task. #>
param([string]$PgBin = "C:\Program Files\PostgreSQL\16\bin", [string]$Port = "5433", [string]$Out = "D:\ipad-asset-data\backup", [string]$Uploads = "D:\ipad-asset-data\uploads", [int]$KeepDays = 30)
$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$stamp = Get-Date -Format "yyyyMMdd_HHmm"
& (Join-Path $PgBin "pg_dump.exe") -U ipad_owner -h localhost -p $Port -F c -f (Join-Path $Out "ipad_$stamp.dump") ipad_asset
if (Test-Path $Uploads) { Compress-Archive -Path $Uploads -DestinationPath (Join-Path $Out "uploads_$stamp.zip") -Force }
Get-ChildItem $Out | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$KeepDays) } | Remove-Item -Force
