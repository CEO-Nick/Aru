#[cfg(target_os = "macos")]
mod bookmark;
pub mod cli;
mod mcpb;
mod storage;

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
#[cfg(not(target_os = "macos"))]
use tauri::menu::MenuItem;
#[cfg(not(target_os = "macos"))]
use tauri::tray::TrayIconBuilder;
use tauri::{
    App, AppHandle, Emitter, Manager, RunEvent, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    Window,
};

/// 빠른 입력창을 띄우기 직전에 쓰던 앱. 입력창을 닫으면 그 앱으로 돌려보낸다
#[derive(Default)]
struct QuickState(Mutex<Option<i32>>);

// 앱스토어판은 투명 창을 못 쓴다(비공개 API). 막대 크기 그대로 기본 창을 띄워 둥근 모서리·그림자는 macOS에 맡긴다
const QUICK_WIDTH: f64 = 588.0;
const QUICK_HEIGHT: f64 = 60.0;

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
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true)
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
    let _ = platform::hide_window_buttons(&window);
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
struct QuitState(Mutex<Option<HashSet<String>>>);

#[tauri::command]
fn set_window_opacity(window: WebviewWindow, alpha: f64) -> Result<(), String> {
    platform::set_opacity(&window, alpha.clamp(0.0, 1.0)).map_err(|_| "창 투명도를 바꾸지 못했어요".to_string())
}

// aru 명령의 오류 문구는 터미널용이라 화면에 그대로 보이지 않게 한다
fn config_dir_error<E>(_: E) -> String {
    "Aru 설정 폴더를 찾지 못했어요".into()
}

// 저장 폴더는 사용자가 바꿀 수 있다. 어디로 바꿨는지는 컴퓨터마다 다르므로 설정 폴더(동기화 대상 아님)에 따로 적는다
fn location_file() -> Result<PathBuf, String> {
    Ok(root_dirs()?.0.join("location.json"))
}

// 앱도 aru 명령과 같은 출처(cli::app_dirs)로 폴더를 구한다. tauri 경로는 HOME을 따르는데,
// AI 도구가 직접 띄운 aru 명령은 HOME이 다를 수 있어 두 쪽이 다른 폴더를 볼 수 있다
fn root_dirs() -> Result<(PathBuf, PathBuf), String> {
    cli::app_dirs().map_err(config_dir_error)
}

/// 사용자가 고른 폴더를 못 열면 기본 폴더로 넘어가지 않고 `저장 폴더를 열 수 없어요: <경로>` 오류를 낸다
fn data_root() -> Result<PathBuf, String> {
    let (config, default) = root_dirs()?;
    cli::locate_root(&config, &default)
}

/// 열 수 없어도 사용자가 고른 경로를 그대로 보여 준다
#[tauri::command]
fn get_data_root() -> Result<String, String> {
    let (config, default) = root_dirs()?;
    Ok(cli::locate(&config, &default).0.to_string_lossy().to_string())
}

/// { ok, path, error }. 화면이 "저장 폴더를 열 수 없어요" 안내와 기본 폴더로 되돌리기를 보여 줄 때 쓴다
#[tauri::command]
fn data_root_status() -> Result<cli::RootStatus, String> {
    let (config, default) = root_dirs()?;
    Ok(cli::root_status(&config, &default))
}

#[tauri::command]
fn data_root_info() -> Result<cli::RootInfo, String> {
    let (config, default) = root_dirs()?;
    Ok(cli::root_info(&config, &default, &cli::user_home().unwrap_or_default()))
}

/// 고른 폴더 설정을 지워 기본 폴더로 돌아간다. 고른 폴더의 파일은 건드리지 않는다
#[tauri::command]
async fn reset_data_root(app: AppHandle) -> Result<(), String> {
    off_main(move || reset_root(&app)).await
}

fn reset_root(app: &AppHandle) -> Result<(), String> {
    let (config, _) = root_dirs()?;
    let _config = storage::lock_config(&config, storage::CLI_LOCK_WAIT)?;
    // 바꾸는 동안 지금 폴더에 들어오는 저장을 붙잡아 둔다(set_data_root와 같은 이유)
    let _lock = data_root().ok().map(|root| storage::lock_root(&root, storage::APP_LOCK_WAIT)).transpose()?;
    match std::fs::remove_file(location_file()?) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
            return Err(format!("기본 폴더로 되돌리지 못했어요: {}", storage::io_message(&e)))
        }
        _ => {}
    }
    let _ = app.emit("data-root-changed", ());
    Ok(())
}

/// set_data_root의 응답이자 data-root-changed의 내용. copied가 false면 지금 할 일을 새 폴더로 옮기지 않았고,
/// reason이 그 까닭이다(kept: 이미 할 일이 있는 폴더, sourceUnavailable: 지금 폴더를 열 수 없음).
/// 창은 바뀐 직후 새로고침되므로 응답이 아니라 이벤트로 받아 안내를 남긴다
#[derive(Debug, Clone, serde::Serialize)]
struct RootChanged {
    copied: bool,
    reason: storage::Prepared,
}

/// 복사부터 location.json 기록(commit)까지 옛 폴더의 잠금을 쥔다. 그 사이 끝난 저장이 옛 폴더에만 남아
/// 새 폴더 복사본에서 빠지지 않게 하고, 잠금을 기다리던 저장은 잡은 뒤 바뀐 폴더를 다시 확인한다(storage::lock_current)
fn switch_root(
    current: Option<&std::path::Path>,
    target: &std::path::Path,
    commit: impl FnOnce() -> Result<(), String>,
) -> Result<RootChanged, String> {
    let _lock = current.map(|root| storage::lock_root(root, storage::APP_LOCK_WAIT)).transpose()?;
    let prepared = storage::prepare_new_root(current, target, commit)?;
    Ok(RootChanged { copied: prepared == storage::Prepared::Copied, reason: prepared })
}

