mod storage;

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::menu::{Menu, MenuBuilder, MenuItem, MenuItemBuilder, SubmenuBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::{
    App, AppHandle, Emitter, Manager, RunEvent, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    Window,
};

/// 종료 요청 뒤 아직 저장을 마치지 않은 창들
#[derive(Default)]
struct QuitState(Mutex<Option<HashSet<String>>>);

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
        let ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() % 100_000)
            .unwrap_or(0);
        eprintln!("[ft] {ms:>5} {_message}");
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

/// date: 작은 창에서 보던 날짜. 모아보기 창이 그 날짜를 골라 둔 채로 열린다
#[tauri::command]
fn open_overview(app: AppHandle, date: Option<String>) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("overview") {
        if let Some(date) = date {
            let _ = app.emit_to("overview", "select-date", date);
        }
        let _ = window.unminimize();
        window.show().map_err(|e| e.to_string())?;
        return window.set_focus().map_err(|e| e.to_string());
    }
    let url = match date {
        Some(date) => format!("index.html#overview?date={date}"),
        None => "index.html#overview".to_string(),
    };
    WebviewWindowBuilder::new(&app, "overview", WebviewUrl::App(url.into()))
        .title("Aru — 모아보기")
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
fn quit_ready(app: AppHandle, window: Window, state: tauri::State<QuitState>) {
    let mut pending = state.0.lock().unwrap();
    if let Some(labels) = pending.as_mut() {
        labels.remove(window.label());
        if labels.is_empty() {
            app.exit(0);
        }
    }
}

// 열린 창마다 저장 대기분을 마저 쓰고 quit_ready를 부른다. 모두 응답하면 끄고, 응답이 없어도 2초 뒤엔 끈다
fn request_quit(app: &AppHandle) {
    let labels: HashSet<String> = app.webview_windows().into_keys().collect();
    if labels.is_empty() {
        app.exit(0);
        return;
    }
    *app.state::<QuitState>().0.lock().unwrap() = Some(labels);
    let _ = app.emit("quit-requested", ());
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(2));
        app.exit(0);
    });
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

// 기본 앱 메뉴의 "종료"(Cmd+Q)는 화면에 저장할 틈을 주지 않고 바로 끈다. 같은 자리에 저장 후 종료하는 항목을 둔다
fn build_app_menu(app: &App) -> tauri::Result<Menu<tauri::Wry>> {
    let quit = MenuItemBuilder::with_id("app-quit", "Aru 종료")
        .accelerator("CmdOrCtrl+Q")
        .build(app)?;
    let app_menu = SubmenuBuilder::new(app, "Aru")
        .about(None)
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .item(&quit)
        .build()?;
    let edit = SubmenuBuilder::new(app, "편집")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let window = SubmenuBuilder::new(app, "윈도우").minimize().close_window().build()?;
    MenuBuilder::new(app).items(&[&app_menu, &edit, &window]).build()
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
        .tooltip("Aru")
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
        // 이미 켜져 있으면 새로 띄우지 않고 기존 작은 창을 앞으로 가져온다. 다른 플러그인보다 먼저 등록해야 한다
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main_window(app)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(QuitState::default())
        .setup(|app| {
            build_tray(app)?;
            let menu = build_app_menu(app)?;
            app.set_menu(menu)?;
            app.on_menu_event(|app, event| {
                if event.id().as_ref() == "app-quit" {
                    request_quit(app);
                }
            });
            // 화면 자동 점검용: 개발 빌드에서 FT_OPEN_OVERVIEW=1(또는 YYYY-MM-DD) 이면 모아보기 창도 바로 연다
            #[cfg(debug_assertions)]
            if let Ok(value) = std::env::var("FT_OPEN_OVERVIEW") {
                let date = (value.len() == 10).then_some(value);
                open_overview(app.handle().clone(), date)?;
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
            quit_ready,
            open_overview,
            get_data_root,
            set_data_root
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // 작은 창을 닫아(숨겨) 둔 상태에서 Dock 아이콘을 누르면 다시 보여 준다
            if let RunEvent::Reopen { .. } = event {
                show_main_window(app);
            }
        });
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
