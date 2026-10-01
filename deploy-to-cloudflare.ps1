# Deploy-to-Cloudflare helper for OHMWORKS
# Usage: run in PowerShell from the site folder (C:\inetpub\ohmworks) as a user with network access.
# This script attempts 3 methods (in order):
# 1) Use 'wrangler' to publish directly to Cloudflare Pages
# 2) Use GitHub CLI 'gh' to create a repo and push the project (so you can connect Pages)
# 3) Initialize a local git repo and give instructions to push manually

$ErrorActionPreference = 'Stop'
Write-Output "OHMWORKS deploy helper — attempting automated deploy steps"

$cwd = Get-Location
Write-Output "Working directory: $cwd"

# Method 1: wrangler publish
if (Get-Command wrangler -ErrorAction SilentlyContinue) {
    try {
        Write-Output "Found 'wrangler'. Version: $(wrangler --version 2>$null)"
        if (-not $env:CLOUDFLARE_API_TOKEN) {
            Write-Output "CLOUDFLARE_API_TOKEN not found. If you prefer token auth, set CLOUDFLARE_API_TOKEN and rerun.\nI'll run 'wrangler login' to authenticate via browser now."
            wrangler login
        }
        Write-Output "Publishing site using 'wrangler pages publish .' (this will upload the current directory)."
        wrangler pages publish . --project-name ohmworks --branch main
        Write-Output "wrangler publish finished. Check the Pages dashboard for the site URL."
        exit 0
    } catch {
        Write-Error "wrangler publish failed: $_"
    }
}

# Method 2: GitHub CLI create + push
if (Get-Command gh -ErrorAction SilentlyContinue) {
    try {
        Write-Output "Found 'gh' (GitHub CLI). Creating repo and pushing..."
        gh repo create fooman82/ohmworks --public --source=. --remote=origin --push --confirm
        Write-Output "Repository created and pushed. Now go to Cloudflare Pages and connect the repo: https://dash.cloudflare.com/pages"
        exit 0
    } catch {
        Write-Error "gh repo create failed: $_"
    }
}

# Method 3: Local git init and guidance
if (Get-Command git -ErrorAction SilentlyContinue) {
    try {
        Write-Output "git found. Initializing local repository and committing files..."
        git init
        git branch -M main
        git add .
        git commit -m "Initial commit: OHMWORKS site scaffold"
        Write-Output "Local repo created. To publish to GitHub and connect to Pages, run these commands (replace if needed):"
        Write-Output "  git remote add origin https://github.com/fooman82/ohmworks.git"
        Write-Output "  git push -u origin main"
        Write-Output "If you prefer, create the repo on GitHub first, then push. After the repo is on GitHub, connect it to Cloudflare Pages in the dashboard."
        exit 0
    } catch {
        Write-Error "git steps failed: $_"
    }
}

Write-Error "No suitable tooling found. Install 'wrangler' (preferred for direct Pages publish) or 'gh'/'git'.\nHints:\n - wrangler: https://developers.cloudflare.com/pages/platform/cli/\n - gh (GitHub CLI): https://cli.github.com/\n - git: https://git-scm.com/download/win\nOnce installed, re-run this script: .\deploy-to-cloudflare.ps1"}