/// 폴더 변경·초기화를 설정 폴더 잠금으로 줄 세우고, 지금 폴더(current)는 그 안에서 구한다.
/// 밖에서 구하면 겹친 두 번째 변경이 첫 변경 전의 옛 폴더에서 복사해, 그 사이 새 폴더에 쓴 할 일이 빠진다.
/// 복사가 길 수 있어 기다림은 명령 쪽 한도(10초)를 쓴다
fn switch_serialized(
    config: &std::path::Path,
    current: impl FnOnce() -> Result<PathBuf, String>,
    target: &std::path::Path,
    commit: impl FnOnce() -> Result<(), String>,
) -> Result<RootChanged, String> {
    let _config = storage::lock_config(config, storage::CLI_LOCK_WAIT)?;
    // 지금 폴더를 못 열어도 새 폴더로는 옮길 수 있어야 한다. 그때는 복사할 게 없다
    let current = current().ok();
    switch_root(current.as_deref(), target, commit)
}

#[tauri::command]
async fn set_data_root(app: AppHandle, path: String) -> Result<RootChanged, String> {
    off_main(move || change_root(&app, path)).await
}

fn change_root(app: &AppHandle, path: String) -> Result<RootChanged, String> {
    let target = PathBuf::from(&path);
    let (config, default) = root_dirs()?;
    let location = config.join("location.json");
    let changed = switch_serialized(&config, || cli::locate_root(&config, &default), &target, || {
        // 샌드박스는 고른 순간에만 폴더를 열어 준다. 다음 실행과 aru 명령이 다시 열 수 있게 bookmark로 남긴다
        #[cfg(target_os = "macos")]
        let json = serde_json::json!({ "root": path, "bookmark": bookmark::create(&path)? }).to_string();
        #[cfg(not(target_os = "macos"))]
        let json = serde_json::json!({ "root": path }).to_string();
        save_location(&location, &json)
    })?;
    let _ = app.emit("data-root-changed", changed.clone());
    Ok(changed)
}

/// "저장하지 못했어요"만으로는 할 일 저장이 실패한 것으로 읽힌다. 까닭만 떼어 붙여 문장이 오류 문구 모양에 기대지 않게 한다
fn save_location(location: &std::path::Path, json: &str) -> Result<(), String> {
    storage::write_atomic(location, json)
        .map_err(|e| format!("폴더 설정을 저장하지 못했어요: {}", e.strip_prefix("저장하지 못했어요: ").unwrap_or(&e)))
}

// 파일 읽기·쓰기는 메인 스레드 밖에서 한다. 동기 command는 메인 스레드에서 돌아서,
// 네트워크 폴더가 느리거나 aru 명령이 잠금을 쥐고 있으면 창 전체가 멈춘다
async fn off_main<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|_| "작업을 마치지 못했어요. 다시 시도해 주세요".to_string())?
}

#[tauri::command]
async fn read_text(window: Window, path: String) -> Result<Option<String>, String> {
    off_main(move || {
        let root = data_root()?;
        trace(&format!("read {} {} @ {}", window.label(), path, root.display()));
        storage::read_text(&root, &path)
    })
    .await
}

