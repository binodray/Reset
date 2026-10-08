mod timer;
mod resize;
use resize::{Corner, ResizeFrame};

use serde::{Deserialize, Serialize};
use std::{fs, io::Write, path::PathBuf, sync::{Condvar, Mutex}, time::Duration};
use tauri::{Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri_plugin_autostart::ManagerExt as AutostartExt;
use tauri_plugin_wallpaper::WallpaperExt;
use timer::{now_ms, Preferences, Snapshot, Timer};

#[derive(Clone, Copy, Default, Serialize, Deserialize)]
struct Point { x: i32, y: i32 }
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default)]
struct Saved { preferences: Preferences, position: Option<Point> }
struct Data { saved: Saved, timer: Timer, path: PathBuf }
struct AppState { data: Mutex<Data>, wake: Condvar, layout: Mutex<Layout> }
#[derive(Default)]
struct Layout { expanded: bool, widget: Point, origin: Point, target: Rect, resizing: Option<ResizeFrame>, moving: Option<(Point, f64)> }
#[derive(Clone, Copy, Default, Serialize)]
struct Rect { x: f64, y: f64, width: f64, height: f64 }
#[derive(Serialize)]
struct Geometry { from: Rect, to: Rect }
#[derive(Serialize)]
struct Initial { preferences: Preferences, timer: Snapshot }

fn persist(data: &Data) -> Result<(), String> {
    let temporary = data.path.with_extension("tmp");
    let bytes = serde_json::to_vec_pretty(&data.saved).map_err(|e| e.to_string())?;
    fs::write(&temporary, bytes).map_err(|e| e.to_string())?;
    fs::rename(&temporary, &data.path).map_err(|e| e.to_string())
}
fn startup_log(app: &tauri::AppHandle, message: &str) {
    let path = std::env::var_os("RESET_DIAGNOSTIC_LOG").map(PathBuf::from)
        .or_else(|| app.path().app_config_dir().ok().map(|p| p.join("startup.log")));
    if let Some(path) = path {
        if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(file, "{} {}", now_ms(), message);
        }
    }
}
fn error(app: &tauri::AppHandle, message: impl ToString) {
    let message = message.to_string(); startup_log(app, &message); let _ = app.emit("native-error", message);
}
#[tauri::command]
fn frontend_report(app: tauri::AppHandle, message: String) {
    startup_log(&app, &message.chars().take(2000).collect::<String>());
}
fn detach(app: &tauri::AppHandle, window: &WebviewWindow) -> Result<(), String> {
    let mut parented = app.wallpaper().is_attached("main");
    #[cfg(windows)] {
        let hwnd = window.hwnd().map_err(|e| e.to_string())?;
        parented |= unsafe {
            use windows::Win32::UI::WindowsAndMessaging::{GetAncestor, GetDesktopWindow, GA_PARENT};
            let parent = GetAncestor(hwnd, GA_PARENT);
            !parent.is_invalid() && parent != GetDesktopWindow()
        };
    }
    if parented {
        let position = window.outer_position().map_err(|e| e.to_string())?;
        app.wallpaper().detach_window(window).map_err(|e| e.to_string())?;
        window.set_position(position).map_err(|e| e.to_string())?;
    }
    Ok(())
}
fn present_widget(app: &tauri::AppHandle, window: &WebviewWindow) -> Result<(), String> {
    detach(app, window)?;
    let mode = app.state::<AppState>().data.lock().unwrap().saved.preferences.window_mode.clone();
    window.set_always_on_top(mode == "top").map_err(|e| e.to_string())?;
    window.set_skip_taskbar(true).map_err(|e| e.to_string())?;
    startup_log(app, &format!("interactive widget shown: {mode}; taskbar hidden, notification icon active"));
    window.show().map_err(|e| e.to_string())
}
// Keep restored widgets within an available monitor, including after unplugging
// a monitor. Positions are physical pixels; layout geometry is logical pixels.
fn safe_position(window: &WebviewWindow, preferred: Option<Point>, dimensions: (f64, f64)) -> Result<Point, String> {
    let monitors = window.available_monitors().map_err(|e| e.to_string())?;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let width = (dimensions.0 * scale).ceil() as i32; let height = (dimensions.1 * scale).ceil() as i32;
    if let Some(point) = preferred {
        if monitors.iter().any(|m| {
            let p = m.position(); let s = m.size();
            point.x >= p.x && point.y >= p.y && point.x + width <= p.x + s.width as i32 && point.y + height <= p.y + s.height as i32
        }) { return Ok(point); }
        if let Some(monitor) = monitors.iter().find(|m| {
            let p = m.position(); let s = m.size();
            point.x >= p.x && point.y >= p.y && point.x < p.x + s.width as i32 && point.y < p.y + s.height as i32
        }) {
            let p = monitor.position(); let s = monitor.size();
            return Ok(Point { x: point.x.min((p.x + s.width as i32 - width).max(p.x)),
                y: point.y.min((p.y + s.height as i32 - height).max(p.y)) });
        }
    }
    let monitor = window.primary_monitor().map_err(|e| e.to_string())?.ok_or("No display is available")?;
    Ok(Point { x: monitor.position().x + 48, y: monitor.position().y + 72 })
}

