# commoncのcam実装からlane64 imageを作り、cmnをコンパイルして実行する。

[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string]$Source = '',
  [string]$Output = '',
  [int]$Dump = 4,
  [int]$RunWords = 65536,
  [switch]$RebuildCompiler,
  [string]$Python = 'python'
)

$ErrorActionPreference = 'Stop'
$packageDir = (Resolve-Path (Join-Path $PSScriptRoot '.')).Path
$generator = Join-Path $packageDir 'bin\common.exe'
$vcpu = Join-Path $packageDir 'vcpu.py'
$compilerSource = Join-Path $packageDir 'common_lang\commonc\src\commonc_lane64.cam'
$buildDir = Join-Path $packageDir 'dist\commonc'
$compilerImage = Join-Path $buildDir 'commonc_lane64.bin'
$buildLog = Join-Path $buildDir 'commonc-build.log'

if (-not (Test-Path -LiteralPath $generator)) {
  throw "camのbinary generatorがありません: $generator"
}
if (-not (Test-Path -LiteralPath $vcpu)) {
  throw "Python vCPUがありません: $vcpu"
}
New-Item -ItemType Directory -Path $buildDir -Force | Out-Null

if ($RebuildCompiler -or -not (Test-Path -LiteralPath $compilerImage)) {
  & $generator $compilerSource -t lane64 --no-sim -o $compilerImage *> $buildLog
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $compilerImage)) {
    Get-Content -LiteralPath $buildLog | Select-Object -Last 20
    throw "commoncのlane64 imageを生成できません。"
  }
  $compilerLength = (Get-Item -LiteralPath $compilerImage).Length
  Write-Output ("tu   camからcommoncを生成  {0} byte" -f $compilerLength)
}

if ([string]::IsNullOrWhiteSpace($Source)) {
  $Source = Join-Path $packageDir 'examples\cmn\futatsu.cmn'
}
$sourcePath = (Resolve-Path -LiteralPath $Source).Path
if ([string]::IsNullOrWhiteSpace($Output)) {
  $name = [System.IO.Path]::GetFileNameWithoutExtension($sourcePath)
  $Output = Join-Path $buildDir ($name + '.bin')
}
$outputPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Output)
$outputDir = Split-Path -Parent $outputPath
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null

$length = (Get-Item -LiteralPath $sourcePath).Length
$stride = [Math]::Max($length + 80, 4096)
$inputBase = 288 * $stride
$compileWords = $inputBase + $length + 4096

& $Python $vcpu $compilerImage --words $compileWords `
  --in $sourcePath --in-base $inputBase --emit $outputPath
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $outputPath)) {
  throw "cmnをlane64 imageへ変換できません: $sourcePath"
}

& $Python $vcpu $outputPath --words $RunWords --dump $Dump
if ($LASTEXITCODE -ne 0) {
  throw "生成したlane64 imageがteを報告しました: $outputPath"
}
