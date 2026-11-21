[CmdletBinding()]
param(
    [string]$Message,
    [string]$ConfigPath = 'podcast.private.json',
    [string]$Repository = 'craiggormanbsl/video-blog',
    [string]$Remote = 'origin',
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Invoke-Native {
    param([string]$FilePath, [string[]]$Arguments)
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$FilePath $($Arguments -join ' ') failed with exit code $LASTEXITCODE." }
}

function Invoke-Step {
    param([string]$Description, [scriptblock]$Action)
    if ($DryRun) {
        Write-Host "[dry run] $Description"
    } else {
        Write-Host $Description
        & $Action
    }
}

$resolvedConfig = Resolve-Path -LiteralPath $ConfigPath
$configJson = [IO.File]::ReadAllText($resolvedConfig)
$null = $configJson | ConvertFrom-Json

$branch = (& git branch --show-current).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Could not determine the current Git branch.' }
if ($branch -ne 'main') { throw "Publishing must be run from main. Current branch: $branch" }

$trackedConfig = & git ls-files -- $ConfigPath
if ($trackedConfig) { throw "$ConfigPath is tracked by Git. Remove it from the index before publishing." }

$portableGh = Join-Path $env:LOCALAPPDATA 'Programs\GitHub CLI'
if (-not (Get-Command gh -ErrorAction SilentlyContinue) -and (Test-Path (Join-Path $portableGh 'gh.exe'))) {
    $env:Path = "$portableGh;$env:Path"
}
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    $ghMessage = 'GitHub CLI is required. Install it with: winget install --id GitHub.cli; then run: gh auth login'
    if ($DryRun) { Write-Warning $ghMessage } else { throw $ghMessage }
} elseif (-not $DryRun) {
    Invoke-Native gh @('auth', 'status', '--hostname', 'github.com')
}

$changes = & git status --porcelain
if ($LASTEXITCODE -ne 0) { throw 'Could not read Git status.' }
if ($changes -and -not $Message) { throw 'There are changes to commit. Supply -Message "Describe the change".' }

if ($changes) {
    Invoke-Step 'Staging repository changes' { Invoke-Native git @('add', '--all') }
    if (-not $DryRun) {
        $stagedConfig = & git diff --cached --name-only -- $ConfigPath
        if ($stagedConfig) { throw "$ConfigPath was staged. It must stay private." }
    }
    Invoke-Step "Committing: $Message" {
        Invoke-Native git @('commit', '-m', $Message, '-m', 'Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>')
    }
}

Invoke-Step "Updating $Repository Actions secret PODCAST_CONFIG_JSON from $ConfigPath" {
    $configJson | & gh secret set PODCAST_CONFIG_JSON --repo $Repository
    if ($LASTEXITCODE -ne 0) { throw 'Could not update PODCAST_CONFIG_JSON.' }
}

Invoke-Native git @('fetch', $Remote, $branch)
$ahead = [int](& git rev-list --count "$Remote/$branch..HEAD")
if ($LASTEXITCODE -ne 0) { throw "Could not compare HEAD with $Remote/$branch." }
$behind = [int](& git rev-list --count "HEAD..$Remote/$branch")
if ($LASTEXITCODE -ne 0) { throw "Could not compare $Remote/$branch with HEAD." }
if ($behind -gt 0) { throw "$Remote/$branch has $behind newer commit(s). Pull and resolve them before publishing." }

if ($ahead -gt 0 -or ($changes -and $DryRun)) {
    Invoke-Step "Pushing $branch to $Remote; GitHub Pages will publish from that push" {
        Invoke-Native git @('push', $Remote, $branch)
    }
} else {
    Invoke-Step 'No commits to push; starting the publish workflow for the updated configuration' {
        Invoke-Native gh @('workflow', 'run', 'publish.yml', '--repo', $Repository, '--ref', $branch)
    }
}
