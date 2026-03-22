<#
.SYNOPSIS
Builds and deploys the ByteSift web app to Azure Storage static website hosting.

.DESCRIPTION
Creates or updates an Azure resource group and storage account, enables static website
hosting, and uploads the built `dist` content to the `$web` container.
By default, the script also runs dependency install and web build before deployment.

.PARAMETER ResourceGroup
Azure resource group name to create or reuse.

.PARAMETER Location
Azure region used when creating resources.

.PARAMETER StorageAccount
Azure Storage account name for static website hosting.

.PARAMETER SkipBuild
Skips `npm ci` and `npm run build`. Use when `dist` already exists and is up to date.

.EXAMPLE
pwsh ./scripts/bs-deploy-webapp.ps1

Deploys with default resource names and builds before upload.

.EXAMPLE
pwsh ./scripts/bs-deploy-webapp.ps1 -ResourceGroup "rg-bytesift" -Location "swedencentral" -StorageAccount "stbytesift" -SkipBuild

Deploys to specified Azure resources without rebuilding.

.NOTES
Requires Azure CLI (`az`) and an authenticated session (`az login`).
Run from the project root.
#>
param(
  [string]$ResourceGroup = "rg-bytesift",
  [string]$Location = "swedencentral",
  [string]$StorageAccount = "stbytesift",
  [switch]$SkipBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$currentDir = (Get-Location).Path

if ([System.IO.Path]::GetFullPath($currentDir) -ne [System.IO.Path]::GetFullPath($projectRoot)) {
  throw "Run this script from project root: $projectRoot (current: $currentDir)"
}

if (-not $SkipBuild) {
  Write-Host "Installing dependencies and building web app..."
  npm ci
  if ($LASTEXITCODE -ne 0) { throw "'npm ci' failed with exit code $LASTEXITCODE." }
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "'npm run build' failed with exit code $LASTEXITCODE." }
}

$distPath = Join-Path -Path (Get-Location).Path -ChildPath "dist"
if (-not (Test-Path -LiteralPath $distPath)) {
  throw "dist folder not found. Run npm run build first."
}

Write-Host "Creating resource group and storage account..."
az group create --name $ResourceGroup --location $Location | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Failed to create or verify resource group '$ResourceGroup'." }

az storage account create --name $StorageAccount --resource-group $ResourceGroup --location $Location --sku Standard_LRS --kind StorageV2 | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Failed to create or verify storage account '$StorageAccount'." }

Write-Host "Enabling static website hosting..."
az storage blob service-properties update --account-name $StorageAccount --static-website --index-document index.html --404-document index.html --auth-mode login | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Failed to enable static website hosting on '$StorageAccount'." }

Write-Host "Uploading built files to Azure Storage static website..."
az storage blob upload-batch --destination '$web' --source $distPath --account-name $StorageAccount --auth-mode login --overwrite | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Failed to upload files to storage account '$StorageAccount'." }

$endpoint = az storage account show --name $StorageAccount --resource-group $ResourceGroup --query "primaryEndpoints.web" -o tsv
Write-Host "Deployment finished: $endpoint"
