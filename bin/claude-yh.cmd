@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
node "%SCRIPT_DIR%claude-yh.js" %*
exit /b %ERRORLEVEL%
