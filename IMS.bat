@echo off
title Institution Management System

cd /d "E:\Student Management v6.0"

echo.
echo ==========================================
echo       INSTITUTION MANAGEMENT SYSTEM
echo ==========================================
echo.
echo Starting application...
echo.

start "" cmd /c "npm start"

timeout /t 5 /nobreak >nul

start "" "http://localhost:3000"

echo.
echo Application is running.
echo.
pause