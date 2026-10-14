mod storage;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use std::path::PathBuf;
use std::time::Duration;
use tauri::{App, AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Window};

#[tauri::command]
fn set_window_opacity(window: WebviewWindow, alpha: f64) -> Result<(), String> {
    platform::set_opacity(&window, alpha.clamp(0.0, 1.0)).map_err(|e| e.to_string())
}

// 저장 폴더는 사용자가 바꿀 수 있다. 어디로 바꿨는지는 컴퓨터마다 다르므로 설정 폴더(동기화 대상 아님)에 따로 적는다
fn location_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_config_dir().map_err(|e| e.to_string())?.join("location.json"))
}

fn data_root(app: &AppHandle) -> Result<PathBuf, String> {
    let custom = std::fs::read_to_string(location_file(app)?)
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .and_then(|v| v.get("root").and_then(|r| r.as_str()).map(PathBuf::from))
        .filter(|p| p.is_dir());
    match custom {
        Some(root) => Ok(root),
        None => app.path().app_data_dir().map_err(|e| e.to_string()),
    }
}

#[tauri::command]
fn get_data_root(app: AppHandle) -> Result<String, String> {
    Ok(data_root(&app)?.to_string_lossy().to_string())
}

#[tauri::command]
fn set_data_root(app: AppHandle, path: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    if !target.is_dir() {
        return Err(format!("폴더가 없습니다: {path}"));
    }
    storage::copy_into_if_empty(&data_root(&app)?, &target)?;
    let location = location_file(&app)?;
    if let Some(parent) = location.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::json!({ "root": path }).to_string();
    std::fs::write(location, json).map_err(|e| e.to_string())?;
    let _ = app.emit("data-root-changed", ());
    Ok(())
}

#[tauri::command]
fn read_text(app: AppHandle, window: Window, path: String) -> Result<Option<String>, String> {
    trace(&format!("read {} {}", window.label(), path));
    storage::read_text(&data_root(&app)?, &path)
}

// 화면 자동 점검용: 개발 빌드에서 FT_TRACE=1 이면 어느 창이 무엇을 읽고 쓰는지 출력한다
fn trace(_message: &str) {
    #[cfg(debug_assertions)]
    if std::env::var("FT_TRACE").is_ok() {
        eprintln!("[ft] {_message}");
    }
}

#[derive(Clone, serde::Serialize)]
struct FileChanged {
    path: String,
    source: String,
}

// 작은 창과 모아보기 창이 같은 날짜를 함께 열 수 있어서, 한쪽이 쓰면 다른 쪽이 다시 읽게 알린다
#[tauri::command]
fn write_text(app: AppHandle, window: Window, path: String, content: String) -> Result<(), String> {
    trace(&format!("write {} {}", window.label(), path));
    storage::write_text(&data_root(&app)?, &path, &content)?;
    let _ = app.emit(
        "file-changed",
        FileChanged { path, source: window.label().to_string() },
    );
    Ok(())
}

#[tauri::command]
fn open_overview(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("overview") {
        let _ = window.unminimize();
        window.show().map_err(|e| e.to_string())?;
        return window.set_focus().map_err(|e| e.to_string());
    }
    WebviewWindowBuilder::new(&app, "overview", WebviewUrl::App("index.html#overview".into()))
        .title("Floating Todo — 모아보기")
        .inner_size(1180.0, 760.0)
        .min_inner_size(720.0, 480.0)
        .focused(true)
        .build()
        .map_err(|e| e.to_string())?;
    if let Some(window) = app.get_webview_window("overview") {
        let _ = window.set_focus();
    }
    Ok(())
}

#[tauri::command]
fn exit_app(app: AppHandle) {
    app.exit(0);
}

// 화면 쪽이 저장 대기분을 마저 쓰고 exit_app을 부른다. 화면이 응답하지 않아도 2초 뒤엔 끈다
fn request_quit(app: &AppHandle) {
    let _ = app.emit("quit-requested", ());
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(2));
        app.exit(0);
    });
}

fn toggle_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

fn build_tray(app: &App) -> tauri::Result<()> {
    let toggle = MenuItem::with_id(app, "toggle", "창 보이기/숨기기", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&toggle, &quit])?;

    let mut tray = TrayIconBuilder::new()
        .tooltip("Floating Todo")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "toggle" => toggle_main_window(app),
            "quit" => request_quit(app),
            _ => {}
        });
    // 메뉴 막대 아이콘은 흑백 템플릿 이미지여야 다크·라이트 메뉴 막대 색에 맞춰 칠해진다
    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?;
    tray = tray.icon(icon).icon_as_template(true);
    tray.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            build_tray(app)?;
            // 화면 자동 점검용: 개발 빌드에서 FT_OPEN_OVERVIEW=1 이면 모아보기 창도 바로 연다
            #[cfg(debug_assertions)]
            if std::env::var("FT_OPEN_OVERVIEW").is_ok() {
                open_overview(app.handle().clone())?;
                // 터미널이 전체화면 Space에 있으면 새 창이 다른 데스크톱에 열려 캡처되지 않는다
                if let Some(w) = app.get_webview_window("overview") {
                    let _ = w.set_visible_on_all_workspaces(true);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_window_opacity,
            read_text,
            write_text,
            exit_app,
            open_overview,
            get_data_root,
            set_data_root
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(target_os = "macos")]
mod platform {
    use objc2_app_kit::NSWindow;
    use tauri::WebviewWindow;

    // NSWindow는 메인 스레드에서만 건드릴 수 있다
    fn with_ns_window(
        window: &WebviewWindow,
        f: impl FnOnce(&NSWindow) + Send + 'static,
    ) -> tauri::Result<()> {
        let window = window.clone();
        window.clone().run_on_main_thread(move || {
            if let Ok(ptr) = window.ns_window() {
                let ns_window = unsafe { &*(ptr as *const NSWindow) };
                f(ns_window);
            }
        })
    }

    pub fn set_opacity(window: &WebviewWindow, alpha: f64) -> tauri::Result<()> {
        with_ns_window(window, move |w| w.setAlphaValue(alpha))
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use tauri::WebviewWindow;

    pub fn set_opacity(_window: &WebviewWindow, _alpha: f64) -> tauri::Result<()> {
        Ok(())
    }
}
