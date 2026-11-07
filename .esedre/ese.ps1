# Ese CLI short alias wrapper for Esedre (PowerShell)
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    [Console]::InputEncoding  = [System.Text.Encoding]::UTF8
    $OutputEncoding = [System.Text.Encoding]::UTF8
} catch {}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if ($env:ESEDRE_BUNDLE_PATH -and (Test-Path $env:ESEDRE_BUNDLE_PATH)) {
    & node $env:ESEDRE_BUNDLE_PATH @args
    exit $LASTEXITCODE
}
& (Join-Path $scriptDir "esedre.ps1") @args
exit $LASTEXITCODE
