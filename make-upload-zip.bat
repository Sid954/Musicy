@echo off
rem Zips only what the Wispbyte server needs. Never includes .env, data, bin, cookies or node_modules.
cd /d "%~dp0"
if exist musicy-upload.zip del musicy-upload.zip
tar -a -cf musicy-upload.zip src scripts package.json package-lock.json
if errorlevel 1 (echo Zip failed. & pause & exit /b 1)
echo.
echo Created musicy-upload.zip - upload it to Wispbyte and extract it in /home/container.
echo Your .env, data folder and cookies on the server are untouched.
pause
