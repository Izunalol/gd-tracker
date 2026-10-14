# Builds the shareable single-file GDTracker.exe into .\dist
# Requires the .NET 8 SDK (winget install Microsoft.DotNet.SDK.8).
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$project = Join-Path $root 'src\GDTracker\GDTracker.csproj'
$out = Join-Path $root 'dist'

dotnet publish $project -c Release -r win-x64 --self-contained true `
    -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true `
    -p:EnableCompressionInSingleFile=true -p:DebugType=none -o $out -nologo
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed" }
Write-Host "Built dist\GDTracker.exe"
