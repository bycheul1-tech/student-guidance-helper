@echo off
cd /d "%~dp0"
echo 필요한 파일을 받는 중입니다...
call npm install
if exist "%LOCALAPPDATA%\Microsoft\WindowsApps\python.exe" python -m pip install requests >nul 2>&1
echo.
echo 설치가 끝났습니다. 시작.bat 으로 켜십시오.
pause
