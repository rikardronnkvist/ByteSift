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

- Target a folder with the `bs-scanner.ps1` script
- Import JSON file to web front
- Mark stale and large files
- Export JSON
- Target exported JSON with `bs-archive.ps1`
- Delete or archive files and folders


## Project Structure

- `.github/workflows/ci.yml`: CI pipeline
- `.github/workflows/deploy-azure.yml`: Azure pipeline
- `src/`: ByteSift web app (React/Vite)
- `public/sample-input.json`: realistic sample scan data (100+ nodes)
- `scripts/bs-scanner.ps1`: PowerShell scanner
- `scripts/bs-archive.ps1`: PowerShell archive/delete executor
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

## Deploy Web App To Azure

Requirements:
- Azure CLI installed and logged in (`az login`)
- PowerShell 7+

Deploy to Azure Storage static website:

```powershell
pwsh ./scripts/bs-deploy-webapp.ps1 -ResourceGroup "rg-bytesift" -Location "swedencentral" -StorageAccount "stbytesift"
```

## Deploy Web App To On-Prem IIS

This web app is a static React/Vite SPA and can be hosted in IIS.

Requirements:
- IIS with Static Content enabled
- URL Rewrite Module installed
- Node.js 20+ and npm on build machine

Build the app:

```bash
npm install
npm run build
```

Publish the `dist/` folder to your IIS site physical path.

For SPA route fallback, add `web.config` in the deployed site root (same level as `index.html`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
	<system.webServer>
		<rewrite>
			<rules>
				<rule name="SPA Fallback" stopProcessing="true">
					<match url=".*" />
					<conditions logicalGrouping="MatchAll">
						<add input="{REQUEST_FILENAME}" matchType="IsFile" negate="true" />
						<add input="{REQUEST_FILENAME}" matchType="IsDirectory" negate="true" />
					</conditions>
					<action type="Rewrite" url="/index.html" />
				</rule>
			</rules>
		</rewrite>
		<staticContent>
			<mimeMap fileExtension=".json" mimeType="application/json" />
			<mimeMap fileExtension=".webmanifest" mimeType="application/manifest+json" />
		</staticContent>
	</system.webServer>
</configuration>
```

Notes:
- If IIS site is hosted under a virtual directory (not `/`), set Vite `base` in `vite.config.ts` before build.
- If you want `web.config` copied automatically on build, place it in `public/web.config`.

## Screenshot

[![Screenshot](README-images/screenshot.png)](README-images/screenshot.png)
