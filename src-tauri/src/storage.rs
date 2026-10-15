use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};

pub fn read_text(root: &Path, rel: &str) -> Result<Option<String>, String> {
    let path = resolve(root, rel)?;
    match fs::read_to_string(&path) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// 임시 파일에 다 쓴 뒤 이름을 바꿔 교체한다. 쓰는 도중 앱이 꺼져도 원래 파일은 온전하다.
/// 내용이 비면 빈 파일을 남기지 않고 지운다
pub fn write_text(root: &Path, rel: &str, content: &str) -> Result<(), String> {
    let path = resolve(root, rel)?;
    if content.is_empty() {
        return match fs::remove_file(&path) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
            _ => Ok(()),
        };
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("tmp");
    let mut file = fs::File::create(&tmp).map_err(|e| e.to_string())?;
    file.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

/// 저장 폴더 밖을 가리키는 경로(절대 경로, ..)는 거부한다
fn resolve(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel_path = Path::new(rel);
    if rel_path.components().any(|c| !matches!(c, Component::Normal(_))) {
        return Err(format!("허용되지 않는 경로: {rel}"));
    }
    Ok(root.join(rel_path))
}

/// 새 저장 폴더가 비어 있으면 지금까지의 할 일을 복사해 둔다. 이미 할 일이 있는 폴더(다른 컴퓨터와 동기화 중인 폴더)는 건드리지 않는다
pub fn copy_into_if_empty(from: &Path, to: &Path) -> Result<bool, String> {
    // 설정은 할 일과 따로 본다. 새 폴더에 설정이 없으면 지금 설정(투명도·핀·미완료 처리)을 가져간다
    if read_text(to, "settings.json")?.is_none() {
        if let Some(content) = read_text(from, "settings.json")? {
            write_text(to, "settings.json", &content)?;
        }
    }
    if to.join("daily").exists() || to.join("someday.md").exists() {
        return Ok(false);
    }
    for name in ["someday.md"] {
        if let Some(content) = read_text(from, name)? {
            write_text(to, name, &content)?;
        }
    }
    let daily = from.join("daily");
    if daily.is_dir() {
        for entry in fs::read_dir(&daily).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.ends_with(".md") {
                continue;
            }
            let rel = format!("daily/{name}");
            if let Some(content) = read_text(from, &rel)? {
                write_text(to, &rel, &content)?;
            }
        }
    }
    Ok(true)
}

/// 앱 ID가 바뀌면 데이터 폴더 이름도 바뀐다. 새 폴더가 아직 없을 때만 옛 폴더를 통째로 옮긴다
pub fn move_legacy_dir(old: &Path, new: &Path) -> Result<bool, String> {
    if !old.is_dir() || new.exists() {
        return Ok(false);
    }
    if let Some(parent) = new.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::rename(old, new).map_err(|e| e.to_string())?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("aru-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn 없는_파일을_읽으면_none이다() {
        let root = temp_root("missing");
        assert_eq!(read_text(&root, "daily/2026-10-14.md").unwrap(), None);
    }

    #[test]
    fn 쓴_내용을_그대로_읽는다_하위_폴더도_만든다() {
        let root = temp_root("roundtrip");
        write_text(&root, "daily/2026-10-14.md", "- [ ] 장보기\n").unwrap();
        assert_eq!(read_text(&root, "daily/2026-10-14.md").unwrap().as_deref(), Some("- [ ] 장보기\n"));
    }

    #[test]
    fn 덮어쓰면_새_내용만_남고_임시_파일은_없다() {
        let root = temp_root("overwrite");
        write_text(&root, "someday.md", "옛 내용\n").unwrap();
        write_text(&root, "someday.md", "새 내용\n").unwrap();
        assert_eq!(read_text(&root, "someday.md").unwrap().as_deref(), Some("새 내용\n"));
        assert!(!root.join("someday.tmp").exists());
    }

    #[test]
    fn 빈_새_폴더로는_할_일_파일을_복사한다() {
        let from = temp_root("copy-from");
        let to = temp_root("copy-to");
        write_text(&from, "daily/2026-10-14.md", "- [ ] 하나\n").unwrap();
        write_text(&from, "someday.md", "- [ ] 둘\n").unwrap();
        write_text(&from, "settings.json", "{}\n").unwrap();

        assert!(copy_into_if_empty(&from, &to).unwrap());
        assert_eq!(read_text(&to, "daily/2026-10-14.md").unwrap().as_deref(), Some("- [ ] 하나\n"));
        assert_eq!(read_text(&to, "someday.md").unwrap().as_deref(), Some("- [ ] 둘\n"));
        assert_eq!(read_text(&to, "settings.json").unwrap().as_deref(), Some("{}\n"));
    }

    #[test]
    fn 이미_할_일이_있는_폴더에는_복사하지_않는다() {
        let from = temp_root("copy-from2");
        let to = temp_root("copy-to2");
        write_text(&from, "someday.md", "- [ ] 여기 것\n").unwrap();
        write_text(&to, "someday.md", "- [ ] 저기 것\n").unwrap();

        assert!(!copy_into_if_empty(&from, &to).unwrap());
        assert_eq!(read_text(&to, "someday.md").unwrap().as_deref(), Some("- [ ] 저기 것\n"));
    }

    #[test]
    fn 할_일이_있는_폴더라도_설정이_없으면_지금_설정을_가져간다() {
        let from = temp_root("copy-from3");
        let to = temp_root("copy-to3");
        write_text(&from, "settings.json", "{\"opacity\": 40}\n").unwrap();
        write_text(&to, "someday.md", "- [ ] 저기 것\n").unwrap();
        copy_into_if_empty(&from, &to).unwrap();
        assert_eq!(read_text(&to, "settings.json").unwrap().as_deref(), Some("{\"opacity\": 40}\n"));

        write_text(&from, "settings.json", "{\"opacity\": 90}\n").unwrap();
        copy_into_if_empty(&from, &to).unwrap();
        assert_eq!(read_text(&to, "settings.json").unwrap().as_deref(), Some("{\"opacity\": 40}\n"));
    }

    #[test]
    fn 빈_내용을_쓰면_파일을_지운다() {
        let root = temp_root("empty");
        write_text(&root, "daily/2026-10-14.md", "- [ ] 하나\n").unwrap();
        write_text(&root, "daily/2026-10-14.md", "").unwrap();
        assert!(!root.join("daily/2026-10-14.md").exists());
        write_text(&root, "daily/2026-10-15.md", "").unwrap();
    }

    #[test]
    fn 저장_폴더_밖을_가리키는_경로는_거부한다() {
        let root = temp_root("escape");
        assert!(write_text(&root, "../escape.md", "x").is_err());
        assert!(read_text(&root, "/etc/hosts").is_err());
    }

    #[test]
    fn 옛_폴더만_있으면_새_이름으로_옮긴다() {
        let base = temp_root("legacy-move");
        write_text(&base.join("old"), "daily/2026-10-14.md", "- [ ] 하나\n").unwrap();
        assert!(move_legacy_dir(&base.join("old"), &base.join("new")).unwrap());
        assert!(!base.join("old").exists());
        assert_eq!(read_text(&base.join("new"), "daily/2026-10-14.md").unwrap().as_deref(), Some("- [ ] 하나\n"));
    }

    #[test]
    fn 새_폴더가_이미_있으면_옛_폴더를_건드리지_않는다() {
        let base = temp_root("legacy-both");
        write_text(&base.join("old"), "someday.md", "- [ ] 옛\n").unwrap();
        write_text(&base.join("new"), "someday.md", "- [ ] 새\n").unwrap();
        assert!(!move_legacy_dir(&base.join("old"), &base.join("new")).unwrap());
        assert_eq!(read_text(&base.join("old"), "someday.md").unwrap().as_deref(), Some("- [ ] 옛\n"));
        assert_eq!(read_text(&base.join("new"), "someday.md").unwrap().as_deref(), Some("- [ ] 새\n"));
    }

    #[test]
    fn 옛_폴더가_없으면_아무것도_하지_않는다() {
        let base = temp_root("legacy-none");
        assert!(!move_legacy_dir(&base.join("old"), &base.join("new")).unwrap());
        assert!(!base.join("new").exists());
    }
}
