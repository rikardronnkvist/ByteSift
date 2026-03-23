# ByteSift

ByteSift is an open-source toolkit for finding large and stale files before they become storage debt.

It includes:
- A React + Vite + TypeScript web app for interactive tree analysis
- PowerShell scanner script that generates input JSON
- PowerShell archive/delete script that processes output JSON
- Azure static web app deployment script (Storage Static Website)

## Features

- Interactive file tree
- Sort by name, size, created date, accessed date, or last-write date
- Configurable thresholds for stale age and minimum size
- Highlight stale and large files/directories

## Workflow

[![Workflow](README-images/workflow.png)](README-images/workflow.png)

- Target a folder with the PowerShell scanner - `bs-scanner.ps1`
- Import JSON file to web front
- Mark stale and large files
- Export JSON from web front
- Target exported JSON with the archive/delete script - `bs-archive.ps1`
- Delete or archive files and folders


## Project Structure

- `.github/workflows/ci.yml`: CI pipeline
- `.github/workflows/deploy-azure.yml`: Azure pipeline
- `.github/workflows/deploy-github-pages.yml`: GitHub Pages pipeline
- `src/`: ByteSift web app (React/Vite)
- `public/sample-input.json`: realistic sample scan data (100+ nodes)
- `scripts/bs-scanner.ps1`: PowerShell scanner
- `scripts/bs-archive.ps1`: PowerShell archive/delete executor
- `scripts/bs-deploy-webapp.ps1`: Azure deployment helper

# Demo

Demo site: https://rikardronnkvist.github.io/ByteSift/

## Screenshot

[![Screenshot](README-images/screenshot.png)](README-images/screenshot.png)

# Scanner Scripts

## PowerShell scanner

```powershell
pwsh ./scripts/bs-scanner.ps1 -Root "/path/to/root"
```

Exclude folders by name or wildcard path pattern:

```powershell
pwsh ./scripts/bs-scanner.ps1 -Root "/path/to/root" -ExcludeFolder "node_modules",".git","dist/*"
```

## Archive/Delete Scripts

Use json exported by the web app.

### Archive files

```powershell
pwsh ./scripts/bs-archive.ps1 -Input "output.json" -Archive -ArchiveRoot "./bytesift-archive"
```

### Delete files, create a report and show verbose messages

```powershell
pwsh ./scripts/bs-archive.ps1 -Input "output.json" -Delete -Report "./bytesift-report.json" -Verbose
```

### Dry-run preview is available in archive script:

```powershell
pwsh ./scripts/bs-archive.ps1 -Input "output.json" -Archive -DryRun
```

# Deployment

## Local Web App for development

Requirements:
- Node.js 20+ (Node.js 22 recommended)
- npm

Install and run:

```bash
npm install
npm run dev
```


## Deploy Web App To Azure

Requirements:
- Azure CLI installed and logged in (`az login`)
- PowerShell 7+

Deploy to Azure Storage static website:

```powershell
pwsh ./scripts/bs-deploy-webapp.ps1 -ResourceGroup "rg-bytesift" -Location "swedencentral" -StorageAccount "stbytesift"
```

## Deploy Web App To GitHub Pages

This repository includes a workflow that builds and deploys the web app to GitHub Pages.

Workflow:
- `.github/workflows/deploy-github-pages.yml`

How it works:
- On push to `main` (or manual run), GitHub Actions builds the app with `VITE_BASE_PATH=/ByteSift/`
- The workflow publishes `dist/` using the official Pages deploy actions
- `dist/index.html` is copied to `dist/404.html` for SPA refresh/deep-link fallback on Pages

Requirements:
- GitHub Pages enabled in repository settings
- Source set to **GitHub Actions**

Notes:
- The sample loader uses `import.meta.env.BASE_URL`, so `sample-input.json` resolves correctly under the repository subpath on Pages.
- If you fork or rename the repository, update `VITE_BASE_PATH` in the workflow to match the new repo path.

## Deploy Web App To IIS

This web app is a static React/Vite SPA and can be hosted in IIS.

Requirements:
- IIS with Static Content enabled
- [URL Rewrite Module](https://www.iis.net/downloads/microsoft/url-rewrite) installed
- [Node.js](https://nodejs.org/en/download) 20+ and npm on build machine

Build the app:

```bash
npm install
npm run build
```

- The build output already includes `web.config` from `public/web.config`.
- Publish the `dist/` folder to your IIS site physical path.
- The bundled IIS config lives in [public/web.config](public/web.config) and is copied to `dist/web.config` during build.

**Notes:**
- If IIS site is hosted under a virtual directory (not `/`), set Vite `base` in `vite.config.ts` before build.
- `npm run build` produces a deployable `dist/` folder that already contains `web.config`.
- If IIS already defines a MIME type for `.json` or `.webmanifest`, use the `remove` entries above or omit the duplicate mapping.

# License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
