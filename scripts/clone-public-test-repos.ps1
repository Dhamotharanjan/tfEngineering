# Shallow-clone public Terraform/Terragrunt test repos into mvp_demo/public_repos/
# Usage: .\scripts\clone-public-test-repos.ps1 [-Ids public-gruntwork-live,public-tfm-vpc] [-Force]

param(
    [string[]]$Ids = @(),
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
$ConfigPath = Join-Path $Root "config\public-test-repos.json"
$CloneRoot = Join-Path $Root "mvp_demo\public_repos"

if (-not (Test-Path $ConfigPath)) {
    Write-Error "Config not found: $ConfigPath"
}

$config = Get-Content $ConfigPath -Raw | ConvertFrom-Json
$repos = $config.repos

if ($Ids.Count -gt 0) {
    $repos = $repos | Where-Object { $Ids -contains $_.id }
}

if (-not (Test-Path $CloneRoot)) {
    New-Item -ItemType Directory -Path $CloneRoot -Force | Out-Null
}

$failed = @()
$skipped = @()
$cloned = @()

foreach ($repo in $repos) {
    $dest = Join-Path $Root ($repo.local_path_after_clone -replace '/', '\')
    $branch = $repo.default_branch
    $url = $repo.clone_url

    if ((Test-Path $dest) -and -not $Force) {
        Write-Host "[skip] $($repo.id) already exists at $dest (use -Force to re-clone)" -ForegroundColor Yellow
        $skipped += $repo.id
        continue
    }

    if ((Test-Path $dest) -and $Force) {
        Write-Host "[clean] Removing existing $($repo.id)..." -ForegroundColor DarkYellow
        Remove-Item -Recurse -Force $dest
    }

    Write-Host "[clone] $($repo.id) ($branch) -> $dest" -ForegroundColor Cyan
    try {
        git clone --depth 1 --branch $branch $url $dest 2>&1 | Out-Host
        if ($LASTEXITCODE -ne 0) { throw "git clone exited with code $LASTEXITCODE" }
        $cloned += $repo.id
    }
    catch {
        Write-Host "[fail] $($repo.id): $_" -ForegroundColor Red
        $failed += $repo.id
    }
}

Write-Host ""
Write-Host "Summary: cloned=$($cloned.Count) skipped=$($skipped.Count) failed=$($failed.Count)"
if ($failed.Count -gt 0) {
    Write-Host "Failed repos: $($failed -join ', ')" -ForegroundColor Red
    Write-Host "See mvp_demo/public_repos/README.md for manual clone commands."
    exit 1
}

Write-Host "Done. Set subscribed=true in config/repo-subscriptions.json for cloned repos." -ForegroundColor Green
