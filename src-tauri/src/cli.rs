//! 터미널·AI 도구에서 할 일을 넣고 보는 명령(`aru add`, `aru list`)과 MCP 서버(`aru mcp`).
//! 앱이 켜져 있지 않아도 저장 폴더의 마크다운 파일에 직접 쓴다. 켜져 있는 앱은 바뀐 파일을 다시 읽어 합친다.

use crate::storage;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::ffi::OsString;
use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const IDENTIFIER: &str = "dev.aruu.aru";

pub const COMMANDS: &[&str] = &["add", "list", "mcp", "help", "--help", "-h"];

/// 한 번에 넣을 수 있는 양. 넘으면 하나도 쓰지 않는다
const MAX_ITEMS: usize = 1000;
const MAX_ITEM_CHARS: usize = 10_000;
const MAX_TOOL_CHARS: usize = 64;
/// 한 번에 넣는 글자 수 합계(UTF-16). 하나하나는 한도 안이어도 1000개 × 1만 자면 한 번에 30MB가 넘게 붙는다
const MAX_CALL_CHARS: usize = 200_000;
/// 건너뛴 할 일을 알릴 때 이름까지 적는 개수
const SKIPPED_SHOWN: usize = 5;

const HELP: &str = "aru — Aru 할 일 앱에 터미널에서 할 일을 넣고 본다

사용법:
  aru add \"할 일\" [\"할 일\" ...] [--someday | --date YYYY-MM-DD] [--by 도구이름]
  aru list [--someday | --date YYYY-MM-DD]
  aru mcp            MCP 서버로 실행(AI 앱 연결용)
  aru --version      버전

규칙:
  - 할 일은 목록 맨 위에, 준 순서대로 들어간다.
  - 같은 날 아직 안 끝낸 똑같은 할 일이 있으면 건너뛴다.
  - -로 시작하는 글을 할 일로 넣으려면 -- 뒤에 적는다(예: aru add -- \"--help 문서 고치기\").
  - AI 도구는 사용자가 할 일에 추가해 달라고 직접 말한 경우에만 쓴다.
    작업 중에 스스로 판단해서 추가하지 않는다.
  - AI 도구가 넣을 때는 --by 에 도구 이름을 적는다(예: --by claude-code).
    앱에 'AI' 태그가 붙고, 사용자가 확인하면 사라진다.
  - 지우기·고치기·체크는 하지 않는다. 사람이 앱에서 한다.";

#[derive(Debug, PartialEq)]
pub enum Target {
    Today,
    Date(String),
    Someday,
}

impl Target {
    fn rel_path(&self, today: &str) -> String {
        match self {
            Target::Today => format!("daily/{today}.md"),
            Target::Date(d) => format!("daily/{d}.md"),
            Target::Someday => "someday.md".into(),
        }
    }

    fn label(&self, today: &str) -> String {
        match self {
            Target::Today => format!("오늘({today})"),
            Target::Date(d) => d.clone(),
            Target::Someday => "언젠가".into(),
        }
    }
}

#[derive(Debug, PartialEq)]
pub struct AddResult {
    pub content: String,
    pub added: Vec<String>,
    pub skipped: Vec<String>,
    /// 같은 요청 안에 앞서 나온 것과 겹쳐 넣지 않은 것
    pub repeated: Vec<String>,
}

/// JS `String.prototype.trim`이 지우는 글자. Rust의 공백 판정과 U+0085·U+FEFF 두 글자가 다르다
fn is_js_space(c: char) -> bool {
    (c.is_whitespace() && c != '\u{85}') || c == '\u{feff}'
}

fn js_trim(text: &str) -> &str {
    text.trim_matches(is_js_space)
}

/// 앱의 `normalizeTodoText`(src/core/text.ts). 앞뒤 공백은 그대로 둔다
fn normalize_text(raw: &str) -> String {
    raw.replace("\r\n", " ")
        .chars()
        .filter(|c| *c != '\u{feff}')
        .map(|c| if matches!(c, '\r' | '\n' | '\u{2028}' | '\u{2029}' | '\u{a0}') { ' ' } else { c })
        .collect()
}

/// 앱의 `normalizeTodoText`(src/core/text.ts) + trim과 같은 결과를 낸다.
/// 다르면 여기서 넣은 줄을 앱이 메모로 읽거나, 앱이 다시 저장할 때 지워 버린다
pub fn normalize_item(raw: &str) -> String {
    js_trim(&normalize_text(raw)).to_string()
}

/// 눈에 보이지 않는 글자(폭 0 공백·방향 표시·이형 선택자·태그·한글 채움 문자 등). 쌍둥이 목록이 src/core/text.ts에 있다 —
/// 한쪽만 고치면 앱은 넣지 않는 빈 할 일을 aru 명령은 넣는다
const INVISIBLE: &[(char, char)] = &[
    ('\u{00AD}', '\u{00AD}'),
    ('\u{034F}', '\u{034F}'),
    ('\u{061C}', '\u{061C}'),
    ('\u{115F}', '\u{1160}'),
    ('\u{17B4}', '\u{17B5}'),
    ('\u{180B}', '\u{180F}'),
    ('\u{200B}', '\u{200F}'),
    ('\u{202A}', '\u{202E}'),
    ('\u{2060}', '\u{2064}'),
    ('\u{2066}', '\u{206F}'),
    ('\u{2800}', '\u{2800}'),
    ('\u{3164}', '\u{3164}'),
    ('\u{FE00}', '\u{FE0F}'),
    ('\u{FEFF}', '\u{FEFF}'),
    ('\u{FFA0}', '\u{FFA0}'),
    ('\u{1D159}', '\u{1D159}'),
    ('\u{1D173}', '\u{1D17A}'),
    ('\u{E0000}', '\u{E007F}'),
    ('\u{E0100}', '\u{E01EF}'),
];

/// 정리한 뒤 공백(Unicode White_Space)과 보이지 않는 글자만 남으면 빈 할 일이다. 판정에만 쓰고 글자는 지우지 않는다 —
/// 이모지 속 ZWJ·이형 선택자처럼 글자 사이에서는 뜻이 있다
pub fn is_blank_item(raw: &str) -> bool {
    normalize_text(raw).chars().all(|c| c.is_whitespace() || INVISIBLE.iter().any(|(from, to)| (*from..=*to).contains(&c)))
}

/// 앱의 TASK_LINE(`^[-*+] \[([ xX])\](?: (.*))?$`, s 플래그)과 같은 판정. 줄은 split_lines로 나눈 것이어야 한다.
/// s 플래그라 글자 속 CR·U+2028·U+2029도 할 일 글자다(앱이 공백으로 바꿔 읽는다)
fn is_task_line(line: &str) -> Option<(bool, &str)> {
    let rest = line.strip_prefix("- [").or_else(|| line.strip_prefix("* [")).or_else(|| line.strip_prefix("+ ["))?;
    let mut chars = rest.chars();
    let mark = chars.next()?;
    let after = chars.as_str().strip_prefix(']')?;
    if !matches!(mark, ' ' | 'x' | 'X') {
        return None;
    }
    if !after.is_empty() && !after.starts_with(' ') {
        return None;
    }
    Some((mark != ' ', after.strip_prefix(' ').unwrap_or(after)))
}

/// 앱의 parseDocument처럼 맨 앞 BOM을 떼고 \n으로만 나눈다(줄 끝 \r 하나는 뗀다).
/// 각 줄은 (글자, 원래 줄 끝)이다. 다시 쓸 때 있던 줄의 끝을 그대로 돌려놓으려고 들고 있다
fn split_lines(content: &str) -> (bool, Vec<(&str, &str)>) {
    let (bom, body) = match content.strip_prefix('\u{feff}') {
        Some(rest) => (true, rest),
        None => (false, content),
    };
    let mut lines = Vec::new();
    let mut rest = body;
    while !rest.is_empty() {
        let (line, ending, next) = match rest.find('\n') {
            Some(i) if rest[..i].ends_with('\r') => (&rest[..i - 1], "\r\n", &rest[i + 1..]),
            Some(i) => (&rest[..i], "\n", &rest[i + 1..]),
            None => match rest.strip_suffix('\r') {
                Some(line) => (line, "\r", ""),
                None => (rest, "", ""),
            },
        };
        lines.push((line, ending));
        rest = next;
    }
    (bom, lines)
}

/// 코드 블록 여는 줄(앱의 FENCE_OPEN `^\s*(`{3,}|~{3,})`)이면 (기호, 개수)
fn fence_open(line: &str) -> Option<(char, usize)> {
    let rest = line.trim_start_matches(is_js_space);
    let mark = rest.chars().next().filter(|c| matches!(c, '`' | '~'))?;
    let run = rest.chars().take_while(|c| *c == mark).count();
    (run >= 3).then_some((mark, run))
}

/// 앱의 closesFence: 같은 기호를 여는 줄 이상 늘어놓고 앞뒤에 공백만 있는 줄
fn closes_fence(line: &str, (mark, run): (char, usize)) -> bool {
    let rest = line.trim_matches(is_js_space);
    !rest.is_empty() && rest.chars().all(|c| c == mark) && rest.chars().count() >= run
}

/// 줄마다 할 일이면 Some((끝냄, 글자)). 앱처럼 코드 블록(``` · ~~~) 안의 줄은 할 일 모양이어도 예시 글이다.
/// 파일 끝까지 닫히지 않은 블록은 블록으로 보지 않는다 — 메모 속 ``` 한 줄이 그 아래 할 일을 모두 숨기지 않게
fn task_lines<'a>(lines: &[(&'a str, &str)]) -> Vec<Option<(bool, &'a str)>> {
    let mut out = Vec::with_capacity(lines.len());
    let mut i = 0;
    while i < lines.len() {
        if let Some(fence) = fence_open(lines[i].0) {
            if let Some(close) = (i + 1..lines.len()).find(|&j| closes_fence(lines[j].0, fence)) {
                out.extend((i..=close).map(|_| None));
                i = close + 1;
                continue;
            }
        }
        out.push(is_task_line(lines[i].0));
        i += 1;
    }
    out
}

fn is_date_shape(d: &str) -> bool {
    let b = d.as_bytes();
    b.len() == 10 && b.iter().enumerate().all(|(i, c)| if i == 4 || i == 7 { *c == b'-' } else { c.is_ascii_digit() })
}

/// 앱의 MARKER_COMMENT 안쪽(` from:날짜` · ` ai:도구@시각`이 하나 이상)을 읽어 AI 표시 여부를 돌려준다. 모양이 다르면 None
fn marker_tokens(inner: &str) -> Option<bool> {
    let mut is_ai = false;
    let mut rest = inner;
    if rest.is_empty() {
        return None;
    }
    while !rest.is_empty() {
        rest = rest.strip_prefix(' ')?;
        let end = rest.find(' ').unwrap_or(rest.len());
        let token = &rest[..end];
        if let Some(date) = token.strip_prefix("from:") {
            if !date.is_empty() && !is_date_shape(date) {
                return None;
            }
        } else if let Some(ai) = token.strip_prefix("ai:") {
            let (by, at) = ai.split_once('@')?;
            let by_ok = !by.is_empty() && by.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'));
            if !by_ok || at.is_empty() || !at.chars().all(|c| c.is_ascii_digit()) {
                return None;
            }
            is_ai = true;
        } else {
            return None;
        }
        rest = &rest[end..];
    }
    Some(is_ai)
}

/// 줄 끝 표시 주석(from·ai)을 뗀 글자와, AI 표시 여부. 앱과 판정이 같아야 목록·중복 판단이 어긋나지 않는다
fn split_marker(text: &str) -> (&str, bool) {
    let trimmed = text.trim_end_matches(is_js_space);
    if let Some(body) = trimmed.strip_suffix(" -->") {
        if let Some(start) = body.rfind("<!--") {
            if let Some(is_ai) = marker_tokens(&body[start + 4..]) {
                return (trimmed[..start].trim_end_matches(is_js_space), is_ai);
            }
        }
    }
    (trimmed, false)
}

fn looks_like_marker(text: &str) -> bool {
    split_marker(text).0.len() != text.trim_end_matches(is_js_space).len()
}

/// 할 일 글자에서 표시 주석을 뗀 비교용 글자. 앱처럼 글자를 먼저 정리한 뒤 주석을 찾는다
fn todo_key(text: &str) -> String {
    let normalized = normalize_text(text);
    js_trim(split_marker(&normalized).0).to_string()
}

/// 새 할 일을 앱의 맨 위 넣기(prependTodoIfNew)와 같은 자리, 첫 할 일 바로 앞(제목 등은 그 위에 남는다)에 준 순서대로 넣는다.
/// 안 끝낸 똑같은 할 일은 건너뛴다. 있던 줄은 줄 끝(CRLF·LF)·BOM까지 그대로 둔다
pub fn add_items(content: &str, items: &[String], ai: Option<(&str, u64)>) -> AddResult {
    let (bom, lines) = split_lines(content);
    let tasks = task_lines(&lines);
    let open: HashSet<String> = tasks.iter().flatten().filter(|(done, _)| !done).map(|(_, text)| todo_key(text)).collect();

    let mut added = Vec::new();
    let mut skipped = Vec::new();
    let mut repeated = Vec::new();
    // 넣은 것뿐 아니라 이미 있어 건너뛴 것도 기억한다. 아니면 같은 이름이 "이미 있어서"에 겹친 수만큼 나온다
    let mut seen = HashSet::new();
    let mut new_lines = Vec::new();
    for raw in items {
        let text = normalize_item(raw);
        if is_blank_item(&text) {
            continue;
        }
        if !seen.insert(text.clone()) {
            repeated.push(text);
            continue;
        }
        if open.contains(&text) {
            skipped.push(text);
            continue;
        }
        let marker = match ai {
            Some((by, at)) => format!(" <!-- ai:{by}@{at} -->"),
            None if looks_like_marker(&text) => " <!-- from: -->".into(),
            None => String::new(),
        };
        new_lines.push(format!("- [ ] {text}{marker}"));
        added.push(text);
    }

    if new_lines.is_empty() {
        return AddResult { content: content.to_string(), added, skipped, repeated };
    }
    // 새 줄의 끝은 파일에 많은 쪽을 따른다. 섞여 있어도 있던 줄의 끝은 바꾸지 않는다
    let crlf = lines.iter().filter(|(_, e)| *e == "\r\n").count();
    let newline = if crlf * 2 > lines.len() { "\r\n" } else { "\n" };
    let mut out = String::from(if bom { "\u{feff}" } else { "" });
    let mut push = |line: &str, ending: &str| {
        out.push_str(line);
        // 마지막 줄에 줄바꿈이 없으면(앱도 저장할 때 붙인다) 붙인다
        out.push_str(if ending == "\n" || ending == "\r\n" { ending } else { newline });
    };
    match tasks.iter().position(Option::is_some) {
        Some(first) => {
            lines[..first].iter().for_each(|(l, e)| push(l, e));
            new_lines.iter().for_each(|l| push(l, newline));
            lines[first..].iter().for_each(|(l, e)| push(l, e));
        }
        None => {
            // 앱은 할 일이 없는 파일의 줄을 모두 메모로 보고, 앞뒤 빈 줄을 떼어 할 일 아래 빈 줄 하나 뒤에 둔다
            let start = lines.iter().position(|(l, _)| !l.is_empty()).unwrap_or(lines.len());
            let end = lines.iter().rposition(|(l, _)| !l.is_empty()).map_or(start, |i| i + 1);
            new_lines.iter().for_each(|l| push(l, newline));
            if start < end {
                push("", newline);
                lines[start..end].iter().for_each(|(l, e)| push(l, e));
            }
        }
    }
    AddResult { content: out, added, skipped, repeated }
}

/// 목록을 사람과 AI가 읽기 좋은 줄로. 앱이 보여 주는 할 일만, 앱처럼 정리한 글자로 보여 준다
pub fn list_items(content: &str) -> Vec<String> {
    let (_, lines) = split_lines(content);
    task_lines(&lines)
        .into_iter()
        .flatten()
        .map(|(done, text)| {
            let normalized = normalize_text(text);
            let (text, is_ai) = split_marker(&normalized);
            format!("{} {}{}", if done { "[x]" } else { "[ ]" }, text, if is_ai { " (AI)" } else { "" })
        })
        .collect()
}

/// 도구 이름은 주석 안에 들어가므로 영문·숫자·.-_만 남긴다
pub fn sanitize_tool(name: &str) -> String {
    let cleaned: String = name
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') { c } else { '-' })
        .collect();
    let cleaned = cleaned.trim_matches('-').to_string();
    if cleaned.is_empty() { "ai".into() } else { cleaned }
}

