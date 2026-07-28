@echo off
chcp 65001 > nul
rem K-JAMDS 시뮬레이터 — Windows 더블클릭용 서버 실행기 (설치 불필요)
rem serve.sh는 bash 전용이라 Windows에서는 메모장이 열립니다. 이 파일을 대신 쓰세요.
rem 포트를 바꾸려면:  serve.bat 9000
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" %*
pause
