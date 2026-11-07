#requires -Version 5.1
# INMOJCO #104: verify existing Nov-01 PG17 RESTORE, no data extraction or SQL writes.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Ledger = Join-Path $Root 'docs\ops\snapshots\supabase-migration-ledger-2026-11-02.json'
$Psql = 'C:\PostgreSQL-INMOJCO-TEST\bin\psql.exe'
$Db = 'inmojco_restore_test_3'
$HostName = '127.0.0.1'
$Port = '5433'
$ReportFolder = Join-Path $env:USERPROFILE 'INMOJCO-RESPALDOS'
$Report = Join-Path $ReportFolder 'RESULTADO-104-CATALOGO-LOCAL.json'
if (!(Test-Path -LiteralPath $Psql -PathType Leaf)) { throw 'PostgreSQL local no encontrado.' }
if (!(Test-Path -LiteralPath $Ledger -PathType Leaf)) { throw 'Manifiesto de versiones no encontrado.' }
if (!(Test-Path -LiteralPath $ReportFolder -PathType Container)) { throw 'Falta carpeta de respaldos existente.' }
foreach ($name in @('PGHOSTADDR','PGSERVICE','PGSERVICEFILE')) {
    if ([Environment]::GetEnvironmentVariable($name,'Process')) { throw ('Redireccion no permitida: ' + $name) }
}
$expected = @((Get-Content -LiteralPath $Ledger -Raw -Encoding UTF8 | ConvertFrom-Json).migrations)
if ($expected.Count -ne 99) { throw 'Manifiesto original cambiado. NO-GO.' }

function Invoke-LocalSelect([string]$Sql) {
    $arguments = @('-X','-A','-t','-q','-w','-v','ON_ERROR_STOP=1','-h',$HostName,'-p',$Port,
        '-U','postgres','-d',$Db,'-c',$Sql)
    $rows = @(& $Psql @arguments 2>$null)
    if ($LASTEXITCODE -ne 0) { throw 'Consulta local fallida. No se modifica ninguna tabla.' }
    return @($rows | Where-Object { $_ -and $_.Trim().Length -gt 0 })
}
$oldPass = [Environment]::GetEnvironmentVariable('PGPASSWORD','Process')
$oldOpts = [Environment]::GetEnvironmentVariable('PGOPTIONS','Process')
$secure = Read-Host -AsSecureString 'Contrasena PostgreSQL LOCAL (no Supabase)'
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
$env:PGOPTIONS = '-c default_transaction_read_only=on -c statement_timeout=15000'
try {
    $identity = @(Invoke-LocalSelect "SELECT current_database() || '|' || coalesce(inet_server_addr()::text,'') || '|' || inet_server_port()::text || '|' || current_setting('server_version_num') || '|' || current_setting('transaction_read_only')")
    if ($identity.Count -ne 1) { throw 'Identidad local inesperada.' }
    $parts = $identity[0].Split('|')
    if ($parts.Count -ne 5 -or $parts[0] -cne $Db -or $parts[1] -cne $HostName -or
        $parts[2] -cne $Port -or [int]$parts[3] -lt 170000 -or
        [int]$parts[3] -ge 180000 -or $parts[4] -cne 'on') {
        throw 'NO-GO: destino diferente de la restauracion local PG17.'
    }
    $actual = @(Invoke-LocalSelect "SELECT version || '|' || name FROM supabase_migrations.schema_migrations ORDER BY version")
    $expectedRows = @($expected | ForEach-Object { $_.version + '|' + $_.name })
    $identical = $actual.Count -eq $expectedRows.Count
    if ($identical) {
        for ($i=0; $i -lt $expectedRows.Count; $i++) {
            if ($actual[$i] -cne $expectedRows[$i]) { $identical=$false; break }
        }
    }
    $statsSql = @'
SELECT (SELECT count(*) FROM auth.users)::text || '|' ||
 (SELECT count(*) FROM storage.objects)::text || '|' ||
 (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='auth' AND c.relkind IN ('r','p'))::text || '|' ||
 (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='storage' AND c.relkind IN ('r','p'))::text || '|' ||
 (SELECT count(*) FROM pg_constraint WHERE contype='f' AND NOT convalidated)::text
'@
    $stats = @(Invoke-LocalSelect $statsSql)
    if ($stats.Count -ne 1) { throw 'No se pudieron leer los contadores de catalogo.' }
    $numbers = $stats[0].Split('|')
    if ($numbers.Count -ne 5) { throw 'Contadores inesperados.' }
    $reportObject = [ordered]@{
        issue=104; mode='READ_ONLY_EXISTING_PG17_RESTORE'; reviewedUtc=[DateTime]::UtcNow.ToString('o')
        database='127.0.0.1:5433/inmojco_restore_test_3'
        postgresMajor=17; ledgerCount=$actual.Count; ledgerExact99=$identical
        authUsers=[int]$numbers[0]; storageObjectsMetadata=[int]$numbers[1]
        authTables=[int]$numbers[2]; storageTables=[int]$numbers[3]
        invalidForeignKeys=[int]$numbers[4]
        sqlWritesPerformed=$false; productionMigrationAuthorized=$false
        authAndStorageApiE2EVerified=$false
    }
    $reportObject | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $Report -Encoding UTF8
    Write-Host ('INFORME SIN DATOS PERSONALES: ' + $Report)
    Write-Host ($reportObject | ConvertTo-Json -Compress)
} finally {
    if ($null -eq $oldPass) { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
    else { $env:PGPASSWORD=$oldPass }
    if ($null -eq $oldOpts) { Remove-Item Env:PGOPTIONS -ErrorAction SilentlyContinue }
    else { $env:PGOPTIONS=$oldOpts }
}
