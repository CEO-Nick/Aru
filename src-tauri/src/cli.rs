//! 터미널·AI 도구에서 할 일을 넣고 보는 명령(`aru add`, `aru list`)과 MCP 서버(`aru mcp`).
//! 앱이 켜져 있지 않아도 저장 폴더의 마크다운 파일에 직접 쓴다. 켜져 있는 앱은 바뀐 파일을 다시 읽어 합친다.

use crate::storage;
use serde_json::{json, Value};
use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

const IDENTIFIER: &str = "dev.aruu.aru";

pub const COMMANDS: &[&str] = &["add", "list", "mcp", "help", "--help", "-h"];

const HELP: &str = "aru — Aru 할 일 앱에 터미널에서 할 일을 넣고 본다

사용법:
  aru add \"할 일\" [\"할 일\" ...] [--someday | --date YYYY-MM-DD] [--by 도구이름]
  aru list [--someday | --date YYYY-MM-DD]
  aru mcp            MCP 서버로 실행(AI 앱 연결용)

규칙:
  - 할 일은 목록 맨 위에, 준 순서대로 들어간다.
  - 같은 날 아직 안 끝낸 똑같은 할 일이 있으면 건너뛴다.
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
    fn rel_path(&self) -> String {
        match self {
            Target::Today => format!("daily/{}.md", today()),
            Target::Date(d) => format!("daily/{d}.md"),
            Target::Someday => "someday.md".into(),
        }
    }

    fn label(&self) -> String {
        match self {
            Target::Today => format!("오늘({})", today()),
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
}

fn is_task_line(line: &str) -> Option<(bool, &str)> {
    let rest = line.strip_prefix("- [").or_else(|| line.strip_prefix("* [")).or_else(|| line.strip_prefix("+ ["))?;
    let mut chars = rest.chars();
    let mark = chars.next()?;
    let after = chars.as_str().strip_prefix(']')?;
    if !matches!(mark, ' ' | 'x' | 'X') {
        return None;
    }
    let text = after.strip_prefix(' ').unwrap_or(after);
    if !after.is_empty() && !after.starts_with(' ') {
        return None;
    }
    Some((mark != ' ', text))
}

/// 줄 끝 표시 주석(from·ai)을 뗀 글자와, AI 표시 여부
fn split_marker(text: &str) -> (&str, bool) {
    let trimmed = text.trim_end();
    if let Some(start) = trimmed.rfind("<!--") {
        let comment = &trimmed[start..];
        if let Some(inner) = comment.strip_prefix("<!--").and_then(|c| c.strip_suffix("-->")) {
            let tokens: Vec<&str> = inner.split_whitespace().collect();
            let valid = !tokens.is_empty()
                && tokens.iter().all(|t| t.starts_with("from:") || t.starts_with("ai:"));
            if valid {
                let is_ai = tokens.iter().any(|t| t.starts_with("ai:"));
                return (trimmed[..start].trim_end(), is_ai);
            }
        }
    }
    (trimmed, false)
}

fn looks_like_marker(text: &str) -> bool {
    split_marker(text).0.len() != text.trim_end().len()
}

/// 새 할 일을 맨 위(첫 할 일 앞)에 준 순서대로 넣는다. 안 끝낸 똑같은 할 일은 건너뛴다
pub fn add_items(content: &str, items: &[String], ai: Option<(&str, u64)>) -> AddResult {
    let lines: Vec<&str> = content.lines().collect();
    let mut open: Vec<String> = lines
        .iter()
        .filter_map(|l| is_task_line(l))
        .filter(|(done, _)| !done)
        .map(|(_, text)| split_marker(text).0.to_string())
        .collect();

    let mut added = Vec::new();
    let mut skipped = Vec::new();
    let mut new_lines = Vec::new();
    for raw in items {
        let text = raw.replace(['\r', '\n'], " ").trim().to_string();
        if text.is_empty() {
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
        open.push(text.clone());
        added.push(text);
    }

    if new_lines.is_empty() {
        return AddResult { content: content.to_string(), added, skipped };
    }
    let first_task = lines.iter().position(|l| is_task_line(l).is_some());
    let mut out: Vec<String> = Vec::new();
    match first_task {
        Some(i) => {
            out.extend(lines[..i].iter().map(|s| s.to_string()));
            out.extend(new_lines);
            out.extend(lines[i..].iter().map(|s| s.to_string()));
        }
        None => {
            out.extend(new_lines);
            if lines.iter().any(|l| !l.trim().is_empty()) {
                out.push(String::new());
                out.extend(lines.iter().map(|s| s.to_string()));
            }
        }
    }
    let mut text = out.join("\n");
    text.push('\n');
    AddResult { content: text, added, skipped }
}

/// 목록을 사람과 AI가 읽기 좋은 줄로
pub fn list_items(content: &str) -> Vec<String> {
    content
        .lines()
        .filter_map(is_task_line)
        .map(|(done, text)| {
            let (text, is_ai) = split_marker(text);
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

fn today() -> String {
    std::process::Command::new("date")
        .arg("+%Y-%m-%d")
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|d| d.len() == 10)
        .unwrap_or_else(|| "1970-01-01".into())
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn valid_date(d: &str) -> bool {
    let b = d.as_bytes();
    d.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && d.chars().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
}

fn home() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_default())
}

/// 앱의 설정 폴더와 기본 저장 폴더. 맥에서는 같은 곳이다
fn app_dirs() -> (PathBuf, PathBuf) {
    #[cfg(target_os = "macos")]
    {
        let base = home().join("Library/Application Support").join(IDENTIFIER);
        (base.clone(), base)
    }
    #[cfg(not(target_os = "macos"))]
    {
        (home().join(".config").join(IDENTIFIER), home().join(".local/share").join(IDENTIFIER))
    }
}

/// 앱과 같은 규칙으로 저장 폴더를 찾는다: 설정 폴더의 location.json이 가리키는 곳, 없으면 기본 폴더
pub fn data_root() -> PathBuf {
    let (config, data) = app_dirs();
    std::fs::read_to_string(config.join("location.json"))
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .and_then(|v| v.get("root").and_then(|r| r.as_str()).map(PathBuf::from))
        .filter(|p| p.is_dir())
        .unwrap_or(data)
}

/// 설정에서 "AI·명령어로 추가"를 껐으면 거절한다
fn external_add_allowed(root: &PathBuf) -> bool {
    std::fs::read_to_string(root.join("settings.json"))
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .and_then(|v| v.get("allowExternalAdd").and_then(|a| a.as_bool()))
        .unwrap_or(true)
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

/// 화면에 안 보이는 날짜에 넣어도 앱이 알 수 있게, 이 맥의 설정 폴더에 남긴다(동기화 폴더가 아니다)
fn log_batch(by: &str, at: u64, path: &str, count: usize) {
    let dir = app_dirs().0;
    let file = dir.join(BATCH_LOG);
    let current = std::fs::read_to_string(&file).unwrap_or_default();
    let next = append_batch(&current, json!({"by": by, "at": at, "path": path, "count": count}));
    let _ = std::fs::create_dir_all(&dir);
    let _ = std::fs::write(file, next);
}

/// 앱이 읽는 최근 추가 기록
pub fn recent_batches() -> Vec<Value> {
    std::fs::read_to_string(app_dirs().0.join(BATCH_LOG))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

pub fn add(target: &Target, items: &[String], by: Option<&str>) -> Result<String, String> {
    let root = data_root();
    if !external_add_allowed(&root) {
        return Err("Aru 설정에서 'AI·명령어로 추가'가 꺼져 있어 추가하지 않았다.".into());
    }
    let rel = target.rel_path();
    let current = storage::read_text(&root, &rel)?.unwrap_or_default();
    let by = by.map(sanitize_tool);
    let at = now_secs();
    let result = add_items(&current, items, by.as_deref().map(|b| (b, at)));
    if !result.added.is_empty() {
        storage::write_text(&root, &rel, &result.content)?;
        if let Some(by) = &by {
            log_batch(by, at, &rel, result.added.len());
        }
    }
    let mut msg = format!("{}에 {}개 추가했다.", target.label(), result.added.len());
    if !result.skipped.is_empty() {
        msg.push_str(&format!(" 이미 있어서 건너뜀: {}", result.skipped.join(", ")));
    }
    Ok(msg)
}

pub fn list(target: &Target) -> Result<String, String> {
    let content = storage::read_text(&data_root(), &target.rel_path())?.unwrap_or_default();
    let items = list_items(&content);
    if items.is_empty() {
        return Ok(format!("{}: 할 일 없음", target.label()));
    }
    Ok(format!("{}:\n{}", target.label(), items.join("\n")))
}

/// AI 도구 안에서 돌면 따로 적지 않아도 태그를 붙인다
fn detect_agent() -> Option<String> {
    if std::env::var("CLAUDECODE").is_ok() {
        return Some("claude-code".into());
    }
    if std::env::vars().any(|(k, _)| k.starts_with("CODEX_")) {
        return Some("codex".into());
    }
    None
}

fn parse_args(args: &[String]) -> Result<(Target, Vec<String>, Option<String>), String> {
    let mut target = Target::Today;
    let mut items = Vec::new();
    let mut by = None;
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--someday" => target = Target::Someday,
            "--date" => {
                let d = args.get(i + 1).ok_or("--date 뒤에 YYYY-MM-DD 날짜가 필요하다")?;
                if !valid_date(d) {
                    return Err(format!("날짜 형식이 틀렸다: {d} (YYYY-MM-DD)"));
                }
                target = Target::Date(d.clone());
                i += 1;
            }
            "--by" => {
                by = Some(args.get(i + 1).ok_or("--by 뒤에 도구 이름이 필요하다")?.clone());
                i += 1;
            }
            other => items.push(other.to_string()),
        }
        i += 1;
    }
    Ok((target, items, by))
}

/// `aru <명령>`으로 실행됐으면 처리하고 종료 코드를 돌려준다
pub fn run(args: &[String]) -> i32 {
    let command = args.first().map(String::as_str).unwrap_or("help");
    let rest = &args[1.min(args.len())..];
    let result = match command {
        "add" => parse_args(rest).and_then(|(target, items, by)| {
            if items.iter().all(|t| t.trim().is_empty()) {
                return Err("추가할 할 일을 적어 달라. 예: aru add \"PR 리뷰\"".into());
            }
            add(&target, &items, by.or_else(detect_agent).as_deref())
        }),
        "list" => parse_args(rest).and_then(|(target, _, _)| list(&target)),
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
        "list": {"type": "string", "enum": ["today", "someday", "date"], "description": "today(기본), someday(언젠가), date(특정 날짜)"},
        "date": {"type": "string", "description": "list가 date일 때 YYYY-MM-DD"}
    });
    let mut add_props = target_props.clone();
    add_props["items"] = json!({"type": "array", "items": {"type": "string"}, "minItems": 1, "description": "추가할 할 일들. 한 항목에 한 줄"});
    json!([
        {"name": "add_todos", "description": ADD_DESCRIPTION,
         "inputSchema": {"type": "object", "properties": add_props, "required": ["items"]}},
        {"name": "list_todos", "description": LIST_DESCRIPTION,
         "inputSchema": {"type": "object", "properties": target_props},
         "annotations": {"readOnlyHint": true}}
    ])
}

fn target_from(args: &Value) -> Result<Target, String> {
    match args.get("list").and_then(Value::as_str).unwrap_or("today") {
        "someday" => Ok(Target::Someday),
        "date" => {
            let d = args.get("date").and_then(Value::as_str).ok_or("list가 date면 date(YYYY-MM-DD)가 필요하다")?;
            if !valid_date(d) {
                return Err(format!("날짜 형식이 틀렸다: {d}"));
            }
            Ok(Target::Date(d.to_string()))
        }
        _ => Ok(Target::Today),
    }
}

fn call_tool(name: &str, args: &Value, client: &str) -> Result<String, String> {
    let target = target_from(args)?;
    match name {
        "add_todos" => {
            let items: Vec<String> = args
                .get("items")
                .and_then(Value::as_array)
                .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .unwrap_or_default();
            if items.iter().all(|t| t.trim().is_empty()) {
                return Err("items가 비어 있다".into());
            }
            add(&target, &items, Some(client))
        }
        "list_todos" => list(&target),
        other => Err(format!("모르는 도구: {other}")),
    }
}

pub fn handle_message(msg: &Value, client: &mut String) -> Option<Value> {
    let id = msg.get("id").cloned();
    let method = msg.get("method").and_then(Value::as_str).unwrap_or("");
    let result = match method {
        "initialize" => {
            if let Some(name) = msg.pointer("/params/clientInfo/name").and_then(Value::as_str) {
                *client = sanitize_tool(name);
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

fn mcp_serve() {
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    let mut client = "ai".to_string();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let reply = match serde_json::from_str::<Value>(&line) {
            Ok(msg) => handle_message(&msg, &mut client),
            Err(_) => Some(json!({"jsonrpc": "2.0", "id": null, "error": {"code": -32700, "message": "JSON이 아니다"}})),
        };
        if let Some(reply) = reply {
            let _ = writeln!(stdout, "{reply}");
            let _ = stdout.flush();
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
        assert_eq!(r.skipped, s(&["하나", "하나"]));
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
        let (t, items, by) = parse_args(&s(&["가", "--date", "2026-10-20", "--by", "codex"])).unwrap();
        assert_eq!(t, Target::Date("2026-10-20".into()));
        assert_eq!(items, s(&["가"]));
        assert_eq!(by.as_deref(), Some("codex"));
        assert!(parse_args(&s(&["--date", "10/20"])).is_err());
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
}
