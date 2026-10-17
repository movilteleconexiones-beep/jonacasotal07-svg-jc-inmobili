# INMOJCO / Supabase Free: private local logical backup, never restores or modifies remote data.
# Usage (PowerShell, from repository):
#   .\scripts\backup-inmojco-free.ps1 -Destination 'D:\RespaldosCifrados\INMOJCO' -ConfirmEncryptedDestination
# Requirements: linked Supabase CLI, running Docker, local encrypted/private destination.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidateNotNullOrEmpty()][string]$Destination,
  [switch]$ConfirmEncryptedDestination
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $ConfirmEncryptedDestination) {
  throw 'Confirma que la carpeta de destino esta en un disco cifrado y privado mediante -ConfirmEncryptedDestination.'
}
$project = 'cuitgyqrjibgwuniapmk'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$base = [IO.Path]::GetFullPath($Destination)
$pathComparison = [StringComparison]::OrdinalIgnoreCase
if ($base.StartsWith($repoRoot.TrimEnd('\','/') + [IO.Path]::DirectorySeparatorChar, $pathComparison) -or
    [string]::Equals($base.TrimEnd('\','/'), $repoRoot.TrimEnd('\','/'), $pathComparison)) {
  throw 'No se permite guardar datos de clientes dentro del repositorio de Git.'
}
foreach ($fragment in @('\OneDrive\','\Dropbox\','\Google Drive\','\Downloads\')) {
  if ($base.IndexOf($fragment, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
    throw 'El destino parece ser una carpeta sincronizada o de descargas; utiliza un disco cifrado y privado fuera de la nube.'
  }
}
if (-not (Get-Command supabase -ErrorAction SilentlyContinue)) { throw 'Instala Supabase CLI antes de continuar.' }
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Instala Docker Desktop antes de continuar.' }
$linkedPath = Join-Path $repoRoot 'supabase\.temp\project-ref'
if (-not (Test-Path -LiteralPath $linkedPath -PathType Leaf)) {
  throw "Falta vincular el proyecto: ejecuta supabase link --project-ref $project desde el repositorio."
}
$linked = (Get-Content -LiteralPath $linkedPath -Raw).Trim()
if ($linked -ne $project) { throw 'Proyecto vinculado incorrecto. No se exportara otra base de datos.' }
& docker info --format '{{.ServerVersion}}' 1>$null 2>$null
if ($LASTEXITCODE -ne 0) { throw 'Docker no esta funcionando. Inicia Docker Desktop e intenta nuevamente.' }
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$target = Join-Path $base "backup-inmojco-$stamp"
if (Test-Path -LiteralPath $target) { throw 'La carpeta de respaldo ya existe; no se sobreescribira.' }
New-Item -ItemType Directory -Path $target -Force | Out-Null
try {
  Push-Location $repoRoot
  try {
    $jobs = @(
      @{ Label='roles'; Args=@('--linked','--role-only') },
      @{ Label='schema'; Args=@('--linked') },
      @{ Label='data'; Args=@('--linked','--data-only','--use-copy','--exclude','storage.buckets_vectors','--exclude','storage.vector_indexes') }
    )
    foreach ($job in $jobs) {
      $file = Join-Path $target ($job.Label + '.sql')
      Write-Host ("Exportando " + $job.Label + " de la base vinculada...")
      $argsForDump = [string[]]$job.Args
      & supabase db dump @argsForDump --file $file
      if ($LASTEXITCODE -ne 0) { throw ("Error al exportar " + $job.Label) }
      if (-not (Test-Path -LiteralPath $file) -or (Get-Item -LiteralPath $file).Length -eq 0) {
        throw ("Archivo de respaldo vacio: " + $job.Label)
      }
    }
    $hashes = @('roles.sql','schema.sql','data.sql') | ForEach-Object {
      $filename=$_
      $full=Join-Path $target $filename
      $hash=(Get-FileHash -Algorithm SHA256 -LiteralPath $full).Hash
      "$hash  $filename"
    }
    [IO.File]::WriteAllLines((Join-Path $target 'SHA256SUMS.txt'),[string[]]$hashes)
    Write-Host "Exportacion completada en $target"
    Write-Host 'IMPORTANTE: AUN NO ES UNA COPIA RECUPERABLE VERIFICADA. Falta restaurarla en una base aislada.'
    Write-Host 'IMPORTANTE: Las fotos, PDFs de Storage, secretos y ciertas tablas de Auth requieren copias separadas.'
  } finally { Pop-Location }
} catch {
  Write-Warning 'La exportacion quedo INCOMPLETA; no debe utilizarse como respaldo fiable.'
  throw
}
