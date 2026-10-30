#requires -Version 5.1
<#
  Guided first PRIVATE backup of the active INMOJCO Supabase project.
  This script does not copy documents to GitHub or send secrets to ChatGPT.
  Nothing is exported before local preflight passes. Run only on your
  own trusted Windows computer after reviewing the source.
#>
[CmdletBinding()]
param(
  [string]$BackupDir,
  [string]$PgHostName,
  [string]$PgUsername
)

$ErrorActionPreference = 'Stop'
$ProjectId = 'cuitgyqrjibgwuniapmk'
$RepositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path

function Read-PrivateValue([string]$Label) {
  $secured = Read-Host -Prompt $Label -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secured)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

if ([string]::IsNullOrWhiteSpace($BackupDir)) {
  $BackupDir = Read-Host 'Carpeta privada ABSOLUTA para el respaldo (fuera del repositorio)'
}
if ([string]::IsNullOrWhiteSpace($PgHostName)) {
  $PgHostName = Read-Host 'Host de PostgreSQL en Supabase > Connect (Direct o Session pooler)'
}
if ([string]::IsNullOrWhiteSpace($PgUsername)) {
  $PgUsername = Read-Host 'Usuario PostgreSQL del mismo proyecto (p. ej. postgres)'
}

$EnvNames = @('PGHOST','PGUSER','PGDATABASE','PGSSLMODE',
  'SUPABASE_URL','INMOJCO_BACKUP_DIR','PGPASSWORD',
  'SUPABASE_SERVICE_ROLE_KEY','INMOJCO_BACKUP_PASSPHRASE')
Push-Location -LiteralPath $RepositoryRoot
try {
  # Never change or overwrite a file/backup folder chosen by mistake.
  # The preflight checks that it is an existing, writable private folder.
  $env:INMOJCO_BACKUP_DIR = $BackupDir
  $env:PGHOST = $PgHostName.Trim()
  $env:PGUSER = $PgUsername.Trim()
  $env:PGDATABASE = 'postgres'
  $env:PGSSLMODE = 'require'
  $env:SUPABASE_URL = "https://$ProjectId.supabase.co"

  Write-Host 'PASO 1: Verificando destino, espacio libre, identidad del proyecto y clientes PostgreSQL 17.'
  & node (Join-Path $RepositoryRoot 'scripts/inmojco-backup.mjs') preflight
  if ($LASTEXITCODE -ne 0) {
    throw 'No se cumplieron las condiciones locales del respaldo. No se pidieron secretos.'
  }

  Write-Host 'PASO 2: Credenciales PRIVADAS. No las escriba en el chat ni las guarde en el repositorio.'
  $env:PGPASSWORD = Read-PrivateValue 'Contrasena PostgreSQL del proyecto activo'
  $env:SUPABASE_SERVICE_ROLE_KEY = Read-PrivateValue 'Clave secreta/de servicio de Supabase para Storage'
  $firstPassphrase = Read-PrivateValue 'Nueva frase de cifrado (minimo 16 caracteres)'
  $confirmation = Read-PrivateValue 'Confirme la frase de cifrado'
  if ($firstPassphrase.Length -lt 16 -or $firstPassphrase -cne $confirmation) {
    throw 'La frase de cifrado no coincide o tiene menos de 16 caracteres.'
  }
  $env:INMOJCO_BACKUP_PASSPHRASE = $firstPassphrase
  $firstPassphrase = $null
  $confirmation = $null
  if ([string]::IsNullOrWhiteSpace($env:PGPASSWORD) -or
      [string]::IsNullOrWhiteSpace($env:SUPABASE_SERVICE_ROLE_KEY)) {
    throw 'Falta una credencial privada. No se realizo ninguna exportacion.'
  }

  Write-Host 'PASO 3: Exportando y cifrando PostgreSQL y todos los archivos privados de Storage.'
  Write-Host 'No cierre esta consola hasta que la herramienta informe el resultado.'
  & node (Join-Path $RepositoryRoot 'scripts/inmojco-backup.mjs') backup
  if ($LASTEXITCODE -ne 0) {
    throw 'Exportacion NO completada. Revise el mensaje generico sin compartir sus contrasenas.'
  }
  Write-Host 'Respaldo CIFRADO creado y verificado localmente. Conserve su frase en un lugar diferente.'
  Write-Host 'IMPORTANTE: resta comprobar recuperacion real en proyecto aislado.'
}
finally {
  # Private values exist temporarily only as child-process environment vars.
  # Clear all variables set by this helper, including those used by preflight.
  foreach ($name in $EnvNames) {
    [Environment]::SetEnvironmentVariable($name, $null, 'Process')
  }
  Pop-Location
}
