# 文件用途：将无凭据的已构建扩展打包到本地 artifacts，供个人加载或解压安装。
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$buildRoot = Join-Path $repoRoot 'dist'
$artifactRoot = Join-Path $repoRoot 'artifacts'
if (-not (Test-Path -LiteralPath (Join-Path $buildRoot 'manifest.json'))) { throw '请先构建扩展。' }
New-Item -ItemType Directory -Path $artifactRoot -Force | Out-Null
$archivePath = Join-Path $artifactRoot 'AskBlackboard-0.1.0.zip'
Compress-Archive -Path (Join-Path $buildRoot '*') -DestinationPath $archivePath -Force
# 使用 .NET 计算交付摘要，避免子 PowerShell 环境缺少 Get-FileHash 命令时将成功打包误判为失败。
$archiveStream = [IO.File]::OpenRead($archivePath)
$hashAlgorithm = [Security.Cryptography.SHA256]::Create()
try {
  $archiveHash = [BitConverter]::ToString($hashAlgorithm.ComputeHash($archiveStream)).Replace('-', '')
  [pscustomobject]@{ Algorithm = 'SHA256'; Hash = $archiveHash; Path = $archivePath }
} finally {
  $archiveStream.Dispose()
  $hashAlgorithm.Dispose()
}
