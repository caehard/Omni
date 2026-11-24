# Instala o gerador de imagens local do Omni: ComfyUI portatil (NVIDIA) + modelos.
#  - SDXL (DreamShaper XL Lightning): modos Cenario e Personagem
#  - Qwen-Image-Edit-2511 (GGUF Q4_K_M) + leitor de texto/imagem Qwen2.5-VL + VAE + LoRA Lightning 4 passos:
#    modo Cenario e personagem (com ate 3 imagens de referencia)
# Uso: powershell -ExecutionPolicy Bypass -File tools\instalar-gerador.ps1 [-Destino C:\caminho]
# Pode rodar de novo: o que ja foi baixado e pulado; downloads interrompidos continuam de onde pararam.
param([string]$Destino = "$HOME\Omni-Gerador")

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$base = Join-Path $Destino 'ComfyUI_windows_portable'
$comfy = Join-Path $base 'ComfyUI'
$py = Join-Path $base 'python_embeded\python.exe'
New-Item -ItemType Directory -Force $Destino | Out-Null

function Get-Arquivo($url, $alvo) {
  if (Test-Path $alvo) { Write-Host "  ja existe: $(Split-Path -Leaf $alvo)"; return }
  New-Item -ItemType Directory -Force (Split-Path -Parent $alvo) | Out-Null
  $parte = "$alvo.part"
  Write-Host "  baixando: $(Split-Path -Leaf $alvo)"
  for ($i = 1; $i -le 5; $i++) {
    & curl.exe -L --fail --retry 5 --retry-delay 5 -C - -sS -o $parte $url
    if ($LASTEXITCODE -eq 0) { Move-Item -Force $parte $alvo; return }
    Write-Host "  falhou (codigo $LASTEXITCODE), tentativa $i de 5"
    Start-Sleep -Seconds 5
  }
  throw "Nao consegui baixar $url"
}

Write-Host '== 1/4 ComfyUI portatil =='
if (-not (Test-Path $py)) {
  $z = Join-Path $Destino 'ComfyUI_windows_portable_nvidia.7z'
  Get-Arquivo 'https://github.com/Comfy-Org/ComfyUI/releases/download/v0.46.0/ComfyUI_windows_portable_nvidia.7z' $z
  $7z = 'C:\Program Files\7-Zip\7z.exe'
  if (Test-Path $7z) { & $7z x -y "-o$Destino" $z | Out-Null } else { & tar.exe -xf $z -C $Destino }
  if (-not (Test-Path $py)) { throw 'A extracao do ComfyUI falhou' }
  Remove-Item $z
} else { Write-Host '  ja instalado' }

Write-Host '== 2/4 no ComfyUI-GGUF (carrega o Qwen compactado) =='
$gguf = Join-Path $comfy 'custom_nodes\ComfyUI-GGUF'
if (-not (Test-Path $gguf)) { & git clone --depth 1 https://github.com/city96/ComfyUI-GGUF $gguf }
& $py -s -m pip install --disable-pip-version-check -q -r (Join-Path $gguf 'requirements.txt')

Write-Host '== 3/4 modelos (~30 GB) =='
$m = Join-Path $comfy 'models'
$hf = 'https://huggingface.co'
Get-Arquivo "$hf/Lykon/dreamshaper-xl-lightning/resolve/main/DreamShaperXL_Lightning-SFW.safetensors" "$m\checkpoints\DreamShaperXL_Lightning-SFW.safetensors"
Get-Arquivo "$hf/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/vae/qwen_image_vae.safetensors" "$m\vae\qwen_image_vae.safetensors"
Get-Arquivo "$hf/lightx2v/Qwen-Image-Edit-2511-Lightning/resolve/main/Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors" "$m\loras\Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors"
Get-Arquivo "$hf/Comfy-Org/HunyuanVideo_1.5_repackaged/resolve/main/split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors" "$m\text_encoders\qwen_2.5_vl_7b_fp8_scaled.safetensors"
Get-Arquivo "$hf/unsloth/Qwen-Image-Edit-2511-GGUF/resolve/main/qwen-image-edit-2511-Q4_K_M.gguf" "$m\unet\qwen-image-edit-2511-Q4_K_M.gguf"

Write-Host '== 4/4 configuracao =='
$cfg = @{ comfyui = $base } | ConvertTo-Json
[IO.File]::WriteAllText((Join-Path $repo 'gerador.local.json'), $cfg)
Write-Host "Pronto. ComfyUI em $base"
Write-Host 'Abra a mesa como mestre: aba Gerador > Ligar gerador.'
