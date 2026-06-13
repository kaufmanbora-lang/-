@echo off
setlocal
cd /d "%~dp0"

set "NODE_EXE=C:\Users\borys\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"

start "Orbit Chat Server" "%NODE_EXE%" server.js
timeout /t 2 >nul
start "" "http://127.0.0.1:8790/"

