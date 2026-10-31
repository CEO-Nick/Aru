//! Claude 데스크톱 확장 파일(.mcpb). manifest.json 하나만 든 zip이다.
//! 서버를 묶어 넣지 않고 설치된 Aru의 aru 명령을 가리킨다 — 할 일 폴더 권한이 앱에 묶여 있어서다.

use crate::storage;
use std::path::{Path, PathBuf};

const MANIFEST: &str = "manifest.json";

pub fn manifest(command: &str, version: &str, author: &str) -> String {
    serde_json::json!({
        "manifest_version": "0.3",
        "name": "aru",
        "display_name": "Aru",
        "version": version,
        "description": "Aru에 할 일을 넣고 오늘 할 일을 본다. 사용자가 넣어 달라고 할 때만 쓴다.",
        "author": { "name": author },
        "server": {
            "type": "binary",
            // 규격상 필수이고 묶음 안의 상대 경로여야 한다. 실행은 mcp_config.command(설치된 앱)로 하므로
            // 실행 파일을 따로 넣지 않고 묶음에 반드시 있는 파일을 가리킨다
            "entry_point": MANIFEST,
            "mcp_config": { "command": command, "args": ["mcp"] }
        },
        "compatibility": { "platforms": [mcpb_platform(std::env::consts::OS)] }
    })
    .to_string()
}

/// mcpb 규격의 플랫폼 이름(Node의 process.platform 값)
fn mcpb_platform(os: &str) -> &str {
    match os {
        "macos" => "darwin",
        "windows" => "win32",
        other => other,
    }
}

pub fn bundle(command: &str, version: &str, author: &str) -> Vec<u8> {
    zip_one(MANIFEST, manifest(command, version, author).as_bytes())
}

const BUNDLE: &str = "Aru.mcpb";

/// 설치를 묻는 창이 앱을 다시 켤 때까지 열려 있는 일은 드물다. 그때 지워 캐시에 쌓아 두지 않는다
pub fn remove_bundle(dir: &Path) {
    let _ = std::fs::remove_file(dir.join(BUNDLE));
}

/// 두 번 빠르게 눌러도 Claude가 반쯤 쓴 파일을 열지 않게 임시 파일을 거쳐 바꾼다
pub fn write_bundle(dir: &Path, command: &str, version: &str, author: &str) -> Result<PathBuf, String> {
    let failed = |e: std::io::Error| format!("Claude에 넘길 확장 파일을 만들지 못했어요: {}", storage::io_message(&e));
    std::fs::create_dir_all(dir).map_err(failed)?;
    let file = dir.join(BUNDLE);
    storage::replace_file(&file, &bundle(command, version, author)).map_err(failed)?;
    Ok(file)
}

