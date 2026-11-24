@echo off
rem Inicia o servidor da mesa Omni (TTS + multiplayer) no Windows. Depois abra http://localhost:8000/vtt/
rem Argumentos opcionais: --porta 8080 · --host 127.0.0.1 (so este PC)
cd /d "%~dp0"
where python >nul 2>nul && (python servidor.py %*) || (py -3 servidor.py %*)
pause