#[tauri::command]
fn initialize(state: tauri::State<AppState>) -> Initial {
    let data = state.data.lock().unwrap();
    Initial { preferences: data.saved.preferences.clone(), timer: data.timer.view.clone() }
}
#[tauri::command]
async fn show_widget(app: tauri::AppHandle, window: WebviewWindow) -> Result<(), String> {
    let should_show = app.state::<AppState>().data.lock().unwrap().saved.preferences.widget;
    if should_show {
        present_widget(&app, &window)?;
    }
    Ok(())
}
#[tauri::command]
async fn hide_widget(app: tauri::AppHandle, window: WebviewWindow) -> Result<(), String> {
    let state = app.state::<AppState>();
    let mut data = state.data.lock().unwrap(); data.saved.preferences.widget = false; persist(&data)?;
    drop(data); window.hide().map_err(|e| e.to_string())
}
#[tauri::command]
fn timer_action(action: String, app: tauri::AppHandle) -> Result<Snapshot, String> {
    let state = app.state::<AppState>();
    let mut data = state.data.lock().unwrap(); let p = data.saved.preferences.clone();
    let snapshot = data.timer.action(&action, &p, now_ms())?;
    drop(data); state.wake.notify_one(); let _ = app.emit("timer-state", snapshot.clone()); Ok(snapshot)
}
#[tauri::command]
async fn save_preferences(preferences: Preferences, app: tauri::AppHandle, window: WebviewWindow) -> Result<Snapshot, String> {
    preferences.validate()?;
    let state = app.state::<AppState>();
    let old = state.data.lock().unwrap().saved.preferences.clone();
    let position = if preferences.remember_position {
        let layout = state.layout.lock().unwrap();
        if layout.expanded { Some(layout.widget) } else {
            let p = window.outer_position().map_err(|e| e.to_string())?; Some(Point { x: p.x, y: p.y })
        }
    } else { None };
    if preferences.startup != old.startup {
        if preferences.startup { app.autolaunch().enable() } else { app.autolaunch().disable() }.map_err(|e| e.to_string())?;
    }
    let snapshot = {
        let mut data = state.data.lock().unwrap(); let old_position = data.saved.position;
        data.saved.preferences = preferences.clone(); data.saved.position = position;
        if let Err(e) = persist(&data) {
            data.saved.preferences = old.clone(); data.saved.position = old_position;
            if preferences.startup != old.startup {
                let _ = if old.startup { app.autolaunch().enable() } else { app.autolaunch().disable() };
            }
            return Err(e);
        }
        data.timer.update_preferences(&old, &preferences, now_ms())
    };
    state.wake.notify_one();
    if (preferences.widget_size != old.widget_size || preferences.widget_scale != old.widget_scale) && !state.layout.lock().unwrap().expanded {
        let (width, height) = preferences.widget_dimensions();
        let current = window.outer_position().map_err(|e| e.to_string())?;
        let point = safe_position(&window, Some(Point { x: current.x, y: current.y }), (width + 24.0, height + 24.0))?;
        detach(&app, &window)?;
        window.set_size(tauri::LogicalSize::new(width + 24.0, height + 24.0)).map_err(|e| e.to_string())?;
        window.set_position(PhysicalPosition::new(point.x, point.y)).map_err(|e| e.to_string())?;
        if preferences.widget { present_widget(&app, &window)?; }
    }
    if !preferences.widget && !state.layout.lock().unwrap().expanded { window.hide().map_err(|e| e.to_string())?; }
    if preferences.window_mode != old.window_mode && preferences.widget && !state.layout.lock().unwrap().expanded { present_widget(&app, &window)?; }
    Ok(snapshot)
}

