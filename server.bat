@echo off
REM ==========================================================================
REM  baoshiTD server script  (stop / build / start / console / dev / reload / restart)
REM
REM  Usage:
REM    server.bat  restart   Full flow: stop old -> build -> start NEW (background, script exits cleanly)
REM    server.bat  (empty)   Same as 'restart'
REM    server.bat  stop      Only stop running server
REM    server.bat  build     Only `go build -o baoshitd-server.exe .`
REM    server.bat  start     Start compiled exe in background
REM    server.bat  console   Start exe in FOREGROUND (live logs, Ctrl+C to stop)
REM    server.bat  dev       Stop old -> `go run .` (useful when editing Go sources)
REM    server.bat  reload    Hot-reload conf/game/*.json via POST /api/config/reload (no server restart)
REM
REM  NOTE: This file uses ASCII-only source text to avoid CMD code-page bugs.
REM        The user-facing runtime strings were kept short and are safe on
REM        both CP936 (CMD default) and CP65001 (UTF-8) environments.
REM ==========================================================================
setlocal EnableExtensions
cd /d "%~dp0"

set "EXE_NAME=baoshitd-server.exe"
set "PORT=8080"
set "LOG_DIR=logs"
set "RELOAD_URL=http://127.0.0.1:%PORT%/api/config/reload"
REM NOTE: Actual log filename is decided inside the Go binary as
REM       %LOG_DIR%\server-YYYY-MM-DD.log  (auto-rotated at midnight)
REM       Keep %LOG_DIR% here so cleanup/prompts stay in sync with main.go.

if "%~1"==""        goto :full
if /i "%~1"=="restart" goto :full
if /i "%~1"=="stop"    goto :stop
if /i "%~1"=="build"   goto :build
if /i "%~1"=="start"   goto :start_background
if /i "%~1"=="console" goto :start_foreground
if /i "%~1"=="dev"     goto :dev
if /i "%~1"=="reload"  goto :reload
echo Usage: server.bat [restart ^| stop ^| build ^| start ^| console ^| dev ^| reload ^| (empty = restart)]
exit /b 1

REM ============================ FULL FLOW (default / restart) ============================
:full
echo ============================================================
echo   baoshiTD restart  (stop -^> build -^> start bg)
echo ============================================================
echo.
call :stop
if errorlevel 1 exit /b 1
echo.
call :build
if errorlevel 1 exit /b 1
echo.
call :start_background
exit /b %errorlevel%

REM ============================ STOP ============================
:stop
echo [1/3 STOP] Kill running server...
set "SHUT=0"

REM 1) Kill by image name (most reliable, zero parsing)
tasklist /FI "IMAGENAME eq %EXE_NAME%" /NH 2>nul | findstr /I /C:"%EXE_NAME%" >nul
if not errorlevel 1 (
    echo   Found %EXE_NAME%, taskkill /F /IM ...
    taskkill /F /IM "%EXE_NAME%" >nul 2>&1
    if not errorlevel 1 (echo     - OK, %EXE_NAME% killed) else (echo     - WARN, fallback by port next)
    set "SHUT=1"
)

REM 2) Port fallback using PowerShell (no hand-parsing netstat columns)
for /f "usebackq delims=" %%k in (`powershell -NoProfile -Command "$c=Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue; if($c){$c.OwningProcess}" 2^>nul`) do (
    if not "%%k"=="" (
        echo   Port %PORT% occupied by PID=%%k, taskkill /F ...
        taskkill /F /PID %%k >nul 2>&1 && (echo     - OK) || (echo     - FAIL, may need admin)
        set "SHUT=1"
    )
)

if %SHUT%==0 echo   No running server detected (port %PORT% free)

REM Wait ~1 second for the port to be released
ping -n 2 127.0.0.1 >nul 2>&1
echo   OK  Stop done
exit /b 0

REM ============================ BUILD ============================
:build
echo [2/3 BUILD] go build -o %EXE_NAME% .
where go >nul 2>&1
if errorlevel 1 (
    echo   FAIL: 'go' not found in PATH. Install Go and/or restart your terminal.
    exit /b 1
)
go build -o %EXE_NAME% .
if errorlevel 1 (
    echo   FAIL: build exited non-zero. Fix Go errors above then retry.
    exit /b 1
)
for %%f in (%EXE_NAME%) do echo   OK: %%f  (%%~zf bytes, %%~tf)
exit /b 0

REM ============================ RELOAD (hot-reload config JSONs) ============================
:reload
echo [RELOAD] POST %RELOAD_URL% ...
REM Check server alive first (lightweight health probe)
powershell -NoProfile -Command ^
  "$u='http://127.0.0.1:%PORT%/api/health';" ^
  "try { $r=Invoke-RestMethod -Uri $u -Method Get -TimeoutSec 5; exit 0 } catch { exit 1 }"
if errorlevel 1 (
    echo   FAIL: server is not running on port %PORT%. Start it first with 'server.bat start'.
    exit /b 2
)

REM Execute reload via PowerShell Invoke-RestMethod and pretty-print result
powershell -NoProfile -Command ^
  "$u='%RELOAD_URL%';" ^
  "try {" ^
  "  $r=Invoke-RestMethod -Uri $u -Method Post -TimeoutSec 15;" ^
  "  if ($r.code -eq 200 -and $r.data -and $r.data.reloaded) {" ^
  "    Write-Host '   OK - config reloaded successfully';" ^
  "    $d=$r.data;" ^
  "    Write-Host ('      towers   = ' + $d.towers);" ^
  "    Write-Host ('      enemies  = ' + $d.enemies);" ^
  "    Write-Host ('      maps     = ' + $d.maps);" ^
  "    Write-Host ('      specials = ' + $d.specials);" ^
  "    Write-Host ('      recipes  = ' + $d.recipes);" ^
  "    exit 0;" ^
  "  } else {" ^
  "    Write-Host ('   FAIL - unexpected response: ' + ($r | ConvertTo-Json -Compress));" ^
  "    exit 1;" ^
  "  }" ^
  "} catch {" ^
  "  if ($_.Exception.Response) {" ^
  "    $code=$_.Exception.Response.StatusCode.value__;" ^
  "    Write-Host ('   FAIL - HTTP ' + $code + '. Check server logs for details.');" ^
  "  } else {" ^
  "    Write-Host ('   FAIL - ' + $_.Exception.Message);" ^
  "  }" ^
  "  exit 1;" ^
  "}"
exit /b %errorlevel%

REM ============================ PREPARE LOG DIR + CLEANUP ============================
REM Ensure logs\ exists, prune server-*.log files older than 7 days, and
REM remove the legacy orphan files (td-server.out/err.log, root server.log)
REM that were produced by old shell-redirection start methods.
:prepare_logs
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
REM Purge server-*.log older than 7 days inside LOG_DIR only (never recurse)
powershell -NoProfile -Command ^
  "$cut=(Get-Date).AddDays(-7);" ^
  "Get-ChildItem -LiteralPath '%~dp0%LOG_DIR%' -File -Filter 'server-*.log' -ErrorAction SilentlyContinue |" ^
  "  Where-Object { $_.LastWriteTime -lt $cut } |" ^
  "  ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue; Write-Host ('    - pruned old log: ' + $_.Name) }"
REM Clean up legacy stray log files (from previous manual redirects)
if exist "%LOG_DIR%\td-server.out.log" (del /F /Q "%LOG_DIR%\td-server.out.log" >nul 2>&1 && echo    - removed legacy td-server.out.log)
if exist "%LOG_DIR%\td-server.err.log" (del /F /Q "%LOG_DIR%\td-server.err.log" >nul 2>&1 && echo    - removed legacy td-server.err.log)
if exist "%~dp0server.log"       (del /F /Q "%~dp0server.log"       >nul 2>&1 && echo    - removed legacy root server.log)
exit /b 0

REM ============================ TODAY LOG HELPER ============================
REM Sets TODAY_LOG_NAME to server-YYYY-MM-DD.log using PowerShell so the
REM displayed filename matches what main.go's dailyLogWriter is writing.
:get_today_log
for /f "usebackq delims=" %%d in (`powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd'"`) do set "TODAY_LOG_NAME=server-%%d.log"
exit /b 0

REM ============================ START (background - default) ============================
:start_background
echo [3/3 START] Launch %EXE_NAME% (background)...
if not exist "%EXE_NAME%" (
    echo   FAIL: %EXE_NAME% not found. Run 'server.bat build' first.
    exit /b 1
)

call :prepare_logs
call :get_today_log

REM The Go binary now handles ALL logging itself:
REM   - tees every line to BOTH stdout AND logs/server-YYYY-MM-DD.log
REM   - auto-creates logs\ dir
REM   - auto-rotates at midnight (closes old day file, opens new day file)
REM
REM For BACKGROUND start we want the script prompt to stay clean, so we
REM discard the stdout/stderr stream HERE (cmd-side >nul). The file copy of
REM the tee inside Go still writes every line to logs\server-YYYY-MM-DD.log.
REM For FOREGROUND starts (:start_foreground / :dev) we keep stdout visible
REM because the user sits and watches that terminal.
start "baoshiTD" /D "%~dp0" /B cmd /C ""%~dp0%EXE_NAME%" >nul 2>&1"

REM Wait ~3 seconds for startup
ping -n 4 127.0.0.1 >nul 2>&1

REM Verify process alive
tasklist /FI "IMAGENAME eq %EXE_NAME%" /NH 2>nul | findstr /I /C:"%EXE_NAME%" >nul
if errorlevel 1 (
    echo   WARN: process not detected after start. Check "%~dp0%LOG_DIR%\%TODAY_LOG_NAME%" for errors.
    exit /b 2
)

echo.
echo   ====== SERVER STARTED ======
echo   Game page    http://localhost:%PORT%/td
echo   Health       http://localhost:%PORT%/api/health
echo   API docs     http://localhost:%PORT%/docs
echo   Logs dir     "%~dp0%LOG_DIR%"
echo   Today log    "%~dp0%LOG_DIR%\%TODAY_LOG_NAME%"
echo   Tail live:   powershell "Get-Content '%~dp0%LOG_DIR%\%TODAY_LOG_NAME%' -Wait -Tail 30"
echo   Stop server: server.bat stop
echo   Reload cfg:  server.bat reload
echo   =============================
exit /b 0

REM ============================ START (foreground / console) ============================
:start_foreground
echo [START/console] Launch %EXE_NAME% in foreground (Ctrl+C to stop)...
if not exist "%EXE_NAME%" (
    echo   FAIL: %EXE_NAME% not found. Run 'server.bat build' first.
    exit /b 1
)
call :prepare_logs
call :get_today_log
echo.
echo   Game page    http://localhost:%PORT%/td
echo   Health       http://localhost:%PORT%/api/health
echo   API docs     http://localhost:%PORT%/docs
echo   Today log    "%~dp0%LOG_DIR%\%TODAY_LOG_NAME%"  (also written alongside stdout)
echo   Press Ctrl+C to stop
echo   ------------------------------------------------------------
"%EXE_NAME%"
exit /b %errorlevel%

REM ============================ DEV MODE: go run . ============================
:dev
echo ============================================================
echo   baoshiTD DEV MODE  (stop old -^> go run .)
echo ============================================================
call :stop
echo.
where go >nul 2>&1
if errorlevel 1 (
    echo   FAIL: 'go' not found in PATH. Install Go and/or restart your terminal.
    exit /b 1
)
call :prepare_logs
call :get_today_log
echo   Game page    http://localhost:%PORT%/td
echo   Health       http://localhost:%PORT%/api/health
echo   API docs     http://localhost:%PORT%/docs
echo   Today log    "%~dp0%LOG_DIR%\%TODAY_LOG_NAME%"  (also written alongside stdout)
echo   Press Ctrl+C to stop
echo   ------------------------------------------------------------
go run .
exit /b %errorlevel%

endlocal
