# npm postinstall (napi-postinstall / cmd) breaks when the repo path contains & (e.g. R&D).
# Map the project to Z:\ and run npm from there so PATH and cwd never contain &.
$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path

# If Z: is already mapped (leftover from a crashed run), remove it first.
if (subst.exe | Select-String -Pattern "^Z:\\") {
    Write-Host "Clearing existing Z: mapping ..."
    subst.exe Z: /d | Out-Null
}

Write-Host "Mapping Z: to:`n  $projectRoot"
$p = Start-Process -FilePath "subst.exe" -ArgumentList @("Z:", $projectRoot) -Wait -PassThru
if ($null -ne $p.ExitCode -and $p.ExitCode -ne 0) {
    Write-Error "subst failed with exit code $($p.ExitCode)"
    exit $p.ExitCode
}

try {
    Set-Location -LiteralPath "Z:\"
    Write-Host "Installing from $(Get-Location) ..."
    if ($args.Count -gt 0) {
        npm install @args
    } else {
        npm install
    }
    exit $LASTEXITCODE
}
finally {
    Set-Location -LiteralPath $env:USERPROFILE
    subst.exe Z: /d 2>$null | Out-Null
}