#[tauri::command]
async fn window_mode(expanded: bool, settings_mode: bool, app: tauri::AppHandle, window: WebviewWindow) -> Result<Geometry, String> {
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let state = app.state::<AppState>();
    // Never hold a state lock while dispatching a window operation to the UI thread.
    let (widget_width, widget_height) = state.data.lock().unwrap().saved.preferences.widget_dimensions();
    if expanded {
        let position = window.outer_position().map_err(|e| e.to_string())?;
        let previous_expanded = state.layout.lock().unwrap().expanded;
        if previous_expanded {
            let layout = state.layout.lock().unwrap(); return Ok(Geometry { from: layout.target, to: layout.target });
        }
        let monitor = window.current_monitor().map_err(|e| e.to_string())?.or(window.primary_monitor().map_err(|e| e.to_string())?).ok_or("No display is available")?;
        let mw = monitor.size().width as f64; let mh = monitor.size().height as f64;
        let width = ((if settings_mode { 644.0 } else { 724.0 }) * scale).min(mw);
        let height = ((if settings_mode { 644.0 } else { 674.0 }) * scale).min(mh - 48.0 * scale);
        let target_x = monitor.position().x as f64 + (mw - width) / 2.0;
        let target_y = monitor.position().y as f64 + (mh - height) / 2.0;
        let left = if settings_mode { target_x } else { (position.x as f64).min(target_x) };
        let top = if settings_mode { target_y } else { (position.y as f64).min(target_y) };
        let right = if settings_mode { target_x + width } else { (position.x as f64 + (widget_width + 24.0) * scale).max(target_x + width) };
        let bottom = if settings_mode { target_y + height } else { (position.y as f64 + (widget_height + 24.0) * scale).max(target_y + height) };
        let from = Rect { x: (position.x as f64 - left) / scale + 12.0, y: (position.y as f64 - top) / scale + 12.0, width: widget_width, height: widget_height };
        let to = Rect { x: (target_x - left) / scale + 12.0, y: (target_y - top) / scale + 12.0, width: width / scale - 24.0, height: height / scale - 24.0 };
        { let mut layout = state.layout.lock().unwrap(); layout.expanded = true; layout.widget = Point { x: position.x, y: position.y }; layout.origin = Point { x: left as i32, y: top as i32 }; layout.target = to; }
        detach(&app, &window)?;
        window.set_size(PhysicalSize::new((right - left) as u32, (bottom - top) as u32)).map_err(|e| e.to_string())?;
        window.set_position(PhysicalPosition::new(left as i32, top as i32)).map_err(|e| e.to_string())?;
        window.set_always_on_top(true).map_err(|e| e.to_string())?;
        window.show().map_err(|e| e.to_string())?;
        Ok(Geometry { from, to })
    } else {
        let (widget, origin, target) = { let layout = state.layout.lock().unwrap(); (layout.widget, layout.origin, layout.target) };
        let point = safe_position(&window, Some(widget), (widget_width + 24.0, widget_height + 24.0))?;
        let size = window.outer_size().map_err(|e| e.to_string())?;
        let left = origin.x.min(point.x); let top = origin.y.min(point.y);
        let right = (origin.x as f64 + size.width as f64).max(point.x as f64 + (widget_width + 24.0) * scale);
        let bottom = (origin.y as f64 + size.height as f64).max(point.y as f64 + (widget_height + 24.0) * scale);
        let from = Rect { x: target.x + (origin.x - left) as f64 / scale, y: target.y + (origin.y - top) as f64 / scale, ..target };
        window.set_size(PhysicalSize::new((right - left as f64).ceil() as u32, (bottom - top as f64).ceil() as u32)).map_err(|e| e.to_string())?;
        window.set_position(PhysicalPosition::new(left, top)).map_err(|e| e.to_string())?;
        { let mut layout = state.layout.lock().unwrap(); layout.widget = point; layout.origin = Point { x: left, y: top }; layout.target = from; }
        Ok(Geometry { from, to: Rect { x: (point.x - left) as f64 / scale + 12.0,
            y: (point.y - top) as f64 / scale + 12.0, width: widget_width, height: widget_height } })
    }
}
#[tauri::command]
async fn finish_window_mode(app: tauri::AppHandle, window: WebviewWindow) -> Result<(), String> {
    let state = app.state::<AppState>();
    let point = state.layout.lock().unwrap().widget;
    window.set_always_on_top(false).map_err(|e| e.to_string())?;
    let (width, height) = state.data.lock().unwrap().saved.preferences.widget_dimensions();
    window.set_size(tauri::LogicalSize::new(width + 24.0, height + 24.0)).map_err(|e| e.to_string())?;
    window.set_position(PhysicalPosition::new(point.x, point.y)).map_err(|e| e.to_string())?;
    state.layout.lock().unwrap().expanded = false;
    let show = state.data.lock().unwrap().saved.preferences.widget;
    if show { present_widget(&app, &window)?; }
    else { window.hide().map_err(|e| e.to_string())?; }
    Ok(())
}

