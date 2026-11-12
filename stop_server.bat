@echo off
title 나만의패스워드관리 - 로컬 서버 종료기
cd /d "%~dp0"

echo ====================================================
echo       NA-MAN-UI PASSWORD GWANLI - SERVER TERMINATOR
echo ====================================================
echo.
echo  [*] 백그라운드에서 실행 중인 Node.js 보안 서버를 강제 종료합니다...
echo.

taskkill /f /im node.exe >nul 2>&1

if %errorlevel% equ 0 (
    echo  [v] 나만의패스워드관리 로컬 서버를 성공적으로 종료했습니다!
) else (
    echo  [!] 백그라운드에 실행 중인 Node.js 서버가 없거나 이미 종료되어 있습니다.
)

echo.
echo ====================================================
echo.
pause
