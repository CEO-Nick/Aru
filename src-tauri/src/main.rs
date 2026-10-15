// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `aru add ...`처럼 명령으로 불리면 창을 띄우지 않고 처리하고 끝낸다
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().is_some_and(|a| aru_lib::cli::COMMANDS.contains(&a.as_str())) {
        std::process::exit(aru_lib::cli::run(&args));
    }
    aru_lib::run()
}
