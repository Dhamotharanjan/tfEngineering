# Run HCL parser unit tests inside the worker Go test image (no local Go install).
$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $Root

Write-Host "Running parser unit tests in Docker (worker-parse-test)..." -ForegroundColor Cyan
docker compose --profile test run --rm --build worker-parse-test
$testExit = $LASTEXITCODE

if ($testExit -eq 0) {
    Write-Host "PASS: All parser unit tests passed." -ForegroundColor Green
} else {
    Write-Host "FAIL: Parser unit tests failed (exit $testExit)." -ForegroundColor Red
}
exit $testExit
