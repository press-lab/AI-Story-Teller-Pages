@echo off
setlocal
where pwsh.exe >nul 2>nul
if not errorlevel 1 (
  pwsh.exe -NoProfile -File "%~dp0start-local-model.ps1" %*
  exit /b
)
set "AIST_PWSH=%ProgramFiles%\PowerShell\7\pwsh.exe"
if not exist "%AIST_PWSH%" set "AIST_PWSH=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe"
if not exist "%AIST_PWSH%" (
  echo PowerShell 7 was not found. Install PowerShell 7 or run start-local-model.ps1 from an existing PowerShell 7 session.
  exit /b 1
)
"%AIST_PWSH%" -NoProfile -File "%~dp0start-local-model.ps1" %*