#[tauri::command]
async fn list_names(path: String) -> Result<Vec<String>, String> {
    off_main(move || storage::list_names(&data_root()?, &path)).await
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
async fn write_text(app: AppHandle, window: Window, path: String, content: String) -> Result<(), String> {
    off_main(move || {
        trace(&format!("write {} {}", window.label(), path));
        if !write_current(|| data_root(), &path, &content, None)?.ok {
            return Err("저장 폴더가 바뀌어 새 폴더의 파일을 덮지 않았어요. 창을 새로 열고 다시 저장해 주세요".into());
        }
        let _ = app.emit("file-changed", FileChanged { path, source: window.label().to_string() });
        Ok(())
    })
    .await
}

/// write_text_if의 응답. 쓰면 { ok: true, current: null }, 파일이 expected와 달라 쓰지 않았으면
/// { ok: false, current: 지금 파일 내용(없으면 null) } — 화면이 그 내용과 합쳐 다시 쓴다
#[derive(Debug, serde::Serialize)]
struct WriteIf {
    ok: bool,
    current: Option<String>,
}

/// aru 명령이 같은 파일을 읽고-고치고-쓰는 도중이면 잠시 기다리고, 오래 걸리면 `저장 폴더가 잠겨 있어요`로 실패한다.
/// 잠금을 잡은 뒤의 저장 폴더에 쓴다 — 기다리는 사이 폴더가 바뀌었으면 옛 폴더에 쓰면 안 된다.
///
/// 기다리는 사이 폴더가 바뀐 무조건 쓰기(expected 없음)는 옛 폴더 기준으로 만든 내용이라 새 폴더 파일을 덮으면 안 된다.
/// 새 폴더가 이미 할 일이 있던 폴더(kept)면 다른 맥에서 꺼 둔 설정이 켜지거나 할 일이 사라진다. 그래서
/// - 할 일 파일(.md)은 "새 폴더에 없거나 빌 때만 쓰기"로 바꾼다. 있으면 쓰지 않고 지금 내용을 돌려줘 화면이 합친다
/// - 그 밖(settings.json)은 새 폴더에 있으면 버린다(ok로 답한다). 폴더를 바꾸면 창이 새로 열려 새 폴더 설정을 읽는다.
///   화면은 설정 충돌을 합치지 않고 제 것으로 덮으므로, 충돌로 돌려주면 결국 덮인다
fn write_current(
    resolve: impl Fn() -> Result<PathBuf, String>,
    path: &str,
    content: &str,
    expected: Option<&str>,
) -> Result<WriteIf, String> {
    let (root, _lock, moved) = storage::lock_current_moved(resolve, storage::APP_LOCK_WAIT)?;
    let expected = match expected {
        None if moved && path.ends_with(".md") => Some(""),
        None if moved && storage::read_text(&root, path)?.is_some() => return Ok(WriteIf { ok: true, current: None }),
        other => other,
    };
    Ok(match storage::write_text_if(&root, path, content, expected)? {
        storage::Swap::Written => WriteIf { ok: true, current: None },
        storage::Swap::Conflict(current) => WriteIf { ok: false, current },
    })
}

#[cfg(test)]
fn write_if_in(root: &std::path::Path, path: &str, content: &str, expected: Option<&str>) -> Result<WriteIf, String> {
    write_current(|| Ok(root.to_path_buf()), path, content, expected)
}

/// 앱이 마지막으로 읽은 내용(expected)과 지금 파일이 같을 때만 쓴다. 화면에서 고치는 사이 aru 명령(MCP)이
/// 넣은 할 일을 덮어써 잃지 않게 한다. expected가 None이면 write_text와 같다
#[tauri::command]
async fn write_text_if(
    app: AppHandle,
    window: Window,
    path: String,
    content: String,
    expected: Option<String>,
) -> Result<WriteIf, String> {
    off_main(move || {
        trace(&format!("write_if {} {}", window.label(), path));
        let result = write_current(|| data_root(), &path, &content, expected.as_deref())?;
        if result.ok {
            let _ = app.emit("file-changed", FileChanged { path, source: window.label().to_string() });
        }
        Ok(result)
    })
    .await
}

/// date: 작은 창에서 보던 날짜. 모아보기 창이 그 날짜를 골라 둔 채로 열린다
#[tauri::command]
fn open_overview(app: AppHandle, date: Option<String>) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("overview") {
        if let Some(date) = date {
            let _ = app.emit_to("overview", "select-date", date);
        }
        let _ = window.unminimize();
        window.show().map_err(overview_error)?;
        return window.set_focus().map_err(overview_error);
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
        .map_err(overview_error)?;
    if let Some(window) = app.get_webview_window("overview") {
        let _ = window.set_focus();
    }
    Ok(())
}

fn overview_error<E>(_: E) -> String {
    "모아보기 창을 열지 못했어요".into()
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

/// 응답 없는 창을 기다리는 한도. 화면의 저장(flush)은 잠금을 최대 APP_LOCK_WAIT 기다리고 화면 쪽 한도는 10초라,
/// 이보다 짧으면 aru 명령이 잠금을 쥔 동안 마지막 저장이 잘린다
const QUIT_WAIT: Duration = Duration::from_secs(11);

/// 폴더 변경(복사)을 기다리는 한도. exFAT로 1500일치를 옮기면 25초쯤 걸린다
const SWITCH_WAIT: Duration = Duration::from_secs(60);

/// 폴더를 바꾸는 동안은 옛 폴더 잠금이 잡혀 화면의 저장이 LOCKED로 실패한다. 그때 끄면 그 편집은 다시 시도되지 못하고 사라지고,
/// 복사도 도중에 끊긴다. 바꾸는 쪽이 쥔 설정 폴더 잠금이 풀릴 때까지 기다리면, 그 뒤의 저장은 바뀐 폴더로 간다(lock_current)
/// 다른 쪽이 쥐고 있을 때(옮기는 중)만 waiting을 불러 화면이 "끝나면 종료해요"를 띄우게 한다. 권한 오류 등은 기다려도 소용없다
fn wait_for_switch(config: &std::path::Path, waiting: impl FnOnce()) {
    if storage::lock_config(config, Duration::ZERO).is_err_and(|e| e.starts_with(storage::CONFIG_LOCKED)) {
        waiting();
        let _ = storage::lock_config(config, SWITCH_WAIT);
    }
}

/// tauri의 종료 요청 중 코드가 없는 것(마지막 창이 닫힘)은 붙잡고 request_quit으로 보낸다.
/// 저장을 마치고 우리가 부른 exit(0)은 코드가 있어 통과한다. 이미 끝내는 중이면 붙잡지 않는다(다시 끝낼 쪽이 없다)
fn hold_exit(code: Option<i32>) -> bool {
    code.is_none() && !QUIT.done()
}

/// 종료의 단계. 한 자물쇠 아래에서만 바꾼다 — 따로 된 플래그면 Dock 종료가 "나중에 답한다"(NSTerminateLater)를 고른 순간
/// 끝내는 쪽이 이미 "답 없이 exit"을 골라, 아무도 답하지 않은 채 앱이 끌 수 없는 상태로 남을 수 있다
#[derive(Clone, Copy, Debug, PartialEq)]
enum QuitPhase {
    Idle,
    /// 저장 중. later: Dock "종료"·로그아웃이 답을 기다린다
    Saving { later: bool },
    Done,
}

struct Quit(Mutex<QuitPhase>);

static QUIT: Quit = Quit(Mutex::new(QuitPhase::Idle));

#[derive(Debug, PartialEq)]
enum Begin {
    /// 처음 요청이라 부른 쪽이 저장을 시작한다
    Start,
    /// 이미 저장 중이라 그쪽이 끝낸다
    Joined,
    /// 이미 끝내는 중이다
    Done,
}

#[derive(Debug, PartialEq)]
enum Finish {
    Exit,
    Reply,
}

impl Quit {
    /// later: Dock "종료"·로그아웃(applicationShouldTerminate:)이라 끝낼 때 답해야 한다.
    /// 이미 끄는 중이면 다시 시작하지 않는다 — 두 번째 요청이 QuitState를 다시 채우면 이미 응답한 창까지 다시 기다린다
    fn begin(&self, later: bool) -> Begin {
        let mut phase = self.0.lock().unwrap();
        match *phase {
            QuitPhase::Idle => {
                *phase = QuitPhase::Saving { later };
                Begin::Start
            }
            QuitPhase::Saving { later: was } => {
                *phase = QuitPhase::Saving { later: was || later };
                Begin::Joined
            }
            QuitPhase::Done => Begin::Done,
        }
    }

    /// 한 번만 끝낸다. 미뤄 둔 Dock 종료·로그아웃이 있으면 그 답으로 끝내야 로그아웃이 이어진다
    fn finish(&self) -> Option<Finish> {
        let mut phase = self.0.lock().unwrap();
        let later = match *phase {
            QuitPhase::Done => return None,
            QuitPhase::Saving { later } => later,
            QuitPhase::Idle => false,
        };
        *phase = QuitPhase::Done;
        Some(if later { Finish::Reply } else { Finish::Exit })
    }

    fn done(&self) -> bool {
        *self.0.lock().unwrap() == QuitPhase::Done
    }
}

/// 모든 창이 저장을 마쳤거나 기다림이 끝났을 때
fn finish_quit(app: &AppHandle) {
    match QUIT.finish() {
        Some(Finish::Reply) if platform::reply_terminate(app) => {}
        Some(_) => app.exit(0),
        None => {}
    }
}

fn request_quit(app: &AppHandle) {
    if QUIT.begin(false) == Begin::Start {
        save_then_quit(app);
    }
}

// 열린 창마다 저장 대기분을 마저 쓰고 quit_ready를 부른다. 모두 응답하면 끄고, 응답이 없어도 QUIT_WAIT 뒤엔 끈다
fn save_then_quit(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        if let Ok((config, _)) = root_dirs() {
            wait_for_switch(&config, || {
                let _ = app.emit("quit-waiting", ());
            });
        }
        // 빠른 입력창은 저장할 게 없어서 기다리지 않는다
        let labels: HashSet<String> = app.webview_windows().into_keys().filter(|l| l != "quick").collect();
        if labels.is_empty() {
            finish_quit(&app);
            return;
        }
        *app.state::<QuitState>().0.lock().unwrap() = Some(labels);
        let _ = app.emit("quit-requested", ());
        std::thread::sleep(QUIT_WAIT);
        finish_quit(&app);
    });
}

