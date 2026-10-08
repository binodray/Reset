# Build and install Reset on Windows

Most people should simply download **Reset-Setup.exe** from the [latest release](https://github.com/binodray/Reset/releases/latest) or from [hastamev.com/reset](https://hastamev.com/reset). These steps are for building it yourself.

## Prerequisites

1. [Rust](https://rustup.rs) 1.93 or newer, with the default MSVC toolchain.
2. [Visual Studio 2022 Build Tools](https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022) with **Desktop development with C++**, including the MSVC compiler and a Windows SDK.
3. [Node.js](https://nodejs.org) 22 or newer.

## Build with one double-click

Double-click **Build Reset.cmd** (or **Build Reset.bat**). It checks the prerequisites, installs the build dependencies, runs the interface and Rust tests, and builds the app and its installer. It stops with an explanation if any step fails. The first build downloads dependencies and takes several minutes.

When it succeeds, the installer is at **Install Reset\Reset-Setup.exe**.

## Build from a terminal

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-windows.ps1 -NoPause
```

The outputs are `src-tauri/target/release/reset.exe` and `src-tauri/target/release/bundle/nsis/Reset_<version>_x64-setup.exe`. The helper copies them to `Install Reset/`.

## About the installer

- Installs per user, with no administrator prompt.
- Includes the WebView2 offline installer, so it works on PCs without an internet connection. This makes it about 200 MB.
- Uses a custom dark NSIS template (`src-tauri/installer/installer.nsi`): Tauri's default template with Reset's palette applied. The artwork is `src-tauri/installer/sidebar.bmp` (164×314) and `header.bmp` (150×57); their sources are in `src-tauri/installer/art/`.
- Upgrades in place. Choosing **Uninstall before installing** removes the old version first. Your preferences are kept unless you tick **Delete the application data** in the uninstaller.
- Isn't code-signed yet. Windows SmartScreen may show "Windows protected your PC": choose **More info › Run anyway**.

Startup details are written to `%APPDATA%\com.reset.timer\startup.log`.

## Continuous integration

The **Build Reset for Windows** GitHub Actions workflow runs the tests and builds the installer on every push to `main`. Download the **Reset-Windows** artifact from the workflow run.

References: [Tauri Windows prerequisites](https://v2.tauri.app/start/prerequisites/#windows) and [Windows installer documentation](https://v2.tauri.app/distribute/windows-installer/).
