mod storage;

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri::menu::{Menu, MenuBuilder, MenuItem, MenuItemBuilder, SubmenuBuilder};
use tauri::tray::TrayIconBuilder;
use tauri_plugin_updater::UpdaterExt;
use tauri::{
    App, AppHandle, Emitter, Manager, RunEvent, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    Window,
};

/// 빠른 입력창을 띄우기 직전에 쓰던 앱. 입력창을 닫으면 그 앱으로 돌려보낸다
#[derive(Default)]
struct QuickState(Mutex<Option<i32>>);

const QUICK_WIDTH: f64 = 620.0;
const QUICK_HEIGHT: f64 = 96.0;

/// 전역 단축키(⌥Space)로 지금 보고 있는 화면 위쪽 가운데에 빠른 입력창을 띄운다. 이미 떠 있으면 닫는다
fn toggle_quick(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("quick") {
        if window.is_visible().unwrap_or(false) {
            hide_quick(app.clone());
            return;
        }
    }
    *app.state::<QuickState>().0.lock().unwrap() = platform::frontmost_other_app();
    let window = match app.get_webview_window("quick") {
        Some(w) => w,
        None => match WebviewWindowBuilder::new(app, "quick", WebviewUrl::App("index.html#quick".into()))
            .title("Aru 빠른 입력")
            .inner_size(QUICK_WIDTH, QUICK_HEIGHT)
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .resizable(false)
            .always_on_top(true)
            .visible_on_all_workspaces(true)
            .skip_taskbar(true)
            .visible(false)
            .build()
        {
            Ok(w) => w,
            Err(e) => {
                trace(&format!("quick window: {e}"));
                return;
            }
        },
    };
    place_on_cursor_screen(app, &window);
    trace("show_quick");
    let _ = window.show();
    let _ = window.set_focus();
    let _ = app.emit_to("quick", "quick-shown", ());
}

// 마우스가 있는 화면 위쪽 1/4 지점 가운데에 둔다
fn place_on_cursor_screen(app: &AppHandle, window: &WebviewWindow) {
    let Ok(cursor) = app.cursor_position() else { return };
    let Ok(monitors) = app.available_monitors() else { return };
    let monitor = monitors.iter().find(|m| {
        let (p, s) = (m.position(), m.size());
        cursor.x >= p.x as f64 && cursor.x < (p.x + s.width as i32) as f64
            && cursor.y >= p.y as f64 && cursor.y < (p.y + s.height as i32) as f64
    });
    let Some(m) = monitor.or(monitors.first()) else { return };
    let scale = m.scale_factor();
    let (p, s) = (m.position(), m.size());
    let x = p.x as f64 + (s.width as f64 - QUICK_WIDTH * scale) / 2.0;
    let y = p.y as f64 + s.height as f64 * 0.24;
    let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
}

#[tauri::command]
fn hide_quick(app: AppHandle) {
    trace("hide_quick");
    if let Some(window) = app.get_webview_window("quick") {
        let _ = window.hide();
    }
    if let Some(pid) = app.state::<QuickState>().0.lock().unwrap().take() {
        platform::activate_app(pid);
    }
}

/// 종료 요청 뒤 아직 저장을 마치지 않은 창들
#[derive(Default)]
struct QuitState(Mutex<Option<HashSet<String>>>, AtomicBool);

/// 찾아 둔 새 버전. 창이 이벤트를 듣기 전에 찾았을 수 있어서 남겨 두고 물으면 알려 준다
#[derive(Default)]
struct UpdateState(Mutex<Option<UpdateInfo>>);

/// 새 버전과 배포할 때 적어 둔 바뀐 점
#[derive(Clone, serde::Serialize)]
struct UpdateInfo {
    version: String,
    notes: String,
}

const UPDATE_CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);

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
    trace(&format!("read {} {} @ {}", window.label(), path, data_root(&app)?.display()));
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
    trace(&format!("write {} {} @ {}", window.label(), path, data_root(&app)?.display()));
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
            finish_quit(&app);
        }
    }
}

fn finish_quit(app: &AppHandle) {
    if app.state::<QuitState>().1.load(Ordering::SeqCst) {
        app.restart();
    }
    app.exit(0);
}

