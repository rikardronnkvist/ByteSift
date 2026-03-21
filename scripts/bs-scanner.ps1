param(
  [Parameter(Mandatory = $true)]
  [string]$Root,
  [string]$Output
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not $Output) {
  $defaultName = "bytesift-$((Get-Date).ToString('yyMMdd')).json"
  $scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
  $Output = Join-Path -Path $scriptDir -ChildPath $defaultName
}

function Convert-ToIsoUtc {
  param([datetime]$Date)
  return $Date.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
}

function Get-Node {
  param(
    [System.IO.FileSystemInfo]$Item,
    [int]$Depth = 0
  )

  $node = [ordered]@{
    name = $Item.Name
    path = $Item.FullName
    type = if ($Item.PSIsContainer) { "directory" } else { "file" }
    sizeBytes = 0
    CreationTime = Convert-ToIsoUtc $Item.CreationTimeUtc
    LastAccessTime = Convert-ToIsoUtc $Item.LastAccessTimeUtc
    LastWriteTime = Convert-ToIsoUtc $Item.LastWriteTimeUtc
    modifiedAt = Convert-ToIsoUtc $Item.LastWriteTimeUtc
  }

  if ($Item.PSIsContainer) {
    $children = @()
    $total = 0
    if ($Depth -eq 1) {
        Write-Host "  $($Item.Name)"
    }

    try {
      $entries = Get-ChildItem -LiteralPath $Item.FullName -Force -ErrorAction Stop | Sort-Object Name
    }
    catch {
      $entries = @()
    }

    foreach ($entry in $entries) {
      try {
        $child = Get-Node -Item $entry -Depth ($Depth + 1)
        $children += $child
        $total += [int64]$child.sizeBytes
      }
      catch {
        continue
      }
    }

    $node.children = $children
    $node.sizeBytes = $total
  }
  else {
    $node.sizeBytes = [int64]$Item.Length
  }

  return $node
}

$resolvedRoot = (Resolve-Path -Path $Root).Path

Write-Host "Scanning root: $resolvedRoot"

$rootItem = Get-Item -LiteralPath $resolvedRoot

$report = [ordered]@{
  rootPath = $resolvedRoot
  generatedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  node = Get-Node -Item $rootItem -Depth 0
}

if ([System.IO.Path]::IsPathRooted($Output)) {
  $outputFile = [System.IO.Path]::GetFullPath($Output)
}
else {
  $outputFile = [System.IO.Path]::GetFullPath((Join-Path -Path (Get-Location).Path -ChildPath $Output))
}
$outputDir = Split-Path -Path $outputFile -Parent
if (-not (Test-Path -LiteralPath $outputDir)) {
  New-Item -ItemType Directory -Path $outputDir | Out-Null
}

$report | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $outputFile -Encoding UTF8
Write-Host "Wrote scan report: $outputFile"