/// 이 맥의 시간대(TZ 포함) 기준 오늘. 외부 `date` 명령은 PATH·로캘에 따라 없거나 다른 모양을 내서 쓰지 않는다
#[cfg(not(windows))]
pub fn today() -> String {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    local_date(now)
}

/// Windows 설정의 시간대 기준 오늘. CRT의 TZ 환경 변수는 서식·의미가 달라(`KST-9`) 지원하지 않는다
#[cfg(windows)]
pub fn today() -> String {
    let t = win::local_time();
    systemtime_date(t.wYear, t.wMonth, t.wDay)
}

#[cfg(any(windows, test))]
fn systemtime_date(year: u16, month: u16, day: u16) -> String {
    format!("{year:04}-{month:02}-{day:02}")
}

#[cfg(unix)]
unsafe extern "C" {
    // libc 크레이트에 선언이 없다. localtime_r은 TZ가 바뀌어도 다시 읽는다는 보장이 없어 먼저 부른다
    fn tzset();
}

#[cfg(not(windows))]
pub(crate) fn local_date(secs: i64) -> String {
    #[cfg(unix)]
    {
        let t = secs as libc::time_t;
        let mut tm: libc::tm = unsafe { std::mem::zeroed() };
        let ok = unsafe {
            tzset();
            !libc::localtime_r(&t, &mut tm).is_null()
        };
        if ok {
            return format!("{:04}-{:02}-{:02}", tm.tm_year + 1900, tm.tm_mon + 1, tm.tm_mday);
        }
    }
    utc_date(secs)
}

#[cfg(not(windows))]
fn utc_date(secs: i64) -> String {
    let z = secs.div_euclid(86_400) + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}")
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// 달력에 있는 날짜만. 앱은 1970~9999년 날짜 파일만 읽는다
fn valid_date(d: &str) -> bool {
    if !is_date_shape(d) {
        return false;
    }
    let num = |r: std::ops::Range<usize>| d[r].parse::<u32>().unwrap_or(0);
    let (y, m, day) = (num(0..4), num(5..7), num(8..10));
    let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    let days = match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    (1970..=9999).contains(&y) && (1..=days).contains(&day)
}

fn date_error(d: &str) -> String {
    format!("올바른 날짜가 아니다: {d} (YYYY-MM-DD, 달력에 있는 날짜)")
}

/// HOME이 없거나 비어 있거나 상대 경로면 계정의 홈 폴더를 쓴다. 그대로 쓰면 지금 폴더 아래에 조용히 저장된다
fn resolve_home(env: Option<OsString>, passwd: impl FnOnce() -> Option<PathBuf>) -> Option<PathBuf> {
    env.map(PathBuf::from).filter(|p| p.is_absolute()).or_else(passwd).filter(|p| p.is_absolute())
}

#[cfg(unix)]
fn passwd_home() -> Option<PathBuf> {
    use std::os::unix::ffi::OsStrExt;
    let mut pw: libc::passwd = unsafe { std::mem::zeroed() };
    let mut buf = vec![0 as libc::c_char; 16 * 1024];
    let mut found: *mut libc::passwd = std::ptr::null_mut();
    let rc = unsafe { libc::getpwuid_r(libc::getuid(), &mut pw, buf.as_mut_ptr(), buf.len(), &mut found) };
    if rc != 0 || found.is_null() || pw.pw_dir.is_null() {
        return None;
    }
    let dir = unsafe { std::ffi::CStr::from_ptr(pw.pw_dir) };
    Some(PathBuf::from(std::ffi::OsStr::from_bytes(dir.to_bytes())))
}

/// Windows에는 passwd가 없다. 계정의 프로필 폴더를 쓴다
#[cfg(windows)]
fn passwd_home() -> Option<PathBuf> {
    win::known_folder(&windows_sys::Win32::UI::Shell::FOLDERID_Profile)
}

#[cfg(not(any(unix, windows)))]
fn passwd_home() -> Option<PathBuf> {
    None
}

/// 샌드박스 컨테이너 홈(`…/Library/Containers/{앱}/Data`)일 때만 받는다
#[cfg(any(target_os = "macos", test))]
fn container_home(p: PathBuf) -> Option<PathBuf> {
    (p.is_absolute() && p.ends_with("Data") && p.parent()?.parent()?.ends_with("Library/Containers")).then_some(p)
}

/// 샌드박스 앱은 GUI로 켜든 AI 도구가 직접 실행하든 NSHomeDirectory가 컨테이너를 가리킨다. HOME은 부모가 넘긴 값이라
/// 계정 홈일 수 있고, 그러면 GUI와 다른 폴더(샌드박스가 막는 곳)를 본다.
/// 샌드박스가 아니면 NSHomeDirectory는 HOME을 무시하고 계정 홈을 돌려주므로 쓰지 않는다 — HOME을 바꿔 띄우는 테스트·사용자가 실제 폴더에 쓴다
#[cfg(target_os = "macos")]
fn sandbox_home() -> Option<PathBuf> {
    container_home(PathBuf::from(objc2_foundation::NSHomeDirectory().to_string()))
}

#[cfg(not(target_os = "macos"))]
fn sandbox_home() -> Option<PathBuf> {
    None
}

// Windows에서는 HOME을 읽지 않는다. Git Bash·MSYS가 `/c/Users/x` 꼴로 넣어 두는 값이라 받으면 엉뚱한 곳에 쓴다
#[cfg(windows)]
const HOME_VAR: &str = "USERPROFILE";
#[cfg(not(windows))]
const HOME_VAR: &str = "HOME";

fn home() -> Result<PathBuf, String> {
    if let Some(container) = sandbox_home() {
        return Ok(container);
    }
    resolve_home(std::env::var_os(HOME_VAR), passwd_home)
        .ok_or_else(|| format!("홈 폴더를 찾을 수 없다({HOME_VAR}이 비어 있다). {HOME_VAR}을 지정하고 다시 실행해 달라."))
}

/// 앱의 설정 폴더와 기본 저장 폴더. 맥에서는 같은 곳이다
pub fn app_dirs() -> Result<(PathBuf, PathBuf), String> {
    #[cfg(target_os = "macos")]
    {
        let base = home()?.join("Library/Application Support").join(IDENTIFIER);
        Ok((base.clone(), base))
    }
    #[cfg(windows)]
    {
        windows_dirs(
            std::env::var_os("LOCALAPPDATA"),
            win::local_app_data_folder,
            || win::known_folder(&windows_sys::Win32::UI::Shell::FOLDERID_Documents),
            || home().ok(),
        )
        .ok_or_else(|| "앱 데이터 폴더나 문서 폴더를 찾을 수 없다. LOCALAPPDATA·USERPROFILE을 지정하고 다시 실행해 달라.".into())
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let home = home()?;
        Ok((home.join(".config").join(IDENTIFIER), home.join(".local/share").join(IDENTIFIER)))
    }
}

/// 설정은 `%LOCALAPPDATA%\dev.aruu.aru`(로밍하지 않는다), 기본 저장 폴더는 문서 폴더(OneDrive로 옮겼으면 그곳) 아래 `Aru`.
/// 저장 폴더를 AppData에 두지 않는 까닭: MSIX는 AppData 쓰기를 패키지 폴더로 가상화해 앱을 지우면 함께 지운다(원칙 3).
/// 가상화를 끄는 unvirtualizedResources는 제한 기능이라 스토어가 거절할 수 있다. 문서 폴더는 가상화되지 않아
/// 앱·aru 명령·탐색기·다른 편집기가 같은 실제 경로를 본다
#[cfg(any(windows, test))]
fn windows_dirs(
    local_app_data: Option<OsString>,
    local_known: impl FnOnce() -> Option<PathBuf>,
    documents: impl FnOnce() -> Option<PathBuf>,
    home: impl FnOnce() -> Option<PathBuf>,
) -> Option<(PathBuf, PathBuf)> {
    let config = resolve_home(local_app_data, local_known)?.join(IDENTIFIER);
    let documents = documents()
        .filter(|p| p.is_absolute())
        .or_else(|| home().map(|h| h.join("Documents")))
        .filter(|p| p.is_absolute())?;
    Some((config, documents.join("Aru")))
}

/// `%LOCALAPPDATA%`. Claude 데스크톱·실행 별칭(WindowsApps)이 그 아래에 있다
#[cfg(windows)]
pub(crate) fn local_app_data() -> Option<PathBuf> {
    resolve_home(std::env::var_os("LOCALAPPDATA"), win::local_app_data_folder)
}

#[cfg(windows)]
mod win {
    use std::path::PathBuf;
    use windows_sys::core::GUID;

    pub fn local_app_data_folder() -> Option<PathBuf> {
        known_folder(&windows_sys::Win32::UI::Shell::FOLDERID_LocalAppData)
    }

    pub fn known_folder(id: &GUID) -> Option<PathBuf> {
        use std::os::windows::ffi::OsStringExt;
        use windows_sys::Win32::System::Com::CoTaskMemFree;
        use windows_sys::Win32::UI::Shell::{SHGetKnownFolderPath, KF_FLAG_DEFAULT};
        let mut raw: windows_sys::core::PWSTR = std::ptr::null_mut();
        unsafe {
            let hr = SHGetKnownFolderPath(id, KF_FLAG_DEFAULT as u32, std::ptr::null_mut(), &mut raw);
            let path = (hr >= 0 && !raw.is_null()).then(|| {
                let len = (0..).take_while(|&i| *raw.add(i) != 0).count();
                PathBuf::from(std::ffi::OsString::from_wide(std::slice::from_raw_parts(raw, len)))
            });
            // 실패해도 받은 포인터는 풀어야 한다(NULL이면 아무것도 하지 않는다)
            CoTaskMemFree(raw as _);
            path
        }
    }

    pub fn local_time() -> windows_sys::Win32::Foundation::SYSTEMTIME {
        let mut t = unsafe { std::mem::zeroed() };
        unsafe { windows_sys::Win32::System::SystemInformation::GetLocalTime(&mut t) };
        t
    }
}

pub const ROOT_UNAVAILABLE: &str = "저장 폴더를 열 수 없어요: ";

/// 앱과 같은 규칙으로 저장 폴더를 찾는다: 설정 폴더의 location.json이 가리키는 곳, 없으면 기본 폴더
pub fn data_root() -> Result<PathBuf, String> {
    let (config, data) = app_dirs()?;
    locate_root(&config, &data)
}

pub fn locate_root(config: &Path, default: &Path) -> Result<PathBuf, String> {
    locate(config, default).1
}

#[derive(Debug, PartialEq, serde::Serialize)]
pub struct RootStatus {
    pub ok: bool,
    pub path: String,
    pub error: Option<String>,
}

pub fn root_status(config: &Path, default: &Path) -> RootStatus {
    let (path, root) = locate(config, default);
    RootStatus { ok: root.is_ok(), path: path.to_string_lossy().to_string(), error: root.err() }
}

/// 설정 화면에 보일 저장 폴더. 화면이 기본 폴더는 이름으로, 고른 폴더는 홈을 ~로 줄여 보인다
#[derive(Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RootInfo {
    pub path: String,
    pub is_default: bool,
    pub home: String,
}

pub fn root_info(config: &Path, default: &Path, home: &Path) -> RootInfo {
    let path = locate(config, default).0;
    RootInfo { is_default: path == default, path: path.to_string_lossy().to_string(), home: home.to_string_lossy().to_string() }
}

/// 사용자 홈 폴더. 샌드박스 앱의 HOME은 컨테이너 안이라, 사용자가 고른 폴더를 ~로 줄이려면 계정 정보의 홈을 먼저 본다
pub fn user_home() -> Option<PathBuf> {
    passwd_home().filter(|p| p.is_absolute()).or_else(|| home().ok())
}

/// (보여 줄 경로: 설정한 폴더 또는 기본 폴더, 실제로 열 수 있는 저장 폴더).
/// 사용자가 고른 폴더를 못 열 때 기본 폴더로 넘어가면, 앱에서 안 보이는 곳에 조용히 쓰고
/// 그 폴더에서 꺼 둔 "AI·명령어로 추가"도 우회된다. 그래서 고른 폴더가 있으면 그 폴더만 쓴다
pub fn locate(config: &Path, default: &Path) -> (PathBuf, Result<PathBuf, String>) {
    let unavailable = |shown: PathBuf| {
        let e = format!("{ROOT_UNAVAILABLE}{}", shown.display());
        (shown, Err(e))
    };
    let file = config.join("location.json");
    let text = match storage::read_file(&file).map(|b| b.map(String::from_utf8)) {
        Ok(Some(Ok(t))) => t,
        Ok(None) => return (default.to_path_buf(), Ok(default.to_path_buf())),
        _ => return unavailable(file),
    };
    #[cfg(target_os = "macos")]
    let text_read = text.clone();
    // 메모장 등으로 고치면 BOM이 붙는다. 그것만으로 고른 폴더를 못 연다고 하지 않는다
    let text = text.strip_prefix('\u{feff}').unwrap_or(&text);
    let Ok(Value::Object(location)) = serde_json::from_str::<Value>(text) else { return unavailable(file) };
    // 키가 있는데 글자가 아니거나 비었으면 망가진 설정이다. 기본 폴더로 넘어가면 고른 폴더 대신 엉뚱한 곳에 조용히 쓴다
    let field = |key: &str| match location.get(key) {
        None => Ok(None),
        Some(Value::String(v)) if !v.is_empty() => Ok(Some(v.as_str())),
        Some(_) => Err(()),
    };
    let (Ok(root), Ok(mark)) = (field("root").map(|r| r.map(PathBuf::from)), field("bookmark")) else { return unavailable(file) };
    // bookmark는 샌드박스(맥)에서만 쓴다. 다른 OS에서는 모양만 확인하고 버린다
    #[cfg(not(target_os = "macos"))]
    let mark: Option<&str> = {
        let _ = mark;
        None
    };
    if root.is_none() && mark.is_none() {
        return (default.to_path_buf(), Ok(default.to_path_buf()));
    }
    let shown = root.clone().unwrap_or_else(|| file.clone());
    // 샌드박스에서는 경로만으로 못 열어서 bookmark를 먼저 푼다. bookmark가 있는데 못 풀면 경로로 대신 열지 않는다
    #[cfg(target_os = "macos")]
    let resolved = match mark {
        Some(mark) => crate::bookmark::resolve(mark).ok().map(|resolved| {
            // 낡은 bookmark는 지금은 풀려도 언젠가 못 풀린다. 풀린 김에 새로 만들어 두고, 못 고쳐 써도 이번에는 연다
            if let Some(fresh) = &resolved.refreshed {
                let _ = refresh_bookmark(&file, &text_read, &Value::Object(location.clone()), fresh);
            }
            PathBuf::from(resolved.path)
        }),
        None => root,
    };
    #[cfg(not(target_os = "macos"))]
    let resolved = root;
    // 상대 경로는 명령을 실행한 폴더에 따라 달라지므로 받지 않는다
    match resolved.filter(|p| p.is_absolute() && p.is_dir()) {
        Some(p) => (p.clone(), Ok(p)),
        None => unavailable(shown),
    }
}

/// 설정에서 "AI·명령어로 추가"를 껐으면 거절한다. 설정 파일을 읽을 수 없으면 껐는지 알 수 없으니 거절한다
fn external_add_allowed(root: &Path) -> Result<bool, String> {
    let bytes = storage::read_file(&root.join("settings.json"))
        .map_err(|e| format!("설정(settings.json)을 읽지 못해 추가하지 않았다: {}", storage::io_message(&e)))?;
    Ok(bytes
        .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
        .and_then(|v| v.get("allowExternalAdd").and_then(|a| a.as_bool()))
        .unwrap_or(true))
}

const BATCH_LOG: &str = "ai-batches.json";
const BATCH_LOG_KEEP: usize = 20;

/// 최근 추가 기록에 한 묶음을 덧붙이고 오래된 건 버린다
pub fn append_batch(log: &str, batch: Value) -> String {
    let mut list: Vec<Value> = serde_json::from_str(log).unwrap_or_default();
    list.push(batch);
    let start = list.len().saturating_sub(BATCH_LOG_KEEP);
    Value::Array(list.split_off(start)).to_string()
}

/// 기록의 시각이 지금보다 이만큼 넘게 앞서 있으면 시계가 틀렸거나 망가진 값으로 보고 무시한다
const MAX_AHEAD: u64 = 60;

