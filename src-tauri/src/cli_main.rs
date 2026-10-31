//! 터미널·AI 도구용 aru 명령(콘솔 실행 파일). 창은 띄우지 않는다

fn main() {
    let args: Vec<std::ffi::OsString> = std::env::args_os().skip(1).collect();
    std::process::exit(aru_lib::cli::cli_entry(&args));
}
