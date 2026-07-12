@echo off
setlocal

set REPO_URL=https://github.com/Dhamotharanjan/tfEngineering.git
set BRANCH=main
set COMMIT_MESSAGE=Upload TF and TG Engineering Knowledge

cd /d "%~dp0.."

echo Project root: %CD%

where git >nul 2>nul
if errorlevel 1 (
  echo ERROR: git is not installed or not on PATH.
  exit /b 1
)

if not exist ".git" (
  echo Initializing git repository...
  git init
  if errorlevel 1 exit /b 1
)

git remote get-url origin >nul 2>nul
if errorlevel 1 (
  echo Adding origin remote: %REPO_URL%
  git remote add origin %REPO_URL%
  if errorlevel 1 exit /b 1
) else (
  for /f "delims=" %%i in ('git remote get-url origin') do set CURRENT_REMOTE=%%i
  if /I not "%CURRENT_REMOTE%"=="%REPO_URL%" (
    echo Updating origin remote from %CURRENT_REMOTE% to %REPO_URL%
    git remote set-url origin %REPO_URL%
    if errorlevel 1 exit /b 1
  )
)

echo Staging files...
git add .
if errorlevel 1 exit /b 1

git diff --cached --quiet
if errorlevel 1 (
  echo Creating commit...
  git commit -m "%COMMIT_MESSAGE%"
  if errorlevel 1 exit /b 1
) else (
  echo No staged changes to commit.
)

echo Setting branch to %BRANCH%
git branch -M %BRANCH%
if errorlevel 1 exit /b 1

echo Pushing to origin/%BRANCH%
git push -u origin %BRANCH%
if errorlevel 1 exit /b 1

echo Upload complete.
exit /b 0
