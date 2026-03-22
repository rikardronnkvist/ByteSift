<#
.SYNOPSIS
Processes a ByteSift export by archiving or deleting the listed paths.

.DESCRIPTION
Reads an exported ByteSift JSON file (`output.json` format) and performs one of two actions
for each item in `items`: move to an archive root (`-Archive`) or remove (`-Delete`).
The script writes a JSON report with per-item status and aggregate metrics.

.PARAMETER InputPath
Path to the ByteSift export JSON file.
`-Input` is supported as an alias for backward compatibility.

.PARAMETER Archive
Runs the script in archive mode. Items are moved to `-ArchiveRoot` while preserving
relative structure under the source `rootPath` when possible.

.PARAMETER Delete
Runs the script in delete mode. Items are removed with recursive force delete.

.PARAMETER Force
Archive mode only. Allows overwrite when archive destination already exists.
If omitted and a destination exists, the operation fails.

.PARAMETER ArchiveRoot
Archive mode only. Destination root folder where archived items are moved.

.PARAMETER Report
Path for the generated JSON report. If omitted, a timestamped report file is created
in the current working directory.

.PARAMETER DryRun
Simulates operations without moving or deleting files.

.EXAMPLE
pwsh ./scripts/bs-archive.ps1 -Input "output.json" -Archive -ArchiveRoot "./bytesift-archive"

Archives all items listed in `output.json`.

.EXAMPLE
pwsh ./scripts/bs-archive.ps1 -Input "output.json" -Delete -DryRun

Shows what would be deleted without modifying the filesystem.

.NOTES
Use `-Verbose` to print each archive/delete action as it is processed.
#>
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

function Format-Bytes {
  param([long]$Bytes)

  if ($Bytes -lt 1024) {
    return "$Bytes B"
  }

  $units = @("KB", "MB", "GB", "TB", "PB")
  [double]$value = $Bytes / 1024.0
  $unitIndex = 0

  while ($value -ge 1024 -and $unitIndex -lt ($units.Count - 1)) {
    $value = $value / 1024.0
    $unitIndex += 1
  }

  if ($value -ge 100) {
    return "{0:N0} {1}" -f $value, $units[$unitIndex]
  }

  return "{0:N1} {1}" -f $value, $units[$unitIndex]
}

if ([string]::IsNullOrWhiteSpace($InputPath)) {
  throw "Input file path is empty. Provide -Input or -InputPath."
}

if (-not (Test-Path -LiteralPath $InputPath)) {
  throw "Input file not found: $InputPath"
}

$inputFilePath = [System.IO.Path]::GetFullPath($InputPath)
Write-Host "Input file: $inputFilePath"

$payload = Get-Content -LiteralPath $InputPath -Raw | ConvertFrom-Json
$rootPath = if ($payload.rootPath) { [string]$payload.rootPath } else { (Get-Location).Path }
$items = @($payload.items)
$totalItems = @($items).Count
$processedItemIndex = 0
$progressActivity = if ($DryRun) {
  "Simulating $Mode operations"
}
else {
  "Running $Mode operations"
}

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
  $processedItemIndex += 1

  $percentComplete = if ($totalItems -gt 0) {
    [int](($processedItemIndex / $totalItems) * 100)
  }
  else {
    100
  }

  $progressPath = if ([string]::IsNullOrWhiteSpace($itemPath)) {
    "<unknown path>"
  }
  else {
    $itemPath
  }

  Write-Progress -Id 1 -Activity $progressActivity -Status "[$processedItemIndex/$totalItems] $progressPath" -PercentComplete $percentComplete
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

Write-Progress -Id 1 -Activity $progressActivity -Completed

$processedResults = @(
  $results | Where-Object { $_.status -in @("archived", "deleted") }
)

$processedFileCount = @(
  $processedResults | Where-Object { $_.type -eq "file" }
).Count

$processedFolderCount = @(
  $processedResults | Where-Object { $_.type -eq "directory" }
).Count

[long]$processedBytes = 0
foreach ($result in $processedResults) {
  if ($result -is [System.Collections.IDictionary]) {
    if ($result.Contains("sizeBytes")) {
      $processedBytes += [long]$result["sizeBytes"]
    }
  }
  elseif ($null -ne $result.PSObject.Properties["sizeBytes"]) {
    $processedBytes += [long]$result.sizeBytes
  }
}

$reportObject = [ordered]@{
  processedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  input = $inputFilePath
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

$archivedCount = @(
  $results | Where-Object { $_.status -eq "archived" }
).Count

$deletedCount = @(
  $results | Where-Object { $_.status -eq "deleted" }
).Count

$skippedCount = @(
  $results | Where-Object { $_.status -eq "skipped" }
).Count

$failedCount = @(
  $results | Where-Object { $_.status -eq "failed" }
).Count

$summaryAction = if ($Mode -eq "archive") { "Archived" } else { "Deleted" }
$summaryActionDryRun = if ($Mode -eq "archive") { "Would archive" } else { "Would delete" }

Write-Host "Summary:"
Write-Host "  Mode: $Mode$(if ($DryRun) { ' (dry-run)' } else { '' })"
Write-Host "  $(if ($DryRun) { $summaryActionDryRun } else { $summaryAction }) items: $($archivedCount + $deletedCount)"
Write-Host "  Skipped items: $skippedCount"
Write-Host "  Failed items: $failedCount"
Write-Host "  Total processed files: $processedFileCount"
Write-Host "  Total processed folders: $processedFolderCount"
Write-Host "  Total processed size: $(Format-Bytes -Bytes $processedBytes) ($processedBytes bytes)"
Write-Host "Report: $reportPath"

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
