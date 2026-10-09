<#
.SYNOPSIS
Bundles DOMQL into the single minified file the package ships and packs the package.

.DESCRIPTION
Runs the gate first, so nothing unbuilt, untested or misformatted is packed, then writes the package to artifacts/. Pushing it to a feed is left to the caller.

.EXAMPLE
./publish.ps1
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot
$nuget = Join-Path $root 'nuget'
$artifacts = Join-Path $root 'artifacts'

& (Join-Path $root 'build.ps1')

# dotnet finds global.json from the working directory up, so the SDK it pins applies from the package project's folder.
Write-Host 'Packing'
Push-Location $nuget
try {
    dotnet pack Forma.DOMQL.csproj -c Release -nologo -o $artifacts
    if ($LASTEXITCODE -ne 0) {
        throw 'dotnet pack failed.'
    }
}
finally {
    Pop-Location
}

Get-ChildItem $artifacts -Filter '*.nupkg' | ForEach-Object { Write-Host "Packed $($_.FullName)" }
