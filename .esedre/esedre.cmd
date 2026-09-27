@echo off
REM Esedre Autonomous Ticketing & Project Planning Engine Wrapper (Windows CMD)
call :run %*
exit /b %ERRORLEVEL%

:run
if exist "%~dp0..\dist\esedre.mjs" (
  node "%~dp0..\dist\esedre.mjs" %*
  goto :eof
)
if exist "%~dp0..\..\esedre\dist\esedre.mjs" (
  node "%~dp0..\..\esedre\dist\esedre.mjs" %*
  goto :eof
)
if exist "%~dp0..\esedre\dist\esedre.mjs" (
  node "%~dp0..\esedre\dist\esedre.mjs" %*
  goto :eof
)
if exist "%~dp0..\node_modules\esedre\dist\esedre.mjs" (
  node "%~dp0..\node_modules\esedre\dist\esedre.mjs" %*
  goto :eof
)
if exist "%~dp0..\node_modules\.bin\ese.cmd" (
  call "%~dp0..\node_modules\.bin\ese.cmd" %*
  goto :eof
)
if exist "%~dp0..\node_modules\.bin\esedre.cmd" (
  call "%~dp0..\node_modules\.bin\esedre.cmd" %*
  goto :eof
)

where ese >nul 2>nul
if %ERRORLEVEL% equ 0 (
  call ese %*
  goto :eof
)

where esedre >nul 2>nul
if %ERRORLEVEL% equ 0 (
  call esedre %*
  goto :eof
)

call npx --yes esedre %*
goto :eof
