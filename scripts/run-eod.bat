@echo off
setlocal
cd /d "%~dp0.."
if not exist "logs" mkdir logs

rem Slack web is unreliable headless — keep headed for Interactive scheduled tasks
if not defined EOD_HEADED set EOD_HEADED=1

set "NODE_EXE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"

set "TSX_CLI=%~dp0..\node_modules\tsx\dist\cli.mjs"
if not exist "%TSX_CLI%" set "TSX_CLI=%CD%\node_modules\tsx\dist\cli.mjs"

echo [%DATE% %TIME%] Starting EOD Generator scheduled run>> "logs\scheduler.log"
"%NODE_EXE%" -v >> "logs\scheduler.log" 2>&1
"%NODE_EXE%" "%TSX_CLI%" ".\src\eod.ts" >> "logs\scheduler.log" 2>&1
set EXITCODE=%ERRORLEVEL%
if not %EXITCODE%==0 (
  echo [%DATE% %TIME%] FAILED exit %EXITCODE%>> "logs\scheduler.log"
) else (
  echo [%DATE% %TIME%] SUCCESS>> "logs\scheduler.log"
)
exit /b %EXITCODE%
