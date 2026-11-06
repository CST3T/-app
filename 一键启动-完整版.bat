@echo off
setlocal
set "SYS=%SystemRoot%\System32"
cd /d "%~dp0"
title Minutes - Full Stack Launcher (Docker)

rem Locate docker CLI (fallback to Docker Desktop bundled CLI)
set "DOCKER=docker"
"%SYS%\where.exe" docker >nul 2>nul
if not errorlevel 1 goto docker_cli_ok
set "DOCKER=%ProgramFiles%\Docker\Docker\resources\bin\docker.exe"
if exist "%DOCKER%" goto docker_cli_ok
echo [ERROR] Docker command not found. Please install Docker Desktop first.
pause
exit /b 1

:docker_cli_ok
rem Start Docker Desktop if the engine is not running
"%DOCKER%" info >nul 2>nul
if not errorlevel 1 goto engine_ready

if not exist "%ProgramFiles%\Docker\Docker\Docker Desktop.exe" (
  echo [ERROR] Docker engine is not running and Docker Desktop was not found.
  pause
  exit /b 1
)
echo Docker engine is not running. Starting Docker Desktop...
start "" "%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
set /a tries=0

:wait_engine
"%DOCKER%" info >nul 2>nul
if not errorlevel 1 goto engine_ready
set /a tries+=1
if %tries% geq 60 (
  echo [ERROR] Docker engine did not become ready within 3 minutes.
  pause
  exit /b 1
)
"%SYS%\timeout.exe" /t 3 /nobreak >nul
goto wait_engine

:engine_ready
rem First run: generate .env from the template with a random JWT secret
if exist ".env" goto env_ready
echo First run: .env not found. Generating default config from infra\.env.example ...
if not exist "infra\.env.example" (
  echo [ERROR] infra\.env.example is missing. Please obtain the complete project files again.
  pause
  exit /b 1
)
copy /Y "infra\.env.example" ".env" >nul
"%SYS%\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -Command "$bytes=New-Object byte[] 32; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes); $secret=-join ($bytes | ForEach-Object { $_.ToString('x2') }); (Get-Content .env -Raw) -replace '(?m)^MINUTES_JWT_SECRET=$', ('MINUTES_JWT_SECRET=' + $secret) | Set-Content .env -Encoding UTF8"
if errorlevel 1 (
  echo [ERROR] Failed to generate .env automatically.
  pause
  exit /b 1
)
echo .env created with a random JWT secret. Edit .env to set LLM_API_KEY for cloud AI summaries.
echo.

:env_ready
echo Starting Minutes full stack (Web + API + Worker + PostgreSQL + Redis + MinIO)...
"%DOCKER%" compose --env-file .env -f infra\docker-compose.yml up -d
if errorlevel 1 (
  echo [ERROR] Startup failed. See the Docker output above.
  pause
  exit /b 1
)

echo Waiting for services to be ready (first run may take 1-3 minutes)...
"%SYS%\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -Command "$ok=$false; 1..90 | %% { try { $r=Invoke-WebRequest http://localhost:3000 -UseBasicParsing -TimeoutSec 2; if($r.StatusCode -eq 200){ $ok=$true; break } } catch {}; Start-Sleep -Seconds 2 }; if(-not $ok){ exit 1 }"
if errorlevel 1 (
  echo [ERROR] Web service did not become ready within 3 minutes.
  pause
  exit /b 1
)

echo Ready. Opening http://localhost:3000
start "" "%SYS%\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -WindowStyle Hidden -Command "Start-Process 'http://localhost:3000'"
echo.
echo Demo account: demo@minutes.dev / minutes2026
echo Real speech recognition (local faster-whisper) + PostgreSQL + Redis + MinIO enabled.
echo Stop: docker compose --env-file .env -f infra\docker-compose.yml down
pause
