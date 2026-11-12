@echo off
title 나만의패스워드관리 - 로컬 패스워드 매니저
cd /d "%~dp0"

echo ====================================================
echo         NA-MAN-UI PASSWORD GWANLI - LOCAL SERVICES
echo ====================================================
echo.
echo  [*] 로컬 보안 연결을 설정하는 중입니다...
echo  [*] 브라우저를 열고 로그인 페이지로 이동합니다.
echo  [*] 금고 데이터(vault.json.enc)가 실시간 동기화됩니다.
echo.
echo  [주의] 이 터미널 창을 닫으면 프로그램이 종료됩니다.
echo         프로그램을 종료할 때만 이 창을 닫아주세요.
echo.
echo ====================================================

:: Launch default web browser asynchronously
start http://localhost:3000

:: Start Node.js HTTP server (blocking process)
node server.js

pause