/// 피드백 폼에 채울 OS 버전. 웹뷰의 userAgent는 macOS 버전을 10.15로 고정해 보여 줘서 따로 묻는다
#[tauri::command]
fn os_version() -> String {
    // sw_vers를 띄우지 않는다(샌드박스에서 자식 프로세스를 만들지 않게)
    #[cfg(target_os = "macos")]
    {
        let v = objc2_foundation::NSProcessInfo::processInfo().operatingSystemVersion();
        match v.patchVersion {
            0 => format!("macOS {}.{}", v.majorVersion, v.minorVersion),
            patch => format!("macOS {}.{}.{patch}", v.majorVersion, v.minorVersion),
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        std::env::consts::OS.into()
    }
}

/// aru 명령이 최근에 넣은 묶음들. 화면에 안 보이는 날짜에 넣은 것도 알림을 띄우려고 앱이 주기적으로 읽는다
#[tauri::command]
fn recent_ai_batches() -> Vec<serde_json::Value> {
    cli::recent_batches()
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AiConnectInfo {
    command: String,
    claude_desktop: bool,
}

/// 앱 실행 파일이 곧 aru 명령이다. AI 도구가 이 경로를 `aru mcp`로 실행한다
fn aru_command() -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| format!("Aru 실행 파일 위치를 알지 못했어요: {}", storage::io_message(&e)))?;
    Ok(exe.to_string_lossy().into_owned())
}

#[tauri::command]
fn ai_connect_info() -> Result<AiConnectInfo, String> {
    Ok(AiConnectInfo { command: aru_command()?, claude_desktop: platform::claude_desktop().is_some() })
}

/// 샌드박스라 Claude 설정 파일을 직접 고칠 수 없다. 확장 파일을 만들어 Claude가 사용자에게 설치를 묻게 한다.
/// 오류 문구는 화면이 그대로 보여 준다
#[tauri::command]
fn install_claude_desktop(app: AppHandle) -> Result<(), String> {
    let claude = platform::claude_desktop().ok_or("Claude 데스크톱을 찾지 못했어요")?;
    let dir = app.path().app_cache_dir().map_err(|_| "Claude에 넘길 확장 파일을 둘 폴더를 찾지 못했어요".to_string())?;
    let file = mcpb::write_bundle(&dir, &aru_command()?, &app.package_info().version.to_string(), env!("CARGO_PKG_AUTHORS"))?;
    if platform::open_with(&file, &claude) { Ok(()) } else { Err("Claude 데스크톱으로 확장 파일을 열지 못했어요".into()) }
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
    // 닫기는 창을 숨길 뿐이라 메뉴에서 다시 열 수 있어야 한다. Dock 클릭만으로는 App Review가 반려했다(Guideline 4, 2026-11-03)
    let main = MenuItemBuilder::with_id("app-show-main", "Aru")
        .accelerator("CmdOrCtrl+0")
        .build(app)?;
    let window = SubmenuBuilder::new(app, "윈도우")
        .minimize()
        .close_window()
        .separator()
        .item(&main)
        .build()?;
    MenuBuilder::new(app).items(&[&app_menu, &edit, &window]).build()
}

// macOS에는 Dock 아이콘이 같은 일(창 다시 열기·종료)을 해서 메뉴 막대 아이콘을 두지 않는다. Windows는 작업 표시줄 트레이가 그 자리다
#[cfg(not(target_os = "macos"))]
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

// macOS에는 Dock 아이콘이 같은 일(창 다시 열기·종료)을 해서 메뉴 막대 아이콘을 두지 않는다. Windows는 작업 표시줄 트레이가 그 자리다
#[cfg(not(target_os = "macos"))]
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
            let result = change_root(&handle, target);
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
        // 두 번 실행 막기는 macOS가 한다. 이미 켜져 있을 때 다시 열면 아래 Reopen으로 작은 창을 보여 준다
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // 빠른 입력창은 늘 마우스가 있는 화면에 띄우므로 위치를 기억하지 않는다
        .plugin(tauri_plugin_window_state::Builder::default().with_denylist(&["quick"]).build())
        .manage(QuitState::default())
        .manage(QuickState::default())
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
            #[cfg(not(target_os = "macos"))]
            build_tray(app)?;
            // 다른 앱이 이미 쓰고 있어 등록에 실패해도 앱은 그대로 쓴다
            if let Err(e) = app.global_shortcut().register(quick_shortcut()) {
                trace(&format!("단축키 등록 실패: {e}"));
            }
            let menu = build_app_menu(app)?;
            app.set_menu(menu)?;
            app.on_menu_event(|app, event| match event.id().as_ref() {
                "app-quit" => request_quit(app),
                "app-show-main" => show_main_window(app),
                _ => {}
            });
            platform::hook_terminate(app.handle().clone());
            if let Ok(cache) = app.path().app_cache_dir() {
                mcpb::remove_bundle(&cache);
            }
            #[cfg(debug_assertions)]
            dev_hooks(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_window_opacity,
            read_text,
            list_names,
            write_text,
            write_text_if,
            quit_ready,
            hide_quick,
            open_overview,
            get_data_root,
            set_data_root,
            data_root_status,
            data_root_info,
            reset_data_root,
            os_version,
            recent_ai_batches,
            ai_connect_info,
            install_claude_desktop
        ])
        .build(context)
        .expect("error while building tauri application")
        .run(|app, event| match event {
            // 작은 창을 닫아(숨겨) 둔 상태에서 Dock 아이콘을 누르면 다시 보여 준다
            RunEvent::Reopen { .. } => show_main_window(app),
            RunEvent::ExitRequested { code, api, .. } if hold_exit(code) => {
                api.prevent_exit();
                request_quit(app);
            }
            _ => {}
        });
}

