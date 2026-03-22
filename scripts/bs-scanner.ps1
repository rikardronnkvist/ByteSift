<#
.SYNOPSIS
Scans a directory tree and exports a ByteSift-compatible JSON snapshot.

.DESCRIPTION
Recursively scans the provided root folder and emits metadata for files and directories,
including path, type, size, and timestamps. The output JSON is used by the ByteSift UI
and archive/delete script workflows.

.PARAMETER Root
Root path to scan.

.PARAMETER Output
Output JSON file path. If omitted, a timestamped file is created in the script folder.
Relative paths are resolved from the current working directory.

.PARAMETER ExcludeFolder
Optional folder exclusion patterns. Patterns are matched against folder name,
absolute path, and root-relative path using PowerShell `-like` wildcard matching.

.EXAMPLE
pwsh ./scripts/bs-scanner.ps1 -Root "/path/to/root"

Scans a root folder and writes a timestamped JSON report.

.EXAMPLE
pwsh ./scripts/bs-scanner.ps1 -Root "/path/to/root" -ExcludeFolder "node_modules",".git","dist/*"

Scans while skipping matching folders.

.NOTES
Use `-Verbose` to print excluded folder skip messages.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Root,
  [string]$Output,
  [string[]]$ExcludeFolder = @()
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not $Output) {
  $defaultName = "bytesift-$((Get-Date).ToString('yyyyMMdd-HHmm')).json"
  $scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
  $Output = Join-Path -Path $scriptDir -ChildPath $defaultName
}

function Convert-ToIsoUtc {
  param([datetime]$Date)
  return $Date.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
}

function Test-IsExcludedDirectory {
  param(
    [string]$ItemPath,
    [string]$ItemName,
    [string]$RootPath,
    [string[]]$Patterns
  )

  if (-not $Patterns -or $Patterns.Count -eq 0) {
    return $false
  }

  $relativePath = $ItemPath
  if ($ItemPath.StartsWith($RootPath, [System.StringComparison]::OrdinalIgnoreCase)) {
    $relativePath = $ItemPath.Substring($RootPath.Length).TrimStart([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
  }

  foreach ($pattern in $Patterns) {
    if ([string]::IsNullOrWhiteSpace($pattern)) {
      continue
    }

    if ($ItemName -like $pattern -or $ItemPath -like $pattern -or $relativePath -like $pattern) {
      return $true
    }
  }

  return $false
}

function Get-Node {
  param(
    [System.IO.FileSystemInfo]$Item,
    [int]$Depth = 0,
    [string]$RootPath,
    [string[]]$ExcludePatterns
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
      if ($entry.PSIsContainer -and (Test-IsExcludedDirectory -ItemPath $entry.FullName -ItemName $entry.Name -RootPath $RootPath -Patterns $ExcludePatterns)) {
        Write-Verbose "Skipping excluded folder: $($entry.FullName)"
        continue
      }

      try {
        $child = Get-Node -Item $entry -Depth ($Depth + 1) -RootPath $RootPath -ExcludePatterns $ExcludePatterns
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
  excludedFolders = @($ExcludeFolder | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
  node = Get-Node -Item $rootItem -Depth 0 -RootPath $resolvedRoot -ExcludePatterns $ExcludeFolder
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
