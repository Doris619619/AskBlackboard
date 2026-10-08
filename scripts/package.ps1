# 文件用途：将无凭据的已构建扩展打包到本地 artifacts，供个人加载或解压安装。
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$buildRoot = Join-Path $repoRoot 'dist'
$artifactRoot = Join-Path $repoRoot 'artifacts'
if (-not (Test-Path -LiteralPath (Join-Path $buildRoot 'manifest.json'))) { throw '请先构建扩展。' }
New-Item -ItemType Directory -Path $artifactRoot -Force | Out-Null
Compress-Archive -Path (Join-Path $buildRoot '*') -DestinationPath (Join-Path $artifactRoot 'AskBlackboard-0.1.0.zip') -Force
Get-FileHash -LiteralPath (Join-Path $artifactRoot 'AskBlackboard-0.1.0.zip') -Algorithm SHA256
