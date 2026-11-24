#!/bin/sh
# Inicia o servidor da mesa Omni (TTS + multiplayer). Depois abra http://localhost:8000/vtt/
# Argumentos opcionais: --porta 8080 · --host 127.0.0.1 (só este PC)
cd "$(dirname "$0")" && exec python3 servidor.py "$@"