#[tauri::command]
async fn resize_widget(scale: f64, corner: Corner, app: tauri::AppHandle, window: WebviewWindow) -> Result<(), String> {
    if !scale.is_finite() || !(0.5..=1.6).contains(&scale) { return Err("Widget size is outside its supported range.".into()); }
    let state = app.state::<AppState>();
    if state.layout.lock().unwrap().expanded { return Err("Resize the compact widget after closing the reminder or settings.".into()); }
    let existing = state.layout.lock().unwrap().resizing;
    let mut frame = if let Some(frame) = existing { frame } else {
        detach(&app, &window)?;
        // Desktop clicks arrive through forwarded input. Real focus lets the
        // detached WebView keep mouse capture outside the widget and receive Escape.
        let _ = window.set_focus();
        let position = window.outer_position().map_err(|e| e.to_string())?;
        let size = window.outer_size().map_err(|e| e.to_string())?;
        let initial_scale = state.data.lock().unwrap().saved.preferences.widget_dimensions().0 / 432.0;
        ResizeFrame { x: position.x, y: position.y, width: size.width, height: size.height,
            dpi: window.scale_factor().map_err(|e| e.to_string())?, corner, scale: initial_scale, initial_scale }
    };
    let (x, y, width, height) = frame.geometry(scale);
    // Save the session before dispatching UI operations, so a failed operation
    // can still be restored and reattached by finish_widget_resize.
    frame.scale = scale; state.layout.lock().unwrap().resizing = Some(frame);
    window.set_size(PhysicalSize::new(width, height)).map_err(|e| e.to_string())?;
    window.set_position(PhysicalPosition::new(x, y)).map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
async fn finish_widget_resize(cancelled: bool, app: tauri::AppHandle, window: WebviewWindow) -> Result<Preferences, String> {
    let state = app.state::<AppState>();
    let frame = state.layout.lock().unwrap().resizing.take();
    if let Some(frame) = frame {
        let scale = if cancelled { frame.initial_scale } else { frame.scale };
        let (x, y, width, height) = frame.geometry(scale);
        let (widget_width, widget_height) = resize::widget_dimensions(scale);
        let point = safe_position(&window, Some(Point { x, y }), (widget_width + 24.0, widget_height + 24.0))?;
        window.set_size(PhysicalSize::new(width, height)).map_err(|e| e.to_string())?;
        window.set_position(PhysicalPosition::new(point.x, point.y)).map_err(|e| e.to_string())?;
        let save_result = {
            let mut data = state.data.lock().unwrap();
            if !cancelled { data.saved.preferences.widget_size = "custom".into(); data.saved.preferences.widget_scale = scale; }
            if data.saved.preferences.remember_position { data.saved.position = Some(point); }
            persist(&data)
        };
        present_widget(&app, &window)?;
        save_result?;
        startup_log(&app, &format!("widget resize finished: scale={scale:.3}; cancelled={cancelled}"));
    }
    let preferences = state.data.lock().unwrap().saved.preferences.clone();
    Ok(preferences)
}
#[tauri::command]
async fn move_widget(dx: f64, dy: f64, app: tauri::AppHandle, window: WebviewWindow) -> Result<(), String> {
    if !dx.is_finite() || !dy.is_finite() || dx.abs() > 20000.0 || dy.abs() > 20000.0 { return Err("Invalid widget position.".into()); }
    let state = app.state::<AppState>();
    if state.layout.lock().unwrap().expanded { return Err("Move the compact widget with Settings closed.".into()); }
    let existing = state.layout.lock().unwrap().moving;
    let (origin, dpi) = if let Some(frame) = existing { frame } else {
        detach(&app, &window)?; let _ = window.set_focus();
        let position = window.outer_position().map_err(|e| e.to_string())?;
        let frame = (Point { x: position.x, y: position.y }, window.scale_factor().map_err(|e| e.to_string())?);
        state.layout.lock().unwrap().moving = Some(frame); frame
    };
    window.set_position(PhysicalPosition::new(origin.x + (dx * dpi).round() as i32, origin.y + (dy * dpi).round() as i32)).map_err(|e| e.to_string())
}
#[tauri::command]
async fn finish_widget_move(cancelled: bool, app: tauri::AppHandle, window: WebviewWindow) -> Result<(), String> {
    let state = app.state::<AppState>();
    let frame = state.layout.lock().unwrap().moving.take();
    if let Some((origin, _)) = frame {
        let position = window.outer_position().map_err(|e| e.to_string())?;
        let preferred = if cancelled { origin } else { Point { x: position.x, y: position.y } };
        let (width, height) = state.data.lock().unwrap().saved.preferences.widget_dimensions();
        let point = safe_position(&window, Some(preferred), (width + 24.0, height + 24.0))?;
        window.set_position(PhysicalPosition::new(point.x, point.y)).map_err(|e| e.to_string())?;
        let save_result = {
            let mut data = state.data.lock().unwrap();
            if data.saved.preferences.remember_position { data.saved.position = Some(point); persist(&data) } else { Ok(()) }
        };
        present_widget(&app, &window)?; save_result?;
        startup_log(&app, &format!("widget move finished: {}, {}; cancelled={cancelled}", point.x, point.y));
    }
    Ok(())
}
fn reveal(app: &tauri::AppHandle, settings: bool) {
    let Some(window) = app.get_webview_window("main") else { return; };
    if settings {
        let _ = app.emit("open-settings", ()); let _ = window.show();
    } else {
        let state = app.state::<AppState>();
        { let mut data = state.data.lock().unwrap(); data.saved.preferences.widget = true; let _ = persist(&data); }
        if !state.layout.lock().unwrap().expanded {
            if let Err(e) = present_widget(app, &window) { error(app, e); }
        }
        let _ = window.show();
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| reveal(app, false)))
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_wallpaper::init())
        .setup(|app| {
            let directory = app.path().app_config_dir()?; fs::create_dir_all(&directory)?;
            let path = directory.join("preferences.json");
            startup_log(app.handle(), "native setup started");
            let mut saved: Saved = fs::read(&path).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default();
            if saved.preferences.validate().is_err() { saved.preferences = Preferences::default(); }
            saved.preferences.startup = app.autolaunch().is_enabled().unwrap_or(false);
            let window = app.get_webview_window("main").unwrap();
            let (width, height) = saved.preferences.widget_dimensions();
            window.set_size(tauri::LogicalSize::new(width + 24.0, height + 24.0))?;
            let position = safe_position(&window, if saved.preferences.remember_position { saved.position } else { None }, (width + 24.0, height + 24.0))?;
            window.set_position(PhysicalPosition::new(position.x, position.y))?;
            let timer = Timer::new(&saved.preferences);
            app.manage(AppState { data: Mutex::new(Data { saved, timer, path }), wake: Condvar::new(), layout: Mutex::new(Layout::default()) });
            if app.state::<AppState>().data.lock().unwrap().saved.preferences.widget {
                window.show()?;
            }
            let start = MenuItem::with_id(app, "start", "Start Focus Session", true, None::<&str>)?;
            let pause = MenuItem::with_id(app, "pause", "Pause", true, None::<&str>)?;
            let take_break = MenuItem::with_id(app, "break", "Take Break Now", true, None::<&str>)?;
            let reset = MenuItem::with_id(app, "restart", "Reset Timer", true, None::<&str>)?;
            let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
            let show = MenuItem::with_id(app, "show", "Show Desktop Widget", true, None::<&str>)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let exit = MenuItem::with_id(app, "exit", "Exit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&start, &pause, &take_break, &reset, &separator, &settings, &show, &exit])?;
            TrayIconBuilder::new().icon(app.default_window_icon().unwrap().clone()).tooltip("Reset · A little space to focus")
                .menu(&menu).show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "exit" => app.exit(0), "settings" => reveal(app, true), "show" => reveal(app, false),
                    "start" => {
                        let phase = app.state::<AppState>().data.lock().unwrap().timer.view.phase.clone();
                        if !["focus", "finishing"].contains(&phase.as_str()) { let _ = timer_action("restart".into(), app.clone()); }
                        let _ = timer_action("start".into(), app.clone());
                    },
                    action => { if let Err(e) = timer_action(action.into(), app.clone()) { error(app, e); } }
                })
                .on_tray_icon_event(|tray, event| {
                    if matches!(event, TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. }) { reveal(tray.app_handle(), false); }
                }).build(app)?;
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let state = handle.state::<AppState>(); let mut last = state.data.lock().unwrap().timer.view.clone();
                loop {
                    let mut data = state.data.lock().unwrap();
                    let p = data.saved.preferences.clone(); data.timer.tick(&p, now_ms());
                    let snapshot = data.timer.view.clone();
                    let active = snapshot.running || snapshot.phase == "complete";
                    drop(data);
                    if snapshot != last {
                        if ["focus", "finishing"].contains(&last.phase.as_str()) && ["reminder", "break"].contains(&snapshot.phase.as_str()) {
                            // The Rust timer presents reminders even if the webview was hidden.
                            if let Some(window) = handle.get_webview_window("main") {
                                if let Err(e) = detach(&handle, &window) { error(&handle, e); }
                                let _ = window.set_always_on_top(true); let _ = window.show();
                            }
                        }
                        let _ = handle.emit("timer-state", snapshot.clone()); last = snapshot;
                    }
                    let data = state.data.lock().unwrap();
                    // Recheck after acquiring the lock: an action could have occurred
                    // between rendering and waiting; never lose its wake-up.
                    if data.timer.view != last { drop(data); continue; }
                    if active { drop(state.wake.wait_timeout(data, Duration::from_millis(250)).unwrap()); }
                    else { drop(state.wake.wait(data).unwrap()); }
                }
            });
            Ok(())
        })
        .on_page_load(|window, payload| {
            startup_log(window.app_handle(), &format!("page {:?}: {}", payload.event(), payload.url()));
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<AppState>();
                if state.data.lock().unwrap().saved.preferences.tray { api.prevent_close(); let _ = window.hide(); }
                else { window.app_handle().exit(0); }
            }
        })
        .invoke_handler(tauri::generate_handler![initialize, frontend_report, timer_action, save_preferences, show_widget, hide_widget, window_mode, finish_window_mode, resize_widget, finish_widget_resize, move_widget, finish_widget_move])
        .run(tauri::generate_context!()).expect("Reset could not launch");
}
