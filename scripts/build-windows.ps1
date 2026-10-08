param([switch]$NoPause)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$buildSucceeded = $false
try {
    Write-Host 'Reset - create the Windows installer' -ForegroundColor Cyan
    $cargoBin = Join-Path $env:USERPROFILE '.cargo\bin'
    if (Test-Path -LiteralPath $cargoBin) { $env:Path = "$cargoBin;$env:Path" }
    if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
        throw 'Install Node.js 22 or newer from https://nodejs.org, then run Build Reset again.'
    }
    if (-not (Get-Command cargo.exe -ErrorAction SilentlyContinue)) {
        throw 'Install Rust using https://rustup.rs (default MSVC toolchain), then run Build Reset again.'
    }
    $vswherePath = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    $cppTools = if (Test-Path -LiteralPath $vswherePath) {
        & $vswherePath -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    }
    $compilerFound = $cppTools -or (Get-ChildItem 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\*\bin\Hostx64\x64\cl.exe' -ErrorAction SilentlyContinue)
    if (-not $compilerFound) {
        throw 'Install Visual Studio Build Tools with Desktop development with C++ (including a Windows SDK): https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022'
    }
    if (-not (Test-Path -LiteralPath 'node_modules\@tauri-apps\cli')) {
        & npm.cmd ci
        if ($LASTEXITCODE -ne 0) { throw 'Could not install the frontend build dependencies.' }
    }
    & npm.cmd test
    if ($LASTEXITCODE -ne 0) { throw 'Interface checks failed. The installer was not built.' }
    & cargo.exe test --manifest-path src-tauri/Cargo.toml
    if ($LASTEXITCODE -ne 0) { throw 'Windows checks failed. The installer was not built.' }
    & npm.cmd run package
    if ($LASTEXITCODE -ne 0) { throw 'The Windows build failed. See the error above.' }
    $installer = Get-ChildItem -LiteralPath 'src-tauri\target\release\bundle\nsis' -Filter '*-setup.exe' |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $installer) { throw 'The build finished without a Windows installer.' }
    $outputFolder = Join-Path $PWD 'Install Reset'
    New-Item -ItemType Directory -Force -Path $outputFolder | Out-Null
    Copy-Item -LiteralPath $installer.FullName -Destination (Join-Path $outputFolder 'Reset-Setup.exe')
    Copy-Item -LiteralPath 'src-tauri\target\release\reset.exe' -Destination (Join-Path $outputFolder 'Reset.exe')
    Write-Host "Ready: $outputFolder\Reset-Setup.exe" -ForegroundColor Green
    Write-Host 'Double-click Reset-Setup.exe to install Reset. You can share this installer with others.'
    $buildSucceeded = $true
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host 'Build instructions: INSTALL.md in the Reset folder.'
} finally {
    if (-not $NoPause) { Read-Host 'Press Enter to close' | Out-Null }
}
if (-not $buildSucceeded) { exit 1 }
