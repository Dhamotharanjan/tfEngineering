@echo off
setlocal

echo Checking for git...
where git >nul 2>nul
if not errorlevel 1 goto :git_ok

echo Git not found. Trying winget...
where winget >nul 2>nul
if errorlevel 1 goto :try_choco
winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements --silent
where git >nul 2>nul
if not errorlevel 1 goto :git_ok

:try_choco
echo Trying Chocolatey...
where choco >nul 2>nul
if errorlevel 1 goto :try_direct
choco install git -y
where git >nul 2>nul
if not errorlevel 1 goto :git_ok

:try_direct
echo Trying direct installer download...
set TMP_EXE=%TEMP%\Git-64-bit.exe
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/git-for-windows/git/releases/latest/download/Git-64-bit.exe' -OutFile '%TMP_EXE%'"
if errorlevel 1 goto :failed
start /wait "" "%TMP_EXE%" /VERYSILENT /NORESTART /SP-
where git >nul 2>nul
if not errorlevel 1 goto :git_ok

echo Git installed but PATH may not be refreshed.
echo Close and reopen terminal, then run: git --version
goto :end

:git_ok
echo Git is installed.
git --version

:end
exit /b 0

:failed
echo ERROR: Git installation failed.
echo Install manually from: https://git-scm.com/download/win
exit /b 1
