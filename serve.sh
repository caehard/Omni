#!/bin/sh
# Inicia o TTS Omni localmente. Depois abra http://localhost:8000/vtt/
cd "$(dirname "$0")" && echo "Omni rodando em http://localhost:8000/vtt/  (Ctrl+C para parar)" && python3 -m http.server 8000
