@echo off
rem Abre a mesa Omni para jogar PELA INTERNET: cria um link publico (tunel gratuito do Cloudflare).
rem Precisa do cloudflared instalado uma vez:  winget install --id Cloudflare.cloudflared
cd /d "%~dp0"
where python >nul 2>nul && (python servidor.py --online %*) || (py -3 servidor.py --online %*)
pause