/// 압축하지 않은(stored) 파일 하나짜리 zip
pub fn zip_one(name: &str, data: &[u8]) -> Vec<u8> {
    let crc = crc32fast::hash(data);
    let (name, size) = (name.as_bytes(), data.len() as u32);
    let mut out = Vec::new();
    let header = |out: &mut Vec<u8>, sig: u32| {
        out.extend(sig.to_le_bytes());
        if sig == 0x0201_4b50 {
            out.extend(20u16.to_le_bytes()); // 만든 버전
        }
        out.extend(20u16.to_le_bytes()); // 풀 때 필요한 버전
        out.extend(0x0800u16.to_le_bytes()); // 파일 이름이 UTF-8
        out.extend(0u16.to_le_bytes()); // 압축 안 함
        out.extend(0u16.to_le_bytes()); // 수정 시각 00:00:00
        // 날짜 0은 월이 0이라 엄격한 해제 도구가 거절한다. 1980-01-01로 고정한다
        out.extend(0x0021u16.to_le_bytes());
        out.extend(crc.to_le_bytes());
        out.extend(size.to_le_bytes());
        out.extend(size.to_le_bytes());
        out.extend((name.len() as u16).to_le_bytes());
        out.extend(0u16.to_le_bytes()); // 추가 필드 길이
    };
    header(&mut out, 0x0403_4b50);
    out.extend(name);
    out.extend(data);
    let central = out.len() as u32;
    header(&mut out, 0x0201_4b50);
    out.extend([0u8; 10]); // 주석 길이·디스크 번호·내부 속성·외부 속성
    out.extend(0u32.to_le_bytes()); // 로컬 헤더 위치
    out.extend(name);
    let central_len = out.len() as u32 - central;
    out.extend(0x0605_4b50u32.to_le_bytes());
    out.extend([0u8; 4]); // 디스크 번호
    out.extend(1u16.to_le_bytes());
    out.extend(1u16.to_le_bytes());
    out.extend(central_len.to_le_bytes());
    out.extend(central.to_le_bytes());
    out.extend(0u16.to_le_bytes());
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_points_to_installed_aru() {
        let m: serde_json::Value = serde_json::from_str(&manifest("/Applications/Aru.app/Contents/MacOS/aru", "0.2.8", "조익현")).unwrap();
        assert_eq!(m["server"]["mcp_config"]["command"], "/Applications/Aru.app/Contents/MacOS/aru");
        assert_eq!(m["server"]["mcp_config"]["args"], serde_json::json!(["mcp"]));
        assert_eq!(m["version"], "0.2.8");
    }

    #[test]
    fn w8_지원_플랫폼은_실행_중인_os다() {
        let m: serde_json::Value = serde_json::from_str(&manifest(COMMAND, "0.2.8", "조익현")).unwrap();
        assert_eq!(m["compatibility"]["platforms"], serde_json::json!(["darwin"]));
        assert_eq!(mcpb_platform("macos"), "darwin");
        assert_eq!(mcpb_platform("windows"), "win32");
        assert_eq!(mcpb_platform("linux"), "linux");
    }

    #[test]
    fn zip_unpacks_with_system_unzip() {
        let dir = std::env::temp_dir().join(format!("aru-mcpb-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("aru.mcpb");
        std::fs::write(&file, zip_one("manifest.json", "{\"이름\":\"aru\"}".as_bytes())).unwrap();
        let out = std::process::Command::new("unzip").arg("-p").arg(&file).arg("manifest.json").output().unwrap();
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
        assert_eq!(String::from_utf8(out.stdout).unwrap(), "{\"이름\":\"aru\"}");
        let test = std::process::Command::new("unzip").arg("-t").arg(&file).output().unwrap();
        assert!(test.status.success());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("aru-mcpb-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    const COMMAND: &str = "/Applications/Aru.app/Contents/MacOS/aru";

    #[test]
    fn r9_q1_묶음을_풀면_매니페스트가_규격대로다() {
        let dir = scratch("q1");
        let file = dir.join("Aru.mcpb");
        std::fs::write(&file, bundle(COMMAND, "0.2.8", "조익현")).unwrap();
        let names = std::process::Command::new("unzip").arg("-Z1").arg(&file).output().unwrap();
        assert!(names.status.success());
        let names = String::from_utf8(names.stdout).unwrap();
        let out = std::process::Command::new("unzip").arg("-p").arg(&file).arg("manifest.json").output().unwrap();
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
        let m: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
        assert_eq!(m["manifest_version"], "0.3");
        assert_eq!(m["name"], "aru");
        assert_eq!(m["version"], "0.2.8");
        assert_eq!(m["author"]["name"], "조익현");
        assert!(m["description"].as_str().is_some_and(|d| !d.is_empty()));
        assert_eq!(m["server"]["type"], "binary");
        assert_eq!(m["server"]["mcp_config"]["command"], COMMAND);
        assert_eq!(m["server"]["mcp_config"]["args"], serde_json::json!(["mcp"]));
        let entry = m["server"]["entry_point"].as_str().unwrap();
        assert!(!std::path::Path::new(entry).is_absolute(), "entry_point가 묶음 밖 절대 경로다: {entry}");
        assert!(names.lines().any(|n| n == entry), "entry_point({entry})가 묶음 안에 없다: {names}");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn r9_n3_zip_날짜는_1980_01_01_고정이다() {
        let bytes = bundle(COMMAND, "0.2.8", "조익현");
        let date = |at: usize| u16::from_le_bytes([bytes[at], bytes[at + 1]]);
        assert_eq!(date(12), 0x0021, "로컬 헤더 날짜");
        let central = bytes.windows(4).position(|w| w == 0x0201_4b50u32.to_le_bytes()).unwrap();
        assert_eq!(date(central + 14), 0x0021, "중앙 디렉터리 날짜");
        let dir = scratch("n3-date");
        let file = dir.join("Aru.mcpb");
        std::fs::write(&file, &bytes).unwrap();
        let info = std::process::Command::new("unzip").arg("-ZT").arg(&file).output().unwrap();
        assert!(String::from_utf8_lossy(&info.stdout).contains("19800101.000000"), "{}", String::from_utf8_lossy(&info.stdout));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn r9_n3_확장_파일은_다_쓴_새_파일로_갈아_끼운다() {
        use std::os::unix::fs::MetadataExt;
        let dir = scratch("n3-atomic");
        std::fs::write(dir.join("Aru.mcpb"), "이전 파일").unwrap();
        let before = std::fs::metadata(dir.join("Aru.mcpb")).unwrap().ino();
        let file = write_bundle(&dir, COMMAND, "0.2.8", "조익현").unwrap();
        assert_ne!(std::fs::metadata(&file).unwrap().ino(), before, "같은 파일을 제자리에서 덮어썼다(반쯤 쓴 파일이 보일 수 있다)");
        assert_eq!(std::fs::read(&file).unwrap(), bundle(COMMAND, "0.2.8", "조익현"));
        let left: Vec<_> = std::fs::read_dir(&dir).unwrap().flatten().map(|e| e.file_name()).collect();
        assert_eq!(left, vec![std::ffi::OsString::from("Aru.mcpb")], "임시 파일이 남았다");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn r9_ac5_확장_파일을_못_만들면_까닭을_한국어로_알린다() {
        use std::os::unix::fs::PermissionsExt;
        let base = scratch("ac5");
        std::fs::set_permissions(&base, std::fs::Permissions::from_mode(0o555)).unwrap();
        let e = write_bundle(&base.join("cache"), COMMAND, "0.2.8", "조익현").unwrap_err();
        std::fs::set_permissions(&base, std::fs::Permissions::from_mode(0o755)).unwrap();
        std::fs::remove_dir_all(&base).unwrap();
        assert!(e.starts_with("Claude에 넘길 확장 파일을 만들지 못했어요: 권한이 없어요"), "{e}");
    }

    #[test]
    fn r10_지난번에_만든_확장_파일은_다음_실행_때_지운다() {
        let dir = scratch("r10-leftover");
        let file = write_bundle(&dir, COMMAND, "0.2.8", "조익현").unwrap();
        remove_bundle(&dir);
        assert!(!file.exists(), "확장 파일이 캐시에 계속 남는다");
        remove_bundle(&dir.join("없는 폴더"));
    }
}
