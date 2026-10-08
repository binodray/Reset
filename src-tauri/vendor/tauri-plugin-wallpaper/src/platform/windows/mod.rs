//! Windows implementation.
//!
//! - Wallpaper mode: WorkerW reparenting (message `0x052C` to Progman).
//! - Pin mode: `HWND_TOPMOST` plus a WNDPROC subclass that blocks the
//!   Win+D / Show Desktop hide (windows are "hidden" by moving them to
//!   x = -32000).
//! - Input forwarding: global raw-input sink translated into legacy
//!   messages posted to wallpaper windows (see `input`).
//! - Explorer-restart resilience: TaskbarCreated broadcast triggers
//!   re-attachment (see `reattach`).

use tauri::{Runtime, WebviewWindow};
use windows::Win32::UI::Shell::{
    SHQueryUserNotificationState, QUNS_BUSY, QUNS_PRESENTATION_MODE, QUNS_RUNNING_D3D_FULL_SCREEN,
};

use crate::models::{AttachOptions, Capabilities};

mod attacher;
mod corners;
mod detacher;
mod helper;
pub(crate) mod input;
mod pinner;
pub(crate) mod reattach;
mod reseter;
mod unpinner;

// SetParent returns the previous parent. A successful move from a top-level
// window therefore returns NULL, which the generated Windows binding treats
// as an error. Only a nonzero, freshly cleared last-error value means failure.
fn set_parent(hwnd: windows::Win32::Foundation::HWND, parent: Option<windows::Win32::Foundation::HWND>) -> crate::Result<()> {
    unsafe {
        use windows::Win32::Foundation::{GetLastError, SetLastError, WIN32_ERROR};
        SetLastError(WIN32_ERROR(0));
        let result = windows::Win32::UI::WindowsAndMessaging::SetParent(hwnd, parent);
        if result.is_err() && GetLastError().0 != 0 {
            return Err(windows::core::Error::from_hresult(windows::core::HRESULT::from_win32(GetLastError().0)).into());
        }
    }
    Ok(())
}

pub fn attach<R: Runtime>(
    webview_window: &WebviewWindow<R>,
    options: AttachOptions,
) -> crate::Result<()> {
    attacher::attach(webview_window, options)
}

pub fn detach<R: Runtime>(webview_window: &WebviewWindow<R>) -> crate::Result<()> {
    detacher::detach(webview_window)
}

pub fn pin<R: Runtime>(webview_window: &WebviewWindow<R>) -> crate::Result<()> {
    pinner::pin(webview_window)
}

pub fn unpin<R: Runtime>(webview_window: &WebviewWindow<R>) -> crate::Result<()> {
    unpinner::unpin(webview_window)
}

pub fn reset() -> crate::Result<()> {
    reseter::reset()
}

/// Toggles full input forwarding for an attached wallpaper window.
pub fn set_interactive<R: Runtime>(
    webview_window: &WebviewWindow<R>,
    interactive: bool,
) -> crate::Result<()> {
    let hwnd = webview_window.hwnd()?;
    if interactive {
        input::register_target(webview_window.label(), hwnd.0 as isize, true, true)
    } else {
        input::unregister_target(hwnd.0 as isize);
        Ok(())
    }
}

/// Lively's technique: the shell reports whether a fullscreen app /
/// presentation is running; when it is, the desktop (and any wallpaper
/// window) is covered.
pub fn is_occluded<R: Runtime>(_webview_window: &WebviewWindow<R>) -> crate::Result<bool> {
    let state = unsafe { SHQueryUserNotificationState()? };
    Ok(state == QUNS_BUSY || state == QUNS_RUNNING_D3D_FULL_SCREEN || state == QUNS_PRESENTATION_MODE)
}

pub fn window_destroyed(label: &str) {
    reattach::note_detached(label);
}

pub fn capabilities() -> Capabilities {
    Capabilities {
        platform: "windows",
        attach: true,
        detach: true,
        reset: true,
        pin: true,
        unpin: true,
        input_forwarding: true,
        interactive: true,
        occlusion: true,
        wallpaper_image: true,
    }
}
