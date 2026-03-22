<#
.SYNOPSIS
Generates a deterministic sample scan dataset for the ByteSift web app.

.DESCRIPTION
Builds a synthetic directory tree with realistic file sizes and timestamps and writes
the result to `public/sample-input.json` for local testing and demos.
The generated data is deterministic because the random seed is fixed.

.EXAMPLE
pwsh ./scripts/bs-generate-sample.ps1

Regenerates `public/sample-input.json` and prints the total node count.

.NOTES
No parameters are required.
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$random = [System.Random]::new(42)
$now = [datetime]::UtcNow

$TEAMS = @('engineering', 'design', 'finance', 'marketing', 'ops')
$PROJECTS = @('apollo', 'mercury', 'atlas', 'helix', 'orbit', 'drift')
$EXTENSIONS = @('.log', '.zip', '.csv', '.json', '.tmp', '.bak', '.db', '.mp4', '.tar')

function Get-RandomInt64 {
  param(
    [long]$Min,
    [long]$Max
  )

  if ($Max -lt $Min) {
    throw "Invalid range: $Min..$Max"
  }

  $span = [double]($Max - $Min + 1)
  return [long]([math]::Floor($random.NextDouble() * $span) + $Min)
}

function Get-Iso {
  param([int]$DaysAgo)

  $shifted = $now.AddDays(-$DaysAgo).AddHours(-($random.Next(0, 24)))
  return $shifted.ToString('yyyy-MM-ddTHH:mm:ss.fffffffZ')
}

function New-Timestamps {
  param([int]$DaysSinceWrite)

  $creationDaysAgo = $DaysSinceWrite + $random.Next(0, 366)
  $lastWrite = Get-Iso -DaysAgo $DaysSinceWrite
  $creation = Get-Iso -DaysAgo $creationDaysAgo
  $lastAccess = Get-Iso -DaysAgo $random.Next(0, ([math]::Max(0, $creationDaysAgo) + 1))

  return [ordered]@{
    CreationTime = $creation
    LastAccessTime = $lastAccess
    LastWriteTime = $lastWrite
    modifiedAt = $lastWrite
  }
}

function New-FileNode {
  param(
    [string]$Path,
    [string]$Name,
    [long]$Size,
    [int]$Days
  )

  $timestamps = New-Timestamps -DaysSinceWrite $Days

  return [ordered]@{
    name = $Name
    path = "$Path/$Name"
    type = 'file'
    sizeBytes = $Size
    CreationTime = $timestamps.CreationTime
    LastAccessTime = $timestamps.LastAccessTime
    LastWriteTime = $timestamps.LastWriteTime
    modifiedAt = $timestamps.modifiedAt
  }
}

function New-DirNode {
  param(
    [string]$Path,
    [string]$Name,
    [object[]]$Children
  )

  [long]$size = 0
  foreach ($child in $Children) {
    $size += [long]$child.sizeBytes
  }

  $latestWrite = if ($Children.Count -gt 0) {
    ($Children | ForEach-Object { [string]$_.LastWriteTime } | Measure-Object -Maximum).Maximum
  }
  else {
    Get-Iso -DaysAgo 200
  }

  $latestAccess = if ($Children.Count -gt 0) {
    ($Children | ForEach-Object { [string]$_.LastAccessTime } | Measure-Object -Maximum).Maximum
  }
  else {
    Get-Iso -DaysAgo 150
  }

  $earliestCreation = if ($Children.Count -gt 0) {
    ($Children | ForEach-Object { [string]$_.CreationTime } | Measure-Object -Minimum).Minimum
  }
  else {
    Get-Iso -DaysAgo 400
  }

  return [ordered]@{
    name = $Name
    path = "$Path/$Name"
    type = 'directory'
    sizeBytes = $size
    CreationTime = $earliestCreation
    LastAccessTime = $latestAccess
    LastWriteTime = $latestWrite
    modifiedAt = $latestWrite
    children = $Children
  }
}

function Get-NodeCount {
  param([object]$Node)

  $total = 1
  $children = @()

  if ($Node -is [System.Collections.IDictionary]) {
    if ($Node.Contains('children')) {
      $children = @($Node['children'])
    }
  }
  elseif ($null -ne $Node.PSObject.Properties['children']) {
    $children = @($Node.children)
  }

  foreach ($child in $children) {
    $total += Get-NodeCount -Node $child
  }

  return $total
}

$rootPath = '/mnt/data/company-shares'
$rootChildren = @()

foreach ($team in $TEAMS) {
  $teamChildren = @()

  foreach ($project in $PROJECTS) {
    $projectChildren = @()

    foreach ($month in 1..6) {
      $monthPath = "$rootPath/$team/$project/2025-$('{0:D2}' -f $month)"
      $monthChildren = @()

      foreach ($index in 1..4) {
        $ext = $EXTENSIONS[$random.Next(0, $EXTENSIONS.Count)]
        $size = Get-RandomInt64 -Min 5000000 -Max 3200000000

        if ($ext -in @('.log', '.tmp')) {
          $size = Get-RandomInt64 -Min 700000 -Max 120000000
        }

        if ($ext -in @('.mp4', '.tar', '.zip')) {
          $size = Get-RandomInt64 -Min 500000000 -Max 6000000000
        }

        $days = $random.Next(5, 1301)
        $monthChildren += New-FileNode -Path $monthPath -Name ("snapshot-{0:D2}{1}" -f $index, $ext) -Size $size -Days $days
      }

      foreach ($index in 1..2) {
        $size = Get-RandomInt64 -Min 40000000 -Max 900000000
        $days = $random.Next(30, 1701)
        $monthChildren += New-FileNode -Path $monthPath -Name ("legacy-cache-{0:D2}.bin" -f $index) -Size $size -Days $days
      }

      $projectChildren += New-DirNode -Path "$rootPath/$team/$project" -Name ("2025-{0:D2}" -f $month) -Children $monthChildren
    }

    $teamChildren += New-DirNode -Path "$rootPath/$team" -Name $project -Children $projectChildren
  }

  $rootChildren += New-DirNode -Path $rootPath -Name $team -Children $teamChildren
}

$rootNode = New-DirNode -Path '/mnt/data' -Name 'company-shares' -Children $rootChildren
$payload = [ordered]@{
  rootPath = $rootPath
  generatedAt = $now.ToString('yyyy-MM-ddTHH:mm:ss.fffffffZ')
  node = $rootNode
}

$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptPath
$outFile = Join-Path -Path $projectRoot -ChildPath 'public/sample-input.json'

$outDir = Split-Path -Path $outFile -Parent
if (-not (Test-Path -LiteralPath $outDir)) {
  New-Item -ItemType Directory -Path $outDir -Force | Out-Null
}

$payload | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $outFile -Encoding UTF8

Write-Host "Wrote $outFile"
Write-Host "Total nodes: $(Get-NodeCount -Node $rootNode)"
