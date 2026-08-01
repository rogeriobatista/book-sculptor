@echo off
cd /d "%~dp0"
title Book Sculptor
echo Iniciando Book Sculptor...
python main.py
if errorlevel 1 (
  echo.
  echo Se faltarem dependencias, execute:
  echo   pip install -r requirements.txt
  pause
)
