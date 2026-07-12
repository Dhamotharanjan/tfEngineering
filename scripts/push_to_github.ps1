param(
    [string]$RepoUrl = "https://github.com/Dhamotharanjan/tfEngineering.git",
    [string]$Branch = "main",
    [string]$CommitMessage = "Initial import: TF and TG Engineering Knowledge"
)

$ErrorActionPreference = "Stop"

function Assert-Command {
    param([string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command not found: $Name"
    }
}

Assert-Command -Name "git"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $projectRoot

Write-Host "Project root: $projectRoot"

if (-not (Test-Path (Join-Path $projectRoot ".git"))) {
    Write-Host "Initializing git repository..."
    git init
}

$currentRemote = ""
try {
    $currentRemote = (git remote get-url origin) 2>$null
} catch {
    $currentRemote = ""
}

if ([string]::IsNullOrWhiteSpace($currentRemote)) {
    Write-Host "Adding origin remote: $RepoUrl"
    git remote add origin $RepoUrl
} elseif ($currentRemote -ne $RepoUrl) {
    Write-Host "Updating origin remote from '$currentRemote' to '$RepoUrl'"
    git remote set-url origin $RepoUrl
} else {
    Write-Host "Origin remote already set to target repo."
}

Write-Host "Staging files..."
git add .

$hasChanges = $false
try {
    git diff --cached --quiet
    if ($LASTEXITCODE -ne 0) {
        $hasChanges = $true
    }
} catch {
    $hasChanges = $true
}

if ($hasChanges) {
    Write-Host "Creating commit: $CommitMessage"
    git commit -m $CommitMessage
} else {
    Write-Host "No staged changes to commit."
}

Write-Host "Setting branch to $Branch"
git branch -M $Branch

Write-Host "Pushing to origin/$Branch"
git push -u origin $Branch

Write-Host "Upload complete."
