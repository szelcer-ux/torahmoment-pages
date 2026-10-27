@echo off
chcp 65001 >nul
set PYTHONUTF8=1
cd /d "%~dp0"
python build_backtable.py --local --out site\backtable
start "" "%~dp0site\backtable\index.html"
echo Preview opened in your browser (videos only play once published).
pause
