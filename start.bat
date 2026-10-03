@echo off
echo ============================================
echo BOOYAHX - Starting Server
echo ============================================
echo.

REM Check if Node.js is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed!
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

REM Check if node_modules exists
if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
    if %errorlevel% neq 0 (
        echo ERROR: Failed to install dependencies!
        pause
        exit /b 1
    )
)

REM Check if .env exists
if not exist ".env" (
    echo Creating .env from example...
    copy .env.example .env
    echo Please edit .env with your configuration!
    pause
)

echo.
echo Starting BOOYAHX server...
echo.
echo Public Website: http://localhost:3000
echo Owner Console:  http://localhost:3000/owner/login.html
echo API:            http://localhost:3000/api
echo.
echo Press Ctrl+C to stop the server.
echo.

call npm start

pause
