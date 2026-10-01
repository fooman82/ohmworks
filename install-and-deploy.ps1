<#
Install-and-deploy helper for OHMWORKS
Run this script in an elevated PowerShell (Run as Administrator) from C:\inetpub\ohmworks
It will attempt to:
 - install git, node, and gh using winget or choco (if available)
 - install wrangler via npm
 - create a GitHub repo (using gh) and push the project
 - optionally publish to Cloudflare Pages using wrangler

Usage:
  1) Open PowerShell as Administrator
  2) cd C:\inetpub\ohmworks
  3) .\install-and-deploy.ps1

Note: this script cannot provide credentials. 'gh' will open an interactive auth flow if not logged in.
#>

$ErrorActionPreference = 'Stop'

function Ensure-Admin {
    $isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
    if (-not $isAdmin) {
        Write-Error "This script must be run as Administrator. Right-click PowerShell -> Run as Administrator and re-run the script."
        exit 1
    }
}

function Install-With-Winget($id) {
    Write-Output "Installing $id via winget..."
    winget install --id $id -e --accept-package-agreements --accept-source-agreements
}

function Install-With-Choco($pkg) {
    Write-Output "Installing $pkg via choco..."
    choco install $pkg -y
}

Ensure-Admin

Write-Output "Working directory: $(Get-Location)"

# Install git
if (Get-Command git -ErrorAction SilentlyContinue) {
    Write-Output "git already installed: $(git --version)"
} else {
    if (Get-Command winget -ErrorAction SilentlyContinue) { Install-With-Winget 'Git.Git' }
    elseif (Get-Command choco -ErrorAction SilentlyContinue) { Install-With-Choco 'git' }
    else { Write-Output "Neither winget nor choco found. Please install Git for Windows: https://git-scm.com/download/win"; exit 1 }
}

# Install Node (for wrangler)
if (Get-Command node -ErrorAction SilentlyContinue) {
    Write-Output "node already installed: $(node --version)"
} else {
    if (Get-Command winget -ErrorAction SilentlyContinue) { Install-With-Winget 'OpenJS.NodeJS.LTS' }
    elseif (Get-Command choco -ErrorAction SilentlyContinue) { Install-With-Choco 'nodejs-lts' }
    else { Write-Output "Neither winget nor choco found. Please install Node.js LTS: https://nodejs.org/"; exit 1 }
}

# Install GitHub CLI
if (Get-Command gh -ErrorAction SilentlyContinue) {
    Write-Output "gh already installed: $(gh --version | Select-String 'gh version' -SimpleMatch)"
} else {
    if (Get-Command winget -ErrorAction SilentlyContinue) { Install-With-Winget 'GitHub.cli' }
    elseif (Get-Command choco -ErrorAction SilentlyContinue) { Install-With-Choco 'gh' }
    else { Write-Output "Neither winget nor choco found. Install GitHub CLI manually: https://cli.github.com/"; exit 1 }
}

# Install wrangler via npm
if (Get-Command wrangler -ErrorAction SilentlyContinue) {
    Write-Output "wrangler already installed: $(wrangler --version)"
} else {
    if (Get-Command npm -ErrorAction SilentlyContinue) {
        Write-Output "Installing wrangler globally via npm..."
        npm install -g wrangler
    } else {
        Write-Output "npm not found even after Node installation. Please ensure Node/npm are correctly installed."; exit 1
    }
}

# Verify tools
Write-Output "Installed tool versions:"
git --version
node --version
npm --version
gh --version
wrangler --version

# Initialize git, commit, create GitHub repo and push
if (-not (Test-Path .git)) {
    Write-Output "Initializing local git repo..."
    git init
    git branch -M main
    git add .
    git commit -m "Initial commit: OHMWORKS site scaffold"
} else {
    Write-Output "Local git repo already exists"
}

# Create GitHub repo with gh
$repoName = 'ohmworks'
$repoOwner = 'fooman82'
$fullName = "$repoOwner/$repoName"
try {
    if (-not (gh repo view $fullName 2>$null)) {
        Write-Output "Creating GitHub repo $fullName..."
        gh repo create $fullName --public --source=. --remote=origin --push --confirm
    } else {
        Write-Output "GitHub repo $fullName already exists or is accessible"
    }
} catch {
    Write-Error "gh repo create failed: $_\nIf the repo already exists, add the remote manually: git remote add origin https://github.com/$fullName.git && git push -u origin main"
}

# Optionally publish with wrangler
Write-Output "Would you like to publish directly to Cloudflare Pages using wrangler? (y/N)"
$ans = Read-Host
if ($ans -eq 'y' -or $ans -eq 'Y') {
    Write-Output "Publishing with wrangler pages publish . --project-name ohmworks --branch main"
    wrangler pages publish . --project-name ohmworks --branch main
    Write-Output "Publish finished. Check Cloudflare Pages dashboard for the site."
} else {
    Write-Output "Skipping direct publish. You can connect https://github.com/$fullName to Cloudflare Pages via the dashboard." 
}

Write-Output "Done."
