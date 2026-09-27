# Esedre Autonomous Ticketing & Project Planning Engine Wrapper (PowerShell)
$ErrorActionPreference = "Stop"

# Ensure UTF-8 console output and pipeline encoding on Windows
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    [Console]::InputEncoding  = [System.Text.Encoding]::UTF8
    $OutputEncoding = [System.Text.Encoding]::UTF8
} catch {}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

$inRepoEsedre = Join-Path $scriptDir "..\dist\esedre.mjs"
if (Test-Path $inRepoEsedre) {
    & node $inRepoEsedre @args
    exit $LASTEXITCODE
}
$siblingEsedre = Join-Path $scriptDir "..\..\esedre\dist\esedre.mjs"
if (Test-Path $siblingEsedre) {
    & node $siblingEsedre @args
    exit $LASTEXITCODE
}
$distEsedre = Join-Path $scriptDir "..\esedre\dist\esedre.mjs"
if (Test-Path $distEsedre) {
    & node $distEsedre @args
    exit $LASTEXITCODE
}
$nodeModulesEsedre = Join-Path $scriptDir "..\node_modules\esedre\dist\esedre.mjs"
if (Test-Path $nodeModulesEsedre) {
    & node $nodeModulesEsedre @args
    exit $LASTEXITCODE
}
$localBin = Join-Path $scriptDir "..\node_modules\.bin\ese.cmd"
if (Test-Path $localBin) {
    & $localBin @args
    exit $LASTEXITCODE
}
$localEsedreBin = Join-Path $scriptDir "..\node_modules\.bin\esedre.cmd"
if (Test-Path $localEsedreBin) {
    & $localEsedreBin @args
    exit $LASTEXITCODE
}
if (Get-Command "ese" -ErrorAction SilentlyContinue) {
    & ese @args
    exit $LASTEXITCODE
}
if (Get-Command "esedre" -ErrorAction SilentlyContinue) {
    & esedre @args
    exit $LASTEXITCODE
}
& npx --yes esedre @args
exit $LASTEXITCODE