/// 앱은 묶음을 `경로|도구@시각`으로 구분한다. 같은 도구가 같은 파일에 1초 안에 두 번 넣어도 겹치지 않게
/// 그 도구·파일의 마지막 시각 다음 값을 쓴다. 다만 지금보다 MAX_AHEAD초 넘게 앞서가지는 않는다 —
/// 앱은 미래 시각을 "방금 들어옴"으로 보고 켤 때마다 알림을 다시 띄운다. 그 이상 몰리면 묶음이 합쳐지는 쪽을 택한다
pub fn next_at(log: &str, by: &str, path: &str, now: u64) -> u64 {
    let limit = now.saturating_add(MAX_AHEAD);
    let list: Vec<Value> = serde_json::from_str(log).unwrap_or_default();
    list.iter()
        .filter(|b| b.get("by").and_then(Value::as_str) == Some(by))
        .filter(|b| b.get("path").and_then(Value::as_str).is_none_or(|p| p == path))
        .filter_map(|b| b.get("at").and_then(Value::as_u64))
        .filter(|at| *at <= limit)
        .max()
        .filter(|last| *last >= now)
        .map_or(now, |last| last.saturating_add(1).min(limit))
}

/// 기록 파일 원문. 깨져 있으면(배열이 아니거나 UTF-8이 아니면) 옆에 보관하고 빈 기록부터 다시 시작한다 —
/// 덮어쓰면 남아 있던 묶음의 알림·되돌리기 근거가 말없이 사라진다. 권한 등으로 아예 못 읽으면 덮어쓰지 않고 오류다
fn read_batch_log(config: &Path) -> Result<String, String> {
    let file = config.join(BATCH_LOG);
    let text = match storage::read_file(&file) {
        Ok(Some(bytes)) => String::from_utf8(bytes).ok(),
        Ok(None) => return Ok(String::new()),
        Err(e) => return Err(format!("최근 추가 기록({})을 읽을 수 없어 추가하지 않았다: {}", file.display(), storage::io_message(&e))),
    };
    if let Some(text) = text.filter(|t| t.trim().is_empty() || serde_json::from_str::<Vec<Value>>(t).is_ok()) {
        return Ok(text);
    }
    std::fs::rename(&file, storage::quarantine_path(&file))
        .map_err(|e| format!("깨진 최근 추가 기록({})을 옆에 보관하지 못해 추가하지 않았다: {}", file.display(), storage::io_message(&e)))?;
    Ok(String::new())
}

/// 앱이 읽는 최근 추가 기록
pub fn recent_batches() -> Vec<Value> {
    app_dirs()
        .ok()
        .and_then(|(config, _)| storage::read_file(&config.join(BATCH_LOG)).ok().flatten())
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

pub fn add(target: &Target, items: &[String], by: Option<&str>) -> Result<String, String> {
    let (config, data) = app_dirs()?;
    add_at(&config, &data, target, items, by, &today())
}

pub fn add_at(
    config: &Path,
    default: &Path,
    target: &Target,
    items: &[String],
    by: Option<&str>,
    today: &str,
) -> Result<String, String> {
    add_with(|| locate_root(config, default), config, target, items, by, today)
}

/// location.json의 bookmark만 바꿔 쓴다. 다른 키(root 등)는 그대로 둔다.
/// original은 처음 읽은 location.json 글자 그대로다. bookmark를 푸는 사이 앱이 폴더를 바꾸거나 기본 폴더로 되돌렸으면
/// 옛 내용으로 덮어 그 변경을 되돌리게 되므로, 설정 폴더 잠금 안에서 다시 읽어 같을 때만 쓴다.
/// 폴더를 바꾸는 중이라 잠금이 잡혀 있으면 기다리지 않고 건너뛴다 — 저장 폴더 잠금을 쥔 채 불릴 수 있어 기다리면 서로 막힌다
pub fn refresh_bookmark(file: &Path, original: &str, location: &Value, mark: &str) -> Result<(), String> {
    let mut next = location.clone();
    let Some(fields) = next.as_object_mut() else { return Err("폴더 설정 모양이 달라 고치지 않았어요".into()) };
    fields.insert("bookmark".into(), Value::String(mark.into()));
    let config = file.parent().ok_or("폴더 설정 위치가 없어요")?;
    let _lock = storage::lock_config(config, std::time::Duration::ZERO)?;
    if storage::read_file(file).ok().flatten().as_deref() != Some(original.as_bytes()) {
        return Err("그 사이 폴더 설정이 바뀌어 고치지 않았어요".into());
    }
    storage::write_atomic(file, &next.to_string())
}

fn empty_items_error() -> String {
    "추가할 할 일을 적어 달라. 예: aru add \"PR 리뷰\"".into()
}

/// root: 저장 폴더, config: 설정 폴더(최근 추가 기록)
pub fn add_in(
    root: &Path,
    config: &Path,
    target: &Target,
    items: &[String],
    by: Option<&str>,
    today: &str,
) -> Result<String, String> {
    add_with(|| Ok(root.to_path_buf()), config, target, items, by, today)
}

fn add_with(
    resolve: impl Fn() -> Result<PathBuf, String>,
    config: &Path,
    target: &Target,
    items: &[String],
    by: Option<&str>,
    today: &str,
) -> Result<String, String> {
    check_amount(items)?;
    let texts: Vec<String> = items.iter().filter(|t| !is_blank_item(t)).map(|t| normalize_item(t)).collect();
    if texts.is_empty() {
        return Err(empty_items_error());
    }
    let blanks = items.len() - texts.len();
    // 앱의 글자 수(JS length)와 같게 UTF-16 단위로 센다
    let lengths: Vec<usize> = texts.iter().map(|t| t.encode_utf16().count()).collect();
    if lengths.iter().any(|n| *n > MAX_ITEM_CHARS) {
        return Err(format!("할 일 하나는 {MAX_ITEM_CHARS}자까지 넣을 수 있다."));
    }
    let by = by.map(sanitize_tool);
    if by.as_ref().is_some_and(|b| b.chars().count() > MAX_TOOL_CHARS) {
        return Err(format!("도구 이름은 {MAX_TOOL_CHARS}자까지다."));
    }
    // 앱이 폴더를 바꾸는 동안은 옛 폴더 잠금을 쥐고 있다. 잡은 뒤의 저장 폴더에 쓴다
    let (root, _lock) = storage::lock_current(resolve, storage::CLI_LOCK_WAIT)?;
    let root = root.as_path();
    if !external_add_allowed(root)? {
        return Err("Aru 설정에서 'AI·명령어로 추가'가 꺼져 있어 추가하지 않았다.".into());
    }
    let rel = target.rel_path(today);
    // 읽기부터 기록 남기기까지 한 덩어리로 잠근다(위 lock_current). 다른 aru 명령·앱이 그 사이에 쓰면 한쪽이 사라진다
    let log = if by.is_some() { read_batch_log(config)? } else { String::new() };
    let at = by.as_deref().map_or(0, |b| next_at(&log, b, &rel, now_secs()));
    let current = storage::read_text(root, &rel)?.unwrap_or_default();
    let result = add_items(&current, &texts, by.as_deref().map(|b| (b, at)));
    // 읽기 상한을 넘는 파일을 쓰면 그날 할 일을 앱·명령 어디서도 못 읽게 된다
    if result.content.len() as u64 > storage::MAX_READ {
        return Err(format!("{}의 할 일 파일이 64MB를 넘게 되어 추가하지 않았다. 끝낸 일을 정리하거나 다른 날짜에 넣어 달라.", target.label(today)));
    }
    if !result.added.is_empty() {
        storage::write_text(root, &rel, &result.content)?;
        if let Some(by) = &by {
            let next = append_batch(&log, json!({"by": by, "at": at, "path": rel, "count": result.added.len()}));
            // 기록은 알림용이라 못 남겨도 할 일 추가는 성공으로 둔다
            let _ = storage::write_text(config, BATCH_LOG, &next);
        }
    }
    let mut msg = format!("{}에 {}개 추가했다.", target.label(today), result.added.len());
    if !result.skipped.is_empty() {
        msg.push_str(&skipped_summary(&result.skipped));
    }
    if !result.repeated.is_empty() {
        let mut names = Vec::new();
        for t in &result.repeated {
            if !names.contains(t) {
                names.push(t.clone());
            }
        }
        msg.push_str(&format!(" 같은 요청 안에서 겹쳐 {}개 건너뜀: {}.", result.repeated.len(), shown_names(&names)));
    }
    if blanks > 0 {
        msg.push_str(&format!(" 빈 항목 {blanks}개는 넣지 않았다."));
    }
    Ok(msg)
}

/// 수천 개를 건너뛰어도 응답이 길어지지 않게 개수와 앞의 몇 개만 적는다.
/// 이름마다 따옴표로 감싼다(JSON 문자열) — 이름에 ", "가 있으면 어디까지가 한 항목인지 알 수 없다
fn skipped_summary(skipped: &[String]) -> String {
    if skipped.len() > SKIPPED_SHOWN {
        format!(" 이미 있어서 {}개 건너뜀: {}.", skipped.len(), shown_names(skipped))
    } else {
        format!(" 이미 있어서 건너뜀: {}.", shown_names(skipped))
    }
}

fn shown_names(names: &[String]) -> String {
    let shown: Vec<String> = names
        .iter()
        .take(SKIPPED_SHOWN)
        .map(|t| if t.chars().count() > 40 { format!("{}…", t.chars().take(40).collect::<String>()) } else { t.clone() })
        .map(|t| Value::String(t).to_string())
        .collect();
    match names.len().checked_sub(SKIPPED_SHOWN).filter(|n| *n > 0) {
        Some(more) => format!("{} 외 {more}개", shown.join(", ")),
        None => shown.join(", "),
    }
}

/// 한 번에 넣는 양(개수·글자 수 합계)의 한도. 넘으면 하나도 쓰지 않는다.
/// 빈 항목을 거르기 전에 센다 — 거른 뒤에 세면 한도를 넘긴 요청이 빈 항목 수만큼 통과한다
fn check_amount(items: &[impl AsRef<str>]) -> Result<(), String> {
    if items.len() > MAX_ITEMS {
        return Err(format!("한 번에 {MAX_ITEMS}개까지 넣을 수 있다(받은 개수: {}). 나눠서 넣어 달라.", items.len()));
    }
    // 앱의 글자 수(JS length)와 같게 UTF-16 단위로 센다
    let total: usize = items.iter().map(AsRef::as_ref).filter(|t| !is_blank_item(t)).map(|t| normalize_item(t).encode_utf16().count()).sum();
    if total > MAX_CALL_CHARS {
        return Err(format!("한 번에 넣는 할 일은 모두 합쳐 {MAX_CALL_CHARS}자까지다(받은 글자 수: {total}). 나눠서 넣어 달라."));
    }
    Ok(())
}

pub fn list(target: &Target) -> Result<String, String> {
    list_in(&data_root()?, target, &today())
}

pub fn list_in(root: &Path, target: &Target, today: &str) -> Result<String, String> {
    let content = storage::read_text(root, &target.rel_path(today))?.unwrap_or_default();
    let items = list_items(&content);
    if items.is_empty() {
        return Ok(format!("{}: 할 일 없음", target.label(today)));
    }
    Ok(format!("{}:\n{}", target.label(today), items.join("\n")))
}

/// AI 도구 안에서 돌면 따로 적지 않아도 태그를 붙인다
fn detect_agent() -> Option<String> {
    detect_agent_from(&std::env::vars_os().map(|(k, _)| k.to_string_lossy().to_string()).collect::<Vec<_>>())
}

/// CLAUDECODE는 Claude Code가 자기가 실행하는 명령에만 넣는다.
/// CODEX_HOME 같은 CODEX_* 변수는 사용자가 셸 설정에 넣어 두는 경우가 많아 사람이 친 명령까지 AI로 표시했다.
/// 그래서 Codex가 자기가 실행하는 명령에만 넣는 샌드박스 변수 두 개만 본다. 샌드박스 없이 돌리는 Codex는 --by codex로 적어야 한다
fn detect_agent_from(keys: &[String]) -> Option<String> {
    if keys.iter().any(|k| k == "CLAUDECODE") {
        return Some("claude-code".into());
    }
    if keys.iter().any(|k| k == "CODEX_SANDBOX" || k == "CODEX_SANDBOX_NETWORK_DISABLED") {
        return Some("codex".into());
    }
    None
}

#[derive(Debug, PartialEq)]
pub struct Args {
    pub target: Target,
    pub items: Vec<String>,
    pub by: Option<String>,
    pub help: bool,
}

/// list: `aru list`의 인자면 할 일과 --by를 받지 않는다
fn parse_args(args: &[String], list: bool) -> Result<Args, String> {
    let mut target = None;
    let mut items = Vec::new();
    let mut by: Option<String> = None;
    let mut help = false;
    let mut literal = false;
    let mut i = 0;
    let mut set_target = |t: Target| match target.replace(t) {
        Some(_) => Err("--someday와 --date는 한 번만, 둘 중 하나만 쓴다".to_string()),
        None => Ok(()),
    };
    while i < args.len() {
        let arg = &args[i];
        i += 1;
        if literal {
            if list {
                return Err(format!("list는 할 일을 받지 않는다: {arg}"));
            }
            items.push(arg.clone());
            continue;
        }
        let (flag, inline) = match arg.split_once('=') {
            Some((f, v)) if f.starts_with("--") => (f, Some(v.to_string())),
            _ => (arg.as_str(), None),
        };
        // 다음 인자를 값으로 쓴다. 그 자리에 다른 옵션이 오면 값이 빠진 것으로 본다
        let mut value = |missing: &str| match inline.clone() {
            Some(v) => Ok(v),
            None => {
                let v = args.get(i).filter(|v| !v.starts_with('-') || v.as_str() == "-").ok_or(missing.to_string())?;
                i += 1;
                Ok::<String, String>(v.clone())
            }
        };
        match (flag, inline.is_some()) {
            ("--", false) => literal = true,
            ("--help" | "-h", false) => help = true,
            ("--someday", false) => set_target(Target::Someday)?,
            ("--date", _) => {
                let d = value("--date 뒤에 YYYY-MM-DD 날짜가 필요하다")?;
                if !valid_date(&d) {
                    return Err(date_error(&d));
                }
                set_target(Target::Date(d))?;
            }
            ("--by", _) if !list => {
                let name = value("--by 뒤에 도구 이름이 필요하다")?;
                if name.trim().is_empty() {
                    return Err("--by 도구 이름이 비어 있다".into());
                }
                if by.replace(name).is_some() {
                    return Err("--by는 한 번만 쓴다".into());
                }
            }
            _ if flag.starts_with('-') && flag != "-" => {
                return Err(format!("모르는 옵션: {arg} (할 일로 넣으려면 -- 뒤에 적는다)"));
            }
            _ if list => return Err(format!("list는 할 일을 받지 않는다: {arg}")),
            _ => items.push(arg.clone()),
        }
    }
    Ok(Args { target: target.unwrap_or(Target::Today), items, by, help })
}

#[derive(Debug, PartialEq)]
pub enum Entry {
    Gui,
    Command(Vec<String>),
    Version,
    Unknown(String),
    BadArgs,
}

/// macOS나 Xcode가 앱을 띄울 때 붙이는 인자(-psn_…, -NSDocumentRevisionsDebugMode 등)
fn is_launch_arg(arg: &str) -> bool {
    arg.starts_with("-psn_") || arg.starts_with("-NS") || arg.starts_with("-Apple")
}

pub fn parse_entry(args: &[OsString]) -> Entry {
    let Some(first) = args.first() else { return Entry::Gui };
    let Some(first) = first.to_str() else { return Entry::Unknown(first.to_string_lossy().to_string()) };
    if is_launch_arg(first) {
        return Entry::Gui;
    }
    if matches!(first, "--version" | "-V") {
        return Entry::Version;
    }
    // 오타 난 명령으로 앱 창이 뜨면 터미널에서는 무슨 일인지 알 수 없다
    if !COMMANDS.contains(&first) {
        return Entry::Unknown(first.to_string());
    }
    match args.iter().map(|a| a.to_str().map(String::from)).collect::<Option<Vec<_>>>() {
        Some(args) => Entry::Command(args),
        None => Entry::BadArgs,
    }
}

/// 실행 인자를 보고 명령이면 처리해 종료 코드를, 앱을 띄울 차례면 None을 돌려준다
pub fn entry(args: &[OsString]) -> Option<i32> {
    match parse_entry(args) {
        Entry::Gui => None,
        Entry::Command(args) => Some(run(&args)),
        Entry::Version => {
            println!("aru {}", env!("CARGO_PKG_VERSION"));
            Some(0)
        }
        Entry::Unknown(command) => {
            eprintln!("알 수 없는 명령: {command}\n\n{HELP}");
            Some(2)
        }
        Entry::BadArgs => {
            eprintln!("명령 인자에 UTF-8이 아닌 글자가 있다. 터미널 인코딩을 UTF-8로 맞추고 다시 실행해 달라.");
            Some(1)
        }
    }
}

/// 콘솔 전용 실행 파일(aru-cli)의 입구. 창을 띄울 수 없으니 명령이 없으면 사용법 오류로 끝낸다
pub fn cli_entry(args: &[OsString]) -> i32 {
    entry(args).unwrap_or_else(|| {
        eprintln!("명령을 붙여 실행해 달라.\n\n{HELP}");
        2
    })
}

/// `aru <명령>`으로 실행됐으면 처리하고 종료 코드를 돌려준다
pub fn run(args: &[String]) -> i32 {
    let command = args.first().map(String::as_str).unwrap_or("help");
    let rest = &args[1.min(args.len())..];
    let result = match command {
        "add" => parse_args(rest, false).and_then(|a| {
            if a.help {
                return Ok(HELP.to_string());
            }
            add(&a.target, &a.items, a.by.or_else(detect_agent).as_deref())
        }),
        "list" => parse_args(rest, true).and_then(|a| if a.help { Ok(HELP.to_string()) } else { list(&a.target) }),
        "mcp" => {
            mcp_serve();
            return 0;
        }
        _ => Ok(HELP.to_string()),
    };
    match result {
        Ok(out) => {
            println!("{out}");
            0
        }
        Err(e) => {
            eprintln!("{e}");
            1
        }
    }
}

// ---------- MCP (stdio, JSON-RPC 2.0) ----------

const ADD_DESCRIPTION: &str = "Aru 할 일 앱에 할 일을 추가한다. 사용자가 할 일(투두)에 추가해 달라고 직접 요청한 경우에만 호출한다. \
작업 중에 스스로 판단해서 추가하지 않는다. 할 일은 목록 맨 위에 준 순서대로 들어가고, 같은 날 안 끝낸 똑같은 할 일은 건너뛴다. \
추가한 할 일에는 앱에서 'AI' 태그가 붙는다.";

const LIST_DESCRIPTION: &str = "Aru 할 일 앱의 할 일 목록을 본다. [ ]는 남은 일, [x]는 끝낸 일, (AI)는 AI가 넣고 사용자가 아직 확인하지 않은 일이다.";

fn tools() -> Value {
    let target_props = json!({
        "list": {"type": "string", "enum": ["today", "someday", "date"], "description": "today(기본), someday(언젠가), date(특정 날짜). 빼고 date만 주면 date"},
        "date": {"type": "string", "description": "list가 date일 때 YYYY-MM-DD"}
    });
    let mut add_props = target_props.clone();
    add_props["items"] = json!({"type": "array", "items": {"type": "string"}, "minItems": 1, "maxItems": MAX_ITEMS, "description": "추가할 할 일들. 한 항목에 한 줄"});
    json!([
        {"name": "add_todos", "description": ADD_DESCRIPTION,
         "inputSchema": {"type": "object", "properties": add_props, "required": ["items"]}},
        {"name": "list_todos", "description": LIST_DESCRIPTION,
         "inputSchema": {"type": "object", "properties": target_props},
         "annotations": {"readOnlyHint": true}}
    ])
}

fn target_from(args: &Value) -> Result<Target, String> {
    let has_date = args.get("date").is_some_and(|d| !d.is_null());
    let list = match args.get("list") {
        None | Some(Value::Null) => if has_date { "date" } else { "today" },
        Some(Value::String(s)) => s.as_str(),
        Some(other) => return Err(format!("list는 today, someday, date 중 하나여야 한다: {other}")),
    };
    // today·someday와 함께 온 date라도 틀렸으면 알린다. 말없이 무시하면 다른 날에 넣은 줄 모른다
    if has_date && list != "date" {
        match args.get("date").and_then(Value::as_str) {
            Some(d) if valid_date(d) => {}
            Some(d) => return Err(date_error(d)),
            None => return Err("date는 YYYY-MM-DD 문자열이어야 한다".into()),
        }
    }
    match list {
        "today" => Ok(Target::Today),
        "someday" => Ok(Target::Someday),
        "date" => {
            let d = args.get("date").and_then(Value::as_str).ok_or("list가 date면 date(YYYY-MM-DD)가 필요하다")?;
            if !valid_date(d) {
                return Err(date_error(d));
            }
            Ok(Target::Date(d.to_string()))
        }
        other => Err(format!("list는 today, someday, date 중 하나여야 한다: {other}")),
    }
}

fn call_tool(name: &str, args: &Value, client: &str) -> Result<String, String> {
    match name {
        "add_todos" => {
            let target = target_from(args)?;
            let items: Vec<String> = args
                .get("items")
                .and_then(Value::as_array)
                .ok_or("items는 문자열 배열이어야 한다")?
                .iter()
                .map(|v| v.as_str().map(String::from))
                .collect::<Option<_>>()
                .ok_or("items에는 문자열만 넣는다")?;
            if items.iter().all(|t| is_blank_item(t)) {
                return Err("items가 비어 있다".into());
            }
            add(&target, &items, Some(client))
        }
        "list_todos" => list(&target_from(args)?),
        other => Err(format!("모르는 도구: {other}")),
    }
}

fn rpc_error(code: i64, message: &str) -> Value {
    json!({"jsonrpc": "2.0", "id": null, "error": {"code": code, "message": message}})
}

pub fn handle_message(msg: &Value, client: &mut String) -> Option<Value> {
    if !msg.is_object() {
        return Some(rpc_error(-32600, "요청 형식이 틀렸다"));
    }
    let id = msg.get("id").cloned();
    // JSON-RPC id는 문자열·정수(·null)만. 객체·실수를 그대로 돌려주면 클라이언트가 응답을 짝짓지 못한다
    if id.as_ref().is_some_and(|id| !(id.is_string() || id.is_i64() || id.is_u64() || id.is_null())) {
        return Some(rpc_error(-32600, "id는 문자열이나 정수여야 한다"));
    }
    let method = msg.get("method").and_then(Value::as_str).unwrap_or("");
    let result = match method {
        "initialize" => {
            if let Some(name) = msg.pointer("/params/clientInfo/name").and_then(Value::as_str) {
                // 사용자가 고칠 수 없는 값이라 길면 거절하지 않고 자른다(직접 적은 --by만 거절한다)
                *client = sanitize_tool(name).chars().take(MAX_TOOL_CHARS).collect();
            }
            let version = msg
                .pointer("/params/protocolVersion")
                .and_then(Value::as_str)
                .unwrap_or("2025-06-18")
                .to_string();
            Ok(json!({
                "protocolVersion": version,
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "aru", "version": env!("CARGO_PKG_VERSION")},
                "instructions": "사용자가 할 일에 추가해 달라고 직접 말할 때만 add_todos를 쓴다."
            }))
        }
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({"tools": tools()})),
        "tools/call" => {
            let name = msg.pointer("/params/name").and_then(Value::as_str).unwrap_or("");
            let args = msg.pointer("/params/arguments").cloned().unwrap_or(json!({}));
            let (text, is_error) = match call_tool(name, &args, client) {
                Ok(t) => (t, false),
                Err(e) => (e, true),
            };
            Ok(json!({"content": [{"type": "text", "text": text}], "isError": is_error}))
        }
        _ if id.is_none() => return None,
        _ => Err(json!({"code": -32601, "message": format!("지원하지 않는 메서드: {method}")})),
    };
    let id = id?;
    Some(match result {
        Ok(r) => json!({"jsonrpc": "2.0", "id": id, "result": r}),
        Err(e) => json!({"jsonrpc": "2.0", "id": id, "error": e}),
    })
}

