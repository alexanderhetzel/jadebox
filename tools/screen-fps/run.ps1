# Builds screen-fps.exe with the C# compiler that ships with Windows (.NET Framework 4) and runs it.
# Usage: powershell -ExecutionPolicy Bypass -File tools/screen-fps/run.ps1 [--display \\.\DISPLAY1] [--seconds N] [--region 0.5]
$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$out = Join-Path $root 'dist-test\screen-fps'
New-Item -ItemType Directory -Force $out | Out-Null
$exe = Join-Path $out 'screen-fps.exe'
$src = Join-Path $PSScriptRoot 'screen-fps.cs'
if (-not (Test-Path $exe) -or (Get-Item $src).LastWriteTime -gt (Get-Item $exe).LastWriteTime) {
  & "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /optimize /platform:x64 /out:$exe $src
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
& $exe @args
exit $LASTEXITCODE
