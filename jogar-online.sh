#!/bin/sh
# Abre a mesa Omni para jogar PELA INTERNET: cria um link público (túnel gratuito do Cloudflare).
# Precisa do cloudflared instalado uma vez (macOS: brew install cloudflared).
cd "$(dirname "$0")" && exec python3 servidor.py --online "$@"
