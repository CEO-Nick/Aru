//! 실제 aru 바이너리를 여러 프로세스로 띄워 확인한다. HOME은 매번 임시 폴더로 바꿔 사용자 데이터를 건드리지 않는다
//! HOME 격리·`date`·TZ·PATH 같은 Unix 프로세스 환경을 전제한다. Windows는 저장 위치가 알려진 폴더 API라 HOME으로 격리되지 않아
//! 단위 테스트(NTFS)와 실기 시험(aru list·add)으로 본다
#![cfg(unix)]

use std::path::PathBuf;
use std::process::{Command, Output};

fn home(name: &str) -> PathBuf {
    let base = std::env::var_os("ARU_TEST_TMP").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
    let dir = base.join(format!("aru-it-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn data(home: &PathBuf) -> PathBuf {
    home.join("Library/Application Support/dev.aruu.aru")
}

fn aru(home: &PathBuf) -> Command {
    let mut c = Command::new(env!("CARGO_BIN_EXE_aru"));
    c.env("HOME", home).env_remove("CLAUDECODE");
    for (k, _) in std::env::vars() {
        if k.starts_with("CODEX_") {
            c.env_remove(k);
        }
    }
    c
}

fn text(o: &Output) -> String {
    format!("{}{}", String::from_utf8_lossy(&o.stdout), String::from_utf8_lossy(&o.stderr))
}

#[test]
fn b1_프로세스_20개가_동시에_넣어도_모두_남는다() {
    let h = home("b1");
    let children: Vec<_> = (0..20)
        .map(|i| {
            aru(&h).args(["add", &format!("p{i}"), "--date", "2026-11-01", "--by", "t"])
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .spawn()
                .unwrap()
        })
        .collect();
    for c in children {
        let o = c.wait_with_output().unwrap();
        assert!(o.status.success(), "{}", text(&o));
    }
    let content = std::fs::read_to_string(data(&h).join("daily/2026-11-01.md")).unwrap();
    assert_eq!(content.lines().count(), 20, "{content}");
    for i in 0..20 {
        assert_eq!(content.lines().filter(|l| l.starts_with(&format!("- [ ] p{i} <!-- ai:t@"))).count(), 1, "{content}");
    }
    let log: Vec<serde_json::Value> = serde_json::from_str(&std::fs::read_to_string(data(&h).join("ai-batches.json")).unwrap()).unwrap();
    assert_eq!(log.len(), 20);
}

#[test]
fn b9_date_명령_없이_tz의_오늘을_쓴다() {
    let h = home("b9");
    let expect = |offset: i64| {
        let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64 + offset;
        let days = secs.div_euclid(86400);
        // civil_from_days
        let z = days + 719468;
        let era = z.div_euclid(146097);
        let doe = z - era * 146097;
        let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        let mp = (5 * doy + 2) / 153;
        let d = doy - (153 * mp + 2) / 5 + 1;
        let m = if mp < 10 { mp + 3 } else { mp - 9 };
        let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
        format!("{y:04}-{m:02}-{d:02}")
    };
    for (tz, offset) in [("Etc/GMT-14", 14 * 3600), ("Etc/GMT+12", -12 * 3600)] {
        let before = expect(offset);
        let o = aru(&h).args(["list"]).env("PATH", "").env("TZ", tz).output().unwrap();
        let after = expect(offset);
        let out = text(&o);
        assert!(o.status.success(), "{out}");
        assert!(out.contains(&format!("오늘({before})")) || out.contains(&format!("오늘({after})")), "{tz}: {out}");
    }
    let o = aru(&h).args(["add", "첫 할 일"]).env("PATH", "").output().unwrap();
    assert!(o.status.success(), "{}", text(&o));
}

#[test]
fn b10_utf8이_아닌_인자는_오류로_끝난다() {
    use std::os::unix::ffi::OsStrExt;
    let h = home("b10");
    let o = aru(&h).arg("add").arg(std::ffi::OsStr::from_bytes(b"\xff\xfe bad")).output().unwrap();
    assert_eq!(o.status.code(), Some(1), "{}", text(&o));
    assert!(!text(&o).contains("panicked"));
}

#[test]
fn b8_b11_b14_명령_오류는_아무것도_쓰지_않고_0이_아닌_코드로_끝난다() {
    let h = home("errors");
    let o = aru(&h).args(["add", "z", "--date", "2026-02-30"]).output().unwrap();
    assert_eq!(o.status.code(), Some(1), "{}", text(&o));
    assert!(!data(&h).join("daily/2026-02-30.md").exists());

    let o = aru(&h).args(["add", "--help"]).output().unwrap();
    assert!(o.status.success());
    assert!(text(&o).contains("사용법"), "{}", text(&o));
    assert!(!data(&h).join("daily").exists());

    std::fs::create_dir_all(data(&h)).unwrap();
    let missing = h.join("없는폴더");
    std::fs::write(data(&h).join("location.json"), format!("{{\"root\": {:?}}}", missing.to_string_lossy())).unwrap();
    let o = aru(&h).args(["add", "x"]).output().unwrap();
    assert_eq!(o.status.code(), Some(1), "{}", text(&o));
    assert!(text(&o).contains(&format!("저장 폴더를 열 수 없어요: {}", missing.display())), "{}", text(&o));
    assert!(!data(&h).join("daily").exists());
    let o = aru(&h).args(["list"]).output().unwrap();
    assert_eq!(o.status.code(), Some(1), "{}", text(&o));
}

#[test]
fn b15_모르는_명령은_창을_띄우지_않고_2로_끝나고_버전을_알려_준다() {
    let h = home("b15");
    let o = aru(&h).args(["ad", "x"]).output().unwrap();
    assert_eq!(o.status.code(), Some(2), "{}", text(&o));
    assert!(text(&o).contains("알 수 없는 명령"), "{}", text(&o));
    for flag in ["--version", "-V"] {
        let o = aru(&h).arg(flag).output().unwrap();
        assert!(o.status.success());
        assert_eq!(String::from_utf8_lossy(&o.stdout).trim(), format!("aru {}", env!("CARGO_PKG_VERSION")));
    }
}

#[test]
fn b6_b7_b12_mcp_서버를_실제로_띄워_확인한다() {
    use std::io::Write;
    let h = home("mcp");
    let mut child = aru(&h)
        .arg("mcp")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    let mut input = Vec::new();
    input.extend_from_slice(b"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"clientInfo\":{\"name\":\"tester\"}}}\n");
    input.extend_from_slice(b"{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"add_todos\",\"arguments\":{\"items\":[\"\xe9\"]}}}\n");
    input.extend_from_slice(b"{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"add_todos\",\"arguments\":{\"items\":[\"dated\"],\"date\":\"2026-10-20\"}}}\n");
    input.extend_from_slice(b"{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"tools/call\",\"params\":{\"name\":\"add_todos\",\"arguments\":{\"items\":[\"x\"],\"list\":\"tomorrow\"}}}\n");
    input.extend_from_slice(b"[{\"jsonrpc\":\"2.0\",\"id\":5,\"method\":\"ping\"},{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}]\n");
    child.stdin.take().unwrap().write_all(&input).unwrap();
    let o = child.wait_with_output().unwrap();
    let replies: Vec<serde_json::Value> =
        String::from_utf8(o.stdout).unwrap().lines().map(|l| serde_json::from_str(l).unwrap()).collect();
    assert_eq!(replies.len(), 5, "{replies:?}");
    assert_eq!(replies[1]["error"]["code"], -32700);
    assert_eq!(replies[2]["result"]["isError"], false);
    assert!(std::fs::read_to_string(data(&h).join("daily/2026-10-20.md")).unwrap().contains("- [ ] dated <!-- ai:tester@"));
    assert_eq!(replies[3]["result"]["isError"], true);
    assert_eq!(replies[4][0]["id"], 5);
    assert_eq!(replies[4].as_array().unwrap().len(), 1);
}

#[test]
fn r2_잠금을_쥔_프로세스가_멈춰_있어도_끝없이_기다리지_않는다() {
    let h = home("r2-lock");
    std::fs::create_dir_all(data(&h)).unwrap();
    let lock = std::fs::OpenOptions::new().create(true).truncate(false).write(true).open(data(&h).join(".aru.lock")).unwrap();
    lock.lock().unwrap();
    let started = std::time::Instant::now();
    let o = aru(&h).args(["add", "가"]).output().unwrap();
    let waited = started.elapsed();
    assert_eq!(o.status.code(), Some(1), "{}", text(&o));
    assert!(String::from_utf8_lossy(&o.stderr).starts_with("저장 폴더가 잠겨 있어요"), "{}", text(&o));
    assert!(waited >= std::time::Duration::from_secs(9) && waited < std::time::Duration::from_secs(20), "{waited:?}");
    drop(lock);
    let o = aru(&h).args(["add", "가"]).output().unwrap();
    assert!(o.status.success(), "{}", text(&o));
}

#[test]
fn r2_list는_대시대시_뒤_인자도_거절한다() {
    let h = home("r2-list");
    let o = aru(&h).args(["list", "--", "x"]).output().unwrap();
    assert_eq!(o.status.code(), Some(1), "{}", text(&o));
}
