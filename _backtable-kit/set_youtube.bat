@echo off
chcp 65001 >nul
set PYTHONUTF8=1
cd /d "%~dp0"
set /p NUM=Shiur number: 
set /p LINK=YouTube link: 
python new_shiur.py --youtube %NUM% %LINK%
pause
