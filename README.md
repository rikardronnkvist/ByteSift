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
- Sort by name, size, or modified date
- Filter by stale age and minimum size
- Search by path substring
- Highlight stale and large files/directories
- Export selected recommendations as output.json

## Project Structure

- `src/`: ByteSift web app (React/Vite)
- `public/sample-input.json`: realistic sample scan data (100+ nodes)
- `scripts/bs-scanner.ps1`: PowerShell scanner
- `scripts/bs-archive.ps1`: PowerShell archive/delete executor
- `scripts/bs-generate-sample.ps1`: sample dataset generator
- `scripts/bs-deploy-webapp.ps1`: Azure deployment helper
- `.github/workflows/ci.yml`: CI pipeline

## Local Web App

Requirements:
- Node.js 20+ (Node.js 22 recommended)
- npm

Install and run:

```bash
npm install
npm run dev
```

Build and preview:

```bash
npm run build
npm run preview
```

## Input JSON Schema

Scanner scripts generate this shape:

```json
{
  "rootPath": "/path/to/root",
  "generatedAt": "2026-03-21T10:40:00Z",
  "node": {
    "name": "root",
    "path": "/path/to/root",
    "type": "directory",
    "sizeBytes": 123456,
    "CreationTime": "2026-03-20T08:10:00Z",
    "LastAccessTime": "2026-03-21T09:15:00Z",
    "LastWriteTime": "2026-03-21T10:39:00Z",
    "modifiedAt": "2026-03-21T10:39:00Z",
    "children": []
  }
}
```

## Output JSON Schema

The web app exports selected recommendations as output.json:

```json
{
  "generatedAt": "2026-03-21T10:45:00Z",
  "sourceGeneratedAt": "2026-03-21T10:40:00Z",
  "rootPath": "/path/to/root",
  "items": [
    {
      "path": "/path/to/root/archive/old.tar",
      "type": "file",
      "sizeBytes": 542155448,
      "modifiedAt": "2022-05-05T09:10:00Z",
      "reasons": ["large", "stale"]
    }
  ]
}
```

## Scanner Scripts

Default output filename (when `--output`/`-Output` is omitted):
- `bytesift-YYMMDD.json` (example: `bytesift-260321.json`)

### PowerShell scanner

```powershell
pwsh ./scripts/bs-scanner.ps1 -Root "/path/to/root"
```

## Archive/Delete Scripts

Use output.json exported by the web app.

Default input/report filenames (when `--input`/`-Input` and `--report`/`-Report` are omitted):
- `bytesift-YYMMDD.json` (example: `bytesift-260321.json`)
- `bytesift-report-YYMMDD.json` (example: `bytesift-report-260321.json`)

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

## Generate New Sample Data

```bash
npm run sample-data
```

## Deploy Web App To Azure

Requirements:
- Azure CLI installed and logged in (`az login`)
- PowerShell 7+

Deploy to Azure Storage static website:

```powershell
pwsh ./scripts/bs-deploy-webapp.ps1 -ResourceGroup "rg-bytesift" -Location "westeurope" -StorageAccount "bytesiftstatic123"
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

## License

MIT
