<#
.SYNOPSIS
Runs the script tests, bundles DOMQL, builds the package project, and checks its formatting.

.PARAMETER Clean
Removes every build output first, so the build starts from nothing.

.PARAMETER Browser
Also runs the tests that need a real browser's layout, in headless Chromium, which is installed first if it is not.

.EXAMPLE
./build.ps1 -Clean

.EXAMPLE
./build.ps1 -Browser
#>
[CmdletBinding()]
param(
    [switch] $Clean,
    [switch] $Browser
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot
$nuget = Join-Path $root 'nuget'
$solution = 'Forma.DOMQL.slnx'
$tests = Join-Path $root 'tests'
$artifacts = Join-Path $root 'artifacts'

if ($Clean) {
    # The package project's bin and obj, its bundle, and the packed artifacts, which dotnet clean alone leaves behind.
    Write-Host 'Cleaning'
    Get-ChildItem $nuget -Directory -Recurse -Include 'bin', 'obj', 'wwwroot' | Remove-Item -Recurse -Force
    if (Test-Path $artifacts) {
        Remove-Item $artifacts -Recurse -Force
    }
}

foreach ($folder in $root, $tests) {
    if (-not (Test-Path (Join-Path $folder 'node_modules'))) {
        Write-Host "Restoring $(Split-Path $folder -Leaf)"
        npm ci --prefix $folder --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) {
            throw "npm ci failed for $folder."
        }
    }
}

Write-Host 'Testing the scripts'
npm test --prefix $tests
if ($LASTEXITCODE -ne 0) {
    throw 'The script tests failed.'
}

if ($Browser) {
    Write-Host 'Testing in a browser'
    npx --prefix $tests playwright install chromium
    if ($LASTEXITCODE -ne 0) {
        throw 'Installing the browser failed.'
    }

    npm run test:browser --prefix $tests
    if ($LASTEXITCODE -ne 0) {
        throw 'The browser tests failed.'
    }
}

Write-Host 'Bundling'
npm run bundle --prefix $root
if ($LASTEXITCODE -ne 0) {
    throw 'The bundle failed.'
}

# dotnet finds global.json from the working directory up, so the SDK it pins applies from the package project's folder.
Push-Location $nuget
try {
    Write-Host 'Building'
    dotnet build $solution -nologo
    if ($LASTEXITCODE -ne 0) {
        throw 'dotnet build failed.'
    }

    Write-Host 'Checking formatting'
    dotnet format $solution --verify-no-changes
    if ($LASTEXITCODE -ne 0) {
        throw 'dotnet format found changes to make; run: dotnet format Forma.DOMQL.slnx from nuget/'
    }
}
finally {
    Pop-Location
}