// 열린 창마다 저장 대기분을 마저 쓰고 quit_ready를 부른다. 모두 응답하면 끄고, 응답이 없어도 2초 뒤엔 끈다
fn request_quit(app: &AppHandle) {
    // 빠른 입력창은 저장할 게 없어서 기다리지 않는다
    let labels: HashSet<String> = app.webview_windows().into_keys().filter(|l| l != "quick").collect();
    if labels.is_empty() {
        finish_quit(app);
        return;
    }
    *app.state::<QuitState>().0.lock().unwrap() = Some(labels);
    let _ = app.emit("quit-requested", ());
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(2));
        finish_quit(&app);
    });
}

async fn check_update(app: &AppHandle) -> Result<Option<UpdateInfo>, String> {
    let update = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
    let Some(update) = update else { return Ok(None) };
    let info = UpdateInfo { version: update.version, notes: update.body.unwrap_or_default() };
    *app.state::<UpdateState>().0.lock().unwrap() = Some(info.clone());
    let _ = app.emit("update-available", info.clone());
    Ok(Some(info))
}

fn watch_updates(app: &AppHandle) {
    // 개발 빌드는 .app 묶음이 아니라 설치할 수 없다
    if cfg!(debug_assertions) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || loop {
        // 오프라인이거나 GitHub이 응답하지 않으면 다음 확인 때 다시 본다
        if let Err(e) = tauri::async_runtime::block_on(check_update(&app)) {
            trace(&format!("업데이트 확인 실패: {e}"));
        }
        std::thread::sleep(UPDATE_CHECK_INTERVAL);
    });
}

#[tauri::command]
async fn check_update_now(app: AppHandle) -> Result<Option<UpdateInfo>, String> {
    check_update(&app).await
}

/// 피드백 폼에 채울 OS 버전. 웹뷰의 userAgent는 macOS 버전을 10.15로 고정해 보여 줘서 따로 묻는다
#[tauri::command]
fn os_version() -> String {
    #[cfg(target_os = "macos")]
    {
        let out = std::process::Command::new("sw_vers").arg("-productVersion").output();
        if let Ok(out) = out {
            let v = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !v.is_empty() {
                return format!("macOS {v}");
            }
        }
        "macOS".into()
    }
    #[cfg(not(target_os = "macos"))]
    {
        std::env::consts::OS.into()
    }
}

#[tauri::command]
fn pending_update(state: tauri::State<UpdateState>) -> Option<UpdateInfo> {
    state.0.lock().unwrap().clone()
}

#[tauri::command]
async fn install_update(app: AppHandle) -> Result<(), String> {
    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or("새 버전이 없다")?;
    update.download_and_install(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
    // 새 버전은 이미 제자리에 있다. 저장 대기분을 마저 쓰고 새 버전으로 다시 켠다
    app.state::<QuitState>().1.store(true, Ordering::SeqCst);
    request_quit(&app);
    Ok(())
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

/// 화면 자동 점검용 옵션. 개발 빌드에서만 들어간다(설치본에는 이 함수 자체가 없다)
/// - FT_SWITCH_ROOT=<폴더>: 6초 뒤 저장 폴더 변경을 실제 경로 그대로 실행한다
/// - FT_OPEN_QUICK=1: 4초 뒤 단축키를 누른 것처럼 빠른 입력창을 띄운다
/// - FT_OPEN_OVERVIEW=1(또는 YYYY-MM-DD): 모아보기 창을 바로 연다
#[cfg(debug_assertions)]
fn dev_hooks(app: &App) -> Result<(), String> {
    if let Ok(target) = std::env::var("FT_SWITCH_ROOT") {
        let handle = app.handle().clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_secs(6));
            let result = set_data_root(handle, target);
            trace(&format!("switch-root {result:?}"));
        });
    }
    if std::env::var("FT_OPEN_QUICK").is_ok() {
        let handle = app.handle().clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_secs(4));
            let h = handle.clone();
            let _ = handle.run_on_main_thread(move || toggle_quick(&h));
        });
    }
    if let Ok(value) = std::env::var("FT_OPEN_OVERVIEW") {
        let date = (value.len() == 10).then_some(value);
        open_overview(app.handle().clone(), date)?;
        // 터미널이 전체화면 Space에 있으면 새 창이 다른 데스크톱에 열려 캡처되지 않는다
        if let Some(w) = app.get_webview_window("overview") {
            let _ = w.set_visible_on_all_workspaces(true);
        }
    }
    Ok(())
}