/// 한 줄에 온 요청(하나 또는 JSON-RPC 배열)에 대한 응답. 알림뿐이면 None
pub fn handle_payload(payload: &Value, client: &mut String) -> Option<Value> {
    match payload {
        Value::Array(batch) if batch.is_empty() => Some(rpc_error(-32600, "빈 배열 요청이다")),
        // 원소마다 답을 만들어 모으므로, 줄 길이 상한 안에서도 수백만 개면 메모리를 GB 단위로 쓴다
        Value::Array(batch) if batch.len() > MAX_BATCH => Some(rpc_error(-32600, &format!("배열 요청은 {MAX_BATCH}개까지다. 나눠서 보내 달라."))),
        Value::Array(batch) => {
            // 여러 add_todos로 나눠 담아 한 번의 한도를 넘기지 못하게 합쳐 본다
            let calls: Vec<&Vec<Value>> = batch
                .iter()
                .filter(|m| m.get("method").and_then(Value::as_str) == Some("tools/call") && m.pointer("/params/name").and_then(Value::as_str) == Some("add_todos"))
                .filter_map(|m| m.pointer("/params/arguments/items")?.as_array())
                .collect();
            if calls.len() > 1 {
                let items: Vec<&str> = calls.into_iter().flatten().filter_map(Value::as_str).collect();
                if let Err(e) = check_amount(&items) {
                    return Some(rpc_error(-32600, &format!("배열 요청 전체로 본다: {e}")));
                }
            }
            let replies: Vec<Value> = batch.iter().filter_map(|m| handle_message(m, client)).collect();
            (!replies.is_empty()).then_some(Value::Array(replies))
        }
        msg => handle_message(msg, client),
    }
}

fn mcp_serve() {
    serve(std::io::stdin().lock(), std::io::stdout());
}

/// serde_json은 짝 없는 서로게이트 이스케이프(`"\ud800"`)를 JSON 오류로 거절해 id까지 잃는다. 그런 이스케이프만
/// U+FFFD로 바꿔 다시 읽어 id만 건진다(요청 자체는 처리하지 않는다 — 글자를 바꿔 넣으면 사용자가 보낸 것과 달라진다)
fn lone_surrogate_id(line: &str) -> Option<Value> {
    let mut fixed = String::with_capacity(line.len());
    let mut rest = line;
    let mut changed = false;
    while let Some(at) = rest.find('\\') {
        fixed.push_str(&rest[..at]);
        let esc = &rest[at..];
        let surrogate = esc.get(2..6).filter(|_| esc[1..].starts_with('u')).and_then(|h| u16::from_str_radix(h, 16).ok()).is_some_and(|c| (0xd800..0xe000).contains(&c));
        let take = if surrogate { 6 } else { esc.chars().nth(1).map_or(1, |c| 1 + c.len_utf8()) };
        if surrogate {
            fixed.push_str("\\ufffd");
            changed = true;
        } else {
            fixed.push_str(&esc[..take]);
        }
        rest = &esc[take..];
    }
    fixed.push_str(rest);
    let id = serde_json::from_str::<Value>(&fixed).ok().filter(|_| changed)?.get("id")?.clone();
    // 정상 경로(handle_message)와 같이 문자열·정수만 돌려준다
    (id.is_string() || id.is_i64() || id.is_u64()).then_some(id)
}

/// 요청 한 줄의 상한. 한도 안의 가장 큰 요청(할 일 1000개·합계 20만 자를 모두 \uXXXX로 적은 것)도 2MB가 안 된다.
/// 상한이 없으면 끝없는 줄 하나가 메모리를 다 쓴다
const MAX_LINE: usize = 8 * 1024 * 1024;

/// 배열(batch) 요청 하나에 담을 수 있는 요청 수
const MAX_BATCH: usize = 100;

/// 상한을 넘은 줄에서 id를 찾으려고 남겨 두는 앞부분
const ID_PREFIX: usize = 64 * 1024;

/// 줄 하나를 담는다. 줄 끝(LF·CRLF)을 뺀 내용이 MAX_LINE을 넘으면 앞부분(ID_PREFIX)만 남기고 줄 끝까지 읽어 버린다.
/// 다 읽었으면 None, 넘었으면 Some(false)
fn read_line_capped(input: &mut impl BufRead, buf: &mut Vec<u8>) -> std::io::Result<Option<bool>> {
    let mut fits = true;
    let mut read_any = false;
    loop {
        let chunk = match input.fill_buf() {
            Ok(c) => c,
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(e),
        };
        let done = chunk.is_empty();
        if done {
            if !read_any {
                return Ok(None);
            }
        } else {
            read_any = true;
        }
        let (used, ended) = match chunk.iter().position(|b| *b == b'\n') {
            Some(i) => (i + 1, true),
            None => (chunk.len(), done),
        };
        if fits && buf.len() + used > MAX_LINE + 2 {
            fits = false;
            buf.truncate(ID_PREFIX);
        }
        let take = if fits { used } else { ID_PREFIX.saturating_sub(buf.len()).min(used) };
        buf.extend_from_slice(&chunk[..take]);
        input.consume(used);
        if ended {
            let ending = if buf.ends_with(b"\r\n") { 2 } else { usize::from(buf.ends_with(b"\n")) };
            return Ok(Some(fits && buf.len() - ending <= MAX_LINE));
        }
    }
}

/// 너무 길어 버린 줄의 앞부분에서 맨 바깥 객체의 "id"(문자열·정수)를 찾는다. 답에 id가 없으면 클라이언트는 그 요청의 답을 짝짓지 못해 시간 초과까지 기다린다
fn prefix_id(prefix: &[u8]) -> Value {
    let skip_ws = |b: &[u8]| b.iter().position(|c| !c.is_ascii_whitespace()).unwrap_or(b.len());
    let mut depth = 0usize;
    let mut i = 0;
    while i < prefix.len() {
        match prefix[i] {
            b'"' => {
                let mut end = i + 1;
                while end < prefix.len() && prefix[end] != b'"' {
                    end += if prefix[end] == b'\\' { 2 } else { 1 };
                }
                if end >= prefix.len() {
                    break;
                }
                let after = &prefix[end + 1..];
                let colon = skip_ws(after);
                if depth == 1 && &prefix[i..=end] == b"\"id\"" && after.get(colon) == Some(&b':') {
                    let value = &after[colon + 1..];
                    let value = &value[skip_ws(value)..];
                    let mut stream = serde_json::Deserializer::from_slice(value).into_iter::<Value>();
                    let id = match stream.next() {
                        Some(Ok(id)) if id.is_string() || id.is_i64() || id.is_u64() => id,
                        _ => return Value::Null,
                    };
                    // 숫자는 앞부분 끝에서 잘려도 그대로 읽힌다(123456789 → 12345). 뒤에 , 나 } 가 보여야 끝난 값이다
                    let rest = &value[stream.byte_offset()..];
                    let terminated = matches!(rest.get(skip_ws(rest)), Some(b',' | b'}'));
                    return if id.is_string() || terminated { id } else { Value::Null };
                }
                i = end;
            }
            b'{' | b'[' => depth += 1,
            b'}' | b']' => depth = depth.saturating_sub(1),
            _ => {}
        }
        i += 1;
    }
    Value::Null
}

