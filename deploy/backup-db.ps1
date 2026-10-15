<#
  Backup harian PostgreSQL + folder upload. Jadwalkan via Task Scheduler (mis. tiap 23:00).
  File backup TERENKRIPSI di level credential (AES), tapi tetap simpan di lokasi terbatas.
  PENTING: backup tidak berguna tanpa DATA_KEYS – simpan kunci terpisah dari backup.
#>
param(
  [string]$PgBin = "C:\Program Files\PostgreSQL\16\bin",
  [string]$Db = "ipad_asset",
  [string]$User = "ipad_owner",
  [string]$Out = "D:\ipad-asset-data\backup",
  [string]$Uploads = "D:\ipad-asset-data\uploads",
  [int]$KeepDays = 30
)
$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$stamp = Get-Date -Format "yyyyMMdd_HHmm"
# password diambil dari %APPDATA%\postgresql\pgpass.conf milik akun yang menjalankan task
& (Join-Path $PgBin "pg_dump.exe") -U $User -h localhost -F c -f (Join-Path $Out "ipad_$stamp.dump") $Db
Compress-Archive -Path $Uploads -DestinationPath (Join-Path $Out "uploads_$stamp.zip") -Force
Get-ChildItem $Out | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$KeepDays) } | Remove-Item -Force
Write-Host "Backup selesai: $Out"
