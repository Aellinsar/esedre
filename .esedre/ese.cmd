@echo off
REM Ese CLI short alias wrapper for Esedre (Windows CMD)
call "%~dp0esedre.cmd" %*
exit /b %ERRORLEVEL%