fn quick_shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::ALT), Code::Space)
}

#[cfg(target_os = "macos")]
mod platform {
    use objc2_app_kit::{
        NSApplicationActivationOptions, NSRunningApplication, NSWindow, NSWindowButton, NSWorkspace,
    };
    use objc2_foundation::NSString;
    use std::path::Path;
    use tauri::WebviewWindow;

    const CLAUDE_DESKTOP: &str = "com.anthropic.claudefordesktop";

    static APP: std::sync::OnceLock<tauri::AppHandle> = std::sync::OnceLock::new();

    /// tao의 앱 델리게이트에는 applicationShouldTerminate:가 없어 Dock "종료"·로그아웃이 저장을 거치지 않고 끝난다.
    /// 그 클래스에 메서드를 더한다(이미 있으면 class_addMethod가 아무것도 하지 않는다)
    pub fn hook_terminate(app: tauri::AppHandle) {
        use objc2::runtime::{AnyClass, AnyObject, Imp, Sel};
        use objc2::{class, msg_send, sel};
        /// 저장 전이면 미루고(NSTerminateLater) 저장을 마친 뒤 답한다. 취소(NSTerminateCancel)로 답하면 로그아웃까지 멈춘다
        extern "C-unwind" fn should_terminate(_: &AnyObject, _: Sel, _: *mut AnyObject) -> usize {
            match super::QUIT.begin(true) {
                super::Begin::Done => 1,
                super::Begin::Start => {
                    if let Some(app) = APP.get() {
                        super::save_then_quit(app);
                    }
                    2
                }
                super::Begin::Joined => 2,
            }
        }
        let _ = APP.set(app);
        unsafe {
            let ns_app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
            let delegate: *mut AnyObject = msg_send![ns_app, delegate];
            if delegate.is_null() {
                return;
            }
            let cls = objc2::ffi::object_getClass(delegate) as *mut AnyClass;
            let imp: Imp = std::mem::transmute(should_terminate as extern "C-unwind" fn(&AnyObject, Sel, *mut AnyObject) -> usize);
            objc2::ffi::class_addMethod(cls, sel!(applicationShouldTerminate:), imp, c"Q@:@".as_ptr());
        }
    }

    /// 미뤄 둔 종료에 "끝내도 된다"고 답한다. 메인 스레드로 못 보내면 false
    pub fn reply_terminate(app: &tauri::AppHandle) -> bool {
        use objc2::runtime::{AnyObject, Bool};
        use objc2::{class, msg_send};
        app.run_on_main_thread(|| unsafe {
            let ns_app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
            let _: () = msg_send![ns_app, replyToApplicationShouldTerminate: Bool::YES];
        })
        .is_ok()
    }

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

