@echo off
rem Starts the game with a public internet invite link (friends on any network can join).
cd /d "%~dp0"
if not exist node_modules call npm install
node online.js
pause
