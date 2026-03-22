[CmdletBinding(DefaultParameterSetName = "Archive")]
param(
  [Parameter(Mandatory = $true)]
  [Alias("Input")]
  [string]$InputPath,

  [Parameter(Mandatory = $true, ParameterSetName = "Archive")]
  [switch]$Archive,

  [Parameter(Mandatory = $true, ParameterSetName = "Delete")]
  [switch]$Delete,

  [Parameter(ParameterSetName = "Archive")]
  [switch]$Force,

  [Parameter(ParameterSetName = "Archive")]
  [string]$ArchiveRoot = ".\bytesift-archive",

  [string]$Report,
  [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$currentFolder = (Get-Location).Path

$Mode = if ($PSCmdlet.ParameterSetName -eq "Archive") { "archive" } else { "delete" }

if (-not $Report) {
  $Report = Join-Path -Path $currentFolder -ChildPath "bytesift-report-$((Get-Date).ToString('yyyyMMdd-HHmm')).json"
}
elseif (-not [System.IO.Path]::IsPathRooted($Report)) {
  $Report = Join-Path -Path $currentFolder -ChildPath $Report
}

function Resolve-ArchiveDestination {
  param(
    [string]$ItemPath,
    [string]$RootPath,
    [string]$ArchiveRootPath
  )

  $resolvedItem = [System.IO.Path]::GetFullPath($ItemPath)
  $resolvedRoot = [System.IO.Path]::GetFullPath($RootPath)

  if ($resolvedItem.StartsWith($resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    $relative = $resolvedItem.Substring($resolvedRoot.Length).TrimStart('\\', '/')
    if ([string]::IsNullOrWhiteSpace($relative)) {
      $relative = Split-Path -Path $resolvedItem -Leaf
    }
  }
  else {
    $relative = Split-Path -Path $resolvedItem -Leaf
  }

  return Join-Path -Path $ArchiveRootPath -ChildPath $relative
}

function Get-ItemMetrics {
  param(
    [pscustomobject]$Item,
    [string]$ItemPath
  )

  $itemType = if ($Item.type) {
    [string]$Item.type
  }
  elseif (Test-Path -LiteralPath $ItemPath -PathType Container) {
    "directory"
  }
  else {
    "file"
  }

  $sizeBytes = 0
  if ($Item.PSObject.Properties.Name -contains "sizeBytes") {
    $sizeBytes = [long]$Item.sizeBytes
  }
  elseif (Test-Path -LiteralPath $ItemPath) {
    if ($itemType -eq "directory") {
      $sizeBytes = [long](
        Get-ChildItem -LiteralPath $ItemPath -File -Recurse -ErrorAction SilentlyContinue |
          Measure-Object -Property Length -Sum |
          Select-Object -ExpandProperty Sum
      )
    }
    else {
      $sizeBytes = [long](Get-Item -LiteralPath $ItemPath).Length
    }
  }

  return [ordered]@{
    type = $itemType
    sizeBytes = [long]$sizeBytes
  }
}

if ([string]::IsNullOrWhiteSpace($InputPath)) {
  throw "Input file path is empty. Provide -Input or -InputPath."
}

if (-not (Test-Path -LiteralPath $InputPath)) {
  throw "Input file not found: $InputPath"
}

$payload = Get-Content -LiteralPath $InputPath -Raw | ConvertFrom-Json
$rootPath = if ($payload.rootPath) { [string]$payload.rootPath } else { (Get-Location).Path }
$items = @($payload.items)

$results = @()
$archiveRootPath = $null

if ($Mode -eq "archive" -and -not $DryRun) {
  $archiveRootPath = [System.IO.Path]::GetFullPath($ArchiveRoot)
  New-Item -ItemType Directory -Path $archiveRootPath -Force | Out-Null
}

if ($Mode -eq "archive" -and -not $archiveRootPath) {
  $archiveRootPath = [System.IO.Path]::GetFullPath($ArchiveRoot)
}

foreach ($item in $items) {
  $itemPath = [string]$item.path

  $metrics = Get-ItemMetrics -Item $item -ItemPath $itemPath

  if (-not (Test-Path -LiteralPath $itemPath)) {
    Write-Verbose "Skipping missing path: $itemPath"
    $results += [ordered]@{
      path = $itemPath
      type = $metrics.type
      sizeBytes = $metrics.sizeBytes
      status = "skipped"
      reason = "not found"
    }
    continue
  }

  try {
    if ($Mode -eq "archive") {
      $destination = Resolve-ArchiveDestination -ItemPath $itemPath -RootPath $rootPath -ArchiveRootPath $archiveRootPath

      if ((Test-Path -LiteralPath $destination) -and -not $Force) {
        throw "Archive target already exists: $destination. Re-run with -Force to overwrite it."
      }

      if (-not $DryRun) {
        Write-Verbose "Archiving '$itemPath' -> '$destination'"
        $destinationDir = Split-Path -Path $destination -Parent
        New-Item -ItemType Directory -Path $destinationDir -Force | Out-Null
        Move-Item -LiteralPath $itemPath -Destination $destination -Force:$Force
      }
      else {
        Write-Verbose "Dry run: would archive '$itemPath' -> '$destination'"
      }

      $results += [ordered]@{
        path = $itemPath
        type = $metrics.type
        sizeBytes = $metrics.sizeBytes
        status = "archived"
        destination = $destination
      }
    }
    else {
      if (-not $DryRun) {
        Write-Verbose "Deleting '$itemPath'"
        Remove-Item -LiteralPath $itemPath -Force -Recurse
      }
      else {
        Write-Verbose "Dry run: would delete '$itemPath'"
      }

      $results += [ordered]@{
        path = $itemPath
        type = $metrics.type
        sizeBytes = $metrics.sizeBytes
        status = "deleted"
      }
    }
  }
  catch {
    $results += [ordered]@{
      path = $itemPath
      type = $metrics.type
      sizeBytes = $metrics.sizeBytes
      status = "failed"
      reason = $_.Exception.Message
    }
  }
}

$processedResults = @(
  $results | Where-Object { $_.status -in @("archived", "deleted") }
)

$processedFileCount = @(
  $processedResults | Where-Object { $_.type -eq "file" }
).Count

$processedFolderCount = @(
  $processedResults | Where-Object { $_.type -eq "directory" }
).Count

$processedBytes = [long](
  $processedResults |
    Measure-Object -Property sizeBytes -Sum |
    Select-Object -ExpandProperty Sum
)

$reportObject = [ordered]@{
  processedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  input = [System.IO.Path]::GetFullPath($InputPath)
  mode = $Mode
  dryRun = [bool]$DryRun
  processedFileCount = $processedFileCount
  processedFolderCount = $processedFolderCount
  totalProcessedCount = ($processedFileCount + $processedFolderCount)
  totalSpaceProcessedBytes = $processedBytes
  results = $results
}

$reportPath = [System.IO.Path]::GetFullPath($Report)
$reportDir = Split-Path -Path $reportPath -Parent
if (-not (Test-Path -LiteralPath $reportDir)) {
  New-Item -ItemType Directory -Path $reportDir -Force | Out-Null
}

$reportObject | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $reportPath -Encoding UTF8
Write-Host "Wrote report: $reportPath"

if ($Mode -eq "archive") {
  $overwriteConflicts = @(
    $results | Where-Object {
      $_.status -eq "failed" -and $_.reason -like "Archive target already exists:*"
    }
  )

  if ($overwriteConflicts.Count -gt 0) {
    throw "Archive aborted because one or more targets already exist. Re-run with -Force to overwrite them. See report: $reportPath"
  }
}
