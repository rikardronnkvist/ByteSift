# ByteSift

ByteSift is an open-source toolkit for finding large and stale files before they become storage debt.

It includes:
- A React + Vite + TypeScript web app for interactive tree analysis
- PowerShell scanner script that generates input JSON
- PowerShell archive/delete script that processes output JSON
- Azure static web app deployment script (Storage Static Website)
- GitHub Actions CI workflow

## Features

- Interactive file tree with directory expansion/collapse
- Human-readable sizes (KB/MB/GB/TB)
- Sort by name, size, created date, accessed date, or last-write date
- Configurable thresholds for stale age and minimum size
- Highlight stale and large files/directories
- Export selected items as json

## Project Structure

- `.github/workflows/ci.yml`: CI pipeline
- `.github/workflows/deploy-azure.yml`: Azure pipeline
- `src/`: ByteSift web app (React/Vite)
- `public/sample-input.json`: realistic sample scan data (100+ nodes)
- `scripts/bs-scanner.ps1`: PowerShell scanner
- `scripts/bs-archive.ps1`: PowerShell archive/delete executor
- `scripts/bs-generate-sample.ps1`: sample dataset generator
- `scripts/bs-deploy-webapp.ps1`: Azure deployment helper

## Local Web App

Requirements:
- Node.js 20+ (Node.js 22 recommended)
- npm

Install and run:

```bash
npm install
npm run dev
```

## Scanner Scripts

### PowerShell scanner

```powershell
pwsh ./scripts/bs-scanner.ps1 -Root "/path/to/root"
```

## Archive/Delete Scripts

Use json exported by the web app.

### PowerShell archive

```powershell
pwsh ./scripts/bs-archive.ps1 -Input "output.json" -Mode archive -ArchiveRoot "./bytesift-archive"
```

### PowerShell delete

```powershell
pwsh ./scripts/bs-archive.ps1 -Input "output.json" -Mode delete
```

Dry-run preview is available in archive script:

```powershell
pwsh ./scripts/bs-archive.ps1 -Input "output.json" -Mode archive -DryRun
```

## Deploy Web App To Azure

Requirements:
- Azure CLI installed and logged in (`az login`)
- PowerShell 7+

Deploy to Azure Storage static website:

```powershell
pwsh ./scripts/bs-deploy-webapp.ps1 -ResourceGroup "rg-bytesift" -Location "swedencentral" -StorageAccount "stbytesift"
```

The script will:
- Run `npm ci` and `npm run build` (unless `-SkipBuild` is set)
- Create/update resource group and storage account
- Enable static website hosting
- Upload `dist/` contents to `$web`
- Print the public endpoint URL

## CI

GitHub Actions runs on push and pull requests:
- `npm ci`
- `npm run lint`
- `npm run build`
