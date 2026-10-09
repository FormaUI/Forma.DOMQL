<#
.SYNOPSIS
Builds the solution, runs its script tests, and checks its formatting.

.PARAMETER Clean
Removes every build output first, so the build starts from nothing.

.EXAMPLE
./build.ps1 -Clean
#>
[CmdletBinding()]
param(
    [switch] $Clean
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot
$solution = Join-Path $root 'Forma.DOMQL.slnx'
$scriptTests = Join-Path $root 'tests/Forma.DOMQL.Tests.Scripts'
$artifacts = Join-Path $root 'artifacts'

if ($Clean) {
    # Every bin and obj under the projects goes, and the packed artifacts with them, which dotnet clean alone leaves behind.
    Write-Host 'Cleaning'
    Get-ChildItem (Join-Path $root 'src'), (Join-Path $root 'tests') -Directory -Recurse -Include 'bin', 'obj' | Remove-Item -Recurse -Force
    if (Test-Path $artifacts) {
        Remove-Item $artifacts -Recurse -Force
    }
}

Write-Host 'Building'
dotnet build $solution -nologo
if ($LASTEXITCODE -ne 0) {
    throw 'dotnet build failed.'
}

Write-Host 'Testing the scripts'
if (-not (Test-Path (Join-Path $scriptTests 'node_modules'))) {
    npm ci --prefix $scriptTests --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) {
        throw 'npm ci failed for the script tests.'
    }
}

npm test --prefix $scriptTests
if ($LASTEXITCODE -ne 0) {
    throw 'The script tests failed.'
}

Write-Host 'Checking formatting'
dotnet format $solution --verify-no-changes
if ($LASTEXITCODE -ne 0) {
    throw 'dotnet format found changes to make; run: dotnet format Forma.DOMQL.slnx'
}
