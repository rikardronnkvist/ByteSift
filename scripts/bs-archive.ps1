param(
  [string]$Input,
  [Parameter(Mandatory = $true)]
  [ValidateSet("archive", "delete")]
  [string]$Mode,
  [string]$ArchiveRoot = ".\bytesift-archive",
  [string]$Report,
  [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not $Input) {
  $Input = "bytesift-$((Get-Date).ToString('yyMMdd')).json"
}

if (-not $Report) {
  $Report = "bytesift-report-$((Get-Date).ToString('yyMMdd')).json"
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

if (-not (Test-Path -LiteralPath $Input)) {
  throw "Input file not found: $Input"
}

$payload = Get-Content -LiteralPath $Input -Raw | ConvertFrom-Json
$rootPath = if ($payload.rootPath) { [string]$payload.rootPath } else { (Get-Location).Path }
$items = @($payload.items)

$results = @()
$archiveRootPath = [System.IO.Path]::GetFullPath($ArchiveRoot)

if ($Mode -eq "archive" -and -not $DryRun) {
  New-Item -ItemType Directory -Path $archiveRootPath -Force | Out-Null
}

foreach ($item in $items) {
  $itemPath = [string]$item.path
  if (-not (Test-Path -LiteralPath $itemPath)) {
    $results += [ordered]@{ path = $itemPath; status = "skipped"; reason = "not found" }
    continue
  }

  try {
    if ($Mode -eq "archive") {
      $destination = Resolve-ArchiveDestination -ItemPath $itemPath -RootPath $rootPath -ArchiveRootPath $archiveRootPath
      if (-not $DryRun) {
        $destinationDir = Split-Path -Path $destination -Parent
        New-Item -ItemType Directory -Path $destinationDir -Force | Out-Null
        Move-Item -LiteralPath $itemPath -Destination $destination -Force
      }
      $results += [ordered]@{ path = $itemPath; status = "archived"; destination = $destination }
    }
    else {
      if (-not $DryRun) {
        Remove-Item -LiteralPath $itemPath -Force -Recurse
      }
      $results += [ordered]@{ path = $itemPath; status = "deleted" }
    }
  }
  catch {
    $results += [ordered]@{ path = $itemPath; status = "failed"; reason = $_.Exception.Message }
  }
}

$reportObject = [ordered]@{
  processedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  input = [System.IO.Path]::GetFullPath($Input)
  mode = $Mode
  dryRun = [bool]$DryRun
  results = $results
}

$reportPath = [System.IO.Path]::GetFullPath($Report)
$reportDir = Split-Path -Path $reportPath -Parent
if (-not (Test-Path -LiteralPath $reportDir)) {
  New-Item -ItemType Directory -Path $reportDir -Force | Out-Null
}

$reportObject | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $reportPath -Encoding UTF8
Write-Host "Wrote report: $reportPath"
