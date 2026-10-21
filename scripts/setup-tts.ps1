# Installs Turkish read aloud on Windows: uv, Python 3.12, CPU-only PyTorch, Antalia-2 Mini and its weights.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue' # the progress bar makes Invoke-WebRequest very slow
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Dir = Join-Path $env:LOCALAPPDATA 'clawdeck\tts'
$UvUrl = 'https://github.com/astral-sh/uv/releases/download/0.13.4/uv-x86_64-pc-windows-msvc.zip'
$UvSha = 'CCEC7508A07D9933D7CB1261880633EFCF1F30D6E6EDDAB21823F1DAE6F23225'
$Repo = 'https://huggingface.co/cloud0day3/antalia-mini/resolve/8a79528770af2ed5cb6d3b9ac1248d370429f272' # the reviewed commit
$Files = @{
  'config.json'          = 'E22EC7FCBE635DCED92070F81E6F1EE83B0D25A23877B0C9AB7FC86E7ABE4CD7'
  'acoustic.safetensors' = '72C36A6855CE95DC1D35960A7B61515136813313406E5B9AE1C2EBE6CD2AD428'
  'vocoder.safetensors'  = '89CA374CC55864B38A36F9EA87C41E1B17376E5D6D68E3A0458332861509BBF6'
}

# Download to a .part file and keep it only when the checksum matches.
function Get-Checked($Url, $Out, $Sha) {
  Invoke-WebRequest -Uri $Url -OutFile "$Out.part" -UseBasicParsing
  if ((Get-FileHash "$Out.part" -Algorithm SHA256).Hash -ne $Sha) {
    Remove-Item -Force "$Out.part"
    throw "Checksum mismatch for $Url"
  }
  Move-Item -Force "$Out.part" $Out
}

# uv keeps its Python here too, and no download cache, so uninstall is one folder.
$env:UV_PYTHON_INSTALL_DIR = Join-Path $Dir 'python'
$env:UV_NO_CACHE = '1'
New-Item -ItemType Directory -Force -Path (Join-Path $Dir 'uv'), (Join-Path $Dir 'model') | Out-Null

$Uv = Join-Path $Dir 'uv\uv.exe'
if (-not (Test-Path $Uv)) {
  Write-Output 'Downloading uv (15 MB)'
  $Zip = Join-Path $env:TEMP 'clawdeck-uv.zip'
  Get-Checked $UvUrl $Zip $UvSha
  Expand-Archive -Force $Zip (Join-Path $Dir 'uv')
  Remove-Item -Force $Zip
}

Write-Output 'Creating the Python environment'
& $Uv venv --quiet --allow-existing --python 3.12 (Join-Path $Dir 'venv')
if ($LASTEXITCODE) { throw 'uv could not create the Python environment' }
$Py = Join-Path $Dir 'venv\Scripts\python.exe'

Write-Output 'Installing PyTorch for the CPU (about 200 MB)'
& $Uv pip install --quiet --python $Py --index-url https://download.pytorch.org/whl/cpu 'torch==2.14.1+cpu'
if ($LASTEXITCODE) { throw 'PyTorch did not install' }

Write-Output 'Installing Antalia-2 Mini'
& $Uv pip install --quiet --python $Py 'antalia-mini==1.0.1'
if ($LASTEXITCODE) { throw 'Antalia-2 Mini did not install' }

foreach ($f in $Files.Keys) {
  $out = Join-Path $Dir "model\$f"
  if (-not (Test-Path $out)) {
    Write-Output "Downloading $f"
    Get-Checked "$Repo/$f" $out $Files[$f]
  }
}
Write-Output 'Read aloud is ready.'