/// 줄 하나가 UTF-8이 아니어도 그 줄에만 오류로 답하고 다음 줄을 계속 받는다
pub fn serve(mut input: impl BufRead, mut output: impl Write) {
    let mut client = "ai".to_string();
    let mut buf = Vec::new();
    loop {
        buf.clear();
        let fits = match read_line_capped(&mut input, &mut buf) {
            Ok(None) | Err(_) => break,
            Ok(Some(fits)) => fits,
        };
        let reply = match std::str::from_utf8(&buf) {
            _ if !fits => {
                let mut e = rpc_error(-32600, &format!("요청 한 줄이 너무 길다({}MB까지). 나눠서 보내 달라.", MAX_LINE / 1024 / 1024));
                e["id"] = prefix_id(&buf);
                Some(e)
            }
            Err(_) => Some(rpc_error(-32700, "UTF-8이 아니다")),
            Ok(line) if line.trim().is_empty() => continue,
            Ok(line) => match serde_json::from_str::<Value>(line) {
                Ok(msg) => handle_payload(&msg, &mut client),
                Err(_) => Some(match lone_surrogate_id(line) {
                    Some(id) => json!({"jsonrpc": "2.0", "id": id, "error": {"code": -32700, "message": "짝이 없는 서로게이트(\\ud800 같은)가 있어 읽을 수 없다"}}),
                    None => rpc_error(-32700, "JSON이 아니다"),
                }),
            },
        };
        if let Some(reply) = reply {
            let _ = writeln!(output, "{reply}");
            let _ = output.flush();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn 맨_위에_준_순서대로_넣고_메모와_기존_할_일은_그대로_둔다() {
        let r = add_items("- [ ] 하나\n- [x] 끝낸 일\n\n메모\n", &s(&["가", "나"]), None);
        assert_eq!(r.content, "- [ ] 가\n- [ ] 나\n- [ ] 하나\n- [x] 끝낸 일\n\n메모\n");
        assert_eq!(r.added, s(&["가", "나"]));
    }

    #[test]
    fn ai가_넣으면_도구와_시각을_주석으로_남긴다() {
        let r = add_items("", &s(&["PR 리뷰"]), Some(("claude-code", 100)));
        assert_eq!(r.content, "- [ ] PR 리뷰 <!-- ai:claude-code@100 -->\n");
    }

    #[test]
    fn 안_끝낸_똑같은_할_일은_건너뛰고_끝낸_일과_같은_글은_넣는다() {
        let r = add_items("- [ ] 하나 <!-- from:2026-10-14 -->\n- [x] 둘\n", &s(&["하나", "둘", "하나"]), None);
        assert_eq!(r.added, s(&["둘"]));
        assert_eq!(r.skipped, s(&["하나"]));
        assert_eq!(r.repeated, s(&["하나"]));
        assert_eq!(r.content, "- [ ] 둘\n- [ ] 하나 <!-- from:2026-10-14 -->\n- [x] 둘\n");
    }

    #[test]
    fn 할_일이_없고_메모만_있으면_할_일을_위에_두고_빈_줄로_나눈다() {
        let r = add_items("메모\n", &s(&["가"]), None);
        assert_eq!(r.content, "- [ ] 가\n\n메모\n");
    }

    #[test]
    fn 줄바꿈은_공백으로_바꾸고_빈_항목은_버린다() {
        let r = add_items("", &s(&["가\n나", "  ", ""]), None);
        assert_eq!(r.content, "- [ ] 가 나\n");
    }

    #[test]
    fn 글자가_표시_주석처럼_끝나면_빈_주석을_붙여_글자를_지킨다() {
        let r = add_items("", &s(&["예시 <!-- ai:x@1 -->"]), None);
        assert_eq!(r.content, "- [ ] 예시 <!-- ai:x@1 --> <!-- from: -->\n");
    }

    #[test]
    fn 목록은_체크_상태와_ai_표시를_보여준다() {
        let items = list_items("- [ ] 가 <!-- ai:codex@1 -->\n- [x] 나 <!-- from:2026-10-14 -->\n메모\n");
        assert_eq!(items, s(&["[ ] 가 (AI)", "[x] 나"]));
    }

    #[test]
    fn 추가_기록은_최근_20개만_남긴다() {
        let mut log = String::new();
        for i in 0..25 {
            log = append_batch(&log, json!({"at": i}));
        }
        let list: Vec<Value> = serde_json::from_str(&log).unwrap();
        assert_eq!(list.len(), 20);
        assert_eq!(list[0]["at"], 5);
        assert_eq!(list[19]["at"], 24);
    }

    #[test]
    fn 도구_이름은_주석에_안전한_글자만_남긴다() {
        assert_eq!(sanitize_tool("Claude Code"), "claude-code");
        assert_eq!(sanitize_tool("claude-ai"), "claude-ai");
        assert_eq!(sanitize_tool("!!"), "ai");
    }

    #[test]
    fn 날짜와_대상을_읽는다() {
        let a = parse_args(&s(&["가", "--date", "2026-10-20", "--by", "codex"]), false).unwrap();
        assert_eq!(a.target, Target::Date("2026-10-20".into()));
        assert_eq!(a.items, s(&["가"]));
        assert_eq!(a.by.as_deref(), Some("codex"));
        assert!(parse_args(&s(&["--date", "10/20"]), false).is_err());
    }

    #[test]
    fn mcp_초기화는_클라이언트_이름을_기억하고_알림에는_답하지_않는다() {
        let mut client = "ai".to_string();
        let init = json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","clientInfo":{"name":"claude-code"}}});
        let reply = handle_message(&init, &mut client).unwrap();
        assert_eq!(reply["result"]["serverInfo"]["name"], "aru");
        assert_eq!(client, "claude-code");
        assert!(handle_message(&json!({"jsonrpc":"2.0","method":"notifications/initialized"}), &mut client).is_none());
        let tools = handle_message(&json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}), &mut client).unwrap();
        let names: Vec<&str> = tools["result"]["tools"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap()).collect();
        assert_eq!(names, vec!["add_todos", "list_todos"]);
    }

    fn dirs(name: &str) -> (PathBuf, PathBuf) {
        let base = std::env::temp_dir().join(format!("aru-cli-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let (root, config) = (base.join("data"), base.join("config"));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&config).unwrap();
        (root, config)
    }

    fn read(root: &Path, rel: &str) -> String {
        std::fs::read_to_string(root.join(rel)).unwrap_or_default()
    }

    fn batches(config: &Path) -> Vec<Value> {
        serde_json::from_str(&read(config, BATCH_LOG)).unwrap()
    }

    #[test]
    fn b1_동시에_넣어도_하나도_잃지_않고_파일이_온전하다() {
        let (root, config) = dirs("b1");
        let handles: Vec<_> = (0..20)
            .map(|i| {
                let (root, config) = (root.clone(), config.clone());
                std::thread::spawn(move || {
                    add_in(&root, &config, &Target::Date("2026-11-01".into()), &[format!("항목{i}")], None, "2026-10-17")
                })
            })
            .collect();
        for h in handles {
            h.join().unwrap().unwrap();
        }
        let content = read(&root, "daily/2026-11-01.md");
        let lines: Vec<&str> = content.lines().collect();
        assert_eq!(lines.len(), 20, "{content}");
        for i in 0..20 {
            assert_eq!(lines.iter().filter(|l| **l == format!("- [ ] 항목{i}")).count(), 1, "{content}");
        }
    }

    #[test]
    fn b2_b3_동시에_같은_도구가_넣어도_기록이_모두_남고_묶음_시각이_겹치지_않는다() {
        let (root, config) = dirs("b2");
        let handles: Vec<_> = (0..15)
            .map(|i| {
                let (root, config) = (root.clone(), config.clone());
                std::thread::spawn(move || {
                    add_in(&root, &config, &Target::Date(format!("2026-11-{:02}", 10 + i)), &[format!("z{i}")], Some("t"), "2026-10-17")
                })
            })
            .collect();
        for h in handles {
            h.join().unwrap().unwrap();
        }
        let log = batches(&config);
        assert_eq!(log.len(), 15);
        let keys: std::collections::HashSet<(String, u64)> =
            log.iter().map(|b| (b["path"].as_str().unwrap().to_string(), b["at"].as_u64().unwrap())).collect();
        assert_eq!(keys.len(), 15, "{log:?}");
        for b in &log {
            let content = read(&root, b["path"].as_str().unwrap());
            assert!(content.contains(&format!("<!-- ai:t@{} -->", b["at"])), "{content} / {b}");
        }
    }

    #[test]
    fn b3_같은_초에_두_번_넣어도_묶음_시각이_다르고_주석과_같다() {
        let (root, config) = dirs("b3");
        // 앱은 묶음을 경로까지 넣어 구분하므로, 같은 파일에 넣은 묶음끼리만 겹치지 않으면 된다
        add_in(&root, &config, &Target::Someday, &s(&["가"]), Some("claude-code"), "2026-10-17").unwrap();
        add_in(&root, &config, &Target::Someday, &s(&["나", "다"]), Some("claude-code"), "2026-10-17").unwrap();
        let log = batches(&config);
        assert_eq!(log.len(), 2);
        assert_ne!(log[0]["at"], log[1]["at"]);
        assert!(read(&root, "someday.md").contains(&format!("ai:claude-code@{} -->", log[1]["at"])));
    }

    #[test]
    fn b3_묶음_시각은_같은_도구의_마지막_시각보다_크다() {
        let log = r#"[{"by":"t","at":100},{"by":"t","at":105},{"by":"u","at":300}]"#;
        assert_eq!(next_at(log, "t", "someday.md", 100), 106);
        assert_eq!(next_at(log, "t", "someday.md", 105), 106);
        assert_eq!(next_at(log, "t", "someday.md", 200), 200);
        assert_eq!(next_at(log, "v", "someday.md", 100), 100);
        assert_eq!(next_at("", "t", "someday.md", 100), 100);
    }

    #[test]
    fn f1_명령도_os_오류를_한국어로_알린다() {
        use std::os::unix::fs::PermissionsExt;
        let (root, config) = dirs("f1-ro");
        std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o555)).unwrap();
        let add = add_in(&root, &config, &Target::Today, &s(&["가"]), None, "2026-10-17").unwrap_err();
        std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(add, "저장 폴더에 쓸 수 없어요: 권한이 없어요");
        // 최근 추가 기록을 읽을 권한이 없을 때
        std::fs::write(config.join(BATCH_LOG), "[]").unwrap();
        std::fs::set_permissions(config.join(BATCH_LOG), std::fs::Permissions::from_mode(0o000)).unwrap();
        let log = add_in(&root, &config, &Target::Today, &s(&["가"]), Some("t"), "2026-10-17").unwrap_err();
        std::fs::set_permissions(config.join(BATCH_LOG), std::fs::Permissions::from_mode(0o644)).unwrap();
        assert!(log.ends_with("을 읽을 수 없어 추가하지 않았다: 권한이 없어요"), "{log}");
        // UTF-8이 아닌 할 일 파일
        std::fs::write(root.join("someday.md"), [0xff, 0xfe]).unwrap();
        let list = list_in(&root, &Target::Someday, "2026-10-17").unwrap_err();
        assert_eq!(list, storage::UNDECODABLE);
    }

    #[test]
    fn b2_기록_파일이_깨져_있으면_옆에_보관하고_새로_시작한다() {
        let (root, config) = dirs("b2-bad");
        let broken = r#"[{"by":"a","at":1,"path":"someday.md","count":1},"#;
        std::fs::write(config.join(BATCH_LOG), broken).unwrap();
        add_in(&root, &config, &Target::Today, &s(&["가"]), Some("t"), "2026-10-17").unwrap();
        let kept: Vec<_> = std::fs::read_dir(&config).unwrap().map(|e| e.unwrap().path()).filter(|p| p.to_string_lossy().ends_with(".bad")).collect();
        assert_eq!(kept.len(), 1, "{kept:?}");
        assert_eq!(std::fs::read_to_string(&kept[0]).unwrap(), broken);
        assert_eq!(batches(&config).len(), 1);
    }

    #[test]
    fn b4_b5_글자_정리는_앱과_같다() {
        assert_eq!(normalize_item("앞\u{2028}뒤"), "앞 뒤");
        assert_eq!(normalize_item("앞\u{2029}뒤"), "앞 뒤");
        assert_eq!(normalize_item("가\r\n나\r다\n라"), "가 나 다 라");
        assert_eq!(normalize_item("a\u{a0}b"), "a b");
        assert_eq!(normalize_item("\u{feff}"), "");
        assert_eq!(normalize_item("가\u{feff}나"), "가나");
        assert_eq!(normalize_item("\u{3000}가\u{2003}"), "가");
        // JS trim은 U+0085를 공백으로 보지 않는다
        assert_eq!(normalize_item("\u{85}가"), "\u{85}가");
    }

    #[test]
    fn b5_정리하면_빈_항목만_있으면_거절한다() {
        let (root, config) = dirs("b5");
        assert!(add_in(&root, &config, &Target::Today, &s(&["\u{feff}", "\u{2028}"]), None, "2026-10-17").is_err());
        assert!(!root.join("daily/2026-10-17.md").exists());
    }

    #[test]
    fn b7_list가_없고_date가_있으면_그_날짜다() {
        assert_eq!(target_from(&json!({"date": "2026-10-20"})).unwrap(), Target::Date("2026-10-20".into()));
        assert_eq!(target_from(&json!({})).unwrap(), Target::Today);
        assert_eq!(target_from(&json!({"list": "someday"})).unwrap(), Target::Someday);
    }

    #[test]
    fn b7_모르는_list_값은_오류다() {
        for v in [json!("tomorrow"), json!("Someday"), json!(3)] {
            let e = target_from(&json!({ "list": v })).unwrap_err();
            assert!(e.contains("list"), "{e}");
        }
    }

    #[test]
    fn b8_달력에_없는_날짜는_거절한다() {
        for d in ["2026-02-30", "2026-13-01", "0000-00-00", "2026-00-10", "2026-04-31", "1969-12-31", "2026-02-29"] {
            assert!(!valid_date(d), "{d}");
        }
        for d in ["2028-02-29", "2000-02-29", "1970-01-01", "9999-12-31", "2026-10-17"] {
            assert!(valid_date(d), "{d}");
        }
        assert!(parse_args(&s(&["가", "--date", "2026-02-30"]), false).is_err());
        assert!(target_from(&json!({"list": "date", "date": "2026-02-31"})).is_err());
    }

    #[test]
    fn b11_설정한_폴더를_못_열면_기본_폴더로_가지_않는다() {
        let (root, config) = dirs("b11");
        let missing = root.join("없는폴더");
        std::fs::write(config.join("location.json"), json!({"root": missing}).to_string()).unwrap();
        let e = locate_root(&config, &root).unwrap_err();
        assert_eq!(e, format!("저장 폴더를 열 수 없어요: {}", missing.display()));
        let st = root_status(&config, &root);
        assert_eq!(st, RootStatus { ok: false, path: missing.to_string_lossy().to_string(), error: Some(e) });

        let file = root.join("파일.txt");
        std::fs::write(&file, "x").unwrap();
        std::fs::write(config.join("location.json"), json!({"root": file}).to_string()).unwrap();
        assert!(locate_root(&config, &root).is_err());

        // 상대 경로는 실행한 폴더 기준으로 풀지 않는다
        std::fs::write(config.join("location.json"), json!({"root": "."}).to_string()).unwrap();
        assert!(locate_root(&config, &root).is_err());

        std::fs::write(config.join("location.json"), "{깨짐").unwrap();
        assert!(locate_root(&config, &root).is_err());
    }

    #[test]
    fn f3_설정에_보일_폴더_정보는_기본_폴더인지와_진짜_홈을_알려준다() {
        let (root, config) = dirs("f3-info");
        let home = Path::new("/Users/me");
        let info = serde_json::to_value(root_info(&config, &root, home)).unwrap();
        assert_eq!(info, json!({"path": root, "isDefault": true, "home": "/Users/me"}));
        let custom = root.join("고른폴더");
        std::fs::create_dir_all(&custom).unwrap();
        std::fs::write(config.join("location.json"), json!({"root": custom}).to_string()).unwrap();
        let info = serde_json::to_value(root_info(&config, &root, home)).unwrap();
        assert_eq!(info, json!({"path": custom, "isDefault": false, "home": "/Users/me"}));
    }

    #[test]
    fn b11_설정이_없거나_비어_있으면_기본_폴더다() {
        let (root, config) = dirs("b11-default");
        assert_eq!(locate_root(&config, &root).unwrap(), root);
        std::fs::write(config.join("location.json"), "{}").unwrap();
        assert_eq!(locate_root(&config, &root).unwrap(), root);
        let custom = root.join("custom");
        std::fs::create_dir_all(&custom).unwrap();
        std::fs::write(config.join("location.json"), json!({"root": custom}).to_string()).unwrap();
        assert_eq!(locate_root(&config, &root).unwrap(), custom);
        assert_eq!(root_status(&config, &root), RootStatus { ok: true, path: custom.to_string_lossy().to_string(), error: None });
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn b11_bookmark를_못_풀면_root가_있어도_열_수_없다() {
        let (root, config) = dirs("b11-bookmark");
        std::fs::write(config.join("location.json"), json!({"root": root, "bookmark": "AAAA"}).to_string()).unwrap();
        assert!(locate_root(&config, &root.join("기본")).unwrap_err().starts_with("저장 폴더를 열 수 없어요: "));
    }

    #[test]
    fn b6_utf8이_아닌_줄에도_서버가_계속_답한다() {
        let mut input = b"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}\n".to_vec();
        input.extend_from_slice(b"{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"ping\",\"x\":\"\xe9\"}\n");
        input.extend_from_slice(b"{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"ping\"}\n");
        let mut out = Vec::new();
        serve(std::io::Cursor::new(input), &mut out);
        let replies: Vec<Value> = String::from_utf8(out).unwrap().lines().map(|l| serde_json::from_str(l).unwrap()).collect();
        assert_eq!(replies.len(), 3, "{replies:?}");
        assert_eq!(replies[0]["id"], 1);
        assert_eq!(replies[1]["error"]["code"], -32700);
        assert_eq!(replies[2]["id"], 3);
    }

    #[test]
    fn b12_배열_요청에는_배열로_답하고_알림은_빼고_빈_배열은_오류다() {
        let mut client = "ai".to_string();
        let batch = json!([
            {"jsonrpc":"2.0","id":3,"method":"ping"},
            {"jsonrpc":"2.0","method":"notifications/initialized"},
            {"jsonrpc":"2.0","id":4,"method":"tools/list"}
        ]);
        let reply = handle_payload(&batch, &mut client).unwrap();
        let ids: Vec<i64> = reply.as_array().unwrap().iter().map(|r| r["id"].as_i64().unwrap()).collect();
        assert_eq!(ids, vec![3, 4]);
        assert!(handle_payload(&json!([{"jsonrpc":"2.0","method":"notifications/initialized"}]), &mut client).is_none());
        assert_eq!(handle_payload(&json!([]), &mut client).unwrap()["error"]["code"], -32600);
        let mixed = handle_payload(&json!([1]), &mut client).unwrap();
        assert_eq!(mixed[0]["error"]["code"], -32600);
    }

    #[test]
    fn b13_codex_home만으로는_ai로_보지_않는다() {
        assert_eq!(detect_agent_from(&s(&["CODEX_HOME", "PATH"])), None);
        assert_eq!(detect_agent_from(&s(&["CODEX_SANDBOX"])).as_deref(), Some("codex"));
        assert_eq!(detect_agent_from(&s(&["CODEX_SANDBOX_NETWORK_DISABLED"])).as_deref(), Some("codex"));
        assert_eq!(detect_agent_from(&s(&["CLAUDECODE"])).as_deref(), Some("claude-code"));
    }

    #[test]
    fn b14_흔한_플래그_표기를_읽는다() {
        assert!(parse_args(&s(&["--help"]), false).unwrap().help);
        assert!(parse_args(&s(&["가", "-h"]), false).unwrap().help);
        let a = parse_args(&s(&["가", "--date=2026-10-20", "--by=codex"]), false).unwrap();
        assert_eq!((a.target, a.items, a.by.as_deref()), (Target::Date("2026-10-20".into()), s(&["가"]), Some("codex")));
        let a = parse_args(&s(&["--someday", "--", "--date", "-h", "--"]), false).unwrap();
        assert_eq!((a.target, a.items, a.help), (Target::Someday, s(&["--date", "-h", "--"]), false));
        let a = parse_args(&s(&["--"]), false).unwrap();
        assert!(a.items.is_empty());
    }

    #[test]
    fn b14_애매한_플래그는_오류다() {
        for args in [
            vec!["가", "--by", "--someday"],
            vec!["가", "--date", "2026-10-20", "--someday"],
            vec!["가", "--someday", "--someday"],
            vec!["가", "--date", "2026-10-20", "--date=2026-10-21"],
            vec!["가", "--by", ""],
            vec!["가", "--by="],
            vec!["가", "--by", "a", "--by", "b"],
            vec!["가", "--bogus"],
        ] {
            assert!(parse_args(&s(&args), false).is_err(), "{args:?}");
        }
        assert!(parse_args(&s(&["남는것"]), true).is_err());
        assert!(parse_args(&s(&["--someday"]), true).is_ok());
    }

    #[test]
    fn b15_모르는_명령은_앱을_띄우지_않는다() {
        use std::ffi::OsString;
        let os = |v: &[&str]| v.iter().map(OsString::from).collect::<Vec<_>>();
        assert_eq!(parse_entry(&[]), Entry::Gui);
        assert_eq!(parse_entry(&os(&["-psn_0_12345"])), Entry::Gui);
        assert_eq!(parse_entry(&os(&["ad", "x"])), Entry::Unknown("ad".into()));
        assert_eq!(parse_entry(&os(&["--version"])), Entry::Version);
        assert_eq!(parse_entry(&os(&["-V"])), Entry::Version);
        assert_eq!(parse_entry(&os(&["add", "x"])), Entry::Command(s(&["add", "x"])));
    }

    #[test]
    fn w1_콘솔용_aru_cli는_명령이_없으면_창_대신_사용법_오류로_끝낸다() {
        use std::ffi::OsString;
        let os = |v: &[&str]| v.iter().map(OsString::from).collect::<Vec<_>>();
        assert_eq!(cli_entry(&[]), 2);
        assert_eq!(cli_entry(&os(&["-psn_0_12345"])), 2);
        assert_eq!(cli_entry(&os(&["ad"])), 2);
        assert_eq!(cli_entry(&os(&["--version"])), 0);
    }

    #[test]
    fn w2_windows_설정은_localappdata_기본_저장_폴더는_문서_아래_aru다() {
        let local = || Some(PathBuf::from("/Users/나/AppData/Local"));
        let docs = || Some(PathBuf::from("/Users/나/OneDrive/문서"));
        let home = || Some(PathBuf::from("/Users/나"));
        let (config, data) = windows_dirs(Some("/C/환경/Local".into()), local, docs, home).unwrap();
        assert_eq!(config, PathBuf::from("/C/환경/Local").join(IDENTIFIER));
        assert_eq!(data, PathBuf::from("/Users/나/OneDrive/문서/Aru"));
        // LOCALAPPDATA가 비었거나 상대 경로면 계정의 알려진 폴더(FOLDERID_LocalAppData)를 쓴다
        for env in [None, Some("".into()), Some("상대".into())] {
            assert_eq!(windows_dirs(env, local, docs, home).unwrap().0, PathBuf::from("/Users/나/AppData/Local").join(IDENTIFIER));
        }
        // 문서 폴더를 못 구하면 홈 아래 Documents
        assert_eq!(windows_dirs(None, local, || None, home).unwrap().1, PathBuf::from("/Users/나/Documents/Aru"));
        assert_eq!(windows_dirs(None, local, || Some("상대".into()), home).unwrap().1, PathBuf::from("/Users/나/Documents/Aru"));
        assert_eq!(windows_dirs(None, || None, docs, home), None);
        assert_eq!(windows_dirs(None, local, || None, || None), None);
    }

    #[test]
    fn w3_windows_오늘은_로컬_시각의_연월일이다() {
        assert_eq!(systemtime_date(2026, 1, 5), "2026-01-05");
        assert_eq!(systemtime_date(2026, 12, 31), "2026-12-31");
    }

    #[test]
    fn b10_utf8이_아닌_인자는_패닉하지_않고_거절한다() {
        use std::os::unix::ffi::OsStringExt;
        let bad = std::ffi::OsString::from_vec(vec![0xff, 0xfe, b' ', b'x']);
        assert_eq!(parse_entry(&[std::ffi::OsString::from("add"), bad.clone()]), Entry::BadArgs);
        assert!(matches!(parse_entry(&[bad]), Entry::Unknown(_)));
    }

    #[test]
    fn b17_한도를_넘으면_아무것도_쓰지_않는다() {
        let (root, config) = dirs("b17");
        let many: Vec<String> = (0..1001).map(|i| format!("x{i}")).collect();
        assert!(add_in(&root, &config, &Target::Today, &many, None, "2026-10-17").is_err());
        let long = "가".repeat(10_001);
        assert!(add_in(&root, &config, &Target::Today, &[long, "짧음".into()], None, "2026-10-17").is_err());
        assert!(add_in(&root, &config, &Target::Today, &s(&["가"]), Some(&"a".repeat(65)), "2026-10-17").is_err());
        assert!(!root.join("daily/2026-10-17.md").exists());
        let ok: Vec<String> = (0..1000).map(|i| format!("x{i}")).collect();
        assert!(add_in(&root, &config, &Target::Today, &ok, Some(&"a".repeat(64)), "2026-10-17").is_ok());
    }

    #[test]
    fn b17_건너뛴_항목은_다섯_개까지만_적는다() {
        let (root, config) = dirs("b17-skip");
        let items: Vec<String> = (0..300).map(|i| format!("x{i}")).collect();
        add_in(&root, &config, &Target::Today, &items, None, "2026-10-17").unwrap();
        let msg = add_in(&root, &config, &Target::Today, &items, None, "2026-10-17").unwrap();
        assert!(msg.contains("300"), "{msg}");
        assert!(msg.len() < 300, "{msg}");
    }

    #[test]
    fn s5_s6_앞_공백과_bom이_있어도_같은_할_일로_본다() {
        let r = add_items("- [ ]  하나\n", &s(&["하나"]), None);
        assert_eq!(r.skipped, s(&["하나"]));
        let r = add_items("\u{feff}- [ ] 하나\n", &s(&["하나", "둘"]), None);
        assert_eq!(r.skipped, s(&["하나"]));
        assert_eq!(r.content, "\u{feff}- [ ] 둘\n- [ ] 하나\n");
    }

    #[test]
    fn s7_crlf_파일은_crlf로_남긴다() {
        let r = add_items("- [ ] 하나\r\n메모\r\n", &s(&["가"]), None);
        assert_eq!(r.content, "- [ ] 가\r\n- [ ] 하나\r\n메모\r\n");
    }

    #[test]
    fn s4_표시_주석은_앱과_같은_모양만_인정한다() {
        assert_eq!(list_items("- [ ] 가 <!--ai:x@1-->\n"), s(&["[ ] 가 <!--ai:x@1-->"]));
        assert_eq!(list_items("- [ ] 가 <!-- ai:x@abc -->\n"), s(&["[ ] 가 <!-- ai:x@abc -->"]));
        assert_eq!(list_items("- [ ] 가 <!-- from:2026-10-14 ai:x@1 -->\n"), s(&["[ ] 가 (AI)"]));
    }
    // ---------- 2차: 앱 파서(src/core/markdown.ts)와 같은 판정 ----------

    #[test]
    fn r2_코드_블록_안의_할_일_모양_줄은_할_일이_아니다() {
        let file = "# 메모\n```\n- [ ] 예시 코드\n```\n- [ ] 진짜\n";
        let r = add_items(file, &s(&["새것", "예시 코드"]), None);
        assert_eq!(r.content, "# 메모\n```\n- [ ] 예시 코드\n```\n- [ ] 새것\n- [ ] 예시 코드\n- [ ] 진짜\n");
        assert_eq!(list_items(file), s(&["[ ] 진짜"]));
        // ~~~, 4개 백틱(3개로는 안 닫힘), 들여쓴 하위 블록
        let file = "~~~md\n- [ ] 가\n~~~\n````\n- [ ] 나\n```\n- [ ] 다\n````\n- [ ] 진짜\n  ```\n- [ ] 라\n  ```\n";
        assert_eq!(list_items(file), s(&["[ ] 진짜"]));
        let r = add_items(file, &s(&["가", "나", "다", "라"]), None);
        assert_eq!(r.added, s(&["가", "나", "다", "라"]));
        assert!(r.content.starts_with("~~~md\n- [ ] 가\n~~~\n````\n- [ ] 나\n```\n- [ ] 다\n````\n- [ ] 가\n"), "{}", r.content);
        // 블록 안에만 있으면 할 일이 없는 파일이다
        let r = add_items("```\n- [ ] 진짜\n```\n", &s(&["진짜"]), None);
        assert_eq!(r.added, s(&["진짜"]));
        assert_eq!(r.content, "- [ ] 진짜\n\n```\n- [ ] 진짜\n```\n");
    }

    #[test]
    fn r2_닫히지_않은_코드_블록은_코드_블록으로_보지_않는다() {
        let file = "메모\n```\n- [ ] 가\n- [ ] 나\n";
        assert_eq!(list_items(file), s(&["[ ] 가", "[ ] 나"]));
        let r = add_items(file, &s(&["가", "새"]), None);
        assert_eq!(r.skipped, s(&["가"]));
        assert_eq!(r.content, "메모\n```\n- [ ] 새\n- [ ] 가\n- [ ] 나\n");
        // 앞 블록은 닫히고 뒤 블록만 안 닫힌 경우
        let file = "```\n- [ ] 예시\n```\n- [ ] 가\n  ~~~\n- [ ] 나\n";
        assert_eq!(list_items(file), s(&["[ ] 가", "[ ] 나"]));
    }

    #[test]
    fn r2_줄바꿈_계열_글자가_든_줄도_할_일이다() {
        let r = add_items("- [ ] a\rb\n- [ ] c\n", &s(&["a b"]), None);
        assert_eq!(r.skipped, s(&["a b"]));
        assert_eq!(list_items("- [ ] a\rb\n- [ ] c\n"), s(&["[ ] a b", "[ ] c"]));
        let r = add_items("# head\n- [ ] a\u{2028}b\n", &s(&["새"]), None);
        assert_eq!(r.content, "# head\n- [ ] 새\n- [ ] a\u{2028}b\n");
        let r = add_items("- [ ] a\u{2029}b <!--\u{2028}ai:x@1 -->\n", &s(&["a b"]), None);
        assert_eq!(r.skipped, s(&["a b"]));
        // 줄바꿈 없이 CR로 끝나는 파일
        let r = add_items("- [ ] a\r", &s(&["a"]), None);
        assert_eq!(r.skipped, s(&["a"]));
    }

    #[test]
    fn r2_맨_앞_bom을_남긴다() {
        let r = add_items("\u{feff}# 제목\n- [ ] a\n", &s(&["b"]), None);
        assert_eq!(r.content, "\u{feff}# 제목\n- [ ] b\n- [ ] a\n");
        let r = add_items("\u{feff}메모\n", &s(&["b"]), None);
        assert_eq!(r.content, "\u{feff}- [ ] b\n\n메모\n");
    }

    #[test]
    fn r2_줄바꿈이_섞인_파일은_있던_줄의_끝을_바꾸지_않는다() {
        let r = add_items("# 제목\r\n- [ ] a\n메모\n", &s(&["b"]), None);
        assert_eq!(r.content, "# 제목\r\n- [ ] b\n- [ ] a\n메모\n");
        let r = add_items("# 제목\r\n- [ ] a\r\n메모\n", &s(&["b"]), None);
        assert_eq!(r.content, "# 제목\r\n- [ ] b\r\n- [ ] a\r\n메모\n");
    }

    #[test]
    fn r2_할_일이_없는_파일의_앞뒤_빈_줄은_쌓이지_않는다() {
        let r = add_items("\n\n메모\n\n", &s(&["가"]), None);
        assert_eq!(r.content, "- [ ] 가\n\n메모\n");
        let r = add_items(&r.content.replace("- [ ] 가\n", ""), &s(&["나"]), None);
        assert_eq!(r.content, "- [ ] 나\n\n메모\n");
        let r = add_items("\n\n", &s(&["가"]), None);
        assert_eq!(r.content, "- [ ] 가\n");
    }

    // ---------- 2차: CLI QA ----------

    #[test]
    fn r2_n3_미래_시각_기록은_무시하고_넘치지_않는다() {
        let now = 1_792_224_916u64;
        let future = format!(r#"[{{"by":"t","at":{},"path":"p"}}]"#, now + 400 * 86_400);
        assert_eq!(next_at(&future, "t", "p", now), now);
        let max = format!(r#"[{{"by":"t","at":{},"path":"p"}}]"#, u64::MAX);
        assert_eq!(next_at(&max, "t", "p", now), now);
        // 같은 초의 연속 추가는 겹치지 않게 올리되 60초 넘게 앞서가지 않는다
        let mut log = String::new();
        let mut ats = Vec::new();
        for _ in 0..200 {
            let at = next_at(&log, "t", "p", now);
            ats.push(at);
            log = append_batch(&log, json!({"by": "t", "at": at, "path": "p"}));
        }
        assert!(ats.iter().all(|a| *a <= now + 60), "{ats:?}");
        assert_eq!(&ats[..3], &[now, now + 1, now + 2]);
        // 다른 파일에 넣은 묶음과는 겹쳐도 된다(앱은 경로까지 묶음 키로 쓴다)
        let other = format!(r#"[{{"by":"t","at":{now},"path":"q"}}]"#);
        assert_eq!(next_at(&other, "t", "p", now), now);
        assert_eq!(next_at("", "t", "p", u64::MAX), u64::MAX);
    }

    #[test]
    fn r2_n5_mcp_클라이언트_이름이_길면_잘라_쓴다() {
        let (root, config) = dirs("n5");
        let mut client = "ai".to_string();
        let init = json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"c".repeat(100)}}});
        handle_message(&init, &mut client).unwrap();
        assert_eq!(client.chars().count(), MAX_TOOL_CHARS);
        assert!(add_in(&root, &config, &Target::Today, &s(&["가"]), Some(&client), "2026-10-17").is_ok());
        // 사용자가 직접 적은 --by가 길면 여전히 거절한다
        assert!(add_in(&root, &config, &Target::Today, &s(&["나"]), Some(&"a".repeat(65)), "2026-10-17").is_err());
    }

    #[test]
    fn r2_n7_list는_대시대시_뒤_인자도_받지_않는다() {
        assert!(parse_args(&s(&["--", "x"]), true).is_err());
        assert!(parse_args(&s(&["--"]), true).is_ok());
    }

    #[test]
    fn r2_n8_home이_없으면_계정의_홈_폴더를_쓰고_그것도_없으면_오류다() {
        let pw = || Some(PathBuf::from("/Users/누구"));
        assert_eq!(resolve_home(Some("/Users/나".into()), pw), Some(PathBuf::from("/Users/나")));
        assert_eq!(resolve_home(None, pw), Some(PathBuf::from("/Users/누구")));
        assert_eq!(resolve_home(Some("".into()), pw), Some(PathBuf::from("/Users/누구")));
        assert_eq!(resolve_home(Some("상대".into()), pw), Some(PathBuf::from("/Users/누구")));
        assert_eq!(resolve_home(None, || None), None);
        assert_eq!(resolve_home(Some("".into()), || Some(PathBuf::from("rel"))), None);
    }

    #[test]
    fn r9_q3_샌드박스_컨테이너_홈만_골라_쓰고_아니면_home을_따른다() {
        let data = PathBuf::from("/Users/나/Library/Containers/dev.aruu.aru/Data");
        assert_eq!(container_home(data.clone()), Some(data));
        assert_eq!(container_home(PathBuf::from("/Users/나")), None);
        assert_eq!(container_home(PathBuf::from("/Users/나/Library/Containers/dev.aruu.aru")), None);
        assert_eq!(container_home(PathBuf::from("Library/Containers/dev.aruu.aru/Data")), None);
        // 이 테스트 프로세스는 샌드박스가 아니다. 여기서 계정 홈을 고르면 HOME을 임시 폴더로 바꾼 테스트가 실제 할 일 폴더에 쓴다
        assert_eq!(sandbox_home(), None);
    }

    #[test]
    fn r2_n10_읽을_수_없는_기록_파일은_덮어쓰지_않는다() {
        use std::os::unix::fs::PermissionsExt;
        let (root, config) = dirs("n10");
        let log = config.join(BATCH_LOG);
        std::fs::write(&log, r#"[{"by":"a","at":1,"path":"someday.md","count":1}]"#).unwrap();
        std::fs::set_permissions(&log, std::fs::Permissions::from_mode(0o000)).unwrap();
        let r = add_in(&root, &config, &Target::Today, &s(&["가"]), Some("t"), "2026-10-17");
        std::fs::set_permissions(&log, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert!(r.is_err(), "{r:?}");
        assert_eq!(read(&config, BATCH_LOG), r#"[{"by":"a","at":1,"path":"someday.md","count":1}]"#);
        assert!(!root.join("daily/2026-10-17.md").exists());
    }

    #[test]
    fn r2_n10_두_번_깨져도_앞의_보관본이_남는다() {
        let (root, config) = dirs("n10-twice");
        std::fs::write(config.join(BATCH_LOG), "첫째").unwrap();
        add_in(&root, &config, &Target::Today, &s(&["가"]), Some("t"), "2026-10-17").unwrap();
        std::fs::write(config.join(BATCH_LOG), "둘째").unwrap();
        add_in(&root, &config, &Target::Today, &s(&["나"]), Some("t"), "2026-10-17").unwrap();
        let mut kept: Vec<String> = std::fs::read_dir(&config)
            .unwrap()
            .map(|e| e.unwrap().path())
            .filter(|p| p.to_string_lossy().ends_with(".bad"))
            .map(|p| std::fs::read_to_string(p).unwrap())
            .collect();
        kept.sort();
        assert_eq!(kept, s(&["둘째", "첫째"]));
    }

    #[test]
    fn r2_mcp_today나_someday에_잘못된_date가_오면_오류다() {
        assert!(target_from(&json!({"list": "today", "date": "2026-02-30"})).is_err());
        assert!(target_from(&json!({"list": "someday", "date": 3})).is_err());
        assert_eq!(target_from(&json!({"list": "today", "date": null})).unwrap(), Target::Today);
    }

    #[test]
    fn r2_한_글자_대시_인자는_대시대시_뒤에_적으라고_알린다() {
        let e = parse_args(&s(&["-x"]), false).unwrap_err();
        assert!(e.contains("--"), "{e}");
        assert_eq!(parse_args(&s(&["--", "-x"]), false).unwrap().items, s(&["-x"]));
        assert_eq!(parse_args(&s(&["-"]), false).unwrap().items, s(&["-"]));
    }

    #[test]
    fn r2_개수와_글자_수는_앱_기준으로_센다() {
        let (root, config) = dirs("caps");
        // 개수는 빈 항목까지 받은 그대로 센다
        let mut items: Vec<String> = vec![String::new(); 999];
        items.push("진짜".into());
        assert!(add_in(&root, &config, &Target::Today, &items, None, "2026-10-17").is_ok());
        items.push(String::new());
        assert!(add_in(&root, &config, &Target::Today, &items, None, "2026-10-17").is_err());
        // JS 길이(UTF-16)로 10,000을 넘으면 거절한다. 이모지는 2로 센다
        let emoji = "😀".repeat(5_001);
        assert!(add_in(&root, &config, &Target::Today, &[emoji], None, "2026-10-17").is_err());
        let emoji = "😀".repeat(5_000);
        assert!(add_in(&root, &config, &Target::Today, &[emoji], None, "2026-10-17").is_ok());
    }

    #[test]
    fn r2_jsonrpc_id가_객체나_실수면_요청_오류다() {
        let mut client = "ai".to_string();
        for id in [json!({"a": 1}), json!(1.5), json!([1]), json!(true)] {
            let r = handle_message(&json!({"jsonrpc":"2.0","id":id,"method":"ping"}), &mut client).unwrap();
            assert_eq!(r["error"]["code"], -32600, "{id}");
        }
        for id in [json!(1), json!("a"), json!(-3)] {
            let r = handle_message(&json!({"jsonrpc":"2.0","id":id.clone(),"method":"ping"}), &mut client).unwrap();
            assert_eq!(r["id"], id);
        }
    }

    #[test]
    fn r4_location_json_모양이_틀리면_열_수_없다고_알린다() {
        let (root, config) = dirs("r4-loc");
        for bad in ["[]", "5", "\"x\"", "null", r#"{"root":5}"#, r#"{"root":null}"#, r#"{"root":""}"#, r#"{"bookmark":5}"#, r#"{"root":[]}"#] {
            std::fs::write(config.join("location.json"), bad).unwrap();
            let e = locate_root(&config, &root).unwrap_err();
            assert!(e.starts_with(ROOT_UNAVAILABLE), "{bad}: {e}");
            assert!(!root_status(&config, &root).ok, "{bad}");
        }
        // 빈 객체는 지금처럼 기본 폴더
        std::fs::write(config.join("location.json"), "{}").unwrap();
        assert_eq!(locate_root(&config, &root).unwrap(), root);
    }

    #[test]
    fn r4_bom이_붙은_location_json도_읽는다() {
        let (root, config) = dirs("r4-loc-bom");
        let custom = root.join("고른폴더");
        std::fs::create_dir_all(&custom).unwrap();
        std::fs::write(config.join("location.json"), format!("\u{feff}{}", json!({"root": custom}))).unwrap();
        assert_eq!(locate_root(&config, &root).unwrap(), custom);
    }

    #[test]
    fn r4_낡은_bookmark는_새로_만든_것으로_location_json을_고쳐_쓴다() {
        let (root, config) = dirs("r4-refresh");
        let file = config.join("location.json");
        let location = json!({"root": root, "bookmark": "옛것", "extra": 1});
        std::fs::write(&file, location.to_string()).unwrap();
        refresh_bookmark(&file, &location.to_string(), &location, "새것").unwrap();
        let after: Value = serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
        assert_eq!(after, json!({"root": root, "bookmark": "새것", "extra": 1}));
    }

    #[test]
    fn r4_명령은_잠금을_잡은_뒤_저장_폴더를_다시_확인한다() {
        let (old, config) = dirs("r4-cli-relock");
        let new = old.parent().unwrap().join("new");
        std::fs::create_dir_all(&new).unwrap();
        let default = old.parent().unwrap().join("default");
        std::fs::write(config.join("location.json"), json!({"root": old}).to_string()).unwrap();
        let switching = storage::lock_root(&old, storage::CLI_LOCK_WAIT).unwrap();
        let adder = {
            let (config, default) = (config.clone(), default.clone());
            std::thread::spawn(move || add_at(&config, &default, &Target::Someday, &["가".into()], None, "2026-10-17"))
        };
        std::thread::sleep(std::time::Duration::from_millis(200));
        std::fs::write(config.join("location.json"), json!({"root": new}).to_string()).unwrap();
        drop(switching);
        adder.join().unwrap().unwrap();
        assert_eq!(read(&new, "someday.md"), "- [ ] 가\n");
        assert_eq!(read(&old, "someday.md"), "");
    }

    #[test]
    fn r5_보이지_않는_글자만_있는_할_일은_빈_항목처럼_거절한다() {
        let blank = [
            "\u{200b}", "\u{200c}", "\u{200d}", "\u{2060}", "\u{feff}\u{200b}", "\u{ad}", " \u{200b} ", "\u{200b}\u{3000}\u{200c}",
            "\u{2061}", "\u{180e}", "\u{3164}", "\u{115f}", "\u{1160}", "\u{34f}", "\u{61c}", "\u{17b4}", "\u{200e}\u{200f}",
            "\u{202a}\u{202e}", "\u{2066}\u{206f}", "\u{2800}", "\u{fe0f}", "\u{ffa0}", "\u{1d159}", "\u{1d17a}", "\u{e0001}\u{e007f}",
            "\u{e0100}\u{e01ef}", "\u{85}\u{200b}", "\u{1680}\u{2064}",
        ];
        for item in blank {
            assert!(is_blank_item(item), "{item:?}는 빈 항목이다");
            let (root, config) = dirs("r5-blank");
            let e = add_in(&root, &config, &Target::Today, &s(&[item]), None, "2026-10-17").unwrap_err();
            assert_eq!(e, empty_items_error(), "{item:?}");
            assert!(!root.join("daily/2026-10-17.md").exists(), "{item:?}를 넣었다");
            let mut client = "ai".to_string();
            let call = json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"add_todos","arguments":{"items":[item, "\u{ad}\u{2060}"]}}});
            let reply = handle_message(&call, &mut client).unwrap();
            assert_eq!(reply["result"]["isError"], json!(true), "{item:?}: {reply}");
        }
        // 글자 사이의 ZWJ·이형 선택자는 뜻이 있으므로 그대로 넣는다
        for (item, kept) in [("a\u{200b}", "a\u{200b}"), ("\u{1f468}\u{200d}\u{1f469}", "\u{1f468}\u{200d}\u{1f469}"), ("\u{2764}\u{fe0f}", "\u{2764}\u{fe0f}"), (" 가\u{200b} ", "가\u{200b}")] {
            assert!(!is_blank_item(item), "{item:?}");
            let (root, config) = dirs("r5-kept");
            add_in(&root, &config, &Target::Today, &s(&[item]), None, "2026-10-17").unwrap();
            assert_eq!(read(&root, "daily/2026-10-17.md"), format!("- [ ] {kept}\n"));
        }
        // 목록 바로 바깥의 이웃 글자는 보이는 글자다(src/core/text.test.ts와 같은 경계)
        for c in ['\u{180a}', '\u{2065}', '\u{fe10}', '\u{1d158}', '\u{1d17b}', '\u{e0080}', '\u{e01f0}', '\u{3165}'] {
            assert!(!is_blank_item(&c.to_string()), "{c:?}");
        }
        let white: String = ['\u{9}', '\u{b}', '\u{c}', '\u{20}', '\u{85}', '\u{a0}', '\u{1680}', '\u{2000}', '\u{200a}', '\u{202f}', '\u{205f}', '\u{3000}'].iter().collect();
        assert!(is_blank_item(&white));
        // 섞여 있으면 빈 것만 빼고 넣는다
        let r = add_items("", &s(&["\u{200b}", "진짜"]), None);
        assert_eq!(r.added, vec!["진짜".to_string()]);
        assert_eq!(r.content, "- [ ] 진짜\n");
    }

    #[test]
    fn r5_낡은_bookmark_갱신은_그_사이_바뀐_location_json을_되돌리지_않는다() {
        let (root, config) = dirs("r5-refresh-cas");
        let file = config.join("location.json");
        let original = json!({"root": root, "bookmark": "옛것"}).to_string();
        let location: Value = serde_json::from_str(&original).unwrap();
        // 앱이 그 사이 다른 폴더로 바꿨다
        let switched = json!({"root": "/다른/폴더", "bookmark": "바꾼것"}).to_string();
        std::fs::write(&file, &switched).unwrap();
        let _ = refresh_bookmark(&file, &original, &location, "새것");
        assert_eq!(std::fs::read_to_string(&file).unwrap(), switched);
        // 기본 폴더로 되돌렸다(파일을 지웠다)
        std::fs::remove_file(&file).unwrap();
        let _ = refresh_bookmark(&file, &original, &location, "새것");
        assert!(!file.exists(), "지운 location.json을 되살렸다");
        // 폴더를 바꾸는 중이면(설정 폴더 잠금) 기다리지 않고 건너뛴다
        std::fs::write(&file, &original).unwrap();
        let held = storage::lock_config(&config, storage::CLI_LOCK_WAIT).unwrap();
        let started = std::time::Instant::now();
        let _ = refresh_bookmark(&file, &original, &location, "새것");
        assert!(started.elapsed() < std::time::Duration::from_millis(500));
        assert_eq!(std::fs::read_to_string(&file).unwrap(), original, "잠금을 무시하고 썼다");
        drop(held);
        refresh_bookmark(&file, &original, &location, "새것").unwrap();
        let after: Value = serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
        assert_eq!(after["bookmark"], "새것");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn r5_낡은_bookmark를_푸는_사이_폴더를_바꿔도_되돌아가지_않는다() {
        let (default, config) = dirs("r5-stale-race");
        let base = default.parent().unwrap().to_path_buf();
        let newroot = base.join("NEWROOT");
        std::fs::create_dir_all(&newroot).unwrap();
        let loc = config.join("location.json");
        let mut reverted = 0;
        for i in 0..20 {
            let a = base.join(format!("a{i}"));
            std::fs::create_dir_all(&a).unwrap();
            let mark = crate::bookmark::create(&a.to_string_lossy()).unwrap();
            std::fs::rename(&a, base.join(format!("moved{i}"))).unwrap();
            std::fs::write(&loc, json!({"root": a, "bookmark": mark}).to_string()).unwrap();
            let switched = json!({"root": newroot, "bookmark": crate::bookmark::create(&newroot.to_string_lossy()).unwrap()}).to_string();
            let (loc2, config2) = (loc.clone(), config.clone());
            // 앱의 set_data_root처럼 설정 폴더 잠금 안에서 location.json을 쓴다
            let t = std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_micros(300));
                let _held = storage::lock_config(&config2, storage::CLI_LOCK_WAIT).unwrap();
                storage::write_atomic(&loc2, &switched).unwrap();
            });
            let _ = locate(&config, &default);
            t.join().unwrap();
            if std::fs::read_to_string(&loc).unwrap().contains(&format!("a{i}\"")) {
                reverted += 1;
            }
        }
        assert_eq!(reverted, 0, "폴더 변경이 되돌려졌다");
    }

    #[test]
    fn r6_개수_한도는_빈_항목까지_세고_뺀_빈_항목_수를_알린다() {
        let (root, config) = dirs("r6-max-blank");
        let mut many: Vec<String> = (0..1000).map(|i| format!("x{i}")).collect();
        many.push(" ".into());
        let e = add_in(&root, &config, &Target::Today, &many, None, "2026-10-17").unwrap_err();
        assert!(e.contains("1000개까지") && e.contains("1001"), "{e}");
        assert!(!root.join("daily/2026-10-17.md").exists());
        let msg = add_in(&root, &config, &Target::Today, &s(&["가", " ", "\u{200b}", "나"]), None, "2026-10-17").unwrap();
        assert!(msg.contains("2개 추가") && msg.contains("빈 항목 2개"), "{msg}");
        let msg = add_in(&root, &config, &Target::Today, &s(&["다"]), None, "2026-10-17").unwrap();
        assert!(!msg.contains("빈 항목"), "{msg}");
    }

    #[test]
    fn r6_짝_없는_서로게이트가_온_요청도_id를_살려_답한다() {
        let input = concat!(
            r#"{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"add_todos","arguments":{"items":["a\ud800"]}}}"#, "\n",
            r#"{"jsonrpc":"2.0","id":"s","method":"ping","x":"\\ud800 😀 \udc00"}"#, "\n",
            r#"{"jsonrpc":"2.0","id":9,"method":"ping","x":"😀"}"#, "\n",
            r#"{"id":10, "x":"\ud800""#, "\n",
        );
        let mut out = Vec::new();
        serve(std::io::Cursor::new(input.as_bytes().to_vec()), &mut out);
        let replies: Vec<Value> = String::from_utf8(out).unwrap().lines().map(|l| serde_json::from_str(l).unwrap()).collect();
        assert_eq!(replies.len(), 4, "{replies:?}");
        assert_eq!((replies[0]["id"].clone(), replies[0]["error"]["code"].clone()), (json!(7), json!(-32700)));
        assert!(!replies[0]["error"]["message"].as_str().unwrap().is_ascii());
        assert_eq!((replies[1]["id"].clone(), replies[1]["error"]["code"].clone()), (json!("s"), json!(-32700)));
        assert_eq!(replies[2]["id"], 9);
        assert!(replies[2]["error"].is_null(), "짝이 맞는 서로게이트는 정상이다: {}", replies[2]);
        // 아예 깨진 JSON은 id를 알 수 없다
        assert_eq!((replies[3]["id"].clone(), replies[3]["error"]["code"].clone()), (Value::Null, json!(-32700)));
    }

    #[test]
    fn r6_list는_하드링크_파일을_쓰는_도중_읽어도_잘린_목록을_내지_않는다() {
        let (root, _config) = dirs("r6-list-torn");
        let make = |c: &str| (0..3000).map(|i| format!("- [ ] {c}{i}\n")).collect::<String>();
        let (a, b) = (make("가"), make("나"));
        storage::write_text(&root, "someday.md", &a).unwrap();
        let backup = dirs("r6-list-torn-backup").0.join("백업.md");
        std::fs::hard_link(root.join("someday.md"), backup).unwrap();
        let want_a = list_in(&root, &Target::Someday, "2026-10-17").unwrap();
        storage::write_text(&root, "someday.md", &b).unwrap();
        let want_b = list_in(&root, &Target::Someday, "2026-10-17").unwrap();
        let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let writer = {
            let (root, stop) = (root.clone(), stop.clone());
            std::thread::spawn(move || {
                let mut i = 0;
                while !stop.load(std::sync::atomic::Ordering::SeqCst) {
                    let _lock = storage::lock_root(&root, storage::CLI_LOCK_WAIT).unwrap();
                    storage::write_text(&root, "someday.md", if i % 2 == 0 { &a } else { &b }).unwrap();
                    i += 1;
                }
            })
        };
        let torn = (0..400).filter(|_| {
            let got = list_in(&root, &Target::Someday, "2026-10-17").unwrap();
            got != want_a && got != want_b
        }).count();
        stop.store(true, std::sync::atomic::Ordering::SeqCst);
        writer.join().unwrap();
        assert_eq!(torn, 0, "잘린 목록을 냈다");
    }

    fn quickly<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> T {
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let _ = tx.send(f());
        });
        rx.recv_timeout(std::time::Duration::from_secs(3)).expect("3초 안에 끝나지 않았다(멈춤)")
    }

    fn mkfifo(path: &Path) {
        let c = std::ffi::CString::new(path.as_os_str().as_encoded_bytes()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(c.as_ptr(), 0o644) }, 0);
    }

    #[test]
    fn r7_데이터_파일이_fifo면_멈추지_않고_잠금도_쥐고_있지_않는다() {
        for name in ["daily/2026-10-17.md", "settings.json"] {
            let (root, config) = dirs(&format!("r7-fifo-{}", name.len()));
            std::fs::create_dir_all(root.join("daily")).unwrap();
            mkfifo(&root.join(name));
            let e = quickly({
                let (root, config) = (root.clone(), config.clone());
                move || add_in(&root, &config, &Target::Today, &s(&["가"]), None, "2026-10-17")
            })
            .unwrap_err();
            assert!(e.contains("특수 파일"), "{name}: {e}");
            // 기다림 0이면 안 된다: 다른 테스트가 그 순간 자식 프로세스(unzip 등)를 띄우면 잠금 fd가 exec 전까지 자식에게도 있어
            // 놓은 잠금이 잠깐 잡혀 보인다(같이 돌리면 150번 중 58번). 정말 쥐고 있으면 1초를 기다려도 실패한다
            let locked = storage::lock_root(&root, std::time::Duration::from_secs(1)).map(|_| ());
            assert!(locked.is_ok(), "{name}: 잠금이 남았다 {locked:?}");
        }
        let (root, config) = dirs("r7-fifo-batch");
        mkfifo(&config.join(BATCH_LOG));
        let e = quickly({
            let (root, config) = (root.clone(), config.clone());
            move || add_in(&root, &config, &Target::Today, &s(&["가"]), Some("claude"), "2026-10-17")
        })
        .unwrap_err();
        assert!(e.contains("특수 파일"), "{e}");
        let (config, default) = dirs("r7-fifo-location");
        mkfifo(&config.join("location.json"));
        let located = quickly(move || locate(&config, &default).1);
        assert!(located.is_err(), "{located:?}");
    }

    #[test]
    fn r7_건너뛴_목록과_빈_항목_안내_사이를_끊는다() {
        let (root, config) = dirs("r7-skip-sep");
        add_in(&root, &config, &Target::Today, &s(&["real1"]), None, "2026-10-17").unwrap();
        let msg = add_in(&root, &config, &Target::Today, &s(&["real1", " ", "  "]), None, "2026-10-17").unwrap();
        assert!(msg.contains(r#"건너뜀: "real1". 빈 항목 2개"#), "{msg}");
    }

    #[test]
    fn r7_서로게이트_경로도_실수_id는_돌려주지_않는다() {
        let input = concat!(r#"{"jsonrpc":"2.0","id":1.5,"method":"ping","x":"\ud800"}"#, "\n");
        let mut out = Vec::new();
        serve(std::io::Cursor::new(input.as_bytes().to_vec()), &mut out);
        let reply: Value = serde_json::from_str(String::from_utf8(out).unwrap().trim()).unwrap();
        assert_eq!(reply["id"], Value::Null, "{reply}");
    }

    #[test]
    fn r8_n3_추가한_결과가_읽기_상한을_넘으면_쓰지_않는다() {
        let (root, config) = dirs("r8-cap");
        let rel = "daily/2026-10-17.md";
        std::fs::create_dir_all(root.join("daily")).unwrap();
        std::fs::File::create(root.join(rel)).unwrap().set_len(64 * 1024 * 1024).unwrap();
        let e = add_in(&root, &config, &Target::Today, &s(&["y"]), None, "2026-10-17").unwrap_err();
        assert!(e.contains("64MB"), "{e}");
        assert_eq!(std::fs::metadata(root.join(rel)).unwrap().len(), 64 * 1024 * 1024, "상한을 넘는 파일을 썼다");
        assert!(list_in(&root, &Target::Today, "2026-10-17").is_ok(), "그날 할 일을 못 읽게 됐다");
    }

    #[test]
    fn r8_n3_한_번에_넣는_글자_수_합계에도_한도가_있다() {
        let (root, config) = dirs("r8-budget");
        let items: Vec<String> = (0..1000).map(|i| format!("{i} {}", "가".repeat(300))).collect();
        let e = add_in(&root, &config, &Target::Today, &items, Some("claude-code"), "2026-10-17").unwrap_err();
        assert!(e.contains("나눠서"), "{e}");
        assert!(!root.join("daily/2026-10-17.md").exists());
    }

    #[test]
    fn r8_건너뛴_이름에_쉼표가_있어도_목록과_구분된다() {
        let (root, config) = dirs("r8-skip-quote");
        let items = s(&["a, b", "c"]);
        add_in(&root, &config, &Target::Today, &items, None, "2026-10-17").unwrap();
        let msg = add_in(&root, &config, &Target::Today, &items, None, "2026-10-17").unwrap();
        assert!(msg.contains(r#"건너뜀: "a, b", "c"."#), "{msg}");
    }

    #[test]
    fn r10_mcp_너무_긴_줄은_버리고_다음_요청에_답한다() {
        let mut input = vec![b'['; 8 * 1024 * 1024 + 10];
        input.push(b'\n');
        input.extend_from_slice(br#"{"jsonrpc":"2.0","id":2,"method":"ping"}"#);
        input.push(b'\n');
        let mut out = Vec::new();
        serve(std::io::Cursor::new(input), &mut out);
        let replies: Vec<Value> = String::from_utf8(out).unwrap().lines().map(|l| serde_json::from_str(l).unwrap()).collect();
        assert_eq!(replies.len(), 2, "{replies:?}");
        assert_eq!(replies[0]["error"]["code"], -32600);
        assert!(replies[0]["error"]["message"].as_str().unwrap().contains("8MB"), "{}", replies[0]);
        assert_eq!(replies[1]["id"], 2);
    }

    #[test]
    fn r10_같은_요청_안의_중복은_이미_있던_것과_따로_알린다() {
        let (root, config) = dirs("r10-dup");
        add_in(&root, &config, &Target::Today, &s(&["나"]), None, "2026-10-17").unwrap();
        let msg = add_in(&root, &config, &Target::Today, &s(&["가", "가", "가", "나"]), None, "2026-10-17").unwrap();
        assert!(msg.contains("1개 추가했다"), "{msg}");
        assert!(msg.contains("이미 있어서 건너뜀: \"나\"."), "{msg}");
        assert!(msg.contains("같은 요청 안에서 겹쳐 2개 건너뜀: \"가\"."), "{msg}");
    }

    #[test]
    fn r11_줄_길이_상한은_줄_끝을_빼고_센다() {
        let line = |body: usize, end: &[u8]| {
            let mut v = vec![b' '; body];
            v.extend_from_slice(end);
            v
        };
        let fits = |input: Vec<u8>| read_line_capped(&mut std::io::Cursor::new(input), &mut Vec::new()).unwrap();
        assert_eq!(fits(line(MAX_LINE, b"\r\n")), Some(true), "CRLF 줄");
        assert_eq!(fits(line(MAX_LINE, b"\n")), Some(true));
        assert_eq!(fits(line(MAX_LINE, b"")), Some(true), "EOF로 끝나는 줄");
        assert_eq!(fits(line(MAX_LINE + 1, b"")), Some(false), "EOF로 끝나는 줄이 1바이트 더 받았다");
        assert_eq!(fits(line(MAX_LINE + 1, b"\n")), Some(false));
        assert_eq!(fits(line(MAX_LINE + 1, b"\r\n")), Some(false));
    }

    #[test]
    fn r11_너무_긴_줄에도_앞부분의_id로_답한다() {
        let mut input = Vec::new();
        let mut long = |head: &str, tail: &str| {
            input.extend_from_slice(head.as_bytes());
            input.extend(vec![b'a'; MAX_LINE]);
            input.extend_from_slice(tail.as_bytes());
            input.push(b'\n');
        };
        long(r#"{"jsonrpc":"2.0","method":"\"id\":3","id":7,"params":{"name":"add_todos","arguments":{"id":99,"items":[""#, r#""]}}}"#);
        long(r#"{"params":{"id":5,"x":""#, r#""}}"#);
        long(r#"{"method":"x","id" : "abc","p":""#, r#""}"#);
        long(r#"{"id":{"a":1},"p":""#, r#""}"#);
        let mut out = Vec::new();
        serve(std::io::Cursor::new(input), &mut out);
        let replies: Vec<Value> = String::from_utf8(out).unwrap().lines().map(|l| serde_json::from_str(l).unwrap()).collect();
        let ids: Vec<&Value> = replies.iter().map(|r| &r["id"]).collect();
        assert_eq!(ids, [&json!(7), &Value::Null, &json!("abc"), &Value::Null], "{replies:?}");
        assert!(replies.iter().all(|r| r["error"]["code"] == -32600));
    }

    #[test]
    fn r12_앞부분_경계에서_잘린_정수_id는_믿지_않는다() {
        let head = r#"{"params":{"x":""#;
        let pad = ID_PREFIX - head.len() - r#""},"id":12345"#.len();
        let mut input = head.as_bytes().to_vec();
        input.extend(vec![b'a'; pad]);
        input.extend_from_slice(r#""},"id":123456789,"y":""#.as_bytes());
        input.extend(vec![b'a'; MAX_LINE]);
        input.extend_from_slice(b"\"}\n");
        let mut out = Vec::new();
        serve(std::io::Cursor::new(input), &mut out);
        let reply: Value = serde_json::from_str(String::from_utf8(out).unwrap().trim()).unwrap();
        assert_eq!(reply["error"]["code"], -32600);
        assert_eq!(reply["id"], Value::Null, "잘린 숫자를 id로 돌려줬다: {reply}");

        assert_eq!(prefix_id(br#"{"id":12"#), Value::Null);
        assert_eq!(prefix_id(br#"{"id":-12 "#), Value::Null, "공백 뒤에서 잘려도 끝났는지 모른다");
        assert_eq!(prefix_id(br#"{"id":12,"#), json!(12));
        assert_eq!(prefix_id(br#"{"id":12 }"#), json!(12));
        assert_eq!(prefix_id(br#"{"id":"ab""#), json!("ab"), "문자열은 닫는 따옴표로 끝이 확정된다");
        assert_eq!(prefix_id(br#"{"id":"ab"#), Value::Null);
    }

    #[test]
    fn r11_이미_있는_할_일이_같은_요청에서_겹쳐도_이름은_한_번만_적는다() {
        let (root, config) = dirs("r11-dup");
        add_in(&root, &config, &Target::Today, &s(&["나", "i1"]), None, "2026-10-17").unwrap();
        let msg = add_in(&root, &config, &Target::Today, &s(&["나", "나"]), None, "2026-10-17").unwrap();
        assert!(msg.contains("이미 있어서 건너뜀: \"나\"."), "{msg}");
        assert!(msg.contains("같은 요청 안에서 겹쳐 1개 건너뜀"), "{msg}");
        let many: Vec<String> = std::iter::repeat_n("i1".to_string(), 1000).collect();
        let msg = add_in(&root, &config, &Target::Today, &many, None, "2026-10-17").unwrap();
        assert!(msg.contains("이미 있어서 건너뜀: \"i1\".") && msg.contains("같은 요청 안에서 겹쳐 999개 건너뜀: \"i1\"."), "{msg}");
    }

    #[test]
    fn r11_배열_요청은_개수와_한_번의_한도를_통째로_본다() {
        let mut client = "ai".to_string();
        let pings = |n: usize| Value::Array((0..n).map(|i| json!({"jsonrpc": "2.0", "id": i, "method": "ping"})).collect());
        let r = handle_payload(&pings(MAX_BATCH + 1), &mut client).unwrap();
        assert_eq!(r["error"]["code"], -32600, "{r}");
        assert_eq!(handle_payload(&pings(MAX_BATCH), &mut client).unwrap().as_array().map(Vec::len), Some(MAX_BATCH));
        // 나눠 담아 한 번의 한도(1000개·20만 자)를 넘기면 통째로 거절한다 — 하나도 쓰지 않는다
        let call = |items: Vec<String>| json!({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "add_todos", "arguments": {"list": "date", "date": "2099-12-31", "items": items}}});
        let many = |n: usize| (0..n).map(|i| format!("r11 배열 {i}")).collect::<Vec<_>>();
        let r = handle_payload(&json!([call(many(600)), call(many(600))]), &mut client).unwrap();
        assert_eq!(r["error"]["code"], -32600, "{r}");
        let long = || vec!["가".repeat(10_000); 15];
        let r = handle_payload(&json!([call(long()), call(long())]), &mut client).unwrap();
        assert_eq!(r["error"]["code"], -32600, "{r}");
    }
}
