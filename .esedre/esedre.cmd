@echo off
REM Esedre Autonomous Ticketing & Project Planning Engine Wrapper (Windows CMD)
setlocal

where ese >nul 2>nul
if %ERRORLEVEL% equ 0 goto use_ese

where esedre >nul 2>nul
if %ERRORLEVEL% equ 0 goto use_esedre

if exist "%~dp0..\..\esedre\dist\esedre.mjs" goto use_sibling_dist
if exist "%~dp0..\esedre\dist\esedre.mjs" goto use_local_dist
if exist "%~dp0..\node_modules\.bin\ese.cmd" goto use_node_modules_ese
if exist "%~dp0..\node_modules\.bin\esedre.cmd" goto use_node_modules_esedre

call npx --yes esedre %*
goto done

:use_ese
call ese %*
goto done

:use_esedre
call esedre %*
goto done

:use_sibling_dist
node "%~dp0..\..\esedre\dist\esedre.mjs" %*
goto done

:use_local_dist
node "%~dp0..\esedre\dist\esedre.mjs" %*
goto done

:use_node_modules_ese
call "%~dp0..\node_modules\.bin\ese.cmd" %*
goto done

:use_node_modules_esedre
call "%~dp0..\node_modules\.bin\esedre.cmd" %*
goto done

:done
endlocal
exit /b %ERRORLEVEL%
