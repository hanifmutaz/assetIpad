<# Backup harian (Task Scheduler). Password ipad_owner di %APPDATA%\postgresql\pgpass.conf akun penjalan task. #>
param([string]$PgBin = "C:\Program Files\PostgreSQL\16\bin", [string]$Port = "5433", [string]$Out = "D:\ipad-asset-data\backup", [string]$Uploads = "D:\ipad-asset-data\uploads", [int]$KeepDays = 30)
$ErrorActionPreference = "Stop"
if ($KeepDays -lt 1) { throw "KeepDays harus minimal 1." }
if (!(Test-Path -LiteralPath $Uploads -PathType Container)) { throw "Folder upload tidak ditemukan: $Uploads" }

New-Item -ItemType Directory -Force -Path $Out | Out-Null
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$staging = Join-Path $Out (".pending-" + [Guid]::NewGuid())
$target = Join-Path $Out "ipad_$stamp"
New-Item -ItemType Directory -Path $staging | Out-Null
try {
    $dump = Join-Path $staging "database.dump"
    & (Join-Path $PgBin "pg_dump.exe") -U ipad_owner -h localhost -p $Port -F c -f $dump ipad_asset
    if ($LASTEXITCODE -ne 0 -or !(Test-Path -LiteralPath $dump) -or (Get-Item -LiteralPath $dump).Length -eq 0) {
        throw "pg_dump gagal (exit $LASTEXITCODE)."
    }
    & (Join-Path $PgBin "pg_restore.exe") --list $dump | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Katalog backup tidak dapat dibaca (exit $LASTEXITCODE)." }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::CreateFromDirectory($Uploads, (Join-Path $staging "uploads.zip"))
    if (Test-Path -LiteralPath $target) { throw "Tujuan backup sudah ada: $target" }
    Rename-Item -LiteralPath $staging -NewName "ipad_$stamp"
} finally {
    if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
}

Get-ChildItem -LiteralPath $Out -Directory | Where-Object {
    $_.Name -match '^ipad_\d{8}_\d{6}$' -and
    $_.LastWriteTime -lt (Get-Date).AddDays(-$KeepDays) -and
    (Test-Path -LiteralPath (Join-Path $_.FullName "database.dump")) -and
    (Test-Path -LiteralPath (Join-Path $_.FullName "uploads.zip"))
} | Remove-Item -Recurse -Force