    pub fn hide_window_buttons(window: &WebviewWindow) -> tauri::Result<()> {
        with_ns_window(window, |w| {
            for kind in [NSWindowButton::CloseButton, NSWindowButton::MiniaturizeButton, NSWindowButton::ZoomButton] {
                if let Some(button) = w.standardWindowButton(kind) {
                    button.setHidden(true);
                }
            }
        })
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

    /// 깔려 있는 Claude 데스크톱 앱의 경로
    pub fn claude_desktop() -> Option<String> {
        let url = NSWorkspace::sharedWorkspace().URLForApplicationWithBundleIdentifier(&NSString::from_str(CLAUDE_DESKTOP))?;
        Some(url.path()?.to_string())
    }

    pub fn open_with(file: &Path, app: &str) -> bool {
        // 대체 API(openURLs:withApplicationAtURL:…)는 완료 블록 때문에 block2가 더 필요하다
        #[allow(deprecated)]
        NSWorkspace::sharedWorkspace()
            .openFile_withApplication(&NSString::from_str(&file.to_string_lossy()), Some(&NSString::from_str(app)))
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use tauri::WebviewWindow;

    pub fn hook_terminate(_app: tauri::AppHandle) {}

    pub fn reply_terminate(_app: &tauri::AppHandle) -> bool {
        false
    }

    pub fn set_opacity(_window: &WebviewWindow, _alpha: f64) -> tauri::Result<()> {
        Ok(())
    }

    pub fn hide_window_buttons(_window: &WebviewWindow) -> tauri::Result<()> {
        Ok(())
    }

    pub fn frontmost_other_app() -> Option<i32> {
        None
    }

    pub fn activate_app(_pid: i32) {}

    pub fn claude_desktop() -> Option<String> {
        None
    }

    pub fn open_with(_file: &std::path::Path, _app: &str) -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn r2_write_text_if는_다르면_쓰지_않고_지금_내용을_돌려준다() {
        let root = std::env::temp_dir().join(format!("aru-lib-cas-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let rel = "daily/2026-10-17.md";
        let ok = write_if_in(&root, rel, "- [ ] 가\n", Some("")).unwrap();
        assert_eq!(serde_json::to_value(&ok).unwrap(), json!({"ok": true, "current": null}));
        // 앱이 기다리는 사이 aru add가 끼어든 경우
        cli::add_in(&root, &root.join("config"), &cli::Target::Date("2026-10-17".into()), &["AI가 넣음".into()], None, "2026-10-17").unwrap();
        let conflict = write_if_in(&root, rel, "- [ ] 가 고침\n", Some("- [ ] 가\n")).unwrap();
        assert_eq!(
            serde_json::to_value(&conflict).unwrap(),
            json!({"ok": false, "current": "- [ ] AI가 넣음\n- [ ] 가\n"})
        );
        assert_eq!(std::fs::read_to_string(root.join(rel)).unwrap(), "- [ ] AI가 넣음\n- [ ] 가\n");
        let missing = write_if_in(&root, "someday.md", "x\n", Some("옛 내용")).unwrap();
        assert_eq!(serde_json::to_value(&missing).unwrap(), json!({"ok": false, "current": null}));
        assert!(write_if_in(&root, "someday.md", "x\n", None).unwrap().ok);
    }

    #[test]
    fn r2_앱이_조건부로_쓰면_동시에_넣은_명령의_할_일을_잃지_않는다() {
        let root = std::env::temp_dir().join(format!("aru-lib-race-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let config = root.join("config");
        let rel = "daily/2026-11-01.md";
        let cli_threads: Vec<_> = (0..20)
            .map(|i| {
                let (root, config, target) = (root.clone(), config.clone(), cli::Target::Date("2026-11-01".into()));
                std::thread::spawn(move || cli::add_in(&root, &config, &target, &[format!("명령{i}")], None, "2026-10-17").unwrap())
            })
            .collect();
        // 화면 쪽: 읽고 → 한 줄 붙여 → 조건부로 쓴다. 다르면 지금 내용으로 다시 고쳐 쓴다(합치기를 단순화한 것)
        for i in 0..20 {
            let mut known = storage::read_text(&root, rel).unwrap().unwrap_or_default();
            loop {
                let mine = format!("{known}- [ ] 앱{i}\n");
                let r = write_if_in(&root, rel, &mine, Some(&known)).unwrap();
                if r.ok {
                    break;
                }
                known = r.current.unwrap_or_default();
            }
        }
        for t in cli_threads {
            t.join().unwrap();
        }
        let content = std::fs::read_to_string(root.join(rel)).unwrap();
        for i in 0..20 {
            assert_eq!(content.lines().filter(|l| *l == format!("- [ ] 명령{i}")).count(), 1, "{content}");
            assert_eq!(content.lines().filter(|l| *l == format!("- [ ] 앱{i}")).count(), 1, "{content}");
        }
    }

    #[test]
    fn r4_폴더를_바꾸는_동안_옛_폴더를_잠그고_응답에_이유를_싣는다() {
        let base = std::env::temp_dir().join(format!("aru-lib-switch-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let (old, new, kept) = (base.join("old"), base.join("new"), base.join("kept"));
        for d in [&old, &new, &kept] {
            std::fs::create_dir_all(d).unwrap();
        }
        std::fs::write(old.join("someday.md"), "- [ ] 가\n").unwrap();
        std::fs::write(kept.join("someday.md"), "- [ ] 저기\n").unwrap();
        let mut locked_during_commit = None;
        let changed = switch_root(Some(&old), &new, || {
            locked_during_commit = Some(storage::lock_root(&old, std::time::Duration::from_millis(50)).is_err());
            Ok(())
        })
        .unwrap();
        assert_eq!(locked_during_commit, Some(true), "location을 쓰는 동안 옛 폴더가 잠겨 있어야 한다");
        assert_eq!(serde_json::to_value(&changed).unwrap(), json!({"copied": true, "reason": "copied"}));
        assert!(storage::lock_root(&old, std::time::Duration::from_millis(50)).is_ok(), "끝나면 풀려야 한다");
        let changed = switch_root(Some(&old), &kept, || Ok(())).unwrap();
        assert_eq!(serde_json::to_value(&changed).unwrap(), json!({"copied": false, "reason": "kept"}));
        let changed = switch_root(None, &base.join("new"), || Ok(())).unwrap();
        assert_eq!(serde_json::to_value(&changed).unwrap(), json!({"copied": false, "reason": "sourceUnavailable"}));
        // location을 못 쓰면 실패를 그대로 알린다
        assert_eq!(switch_root(Some(&old), &new, || Err("x".into())).unwrap_err(), "x");
    }

    #[test]
    fn r4_앱의_저장은_잠금을_잡은_뒤_바뀐_저장_폴더에_쓴다() {
        let base = std::env::temp_dir().join(format!("aru-lib-relock-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let (old, new) = (base.join("old"), base.join("new"));
        std::fs::create_dir_all(&old).unwrap();
        std::fs::create_dir_all(&new).unwrap();
        let current = std::sync::Arc::new(Mutex::new(old.clone()));
        let switching = storage::lock_root(&old, storage::CLI_LOCK_WAIT).unwrap();
        let writer = {
            let current = current.clone();
            std::thread::spawn(move || write_current(|| Ok(current.lock().unwrap().clone()), "someday.md", "- [ ] 가\n", Some("")).unwrap())
        };
        std::thread::sleep(std::time::Duration::from_millis(200));
        *current.lock().unwrap() = new.clone();
        drop(switching);
        assert!(writer.join().unwrap().ok);
        assert!(new.join("someday.md").exists());
        assert!(!old.join("someday.md").exists(), "옛 폴더에 썼다");
    }

    fn switch_base(name: &str) -> std::path::PathBuf {
        let base = std::env::temp_dir().join(format!("aru-lib-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        base
    }

    #[test]
    fn r5_폴더를_바꾸는_사이_기다린_무조건_쓰기는_이미_할_일이_있는_폴더의_파일을_덮지_않는다() {
        let base = switch_base("r5-kept");
        let (old, kept) = (base.join("old"), base.join("kept"));
        for d in [&old, &kept] {
            std::fs::create_dir_all(d).unwrap();
        }
        std::fs::write(old.join("settings.json"), "{\"allowExternalAdd\":true}").unwrap();
        std::fs::write(kept.join("someday.md"), "- [ ] 저기\n").unwrap();
        std::fs::write(kept.join("settings.json"), "{\"allowExternalAdd\":false}").unwrap();
        let loc = std::sync::Arc::new(Mutex::new(old.clone()));
        let switcher = {
            let (loc, old, kept) = (loc.clone(), old.clone(), kept.clone());
            std::thread::spawn(move || {
                switch_root(Some(&old), &kept, || {
                    std::thread::sleep(Duration::from_millis(300));
                    *loc.lock().unwrap() = kept.clone();
                    Ok(())
                })
            })
        };
        std::thread::sleep(Duration::from_millis(50));
        let resolve = || Ok(loc.lock().unwrap().clone());
        let settings = std::thread::scope(|s| {
            let settings = s.spawn(|| write_current(resolve, "settings.json", "{\"allowExternalAdd\":true,\"옛\":1}", None));
            let someday = s.spawn(|| write_current(resolve, "someday.md", "- [ ] 옛 폴더\n", None));
            let fresh = s.spawn(|| write_current(resolve, "daily/2026-10-17.md", "- [ ] 새 파일\n", None));
            (settings.join().unwrap(), someday.join().unwrap(), fresh.join().unwrap())
        });
        assert_eq!(switcher.join().unwrap().unwrap().reason, storage::Prepared::Kept);
        assert_eq!(std::fs::read_to_string(kept.join("settings.json")).unwrap(), "{\"allowExternalAdd\":false}", "다른 맥에서 정한 설정을 덮었다");
        assert!(settings.0.unwrap().ok, "설정은 새 폴더 것을 따르고 조용히 버린다");
        assert_eq!(std::fs::read_to_string(kept.join("someday.md")).unwrap(), "- [ ] 저기\n", "할 일 파일을 덮었다");
        let someday = settings.1.unwrap();
        assert_eq!((someday.ok, someday.current.as_deref()), (false, Some("- [ ] 저기\n")), "화면이 합치도록 지금 내용을 돌려준다");
        // 새 폴더에 없던 파일은 그대로 쓴다
        assert!(settings.2.unwrap().ok);
        assert_eq!(std::fs::read_to_string(kept.join("daily/2026-10-17.md")).unwrap(), "- [ ] 새 파일\n");
        // 옛 폴더에도 쓰지 않았다
        assert_eq!(std::fs::read_to_string(old.join("settings.json")).unwrap(), "{\"allowExternalAdd\":true}");
    }

    #[test]
    fn r5_폴더_변경이_겹쳐도_나중_변경은_앞_변경이_만든_폴더에서_복사한다() {
        let base = switch_base("r5-double");
        let config = base.join("config");
        let (old, x, y) = (base.join("old"), base.join("x"), base.join("y"));
        for d in [&old, &x, &y, &config] {
            std::fs::create_dir_all(d).unwrap();
        }
        std::fs::write(old.join("someday.md"), "- [ ] 옛\n").unwrap();
        let loc = std::sync::Arc::new(Mutex::new(old.clone()));
        let a = {
            let (loc, x, config) = (loc.clone(), x.clone(), config.clone());
            std::thread::spawn(move || {
                let cur = loc.clone();
                switch_serialized(&config, move || Ok(cur.lock().unwrap().clone()), &x, || {
                    std::thread::sleep(Duration::from_millis(300));
                    *loc.lock().unwrap() = x.clone();
                    Ok(())
                })
            })
        };
        std::thread::sleep(Duration::from_millis(50));
        let b = {
            let (loc, y, config) = (loc.clone(), y.clone(), config.clone());
            std::thread::spawn(move || {
                let cur = loc.clone();
                switch_serialized(&config, move || Ok(cur.lock().unwrap().clone()), &y, || {
                    *loc.lock().unwrap() = y.clone();
                    Ok(())
                })
            })
        };
        a.join().unwrap().unwrap();
        // A가 끝난 뒤 X에 쓴 할 일
        let mut wrote_in_x = false;
        if loc.lock().unwrap().as_path() == x.as_path() {
            wrote_in_x = write_current(|| Ok(loc.lock().unwrap().clone()), "someday.md", "- [ ] A 뒤에 씀\n", None).is_ok_and(|w| w.ok);
        }
        b.join().unwrap().unwrap();
        assert_eq!(*loc.lock().unwrap(), y);
        if wrote_in_x {
            assert_eq!(std::fs::read_to_string(y.join("someday.md")).unwrap(), "- [ ] A 뒤에 씀\n");
        }
        // B는 A가 바꾼 X에서 복사해야 한다(옛 폴더가 아니라)
        assert_eq!(std::fs::read_to_string(x.join("someday.md")).unwrap(), std::fs::read_to_string(y.join("someday.md")).unwrap());
    }

    #[test]
    fn r7_폴더_설정을_못_쓰면_옮긴_것을_되돌려_다시_해도_이어서_옮긴다() {
        let base = switch_base("r7-commit-fail");
        let (old, new) = (base.join("old"), base.join("new"));
        std::fs::create_dir_all(old.join("daily")).unwrap();
        std::fs::create_dir_all(&new).unwrap();
        std::fs::write(old.join("someday.md"), "- [ ] 언젠가\n").unwrap();
        std::fs::write(old.join("daily/2026-10-01.md"), "- [ ] 하나\n").unwrap();
        assert!(switch_root(Some(&old), &new, || Err("x".into())).is_err());
        let left: Vec<_> = std::fs::read_dir(&new).unwrap().flatten().map(|e| e.file_name()).collect();
        assert!(left.is_empty(), "되돌리지 않았다: {left:?}");
        std::fs::write(old.join("someday.md"), "- [ ] 언젠가\n- [ ] 그 사이 넣음\n").unwrap();
        std::fs::write(old.join("daily/2026-10-02.md"), "- [ ] 둘\n").unwrap();
        let changed = switch_root(Some(&old), &new, || Ok(())).unwrap();
        assert_eq!(serde_json::to_value(&changed).unwrap(), json!({"copied": true, "reason": "copied"}));
        assert_eq!(std::fs::read_to_string(new.join("someday.md")).unwrap(), "- [ ] 언젠가\n- [ ] 그 사이 넣음\n");
        assert!(new.join("daily/2026-10-02.md").exists());
    }

    #[test]
    fn r7_폴더_설정을_못_쓰면_폴더_설정이라고_알린다() {
        use std::os::unix::fs::PermissionsExt;
        let base = switch_base("r7-location-denied");
        std::fs::set_permissions(&base, std::fs::Permissions::from_mode(0o555)).unwrap();
        let e = save_location(&base.join("location.json"), "{}").unwrap_err();
        std::fs::set_permissions(&base, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert!(e.starts_with("폴더 설정을 저장하지 못했어요: 권한이 없어요"), "{e}");
    }

    #[test]
    fn r8_종료는_폴더를_바꾸는_중이면_끝날_때까지_기다린다() {
        let config = switch_base("r8-quit-wait");
        let switching = storage::lock_config(&config, storage::CLI_LOCK_WAIT).unwrap();
        let start = std::time::Instant::now();
        let release = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(400));
            drop(switching);
        });
        wait_for_switch(&config, || ());
        assert!(start.elapsed() >= Duration::from_millis(350), "복사가 끝나기 전에 종료를 시작했다");
        release.join().unwrap();
    }

    #[test]
    fn r9_n6_이미_끄는_중이면_두_번째_종료_요청은_무시한다() {
        let q = quit();
        assert_eq!(q.begin(false), Begin::Start, "첫 종료 요청을 막았다");
        assert_eq!(q.begin(false), Begin::Joined, "두 번째 종료 요청이 기다림을 다시 시작한다");
    }

    fn quit() -> Quit {
        Quit(Mutex::new(QuitPhase::Idle))
    }

    #[test]
    fn r9_q3_앱과_aru_명령은_같은_설정_폴더를_본다() {
        let conf: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let (config, data) = cli::app_dirs().unwrap();
        assert_eq!(root_dirs().unwrap(), (config.clone(), data));
        assert_eq!(config.file_name().unwrap(), conf["identifier"].as_str().unwrap());
    }

    #[test]
    fn r7_종료는_잠금을_기다리는_저장보다_오래_기다린다() {
        assert!(QUIT_WAIT > storage::APP_LOCK_WAIT + Duration::from_secs(7), "화면 저장 한도(10초)보다 짧다");
    }

    #[test]
    fn r10_폴더를_옮기는_중일_때만_종료가_기다린다고_알린다() {
        let config = switch_base("r10-quit-waiting");
        let told = std::cell::Cell::new(false);
        wait_for_switch(&config, || told.set(true));
        assert!(!told.get(), "옮기는 중이 아닌데 알렸다");
        let switching = storage::lock_config(&config, storage::CLI_LOCK_WAIT).unwrap();
        let release = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(200));
            drop(switching);
        });
        wait_for_switch(&config, || told.set(true));
        release.join().unwrap();
        assert!(told.get(), "옮기는 중인데 알리지 않았다");
    }

    #[test]
    fn r10_dock_종료와_로그아웃도_저장을_마친_뒤에_끝낸다() {
        // 마지막 창이 닫혀 생긴 종료 요청(코드 없음)은 붙잡고, 저장을 마친 뒤 부른 exit(코드 있음)는 통과시킨다
        assert!(hold_exit(None));
        assert!(!hold_exit(Some(0)));
        // Dock 종료·로그아웃: 저장 전이면 나중에 답하고, 저장을 마치면 그 답으로 끝낸다(한 번만)
        let q = quit();
        assert_eq!(q.begin(true), Begin::Start);
        assert_eq!(q.finish(), Some(Finish::Reply));
        assert_eq!(q.finish(), None, "두 번 끝냈다");
        assert!(q.done(), "끝내는 중의 종료 요청을 붙잡으면 끝낼 쪽이 없다");
        assert_eq!(q.begin(true), Begin::Done, "저장을 마친 뒤의 종료 요청을 또 미뤘다");
    }

    #[test]
    fn r11_바쁜_게_아닌_잠금_오류에는_옮기는_중이라고_알리지_않는다() {
        let base = switch_base("r11-quit-denied");
        let config = base.join("설정-자리에-파일");
        std::fs::write(&config, "").unwrap();
        let told = std::cell::Cell::new(false);
        wait_for_switch(&config, || told.set(true));
        assert!(!told.get(), "권한·자리 오류인데 옮기는 중이라고 알렸다");
    }

    #[test]
    fn r11_dock_종료와_끝내기가_겹쳐도_답할_쪽이_남는다() {
        // 끝내는 쪽이 먼저 exit을 골랐으면 Dock 종료에는 바로 끝내라고 답한다
        let q = quit();
        q.begin(false);
        assert_eq!(q.finish(), Some(Finish::Exit));
        assert_eq!(q.begin(true), Begin::Done);
        // Dock 종료가 먼저면 끝내는 쪽이 답한다
        let q = quit();
        q.begin(false);
        assert_eq!(q.begin(true), Begin::Joined);
        assert_eq!(q.finish(), Some(Finish::Reply));
        // 실제로 겹쳐도 "나중에 답한다"와 "답 없이 exit"이 함께 나오지 않는다
        for _ in 0..20000 {
            let q = std::sync::Arc::new(quit());
            q.begin(false);
            let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
            let dock = {
                let (q, b) = (q.clone(), barrier.clone());
                std::thread::spawn(move || {
                    b.wait();
                    q.begin(true)
                })
            };
            barrier.wait();
            let fin = q.finish();
            let begin = dock.join().unwrap();
            assert!(matches!((&begin, &fin), (Begin::Joined, Some(Finish::Reply)) | (Begin::Done, Some(Finish::Exit))), "{begin:?} {fin:?}");
        }
    }

    #[test]
    fn r11_os_버전은_sw_vers와_같다() {
        let out = std::process::Command::new("/usr/bin/sw_vers").arg("-productVersion").output().unwrap();
        assert_eq!(os_version(), format!("macOS {}", String::from_utf8_lossy(&out.stdout).trim()));
    }
}