// 0.2.2까지의 앱 ID. 그때 만든 할 일·설정 폴더를 새 ID 폴더로 옮겨 온다
const LEGACY_IDENTIFIER: &str = "dev.aruu.floatingtodo";

#[cfg(target_os = "macos")]
fn move_legacy_data(identifier: &str) {
    let Ok(home) = std::env::var("HOME") else { return };
    let library = PathBuf::from(home).join("Library");
    // 할 일·설정은 Application Support, 브라우저 저장소(마지막 실행 버전)는 WebKit 아래에 있다
    for dir in ["Application Support", "WebKit"] {
        let base = library.join(dir);
        if let Err(e) = storage::move_legacy_dir(&base.join(LEGACY_IDENTIFIER), &base.join(identifier)) {
            trace(&format!("옛 데이터 폴더 이동 실패({dir}): {e}"));
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let context = tauri::generate_context!();
    // 플러그인들이 새 폴더를 만들기 전에 옮겨야 한다
    #[cfg(target_os = "macos")]
    move_legacy_data(&context.config().identifier);
    tauri::Builder::default()
        // 이미 켜져 있으면 새로 띄우지 않고 기존 작은 창을 앞으로 가져온다. 다른 플러그인보다 먼저 등록해야 한다
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main_window(app)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // 빠른 입력창은 늘 마우스가 있는 화면에 띄우므로 위치를 기억하지 않는다
        .plugin(tauri_plugin_window_state::Builder::default().with_denylist(&["quick"]).build())
        .manage(QuitState::default())
        .manage(QuickState::default())
        .manage(UpdateState::default())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        toggle_quick(app);
                    }
                })
                .build(),
        )
        .setup(|app| {
            build_tray(app)?;
            watch_updates(app.handle());
            // 다른 앱이 이미 쓰고 있어 등록에 실패해도 앱은 그대로 쓴다
            if let Err(e) = app.global_shortcut().register(quick_shortcut()) {
                trace(&format!("단축키 등록 실패: {e}"));
            }
            let menu = build_app_menu(app)?;
            app.set_menu(menu)?;
            app.on_menu_event(|app, event| {
                if event.id().as_ref() == "app-quit" {
                    request_quit(app);
                }
            });
            #[cfg(debug_assertions)]
            dev_hooks(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_window_opacity,
            read_text,
            write_text,
            quit_ready,
            hide_quick,
            open_overview,
            get_data_root,
            set_data_root,
            pending_update,
            check_update_now,
            os_version,
            install_update
        ])
        .build(context)
        .expect("error while building tauri application")
        .run(|app, event| {
            // 작은 창을 닫아(숨겨) 둔 상태에서 Dock 아이콘을 누르면 다시 보여 준다
            if let RunEvent::Reopen { .. } = event {
                show_main_window(app);
            }
        });
}

fn quick_shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::ALT), Code::Space)
}

#[cfg(target_os = "macos")]
mod platform {
    use objc2_app_kit::{NSApplicationActivationOptions, NSRunningApplication, NSWindow, NSWorkspace};
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

    /// 지금 앞에 있는 앱(Aru 자신은 빼고)
    pub fn frontmost_other_app() -> Option<i32> {
        let app = NSWorkspace::sharedWorkspace().frontmostApplication()?;
        let pid = app.processIdentifier();
        (pid != NSRunningApplication::currentApplication().processIdentifier()).then_some(pid)
    }

    pub fn activate_app(pid: i32) {
        if let Some(app) = NSRunningApplication::runningApplicationWithProcessIdentifier(pid) {
            app.activateWithOptions(NSApplicationActivationOptions::empty());
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use tauri::WebviewWindow;

    pub fn set_opacity(_window: &WebviewWindow, _alpha: f64) -> tauri::Result<()> {
        Ok(())
    }

    pub fn frontmost_other_app() -> Option<i32> {
        None
    }

    pub fn activate_app(_pid: i32) {}
}
