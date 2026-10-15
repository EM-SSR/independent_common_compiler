# 同梱したHaskell sourceからcam binary generatorを作る。

[CmdletBinding()]
param(
  [string]$Cabal = 'cabal',
  [string]$Python = 'python',
  [switch]$Verify
)

$ErrorActionPreference = 'Stop'
$packageDir = (Resolve-Path $PSScriptRoot).Path
$haskellDir = Join-Path $packageDir 'haskell'
$distDir = Join-Path $packageDir 'dist'
$buildDir = Join-Path $distDir 'cabal'
$storeDir = Join-Path $distDir 'store'
$config = Join-Path $packageDir 'cabal-local.config'
$binDir = Join-Path $packageDir 'bin'
$destination = Join-Path $binDir 'common.exe'

New-Item -ItemType Directory -Path $distDir -Force | Out-Null
Push-Location $haskellDir
try {
  & $Cabal "--config-file=$config" "--store-dir=$storeDir" `
    "--active-repositories=:none" build `
    "--builddir=$buildDir" --offline exe:common
  if ($LASTEXITCODE -ne 0) {
    throw "common.exeをbuildできません。"
  }
  $built = (& $Cabal "--config-file=$config" "--store-dir=$storeDir" `
    "--active-repositories=:none" list-bin `
    "--builddir=$buildDir" exe:common | Select-Object -Last 1).Trim()
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $built)) {
    throw "buildしたcommon.exeの場所を取得できません。"
  }
} finally {
  Pop-Location
}

New-Item -ItemType Directory -Path $binDir -Force | Out-Null
Copy-Item -LiteralPath $built -Destination $destination -Force
$length = (Get-Item -LiteralPath $destination).Length
Write-Output ("tu   Haskell sourceからcommon.exeを生成  {0} byte" -f $length)

if ($Verify) {
  & (Join-Path $packageDir 'examples\commonc\tools\Check.ps1') -Python $Python
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}
