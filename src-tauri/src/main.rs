// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `aru add ...`처럼 명령으로 불리면 창을 띄우지 않고 처리하고 끝낸다
    let args: Vec<std::ffi::OsString> = std::env::args_os().skip(1).collect();
    match aru_lib::cli::entry(&args) {
        Some(code) => std::process::exit(code),
        None => aru_lib::run(),
    }
}
