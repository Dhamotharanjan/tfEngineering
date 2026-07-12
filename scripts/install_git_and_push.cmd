@echo off
setlocal

cd /d "%~dp0.."
echo Project root: %CD%

where git >nul 2>nul
if errorlevel 1 (
  echo Git not found. Trying winget install...
  winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements --silent
  where git >nul 2>nul
)

where git >nul 2>nul
if errorlevel 1 (
  echo winget path failed. Trying Chocolatey install...
  choco install git -y
  where git >nul 2>nul
)

where git >nul 2>nul
if errorlevel 1 (
  echo ERROR: Git installation failed or git is not on PATH yet.
  echo Restart terminal and run this script again, or install manually from:
  echo https://git-scm.com/download/win
  exit /b 1
)

echo Git detected:
git --version

echo Running repository upload...
call scripts\push_to_github.cmd
exit /b %ERRORLEVEL%
