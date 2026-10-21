# Installs local speech to text on Windows: the official whisper.cpp CPU build and the Whisper turbo model.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue' # the progress bar makes Invoke-WebRequest very slow
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Dir = Join-Path $env:LOCALAPPDATA 'clawdeck\voice'
$ZipUrl = 'https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-blas-bin-x64.zip'
$ZipSha = 'B1158BD10EDF92C9799149A6FC5D3E58DA3F495241D6FB3423088130E88FFBF3'
$ModelUrl = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-large-v3-turbo-q5_0.bin'
$ModelSha = '394221709CD5AD1F40C46E6031CA61BCE88931E6E088C188294C6D5A55FFA7E2'
$Model = Join-Path $Dir 'models\ggml-large-v3-turbo-q5_0.bin'

# Download to a .part file and keep it only when the checksum matches.
function Get-Checked($Url, $Out, $Sha) {
  Invoke-WebRequest -Uri $Url -OutFile "$Out.part" -UseBasicParsing
  if ((Get-FileHash "$Out.part" -Algorithm SHA256).Hash -ne $Sha) {
    Remove-Item -Force "$Out.part"
    throw "Checksum mismatch for $Url"
  }
  Move-Item -Force "$Out.part" $Out
}

New-Item -ItemType Directory -Force -Path (Join-Path $Dir 'bin'), (Join-Path $Dir 'models') | Out-Null

Write-Output 'Downloading whisper.cpp (22 MB)'
$Zip = Join-Path $env:TEMP 'clawdeck-whisper.zip'
$Unzip = Join-Path $env:TEMP 'clawdeck-whisper'
Get-Checked $ZipUrl $Zip $ZipSha
Expand-Archive -Force $Zip $Unzip
# whisper-cli.exe needs the DLLs next to it, so the whole folder goes in.
Copy-Item -Force (Join-Path $Unzip 'Release\*') (Join-Path $Dir 'bin')
Remove-Item -Recurse -Force $Zip, $Unzip

if (-not (Test-Path $Model)) {
  Write-Output 'Downloading the Whisper turbo model (550 MB)'
  Get-Checked $ModelUrl $Model $ModelSha
}
Write-Output 'Voice input is ready.'
