# Finance #96 — Windows launcher for the isolated Supabase restoration clone.
# Run from PowerShell 7: pwsh -NoProfile -File .\scripts\qa\finance96-windows.ps1
# Never accept production URLs or save API keys in files.
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$clone = 'https://zjgstfgiirgjssnihaam.supabase.co'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$probe = Join-Path $root 'tests\finance-real-auth-96.test.mjs'
$membership = Join-Path $root 'scripts\qa\finance96-membership.mjs'
$runner = Join-Path $root 'scripts\qa\finance96-run-auth.mjs'
$keyPtr = [IntPtr]::Zero
$exitCode = $null

try {
    if (-not (Test-Path -LiteralPath $probe) -or
        -not (Test-Path -LiteralPath $membership) -or
        -not (Test-Path -LiteralPath $runner)) {
        throw 'QA96: faltan archivos del repositorio. Ejecute git pull --ff-only origin main.'
    }
    if (-not (Select-String -LiteralPath $probe -Pattern 'VALID_REVIEW_NOTE' -Quiet)) {
        throw 'QA96: falta la correccion de revision. Ejecute git pull --ff-only origin main.'
    }
    if ($env:JCO_QA96_SUPABASE_URL -and
        $env:JCO_QA96_SUPABASE_URL -ne $clone) {
        throw 'QA96: proyecto inesperado. No se permiten URLs de produccion.'
    }
    $null = Get-Command node -ErrorAction Stop

    $publishable = (Read-Host 'Pegue Publishable key default SOLO del clon').Trim()
    if (-not $publishable.StartsWith('sb_publishable_', [StringComparison]::Ordinal)) {
        throw 'QA96: Publishable key ausente o con formato inesperado.'
    }
    $secret = Read-Host 'Pegue Secret key qa96_certificacion SOLO del clon' -AsSecureString
    $keyPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPtr)
    if (-not $plain.StartsWith('sb_secret_', [StringComparison]::Ordinal)) {
        throw 'QA96: Secret key con formato inesperado. No se ejecutaron las pruebas.'
    }

    $env:JCO_QA96_PUBLISHABLE_KEY = $publishable
    $env:JCO_QA96_SECRET_KEY = $plain
    $env:JCO_QA96_SUPABASE_URL = $clone
    $env:JCO_QA96_PROVISION = '1'
    $env:JCO_QA96_AUTO_FIXTURES = '1'

    Push-Location $root
    try {
        & node $runner
        $exitCode = $LASTEXITCODE
    }
    finally {
        Pop-Location
    }
}
finally {
    foreach ($name in @(
        'JCO_QA96_SECRET_KEY',
        'JCO_QA96_PUBLISHABLE_KEY',
        'JCO_QA96_SUPABASE_URL',
        'JCO_QA96_PROVISION',
        'JCO_QA96_AUTO_FIXTURES'
    )) {
        Remove-Item "Env:$name" -ErrorAction SilentlyContinue
    }
    if ($keyPtr -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPtr)
    }
    Remove-Variable secret, plain, publishable, keyPtr -ErrorAction SilentlyContinue
}
if ($null -ne $exitCode) {
    Write-Host "RESULTADO QA96: $exitCode"
    if ($exitCode -ne 0) {
        throw 'QA96: certificacion no aprobada. Revise el error; no repita hasta corregir.'
    }
}
