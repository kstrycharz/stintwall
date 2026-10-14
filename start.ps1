$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules'))) {
    npm ci
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
}
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'dist/index.html'))) {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Application build failed.' }
}
$appUrl = 'http://localhost:8091'
try {
    $appHealth = Invoke-RestMethod "$appUrl/api/health" -TimeoutSec 2
} catch { $appHealth = $null }
if ($appHealth.application -ne 'endurance-manager') {
    $appPython = (Get-Command python -ErrorAction Stop).Source
    Start-Process -FilePath $appPython -ArgumentList @('server.py', '--port', '8091') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $PSScriptRoot 'data/server.log') -RedirectStandardError (Join-Path $PSScriptRoot 'data/server-error.log')
    for ($appAttempt = 0; $appAttempt -lt 20; $appAttempt++) {
        Start-Sleep -Milliseconds 250
        try {
            $appHealth = Invoke-RestMethod "$appUrl/api/health" -TimeoutSec 1
            if ($appHealth.application -eq 'endurance-manager') { break }
        } catch { }
    }
    if ($appHealth.application -ne 'endurance-manager') { throw 'The local app did not start. See data/server-error.log.' }
}
Start-Process $appUrl
Write-Host 'Stintwall is running locally at http://localhost:8091.'
