@echo off
chcp 65001 >nul
set PYTHONUTF8=1
cd /d "%~dp0"
set /p NUM=Shiur number: 
python publish.py --announce %NUM%
pause
