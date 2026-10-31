use std::ffi::OsStr;
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant, SystemTime};

mod sys;
use sys::{open_lock, open_regular, rename_excl, volume_uuid};

const LOCK_FILE: &str = ".aru.lock";
/// location.json을 고치는 쪽(폴더 변경·초기화·낡은 bookmark 갱신)끼리 줄 세우는 잠금. 저장 폴더 잠금과 다른 이름이어야 한다 —
/// 맥에서는 설정 폴더가 곧 기본 저장 폴더라, 같은 파일이면 폴더 변경이 옛 폴더를 잠글 때 자기 잠금에 막힌다
const CONFIG_LOCK_FILE: &str = ".aru-location.lock";

/// 잠금을 못 잡았을 때 오류의 앞부분. 앱 화면은 이 글자로 "잠시 뒤 다시 저장"을 판단한다
pub const LOCKED: &str = "저장 폴더가 잠겨 있어요";
/// 앱은 오래 기다리지 않고 실패를 돌려준다. 화면의 자동 저장이 곧 다시 시도한다
pub const APP_LOCK_WAIT: Duration = Duration::from_secs(3);
pub const CLI_LOCK_WAIT: Duration = Duration::from_secs(10);

/// 저장 폴더 단위 쓰기 잠금. 놓으면(drop) 풀린다. None이면 잠금을 지원하지 않는 폴더라 잠그지 않은 것이다
pub struct RootLock(#[allow(dead_code)] Option<fs::File>);

/// 앱과 aru 명령(여러 프로세스)이 같은 파일을 읽고-고치고-쓰는 사이에 끼어들지 못하게 한다.
/// 한 프로세스 안에서 두 번 잡으면 스스로 막히므로, 잡은 쪽은 write_text만 부르고 다시 잡지 않는다.
/// 멈춘(Ctrl+Z) aru가 잠금을 쥐고 있어도 끝없이 기다리지 않게 wait 동안만 다시 시도한다
pub fn lock_root(root: &Path, wait: Duration) -> Result<RootLock, String> {
    let lock = lock_named(root, LOCK_FILE, "저장 폴더", wait)?;
    // 저장 폴더로 쓰이는 폴더의 복사 표지는 끝난(commit된) 복사가 지우지 못한 것이다. 두면 나중에 그 출처에서 바꿀 때
    // "이어 하기"로 여기서 고친 것을 덮는다. 복사 중인 새 폴더는 아직 저장 폴더가 아니라 여기로 오지 않는다
    let _ = fs::remove_file(root.join(COPYING_MARKER));
    Ok(lock)
}

/// 다른 쪽(폴더를 바꾸는 중)이 설정 폴더 잠금을 쥐고 있을 때의 오류 앞부분
pub const CONFIG_LOCKED: &str = "폴더 설정이 잠겨 있어요";

pub fn lock_config(config: &Path, wait: Duration) -> Result<RootLock, String> {
    lock_named(config, CONFIG_LOCK_FILE, "Aru 설정 폴더", wait)
}

fn lock_named(dir: &Path, name: &str, place: &str, wait: Duration) -> Result<RootLock, String> {
    let denied = |e: std::io::Error| format!("{place}에 쓸 수 없어요: {}", io_message(&e));
    fs::create_dir_all(dir).map_err(denied)?;
    let path = dir.join(name);
    let file = open_lock(&path).map_err(|e| match e {
        Some(e) => denied(e),
        None => format!("{place}에 쓸 수 없어요: 잠금 파일({name})이 일반 파일이 아니에요(링크·특수 파일). 그 파일을 지우고 다시 시도해 주세요 ({})", path.display()),
    })?;
    let busy = || match name {
        LOCK_FILE => format!("{LOCKED}: 다른 프로그램(aru 명령 등)이 쓰는 중이에요. 잠시 뒤 다시 시도해 주세요 ({})", dir.display()),
        _ => format!("{CONFIG_LOCKED}: 저장 폴더를 바꾸거나 되돌리는 작업이 아직 끝나지 않았어요. 잠시 뒤 다시 시도해 주세요"),
    };
    acquire(file, place, wait, busy, |f| f.try_lock())
}

/// 폴더를 바꾸는 쪽(set_data_root)은 옛 폴더의 잠금을 쥔 채 location.json을 고친다. 그 잠금을 기다리던 저장이
/// 풀리자마자 옛 폴더에 쓰지 않게, 잡은 뒤 저장 폴더를 다시 확인하고 바뀌었으면 새 폴더로 다시 잡는다
pub fn lock_current(resolve: impl Fn() -> Result<PathBuf, String>, wait: Duration) -> Result<(PathBuf, RootLock), String> {
    lock_current_moved(resolve, wait).map(|(root, lock, _)| (root, lock))
}

/// lock_current에 더해, 잠그기 전 처음 찾은 폴더와 잡은 뒤의 폴더가 다른지(moved)도 알려 준다
pub fn lock_current_moved(resolve: impl Fn() -> Result<PathBuf, String>, wait: Duration) -> Result<(PathBuf, RootLock, bool), String> {
    let first = resolve()?;
    let mut root = first.clone();
    for _ in 0..8 {
        let lock = lock_root(&root, wait)?;
        let now = resolve()?;
        if now == root {
            let moved = root != first;
            return Ok((root, lock, moved));
        }
        root = now;
    }
    Err(format!("{LOCKED}: 저장 폴더를 바꾸는 중이에요. 잠시 뒤 다시 시도해 주세요"))
}

fn acquire(
    file: fs::File,
    place: &str,
    wait: Duration,
    busy: impl Fn() -> String,
    mut try_lock: impl FnMut(&fs::File) -> Result<(), fs::TryLockError>,
) -> Result<RootLock, String> {
    let deadline = Instant::now() + wait;
    loop {
        match try_lock(&file) {
            Ok(()) => return Ok(RootLock(Some(file))),
            // 잠금 데몬 없는 NFS·일부 SMB·macFUSE(Cryptomator 등)는 flock을 거부한다.
            // 잠금 때문에 저장이 전부 막히는 것보다, 잠그지 않고 예전처럼 쓰는 편이 낫다(동시 쓰기 보호만 빠진다)
            Err(fs::TryLockError::Error(e)) if sys::lock_unsupported(&e) => return Ok(RootLock(None)),
            Err(fs::TryLockError::Error(e)) => return Err(format!("{place}에 쓸 수 없어요: {}", io_message(&e))),
            Err(fs::TryLockError::WouldBlock) if Instant::now() >= deadline => return Err(busy()),
            Err(fs::TryLockError::WouldBlock) => std::thread::sleep(Duration::from_millis(20)),
        }
    }
}

pub fn read_text(root: &Path, rel: &str) -> Result<Option<String>, String> {
    let path = resolve(root, rel)?;
    match read_settled(&path) {
        Ok(None) => Ok(None),
        Ok(Some(bytes)) => String::from_utf8(bytes).map(Some).map_err(|_| UNDECODABLE.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::InvalidData => Err(UNDECODABLE.to_string()),
        Err(e) => Err(format!("읽지 못했어요: {}", io_message(&e))),
    }
}

/// 폴더 안 이름들(순서 없음). 폴더가 없으면 빈 목록. 이름을 글로 풀 수 없는 항목은 뺀다
pub fn list_names(root: &Path, rel: &str) -> Result<Vec<String>, String> {
    let dir = resolve(root, rel)?;
    let entries = match fs::read_dir(&dir) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        r => r.map_err(|e| format!("읽지 못했어요: {}", io_message(&e)))?,
    };
    let mut names = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| format!("읽지 못했어요: {}", io_message(&e)))?;
        if let Ok(name) = entry.file_name().into_string() {
            names.push(name);
        }
    }
    Ok(names)
}

const READ_TRIES: u32 = 50;

/// 하드링크로 묶인 파일은 제자리에 고쳐 쓰므로(write_in_place) 쓰는 도중 읽으면 비었거나 잘린 내용이 보인다.
/// 잠금은 쓰지 않는다 — 읽기 전용 폴더에서는 잠금 파일을 만들 수 없고, 쓰는 쪽이 잠금을 오래 쥐면 읽기까지 막힌다.
/// 대신 연 파일의 크기·수정 시각·inode 변경 시각을 읽기 앞뒤로 비교해, 그 사이 바뀌었거나 읽은 길이가 크기와 다르면 다시 읽는다.
/// 우리 쓰기는 빈 내용이면 파일을 지우므로, 하드링크 파일이 비어 보이면 잘라 낸 직후(truncate와 write 사이)일 수 있어 한 번 더 본다
fn read_settled(path: &Path) -> std::io::Result<Option<Vec<u8>>> {
    let mut last = None;
    for _ in 0..READ_TRIES {
        let Some(mut file) = open_regular(path)? else { return Ok(None) };
        let before = sys::stamp(&file)?;
        let bytes = read_capped(&mut file, before.len)?;
        let after = sys::stamp(&file)?;
        let settled = before.same(&after) && bytes.len() as u64 == after.len;
        if settled && !(bytes.is_empty() && after.links > 1) {
            return Ok(Some(bytes));
        }
        last = settled.then_some(bytes);
        std::thread::sleep(Duration::from_millis(2));
    }
    // 정말 빈 하드링크 파일이면 여기까지 온다. 계속 바뀌기만 하면 잘린 내용을 주느니 실패로 알린다
    last.map(Some).ok_or_else(|| std::io::Error::from_raw_os_error(sys::EAGAIN))
}

/// 할 일·설정 파일로 볼 수 있는 크기의 상한. 크기만큼 미리 잡으면 거대한 희소 파일에서 할당이 실패해 프로세스가 죽는다
pub const MAX_READ: u64 = 64 * 1024 * 1024;

fn read_capped(file: &mut fs::File, size: u64) -> std::io::Result<Vec<u8>> {
    use std::io::Read;
    let too_big = || std::io::Error::from_raw_os_error(sys::EFBIG);
    if size > MAX_READ {
        return Err(too_big());
    }
    let mut bytes = Vec::new();
    bytes.try_reserve_exact(size as usize).map_err(|_| std::io::Error::from_raw_os_error(sys::ENOMEM))?;
    // 크기 확인 뒤에 늘어난 파일도 상한에서 멈춘다
    file.take(MAX_READ + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_READ {
        return Err(too_big());
    }
    Ok(bytes)
}

/// 저장 폴더 밖 파일(location.json·최근 추가 기록 등)도 같은 규칙으로 읽는다. 없으면 None
pub fn read_file(path: &Path) -> std::io::Result<Option<Vec<u8>>> {
    let Some(mut file) = open_regular(path)? else { return Ok(None) };
    let size = file.metadata()?.len();
    read_capped(&mut file, size).map(Some)
}

#[derive(Debug, PartialEq)]
pub enum Swap {
    Written,
    /// 알던 내용과 달라 쓰지 않았다. 지금 파일 내용(없으면 None)
    Conflict(Option<String>),
}

/// expected가 있으면 지금 파일(없으면 빈 내용)이 그와 같을 때만 쓴다. 부르는 쪽이 lock_root를 잡고 있어야 한다.
/// 앱은 읽고-고치고-쓰기를 화면에서 하므로, 그 사이 aru 명령이 넣은 줄을 덮지 않으려면 쓰는 순간에 확인해야 한다
pub fn write_text_if(root: &Path, rel: &str, content: &str, expected: Option<&str>) -> Result<Swap, String> {
    if let Some(expected) = expected {
        let current = read_text(root, rel)?;
        if current.as_deref().unwrap_or("") != expected {
            return Ok(Swap::Conflict(current));
        }
    }
    write_text(root, rel, content)?;
    Ok(Swap::Written)
}

/// 임시 파일에 다 쓴 뒤 이름을 바꿔 교체한다. 쓰는 도중 앱이 꺼져도 원래 파일은 온전하다.
/// 내용이 비면 빈 파일을 남기지 않고 지운다
pub fn write_text(root: &Path, rel: &str, content: &str) -> Result<(), String> {
    let path = resolve(root, rel)?;
    // 읽기 상한을 넘게 쓰면 그 파일을 앱·aru 명령 어디서도 다시 읽지 못한다
    if content.len() as u64 > MAX_READ {
        return Err("저장하지 못했어요: 파일이 64MB를 넘게 되어요. 끝낸 일을 정리하거나 나눠 주세요".into());
    }
    if let Some(parent) = path.parent() {
        remove_stale_temps(root, parent);
    }
    // 사용자가 심링크로 둔 파일은 링크를 일반 파일로 바꾸지 않고 가리키는 파일을 고친다
    if fs::symlink_metadata(&path).is_ok_and(|m| m.file_type().is_symlink()) {
        let target = follow_links(&path)?;
        // 끊어진 링크가 마운트되지 않은 디스크를 가리킬 때 폴더를 만들면, 마운트 지점 아래에 쌓여 나중에 가려진다
        if !target.parent().is_some_and(Path::is_dir) {
            return Err(format!("저장하지 못했어요: 심링크가 가리키는 폴더가 없어요 ({})", target.display()));
        }
        return write_file(&target, content, false);
    }
    if content.is_empty() {
        if let Ok(meta) = fs::metadata(&path) {
            refuse_read_only(&path, &meta)?;
        }
        return match fs::remove_file(&path) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(write_error(e)),
            _ => Ok(()),
        };
    }
    write_file(&path, content, true)
}

/// 경로 그대로(저장 폴더 밖 설정 파일 등) 원자적으로 쓴다
pub fn write_atomic(path: &Path, content: &str) -> Result<(), String> {
    write_file(path, content, true)
}

/// 사용자가 일부러 읽기 전용으로 둔 파일이다. 이름을 바꿔 교체하면 권한과 상관없이 써져 버린다
fn refuse_read_only(path: &Path, meta: &fs::Metadata) -> Result<(), String> {
    if meta.is_file() && meta.permissions().readonly() {
        return Err(format!("저장하지 못했어요: 읽기 전용 파일이에요. {} 다시 저장해요 ({})", sys::READ_ONLY_FIX, path.display()));
    }
    Ok(())
}

fn write_file(path: &Path, content: &str, make_parent: bool) -> Result<(), String> {
    let parent = path.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new("."));
    let name = path.file_name().ok_or_else(|| format!("저장하지 못했어요: 허용되지 않는 경로예요 ({})", path.display()))?;
    if make_parent {
        fs::create_dir_all(parent).map_err(write_error)?;
    }
    let existing = fs::metadata(path).ok();
    if let Some(meta) = &existing {
        refuse_read_only(path, meta)?;
        // 하드링크로 묶인 파일은 이름을 바꿔 교체하면 다른 쪽 이름이 옛 내용에 남는다(백업·다른 앱과 갈라진다).
        // 원자성보다 링크를 지키는 쪽을 택해 제자리에 쓴다
        if meta.is_file() && sys::links(path, meta) > 1 {
            return write_in_place(path, content);
        }
    }
    replace_via_temp(parent, name, |f| f.write_all(content.as_bytes()), existing.as_ref().map(|m| (path, m)), false).map_err(write_error)
}

/// 같은 폴더의 임시 파일에 다 쓴 뒤 이름을 바꿔 교체한다. keep이 있으면 원래 파일의 권한·확장 속성을 옮긴다.
/// only_new면 이름이 이미 있을 때 EEXIST로 실패한다.
/// 폴더 기준(*at)으로 만들고 바꾼다. 전체 경로가 PATH_MAX에 닿아도 임시 이름 길이만 따지게 된다
fn replace_via_temp(
    parent: &Path,
    name: &OsStr,
    fill: impl FnOnce(&mut fs::File) -> std::io::Result<()>,
    keep: Option<(&Path, &fs::Metadata)>,
    only_new: bool,
) -> std::io::Result<()> {
    let dir = sys::Dir::open(parent)?;
    let (tmp, mut file) = create_temp(&dir, name)?;
    let written = (|| {
        fill(&mut file)?;
        if let Some((original, meta)) = keep {
            keep_metadata(original, meta, &file);
        }
        file.sync_all()?;
        drop(file);
        if only_new && fs::symlink_metadata(parent.join(name)).is_ok() {
            return Err(std::io::Error::from_raw_os_error(sys::EEXIST));
        }
        dir.rename_in(&tmp, name)
    })();
    if written.is_err() {
        let _ = dir.unlink_in(&tmp);
    }
    written
}

/// 다른 앱이 이 이름을 바로 열 수 있을 때 쓴다. 반쯤 쓴 파일이 보이지 않는다
pub fn replace_file(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let name = path.file_name().ok_or(std::io::ErrorKind::InvalidInput)?;
    replace_via_temp(path.parent().unwrap_or(Path::new(".")), name, |f| f.write_all(bytes), None, false)
}

fn write_in_place(path: &Path, content: &str) -> Result<(), String> {
    let mut file = fs::OpenOptions::new().write(true).truncate(true).open(path).map_err(write_error)?;
    file.write_all(content.as_bytes()).and_then(|_| file.sync_all()).map_err(write_error)
}

/// 이름을 바꿔 교체하면 새 파일에는 umask 권한만 남고 확장 속성(Finder 태그 등)·ACL이 사라진다.
/// 옮길 수 없는 디스크(SMB·NFS·FAT)에서 실패해도 내용 저장은 막지 않는다
/// 일반 파일일 때만 연다. FIFO는 열면 상대가 열 때까지 멈추는데, 부르는 쪽은 저장 폴더 잠금을 쥐고 있다
fn keep_metadata(original: &Path, meta: &fs::Metadata, tmp: &fs::File) {
    if !meta.is_file() {
        return;
    }
    sys::copy_meta(original, meta, tmp);
    let _ = tmp.set_permissions(meta.permissions());
}

/// 링크가 가리키는 마지막 경로. 대상이 없어도(끊어진 링크) 그 경로를 돌려줘서 그 자리에 파일을 만든다
fn follow_links(path: &Path) -> Result<PathBuf, String> {
    let mut path = path.to_path_buf();
    for _ in 0..40 {
        match fs::symlink_metadata(&path) {
            Ok(m) if m.file_type().is_symlink() => {
                let target = fs::read_link(&path).map_err(write_error)?;
                path = match path.parent() {
                    Some(parent) if target.is_relative() => parent.join(target),
                    _ => target,
                };
            }
            _ => return Ok(path),
        }
    }
    Err(format!("심링크가 너무 여러 번 이어져 있어요: {}", path.display()))
}

/// 우리 임시 파일만 알아볼 수 있게 붙이는 표지. 사용자 파일과 겹치지 않을 이름이어야 정리할 때 지워도 된다
const TEMP_PREFIX: &str = ".aru-tmp-";

/// `.aru-tmp-{pid}-{순번}.{이름 앞 32바이트}.tmp`. 폴더 기준으로 만들어 길이는 이름 한도(255)만 따진다.
/// O_EXCL·O_NOFOLLOW라 같은 이름이 있으면 덮지 않고 다음 순번으로 넘어간다
fn create_temp(dir: &sys::Dir, name: &OsStr) -> std::io::Result<(String, fs::File)> {
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let name = name.to_string_lossy();
    let mut cut = name.len().min(32);
    while !name.is_char_boundary(cut) {
        cut -= 1;
    }
    loop {
        let token = format!("{}-{}", base36(std::process::id() as u64), base36(SEQ.fetch_add(1, Ordering::Relaxed)));
        let tmp = format!("{TEMP_PREFIX}{token}.{}.tmp", &name[..cut]);
        match dir.create_new(&tmp) {
            Ok(file) => return Ok((tmp, file)),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        }
    }
}

fn base36(mut n: u64) -> String {
    let mut out = Vec::new();
    loop {
        out.push(b"0123456789abcdefghijklmnopqrstuvwxyz"[(n % 36) as usize]);
        n /= 36;
        if n == 0 {
            break;
        }
    }
    out.reverse();
    String::from_utf8(out).unwrap_or_default()
}

const STALE_TEMP: Duration = Duration::from_secs(3600);
/// 시계가 빠른 다른 맥이 동기화 폴더에서 지금 쓰는 임시 파일은 미래 시각으로 보인다. 미래 쪽은 하루를 넘겨야 버려진 것으로 본다
const STALE_FUTURE: Duration = Duration::from_secs(24 * 3600);

/// 쓰는 도중 앱이 죽으면 임시 파일이 남는다(이름이 매번 달라 쌓인다). 한 시간 넘은 것만 지운다 —
/// 지금 다른 프로세스가 쓰는 중인 임시 파일을 지우지 않게. 심링크로 이어진 저장 폴더 밖은 사용자 공간이라 손대지 않는다
fn remove_stale_temps(root: &Path, dir: &Path) {
    let (Ok(root), Ok(dir)) = (fs::canonicalize(root), fs::canonicalize(dir)) else { return };
    if !dir.starts_with(&root) {
        return;
    }
    if dir == root {
        remove_stale_leftovers(&dir);
    }
    let Ok(entries) = fs::read_dir(&dir) else { return };
    let now = SystemTime::now();
    for entry in entries.flatten() {
        if !is_our_temp(&entry.file_name().to_string_lossy()) || !entry.file_type().is_ok_and(|t| t.is_file()) {
            continue;
        }
        if is_stale(&entry, now) {
            let _ = fs::remove_file(entry.path());
        }
    }
}

/// create_temp가 만드는 이름만 알아본다: 표지 뒤에 `{pid}-{순번}`(소문자 36진수)이 오고 끝나거나 `.`이 이어진다
fn is_our_temp(name: &str) -> bool {
    let Some(rest) = name.strip_prefix(TEMP_PREFIX) else { return false };
    is_pid_seq(rest.split('.').next().unwrap_or_default())
}

/// `{pid}-{순번}`(소문자 36진수) 모양인가. 우리가 만든 이름에만 붙는다
fn is_pid_seq(token: &str) -> bool {
    let parts: Vec<&str> = token.split('-').collect();
    parts.len() == 2 && parts.iter().all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit() || b.is_ascii_lowercase()))
}

/// 수정 시각이 아주 먼 미래여도(시계가 틀린 맥·디스크에서 만들어짐) 지운다. 아니면 영영 지워지지 않는다
fn is_stale(entry: &fs::DirEntry, now: SystemTime) -> bool {
    entry.metadata().and_then(|m| m.modified()).is_ok_and(|t| match now.duration_since(t) {
        Ok(age) => age > STALE_TEMP,
        Err(ahead) => ahead.duration() > STALE_FUTURE,
    })
}

/// 복사하거나 쓰기를 확인하던 중 앱이 죽으면 `.aru-staging-*` 폴더와 `.aru-write-check-*` 파일이 남는다.
/// 동기화 폴더(iCloud·Dropbox)면 할 일 사본이 클라우드에 계속 남으므로, 한 시간 넘은 우리 이름만 지운다.
/// file_type은 링크를 따라가지 않으므로 같은 이름의 링크 너머는 건드리지 않는다
fn remove_stale_leftovers(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    let now = SystemTime::now();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let Ok(kind) = entry.file_type() else { continue };
        let staging = kind.is_dir() && name.strip_prefix(STAGING_PREFIX).is_some_and(is_pid_seq);
        let probe = kind.is_file() && name.strip_prefix(PROBE_FILE).and_then(|r| r.strip_prefix('-')).is_some_and(is_pid_seq);
        if (staging || probe) && is_stale(&entry, now) {
            let _ = if staging { fs::remove_dir_all(entry.path()) } else { fs::remove_file(entry.path()) };
        }
    }
}

/// 깨진 파일을 옆에 보관할 이름. 앞서 보관한 것을 덮지 않게 시각과 순번을 붙인다(`이름.{밀리초}.bad`)
pub fn quarantine_path(file: &Path) -> PathBuf {
    let millis = SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let name = file.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    (0..)
        .map(|n| file.with_file_name(if n == 0 { format!("{name}.{millis}.bad") } else { format!("{name}.{millis}-{n}.bad") }))
        .find(|p| fs::symlink_metadata(p).is_err())
        .unwrap_or_else(|| file.with_file_name(format!("{name}.bad")))
}

/// 저장 폴더 밖을 가리키는 경로(절대 경로, ..)는 거부한다
fn resolve(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel_path = Path::new(rel);
    if rel_path.components().any(|c| !matches!(c, Component::Normal(_))) {
        return Err(format!("허용되지 않는 경로: {rel}"));
    }
    Ok(root.join(rel_path))
}

/// 새 저장 폴더가 비어 있으면 지금까지의 할 일을 복사해 두고 commit(location.json 기록)을 부른다.
/// 이미 할 일이 있는 폴더(다른 컴퓨터와 동기화 중인 폴더)는 건드리지 않는다.
/// 복사는 한 덩어리다: 새 폴더 안의 임시 폴더에 다 복사한 뒤 제자리로 옮기고, 도중에 실패하거나 commit이 실패하면
/// 옮긴 것까지 지워 새 폴더를 처음 그대로 둔다. 일부만 복사된 채 남으면 다시 시도할 때 "이미 할 일이 있는 폴더"로 보여 나머지를 잃는다.
/// 제자리로 옮기는 도중 앱이 꺼지는 것은 막을 수 없어서, 그동안 표지(COPYING_MARKER)에 출처 아이디와 새 폴더에 둔 파일 목록을 적어 둔다.
/// 표지는 그 폴더를 저장 폴더로 쓰기 직전(commit 전)에 언제나 지우므로, 같은 출처의 표지가 남은 폴더는 아직 아무도 쓴 적이 없다.
/// 그래서 이어 할 때는 지금 원본이 정답이다: 목록의 파일을 모두 지우고 지금 원본을 다시 옮긴다(그 사이 고친 것·지운 날짜까지 맞춰진다)
pub fn copy_into_if_empty(from: &Path, to: &Path, commit: impl FnOnce() -> Result<(), String>) -> Result<bool, String> {
    copy_into_with(from, to, commit, rename_excl)
}

fn copy_into_with(from: &Path, to: &Path, commit: impl FnOnce() -> Result<(), String>, rename_excl: fn(&Path, &Path) -> std::io::Result<()>) -> Result<bool, String> {
    // 끊어진 링크라도 사용자가 둔 것이니 있는 것으로 본다
    let present = |name: &str| fs::symlink_metadata(to.join(name)).is_ok();
    let unreadable = |e: std::io::Error| format!("지금 할 일 폴더를 읽지 못했어요: {}", io_message(&e));
    let marker = to.join(COPYING_MARKER);
    // 다른 출처(동기화된 다른 맥, 다른 폴더)의 표지면 이어 하지 않는다. 이어 하면 두 곳의 할 일이 섞인다.
    // 새 폴더의 할 일이 표지에 적은 것과 하나라도 다르면(still_ours) 그 사이 남이 둔 것이라 이어 하지 않는다 — 이어 하면 덮거나 섞는다
    let prior = read_marker(&marker)?
        .filter(|m| source_id(from).is_some_and(|id| id == m.source))
        .filter(|m| still_ours(to, &m.files))
        .map(|m| m.files);
    let resuming = prior.is_some();
    let prior = prior.unwrap_or_default();
    let in_prior: HashSet<&str> = prior.iter().map(|e| e.name.as_str()).collect();
    let bring_todos = resuming || (!present("daily") && !present("someday.md"));
    let mut files = Vec::new();
    // 설정은 할 일과 따로 본다. 새 폴더에 설정이 없으면 지금 설정(투명도·핀·미완료 처리)을 가져간다
    if from.join("settings.json").is_file() {
        files.push("settings.json".to_string());
    }
    if bring_todos {
        if from.join("someday.md").is_file() {
            files.push("someday.md".to_string());
        }
        let daily = from.join("daily");
        if daily.is_dir() {
            for entry in fs::read_dir(&daily).map_err(unreadable)? {
                let name = entry.map_err(unreadable)?.file_name();
                let name = name.to_string_lossy();
                if name.ends_with(".md") && !is_apple_double(name.as_ref()) && daily.join(name.as_ref()).is_file() {
                    files.push(format!("daily/{name}"));
                }
            }
        }
    }
    // 우리가 둔 파일은 있어도 원본으로 갈아 끼운다. 남이 둔 것은 건드리지 않는다
    files.retain(|rel| in_prior.contains(rel.as_str()) || !present(rel));
    let mut placed = Placed::default();
    let mut wrote_marker = false;
    // 처음 복사를 다 되돌렸으면 표지를 지운다. 그때 새 폴더에 남은 daily·someday는 그 사이 들어온 남의 것인데,
    // 표지를 두면 다시 시도할 때 "이어 하기"가 되어 그 파일들을 이 맥의 원본으로 덮는다.
    // 이어 하던 중이면 여전히 끝나지 않은 폴더라 표지를 둔다
    let undo = |placed: &Placed, wrote_marker: bool, e: String| match remove_placed(to, placed) {
        Ok(()) => {
            if wrote_marker && !resuming {
                let _ = fs::remove_file(&marker);
            }
            e
        }
        Err(x) => format!("{e} (새 폴더에 옮긴 것을 되돌리지 못했어요: {x})"),
    };
    if !files.is_empty() || resuming {
        let staging = make_staging(to).map_err(|e| format!("새 폴더에 할 일을 옮기지 못했어요: {}", io_message(&e)))?;
        let result = (|| {
            let staged = stage_files(from, &staging, &files)?;
            // 앞서 둔 것을 지운 뒤 새 목록을 적는다. 거꾸로 하면 그 사이 꺼졌을 때 옛 내용이 새 목록과 달라 이어 하지 못한다
            if resuming {
                remove_ours(to, &prior)?;
                remove_temps(to)?;
            }
            if resuming || bring_todos {
                write_marker(&marker, &Marker { source: ensure_source_id(from), files: staged.clone() })?;
                wrote_marker = true;
            }
            place_staged_with(&staging, to, &staged, resuming, rename_excl, &mut placed)
        })();
        let _ = fs::remove_dir_all(&staging);
        if let Err(e) = result {
            return Err(undo(&placed, wrote_marker, e));
        }
    }
    if let Err(e) = commit() {
        return Err(undo(&placed, wrote_marker, e));
    }
    // 표지는 commit 뒤에 지운다. 앞에서 지우면 그 사이 꺼졌을 때 다시 해도 Kept가 되어 그 뒤 고친 것이 빠진다.
    // 복사 없이 쓰기 시작하는 폴더(Kept)의 남의 표지도 지운다 — 두면 나중에 그 출처에서 바꿀 때 "이어 하기"로 사용자가 고친 파일을 덮는다.
    // 지우기 전에 꺼지거나 못 지워도 그 폴더에 처음 쓸 때 lock_root가 지운다
    let _ = fs::remove_file(&marker);
    Ok(bring_todos)
}

/// 새 폴더의 복사 표지. 사용자 경로는 적지 않는다 — 동기화 폴더면 클라우드에 그대로 올라간다
#[derive(Default, serde::Serialize, serde::Deserialize)]
struct Marker {
    source: String,
    files: Vec<Entry>,
}

/// 새 폴더에 둔(둘) 파일 하나. 이어 하거나 되돌릴 때 지금 파일이 이것과 같아야 우리가 둔 것으로 본다
#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct Entry {
    name: String,
    size: u64,
    sha256: String,
}

/// 표지를 읽는다. 읽을 수 없는 모양(이전 빌드의 표지 등)이나 너무 큰 표지는 출처를 알 수 없는 표지로 본다.
/// 표지가 폴더·링크면 그 폴더로는 영영 바꿀 수 없으니 이름을 대고 지우라고 알린다
fn read_marker(marker: &Path) -> Result<Option<Marker>, String> {
    let failed = |e: std::io::Error| format!("새 폴더의 복사 표시({COPYING_MARKER})를 읽지 못했어요: {} ({})", io_message(&e), marker.display());
    let bytes = match fs::symlink_metadata(marker) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(failed(e)),
        Ok(m) if !m.is_file() => {
            return Err(format!(
                "새 폴더의 복사 표시({COPYING_MARKER})가 일반 파일이 아니에요(폴더·링크 등). 그 항목을 지우고 다시 시도해 주세요 ({})",
                marker.display()
            ))
        }
        Ok(_) => match read_file(marker) {
            Err(e) if e.raw_os_error() == Some(sys::EFBIG) => return Ok(Some(Marker::default())),
            r => r.map_err(failed)?,
        },
    };
    Ok(bytes.map(|b| serde_json::from_slice(&b).unwrap_or_default()))
}

/// 우리가 옮기는 이름 모양. 표지 목록은 동기화 폴더에서 온 글자라, 다른 모양(../, NUL 등)이 있으면 우리가 쓴 표지가 아니다
fn copied_name(f: &str) -> bool {
    !f.contains('\0') && (f == "settings.json" || f == "someday.md" || f.strip_prefix("daily/").is_some_and(|n| n.ends_with(".md") && !n.contains('/')))
}

/// 이어 해도 되는지. 새 폴더의 할 일 파일이 모두 표지에 적힌 그대로(크기·내용)여야 한다. 표지에 없는 할 일 파일이 있거나
/// 내용이 다르면 그 사이 남(다른 맥의 동기화 등)이 둔 것이다. 설정은 표지에 없으면 남의 것으로 두고 건드리지 않으니 따지지 않는다.
/// daily가 링크면 이어 하지 않는다 — 링크 너머의 daily/*.md가 지워진다
fn still_ours(to: &Path, entries: &[Entry]) -> bool {
    let Ok(t) = open_target(to) else { return false };
    let listed: HashMap<&str, &Entry> = entries.iter().map(|e| (e.name.as_str(), e)).collect();
    entries.iter().all(|e| copied_name(&e.name))
        && t.names.iter().all(|rel| match listed.get(rel.as_str()) {
            Some(e) => t.at(rel).is_some_and(|(dir, name)| same_in(dir, name, e)),
            None => rel == "settings.json",
        })
}

/// 반쯤 쓴 표지는 출처를 알 수 없는 표지가 되어 이어 하지 못하므로 임시 파일을 거쳐 바꾼다
fn write_marker(marker: &Path, m: &Marker) -> Result<(), String> {
    let failed = |e: std::io::Error| format!("새 폴더에 할 일을 옮기지 못했어요: {} ({COPYING_MARKER})", io_message(&e));
    let bytes = serde_json::to_vec(m).map_err(|e| failed(e.into()))?;
    let parent = marker.parent().unwrap_or(Path::new("."));
    replace_via_temp(parent, OsStr::new(COPYING_MARKER), |f| f.write_all(&bytes), None, false).map_err(failed)
}

/// 저장 폴더마다 한 번 만드는 무작위 아이디. 표지의 출처를 경로가 아니라 이것으로 맞춘다 — 사용자 이름이 같은 다른 맥은
/// 기본 폴더 경로가 글자까지 같지만 아이디는 다르다. 같은 동기화 폴더를 쓰는 맥끼리는 아이디도 같은데, 그때는 내용도 같아 이어 해도 된다
const SOURCE_ID: &str = ".aru-id";

fn source_id(from: &Path) -> Option<String> {
    saved_source_id(from).or_else(|| folder_id(from))
}

fn saved_source_id(from: &Path) -> Option<String> {
    let id = String::from_utf8(read_file(&from.join(SOURCE_ID)).ok()??).ok()?;
    (id.len() == 32 && id.bytes().all(|b| b.is_ascii_hexdigit())).then_some(id)
}

/// 아이디 파일을 못 남기는 원본(읽기 전용, .aru-id 자리에 폴더 등)의 대신 아이디. 무작위로 만들면 꺼진 뒤 다시 할 때마다 달라져
/// 영영 이어 하지 못하고 반쯤 옮긴 채 Kept가 된다. dev 번호는 디스크를 다시 붙이면(외장 디스크·재부팅) 바뀌어 볼륨 UUID와 inode로 만든다.
/// UUID가 없는 볼륨(네트워크 폴더 등)만 dev를 써서, 그런 원본은 다시 붙인 뒤에는 이어 하지 못하고 Kept가 된다.
/// 다른 맥과 우연히 같을 수는 있지만 둘 다 아이디를 못 남긴 때뿐이다. 기기 식별값이 동기화 폴더에 올라가지 않게 해시로만 남긴다
fn folder_id(from: &Path) -> Option<String> {
    let m = fs::metadata(from).ok()?;
    let (dev, ino) = sys::file_id(from, &m)?;
    let key = match volume_uuid(from) {
        Some(uuid) => [uuid.as_slice(), &ino.to_le_bytes()].concat(),
        None => format!("dev:{:x}:{:x}", dev, ino).into_bytes(),
    };
    Some(format!("{:x}", Sha256::digest(&key))[..32].to_string())
}

/// 아이디를 못 남기면(읽기 전용 등) 폴더 자체로 만든 대신 아이디를 쓴다(source_id와 같은 값)
fn ensure_source_id(from: &Path) -> String {
    saved_source_id(from).unwrap_or_else(|| {
        let mut bytes = [0u8; 16];
        if !sys::random_bytes(&mut bytes) {
            let nanos = SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
            bytes = (nanos ^ (std::process::id() as u128) << 64).to_le_bytes();
        }
        let id: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
        match replace_via_temp(from, OsStr::new(SOURCE_ID), |f| f.write_all(id.as_bytes()), None, false) {
            Ok(()) => id,
            Err(_) => folder_id(from).unwrap_or(id),
        }
    })
}

/// 새 폴더와 그 daily를 링크를 따라가지 않고 연 것, 그리고 그 안의 표지 이름 모양 항목(someday.md·settings.json·daily/*.md).
/// 확인한 뒤 daily가 링크로 바뀌어도 그 너머를 지우지 않게, 지우기는 연 폴더 안에서만 한다
struct Opened {
    top: sys::Dir,
    daily: Option<sys::Dir>,
    names: Vec<String>,
}

impl Opened {
    fn at<'a>(&'a self, rel: &'a str) -> Option<(&'a sys::Dir, &'a str)> {
        match rel.strip_prefix("daily/") {
            Some(name) => self.daily.as_ref().map(|d| (d, name)),
            None => Some((&self.top, rel)),
        }
    }
}

fn open_target(to: &Path) -> Result<Opened, String> {
    let failed = |e: std::io::Error, rel: &str| format!("할 일을 새 폴더로 옮기지 못했어요: {} ({rel})", io_message(&e));
    let top = sys::open_dir_nofollow(to, None).map_err(|e| failed(e, "."))?;
    let daily = match sys::open_dir_nofollow(to, Some((&top, "daily"))) {
        Ok(d) => Some(d),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) if matches!(e.raw_os_error(), Some(sys::ELOOP | sys::ENOTDIR)) => {
            return Err("할 일을 새 폴더로 옮기지 못했어요: 새 폴더의 daily가 링크나 파일이에요. 그 항목을 치우고 다시 시도해 주세요 (daily)".into())
        }
        Err(e) => return Err(failed(std::io::Error::from_raw_os_error(e.raw_os_error().unwrap_or(sys::EIO)), "daily")),
    };
    let mut names: Vec<String> = ["someday.md", "settings.json"].into_iter().filter(|n| fs::symlink_metadata(to.join(n)).is_ok()).map(String::from).collect();
    if daily.is_some() {
        for entry in fs::read_dir(to.join("daily")).map_err(|e| failed(e, "daily"))?.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.ends_with(".md") && !is_apple_double(&name) {
                names.push(format!("daily/{name}"));
            }
        }
    }
    Ok(Opened { top, daily, names })
}

/// 일반 파일이고 크기·내용이 적어 둔 것과 같은가. 링크는 따라가지 않는다
fn same_in(dir: &sys::Dir, name: &str, e: &Entry) -> bool {
    let Ok(mut file) = dir.open_in(name) else { return false };
    file.metadata().is_ok_and(|m| m.is_file() && m.len() == e.size) && digest(&mut file, |_| Ok(())).is_ok_and(|(size, sha)| size == e.size && sha == e.sha256)
}

/// 크기와 SHA-256. 읽은 조각은 sink에도 넘긴다(복사하면서 한 번에 잰다)
fn digest(src: &mut impl std::io::Read, mut sink: impl FnMut(&[u8]) -> std::io::Result<()>) -> std::io::Result<(u64, String)> {
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 64 * 1024];
    let mut size = 0u64;
    loop {
        let n = match src.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => n,
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(e),
        };
        hasher.update(&buf[..n]);
        sink(&buf[..n])?;
        size += n as u64;
    }
    Ok((size, format!("{:x}", hasher.finalize())))
}

/// 우리가 둔 파일(entries)만 지운다. 지금 내용이 적어 둔 것과 다르면 그 사이 남이 바꾼 것이라 남긴다
fn remove_ours(to: &Path, entries: &[Entry]) -> Result<(), String> {
    if entries.is_empty() {
        return Ok(());
    }
    let t = open_target(to)?;
    let listed: HashMap<&str, &Entry> = entries.iter().map(|e| (e.name.as_str(), e)).collect();
    for rel in &t.names {
        let (Some(e), Some((dir, name))) = (listed.get(rel.as_str()), t.at(rel)) else { continue };
        if same_in(dir, name, e) {
            dir.unlink_in(name).map_err(|x| format!("할 일을 새 폴더로 옮기지 못했어요: {} ({rel})", io_message(&x)))?;
        }
    }
    Ok(())
}

/// 이어 하기 전에 쓰다 남은 임시 파일을 지운다. 이 폴더는 아직 아무도 쓴 적이 없어 나이를 따지지 않는다
fn remove_temps(to: &Path) -> Result<(), String> {
    let t = open_target(to)?;
    for (dir, path) in [(Some(&t.top), to.to_path_buf()), (t.daily.as_ref(), to.join("daily"))] {
        let Some(dir) = dir else { continue };
        // 이름은 경로로 읽지만 지우기는 연 폴더 안에서만 한다 — 그 사이 링크로 바뀌어도 너머는 지우지 않는다
        for entry in fs::read_dir(path).into_iter().flatten().flatten() {
            let name = entry.file_name();
            if is_our_temp(&name.to_string_lossy()) && entry.file_type().is_ok_and(|t| t.is_file()) {
                let _ = dir.unlink_in(&name.to_string_lossy());
            }
        }
    }
    Ok(())
}

/// 이번에 새 폴더에 둔 것. 되돌릴 때 이것만 지우고, daily는 우리가 만들었고 비었을 때만 지운다 —
/// 그 사이 동기화로 들어온 남의 파일까지 폴더째 지우면 동기화 폴더에서는 그 삭제가 다른 맥으로도 퍼진다
#[derive(Default)]
struct Placed {
    files: Vec<Entry>,
    made_daily: bool,
}

/// 못 지운 것이 있으면 첫 이름과 까닭을 돌려준다
fn remove_placed(to: &Path, placed: &Placed) -> Result<(), String> {
    remove_ours(to, &placed.files)?;
    if placed.made_daily {
        let _ = fs::remove_dir(to.join("daily"));
    }
    Ok(())
}

/// exFAT·FAT·SMB에서 macOS가 파일마다 스스로 만드는 `._이름`(AppleDouble) 보조 파일. 할 일이 아니다.
/// 옮기면 대상 디스크에서 OS가 같은 이름을 먼저 만들어 부딪히고(EEXIST), APFS로는 찌꺼기가 일반 파일로 남는다
fn is_apple_double(name: &str) -> bool {
    name.starts_with("._")
}

const STAGING_PREFIX: &str = ".aru-staging-";
const COPYING_MARKER: &str = ".aru-copying";

fn make_staging(to: &Path) -> std::io::Result<PathBuf> {
    static SEQ: AtomicU64 = AtomicU64::new(0);
    loop {
        let dir = to.join(format!("{STAGING_PREFIX}{}-{}", base36(std::process::id() as u64), base36(SEQ.fetch_add(1, Ordering::Relaxed))));
        match fs::create_dir(&dir) {
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            r => return r.map(|_| dir),
        }
    }
}

/// 바이트 그대로 옮기고 옮긴 크기·내용 해시를 돌려준다. 해석하지 않으니 읽기 상한(64MB)도 걸지 않는다 — 큰 파일 하나 때문에 폴더를 못 바꾸면 안 된다
fn stage_files(from: &Path, staging: &Path, files: &[String]) -> Result<Vec<Entry>, String> {
    let mut staged = Vec::new();
    for rel in files {
        let failed = |e: std::io::Error| format!("할 일을 새 폴더로 옮기지 못했어요: {} ({rel})", io_message(&e));
        let (size, sha256, whole) = (|| {
            let mut src = open_regular(&from.join(rel))?.ok_or(std::io::ErrorKind::NotFound)?;
            let dst = staging.join(rel);
            if let Some(parent) = dst.parent() {
                fs::create_dir_all(parent)?;
            }
            let mut file = fs::File::create_new(&dst)?;
            let (size, sha256) = digest(&mut src, |b| file.write_all(b))?;
            file.sync_all()?;
            Ok((size, sha256, size == src.metadata()?.len()))
        })()
        .map_err(failed)?;
        if !whole {
            return Err(format!("할 일을 새 폴더로 옮기지 못했어요: 옮기는 사이 원본이 바뀌었어요 ({rel})"));
        }
        staged.push(Entry { name: rel.clone(), size, sha256 });
    }
    Ok(staged)
}

/// 파일을 하나씩 제자리에 두고 둔 것을 placed에 쌓는다. 실패하면 부르는 쪽이 placed를 되돌린다.
/// 처음 복사일 때 그 사이 daily가 생겼으면(다른 맥의 동기화 등) 섞지 않고 실패한다. 이어 할 때는 이미 있는 daily에 둔다
fn place_staged_with(staging: &Path, to: &Path, staged: &[Entry], resuming: bool, rename_excl: fn(&Path, &Path) -> std::io::Result<()>, placed: &mut Placed) -> Result<(), String> {
    let failed = |e: &std::io::Error, rel: &str| format!("할 일을 새 폴더로 옮기지 못했어요: {} ({rel})", io_message(e));
    // 도중에 죽어도 "설정·someday만 있는" 폴더가 남지 않게 daily부터 둔다. 그런 폴더는 다음에 Kept로 보여 daily를 옮기지 못한다
    let mut order: Vec<&Entry> = staged.iter().collect();
    order.sort_by_key(|e| match e.name.as_str() {
        "someday.md" => 1,
        "settings.json" => 2,
        _ => 0,
    });
    if order.first().is_some_and(|e| e.name.starts_with("daily/")) {
        let daily = to.join("daily");
        match fs::create_dir(&daily) {
            Ok(()) => placed.made_daily = true,
            Err(e) if resuming && e.kind() == std::io::ErrorKind::AlreadyExists && name_is_dir(&daily) => {}
            Err(e) => return Err(failed(&e, "daily")),
        }
    }
    for e in order {
        rename_new(&staging.join(&e.name), &to.join(&e.name), rename_excl).map_err(|x| failed(&x, &e.name))?;
        placed.files.push(e.clone());
    }
    Ok(())
}

fn name_is_dir(p: &Path) -> bool {
    fs::symlink_metadata(p).is_ok_and(|m| m.is_dir())
}

fn rename_new(src: &Path, dst: &Path, rename_excl: fn(&Path, &Path) -> std::io::Result<()>) -> std::io::Result<()> {
    match rename_excl(src, dst) {
        // exFAT·SMB·NFS는 RENAME_EXCL을 모른다(ENOTSUP). 확인하고 이름을 바꾸면 그 사이 생긴 같은 이름을 덮으므로 복사로 둔다
        Err(e) if sys::is_notsup(&e) => copy_new(src, dst),
        r => r,
    }
}

/// 같은 이름이 있으면 EEXIST로 실패한다. 원본(staging)은 부르는 쪽이 지운다.
/// 같은 폴더의 임시 파일에 다 쓴 뒤, 이름이 비었는지 보고 옮긴다. exFAT·SMB에는 RENAME_EXCL도 하드링크도 없어
/// 그 확인과 rename 사이(마이크로초)에 생긴 같은 이름은 덮을 수 있다. 대신 이름을 빈 파일로 먼저 차지하지 않는다 —
/// 차지한 채 꺼지면 빈 settings.json이 남아 다시 시도해도 채우지 않고, 설정이 모두 기본값으로 돌아간다
fn copy_new(src: &Path, dst: &Path) -> std::io::Result<()> {
    let (Some(parent), Some(name)) = (dst.parent(), dst.file_name()) else { return Err(std::io::ErrorKind::InvalidInput.into()) };
    replace_via_temp(parent, name, |f| std::io::copy(&mut fs::File::open(src)?, f).map(|_| ()), None, true)
}

/// 앱 ID가 바뀌면 데이터 폴더 이름도 바뀐다. 새 폴더가 아직 없을 때만 옛 폴더를 통째로 옮긴다
pub fn move_legacy_dir(old: &Path, new: &Path) -> Result<bool, String> {
    if !old.is_dir() || new.exists() {
        return Ok(false);
    }
    if let Some(parent) = new.parent() {
        fs::create_dir_all(parent).map_err(|e| io_message(&e))?;
    }
    fs::rename(old, new).map_err(|e| io_message(&e))?;
    Ok(true)
}

/// 글자로 풀 수 없는(UTF-8이 아닌) 파일을 읽었을 때의 오류. 화면은 이 글자로 "쓰지 말고 사용자가 고칠 파일"을 알아본다
pub const UNDECODABLE: &str = "글자로 풀 수 없는 파일이에요 (UTF-8이 아니에요)";

/// 앱 화면과 aru 명령에 그대로 보이는 말. 영문 OS 오류(`Permission denied (os error 13)`)를 보여 주지 않는다
pub fn io_message(e: &std::io::Error) -> String {
    use std::io::ErrorKind;
    let text = match e.raw_os_error().map(|code| (code, sys::os_error(code))) {
        Some((_, Some(kind))) => match kind {
            OsErr::Denied => "권한이 없어요",
            OsErr::ReadOnlyDisk => "읽기 전용 디스크예요",
            OsErr::NoSpace => "디스크 공간이 부족해요",
            OsErr::Quota => "저장 공간 한도를 넘었어요",
            OsErr::NameTooLong => "폴더나 파일 이름이 너무 길어요",
            OsErr::BadName => "이 디스크에 쓸 수 없는 글자가 이름에 있어요",
            OsErr::NotFound => "폴더나 파일을 찾을 수 없어요",
            OsErr::NotDir => "폴더가 있어야 할 자리에 파일이 있어요",
            OsErr::IsDir => "파일이 있어야 할 자리에 폴더가 있어요",
            OsErr::Exists => "같은 이름이 이미 있어요",
            OsErr::Busy => "다른 프로그램이 쓰고 있어요",
            OsErr::Io => "디스크를 읽고 쓰다 문제가 생겼어요",
            OsErr::Disconnected => "디스크나 네트워크 폴더와 연결이 끊겼어요",
            OsErr::Loop => "심링크가 너무 여러 번 이어져 있어요",
            OsErr::TooManyOpen => "열린 파일이 너무 많아요. 잠시 뒤 다시 시도해 주세요",
            OsErr::NotSupported => "이 디스크에서는 할 수 없는 작업이에요",
            OsErr::TooBig => "파일이 너무 커요 (64MB가 넘는 파일은 읽지 않아요)",
            OsErr::Special => "일반 파일이 아니에요 (파이프·장치 같은 특수 파일이에요)",
            OsErr::Again => "잠깐 처리하지 못했어요. 잠시 뒤 다시 시도해 주세요",
            #[cfg(windows)]
            OsErr::InUse => "다른 프로그램이 이 파일을 쓰는 중이에요",
            #[cfg(windows)]
            OsErr::NotEmpty => "폴더가 비어 있지 않아요",
        },
        // 오류 번호는 남겨 둔다. 사용자가 "의견 보내기"로 알려 줄 때 원인을 찾을 수 있게
        Some((code, None)) => return format!("알 수 없는 문제가 생겼어요 (오류 {code})"),
        None => match e.kind() {
            ErrorKind::InvalidData => UNDECODABLE,
            ErrorKind::PermissionDenied => "권한이 없어요",
            ErrorKind::NotFound => "폴더나 파일을 찾을 수 없어요",
            ErrorKind::ReadOnlyFilesystem => "읽기 전용 디스크예요",
            ErrorKind::StorageFull => "디스크 공간이 부족해요",
            _ => "알 수 없는 문제가 생겼어요",
        },
    };
    text.to_string()
}

/// 같은 뜻의 OS 오류는 어느 OS에서든 같은 말로 알린다. 번호를 뜻으로 옮기는 표는 sys에 있다
enum OsErr {
    Denied,
    ReadOnlyDisk,
    NoSpace,
    Quota,
    NameTooLong,
    BadName,
    NotFound,
    NotDir,
    IsDir,
    Exists,
    Busy,
    Io,
    Disconnected,
    Loop,
    TooManyOpen,
    NotSupported,
    TooBig,
    Special,
    Again,
    #[cfg(windows)]
    InUse,
    #[cfg(windows)]
    NotEmpty,
}

fn write_error(e: std::io::Error) -> String {
    format!("저장하지 못했어요: {}", io_message(&e))
}

const PROBE_FILE: &str = ".aru-write-check";

/// 쓸 수 있는지 보려고 만들었다 지우는 파일. 매번 새 이름을 O_EXCL·O_NOFOLLOW로 만들어,
/// 같은 이름의 사용자 파일·링크를 덮거나 지우지 않고 우리가 만든 것만 지운다
fn check_writable(dir: &Path) -> std::io::Result<()> {
    static SEQ: AtomicU64 = AtomicU64::new(0);
    loop {
        let probe = dir.join(format!("{PROBE_FILE}-{}-{}", base36(std::process::id() as u64), base36(SEQ.fetch_add(1, Ordering::Relaxed))));
        match sys::no_follow(fs::OpenOptions::new().write(true).create_new(true)).open(&probe) {
            Ok(mut file) => {
                let written = file.write_all(b"aru");
                drop(file);
                let _ = fs::remove_file(&probe);
                return written;
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        }
    }
}

/// 폴더를 바꿀 때 지금 할 일을 어떻게 했는지. 화면 안내 문구가 이걸로 갈린다
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Prepared {
    Copied,
    Kept,
    SourceUnavailable,
}

/// 고른 폴더를 저장 폴더로 쓸 준비를 하고 commit(location.json 기록)을 부른다. 쓸 수 있는지 먼저 확인하고,
/// 쓸 수 없으면 아무것도 복사하지 않고 실패한다. commit이 실패하면 복사한 것을 되돌린다.
/// 이미 할 일이 있는 폴더면 Kept, 지금 폴더를 열 수 없으면(current가 None) SourceUnavailable
pub fn prepare_new_root(current: Option<&Path>, target: &Path, commit: impl FnOnce() -> Result<(), String>) -> Result<Prepared, String> {
    if !target.is_dir() {
        return Err("폴더를 찾을 수 없어요".into());
    }
    // 지금 저장 폴더 안(daily 등)을 고르면 할 일이 daily/daily/…로 복사되고, 앱이 쓰는 폴더가 서로 겹친다
    if let Some((current, chosen)) = current.and_then(|c| Some((fs::canonicalize(c).ok()?, fs::canonicalize(target).ok()?))) {
        if chosen != current && chosen.starts_with(&current) {
            return Err("지금 저장 폴더 안에 있는 폴더는 새 저장 폴더로 고를 수 없어요. 저장 폴더 밖의 폴더를 골라 주세요".into());
        }
    }
    check_writable(target).map_err(|e| format!("이 폴더에는 쓸 수 없어요 ({})", io_message(&e)))?;
    remove_stale_leftovers(target);
    match current {
        Some(current) => Ok(if copy_into_if_empty(current, target, commit)? { Prepared::Copied } else { Prepared::Kept }),
        None => {
            commit()?;
            // 복사 없이 쓰기 시작하니 남은 표지를 지운다(copy_into_if_empty의 Kept와 같은 까닭)
            let _ = fs::remove_file(target.join(COPYING_MARKER));
            Ok(Prepared::SourceUnavailable)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    use std::ffi::CString;
    #[cfg(unix)]
    use std::os::unix::{ffi::OsStrExt, fs::MetadataExt};

    fn prepare_new_root(current: Option<&Path>, target: &Path) -> Result<Prepared, String> {
        super::prepare_new_root(current, target, || Ok(()))
    }

    fn copy_into_if_empty(from: &Path, to: &Path) -> Result<bool, String> {
        super::copy_into_if_empty(from, to, || Ok(()))
    }

    fn temp_root(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("aru-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn 폴더_안_이름을_한번에_본다() {
        let root = temp_root("list");
        assert_eq!(list_names(&root, "daily").unwrap(), Vec::<String>::new(), "폴더가 없으면 빈 목록");
        fs::create_dir_all(root.join("daily")).unwrap();
        fs::write(root.join("daily/2026-10-12.md"), "- [ ] a\n").unwrap();
        fs::write(root.join("daily/2026-10-13.md"), "").unwrap();
        let mut names = list_names(&root, "daily").unwrap();
        names.sort();
        assert_eq!(names, ["2026-10-12.md", "2026-10-13.md"]);
        assert!(list_names(&root, "../x").is_err());
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

    #[test]
    fn b1_여러_곳에서_동시에_써도_실패하지_않고_임시_파일이_남지_않는다() {
        let root = temp_root("concurrent");
        let handles: Vec<_> = (0..20)
            .map(|i| {
                let root = root.clone();
                std::thread::spawn(move || write_text(&root, "daily/2026-10-14.md", &format!("- [ ] {i}\n")))
            })
            .collect();
        for h in handles {
            h.join().unwrap().unwrap();
        }
        let content = read_text(&root, "daily/2026-10-14.md").unwrap().unwrap();
        assert!(content.starts_with("- [ ] ") && content.lines().count() == 1, "{content}");
        let names: Vec<_> = fs::read_dir(root.join("daily")).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(names.len(), 1, "{names:?}");
    }

    #[test]
    fn b1_잠금은_한_번에_하나만_잡는다() {
        let root = temp_root("lock");
        let inside = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let handles: Vec<_> = (0..8)
            .map(|_| {
                let (root, inside) = (root.clone(), inside.clone());
                std::thread::spawn(move || {
                    let _lock = lock_root(&root, CLI_LOCK_WAIT).unwrap();
                    let n = inside.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    std::thread::sleep(std::time::Duration::from_millis(20));
                    inside.fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
                    n
                })
            })
            .collect();
        for h in handles {
            assert_eq!(h.join().unwrap(), 0);
        }
    }

    #[test]
    fn s3_심링크는_가리키는_파일에_쓰고_링크는_그대로_둔다() {
        let root = temp_root("symlink");
        let real = temp_root("symlink-real").join("진짜.md");
        fs::write(&real, "- [ ] 옛\n").unwrap();
        std::os::unix::fs::symlink(&real, root.join("someday.md")).unwrap();
        write_text(&root, "someday.md", "- [ ] 새\n").unwrap();
        assert!(fs::symlink_metadata(root.join("someday.md")).unwrap().file_type().is_symlink());
        assert_eq!(fs::read_to_string(&real).unwrap(), "- [ ] 새\n");
    }
    #[test]
    fn r2_flock을_지원하지_않는_폴더에서는_잠그지_않고_진행한다() {
        let root = temp_root("nolock");
        let open = || fs::OpenOptions::new().create(true).truncate(false).write(true).open(root.join(LOCK_FILE)).unwrap();
        let errors = [
            std::io::Error::from_raw_os_error(libc::ENOTSUP),
            std::io::Error::from_raw_os_error(libc::EOPNOTSUPP),
            std::io::Error::from(std::io::ErrorKind::Unsupported),
        ];
        for e in errors {
            let mut e = Some(e);
            let r = acquire(open(), "저장 폴더", std::time::Duration::from_millis(50), String::new, |_| Err(fs::TryLockError::Error(e.take().unwrap())));
            assert!(r.is_ok(), "{:?}", r.err());
        }
        let r = acquire(open(), "저장 폴더", std::time::Duration::from_millis(50), String::new, |_| {
            Err(fs::TryLockError::Error(std::io::Error::from_raw_os_error(libc::EIO)))
        });
        assert!(r.is_err());
    }

    #[test]
    fn r2_잠금을_오래_못_잡으면_기다리다_잠겨_있다고_알린다() {
        let root = temp_root("lock-wait");
        let held = lock_root(&root, CLI_LOCK_WAIT).unwrap();
        let releaser = std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(1500));
            drop(held);
        });
        let started = std::time::Instant::now();
        let r = lock_root(&root, std::time::Duration::from_millis(300));
        let waited = started.elapsed();
        releaser.join().unwrap();
        let e = r.err().expect("잠긴 동안은 오류여야 한다");
        assert!(e.starts_with(LOCKED), "{e}");
        assert!(waited >= std::time::Duration::from_millis(300) && waited < std::time::Duration::from_millis(1200), "{waited:?}");
        // 풀리면 바로 잡힌다
        assert!(lock_root(&root, std::time::Duration::from_millis(300)).is_ok());
    }

    #[test]
    fn r2_조건부_쓰기는_알던_내용과_같을_때만_쓴다() {
        let root = temp_root("cas");
        let rel = "daily/2026-10-17.md";
        // 없는 파일은 빈 내용으로 본다
        assert_eq!(write_text_if(&root, rel, "- [ ] 가\n", Some("x")).unwrap(), Swap::Conflict(None));
        assert!(!root.join(rel).exists());
        assert_eq!(write_text_if(&root, rel, "- [ ] 가\n", Some("")).unwrap(), Swap::Written);
        assert_eq!(read_text(&root, rel).unwrap().as_deref(), Some("- [ ] 가\n"));
        // 그 사이 다른 쪽(aru add)이 쓴 경우
        write_text(&root, rel, "- [ ] AI\n- [ ] 가\n").unwrap();
        assert_eq!(
            write_text_if(&root, rel, "- [ ] 가 고침\n", Some("- [ ] 가\n")).unwrap(),
            Swap::Conflict(Some("- [ ] AI\n- [ ] 가\n".into()))
        );
        assert_eq!(read_text(&root, rel).unwrap().as_deref(), Some("- [ ] AI\n- [ ] 가\n"));
        assert_eq!(write_text_if(&root, rel, "합침\n", Some("- [ ] AI\n- [ ] 가\n")).unwrap(), Swap::Written);
        assert_eq!(write_text_if(&root, rel, "무조건\n", None).unwrap(), Swap::Written);
        assert_eq!(read_text(&root, rel).unwrap().as_deref(), Some("무조건\n"));
    }

    #[test]
    fn r2_끊어진_심링크는_링크를_두고_가리키는_곳에_파일을_만든다() {
        let root = temp_root("dangling");
        let target_dir = temp_root("dangling-target");
        let target = target_dir.join("없던파일.md");
        std::os::unix::fs::symlink(&target, root.join("someday.md")).unwrap();
        write_text(&root, "someday.md", "- [ ] 새\n").unwrap();
        assert!(fs::symlink_metadata(root.join("someday.md")).unwrap().file_type().is_symlink());
        assert_eq!(fs::read_to_string(&target).unwrap(), "- [ ] 새\n");
        // 상대 경로 링크
        std::os::unix::fs::symlink("상대.md", root.join("rel.md")).unwrap();
        write_text(&root, "rel.md", "x\n").unwrap();
        assert!(fs::symlink_metadata(root.join("rel.md")).unwrap().file_type().is_symlink());
        assert_eq!(fs::read_to_string(root.join("상대.md")).unwrap(), "x\n");
    }

    #[test]
    fn r2_바꿔_쓸_때_원래_파일의_권한을_지킨다() {
        use std::os::unix::fs::PermissionsExt;
        let root = temp_root("perm");
        write_text(&root, "someday.md", "옛\n").unwrap();
        fs::set_permissions(root.join("someday.md"), fs::Permissions::from_mode(0o600)).unwrap();
        write_text(&root, "someday.md", "새\n").unwrap();
        assert_eq!(fs::metadata(root.join("someday.md")).unwrap().permissions().mode() & 0o7777, 0o600);
    }

    #[test]
    fn r2_오래된_임시_파일은_쓸_때_정리한다() {
        let root = temp_root("stale");
        let daily = root.join("daily");
        fs::create_dir_all(&daily).unwrap();
        let old = std::time::SystemTime::now() - std::time::Duration::from_secs(2 * 3600);
        let make = |name: &str, when: std::time::SystemTime| {
            let f = fs::File::create(daily.join(name)).unwrap();
            f.set_modified(when).unwrap();
        };
        make(".aru-tmp-1a2b-3.2026-10-02.md", old);
        make(".aru-tmp-1a2b-4", old);
        make(".aru-tmp-1a2b-5.2026-10-03.md", std::time::SystemTime::now());
        make(".사용자것.tmp", old);
        make("메모.tmp", old);
        write_text(&root, "daily/2026-10-17.md", "- [ ] 가\n").unwrap();
        let mut names: Vec<String> = fs::read_dir(&daily).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().to_string()).collect();
        names.sort();
        assert_eq!(names, vec![".aru-tmp-1a2b-5.2026-10-03.md", ".사용자것.tmp", "2026-10-17.md", "메모.tmp"]);
    }

    #[test]
    fn r2_임시_파일_경로는_원래_경로보다_길어지지_않게_한다() {
        // 원래 경로가 PATH_MAX(1024)에 가까워도 쓸 수 있어야 한다
        let mut root = temp_root("longpath");
        while root.as_os_str().len() + 250 < 1000 {
            root = root.join("a".repeat(200));
        }
        let pad = 1015 - root.as_os_str().len() - "/daily/".len() - ".md".len();
        let rel = format!("daily/{}.md", "b".repeat(pad));
        assert_eq!(root.join(&rel).as_os_str().len(), 1015);
        write_text(&root, &rel, "- [ ] 가\n").unwrap();
        assert_eq!(read_text(&root, &rel).unwrap().as_deref(), Some("- [ ] 가\n"));
        // 이름이 255바이트에 가까워도
        let long = format!("{}.md", "c".repeat(250));
        let short_root = temp_root("longname");
        write_text(&short_root, &long, "x\n").unwrap();
        assert_eq!(read_text(&short_root, &long).unwrap().as_deref(), Some("x\n"));
    }

    #[test]
    fn r2_깨진_파일을_옆에_둘_때_이전_보관본을_덮지_않는다() {
        let root = temp_root("quarantine");
        let file = root.join("ai-batches.json");
        let first = quarantine_path(&file);
        fs::write(&first, "1").unwrap();
        let second = quarantine_path(&file);
        assert_ne!(first, second);
        assert!(!second.exists());
        let name = second.file_name().unwrap().to_string_lossy().to_string();
        assert!(name.starts_with("ai-batches.json.") && name.ends_with(".bad"), "{name}");
    }

    #[test]
    fn r2_원자적_쓰기는_임시_파일을_남기지_않는다() {
        let root = temp_root("atomic");
        let file = root.join("location.json");
        write_atomic(&file, "{}").unwrap();
        write_atomic(&file, "{\"a\":1}").unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "{\"a\":1}");
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
    }

    fn read_only_dir(name: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp_root(name);
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o555)).unwrap();
        dir
    }

    fn unlock(dir: &Path) {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(dir, fs::Permissions::from_mode(0o755));
    }

    #[test]
    fn f1_os_오류는_한국어로_알린다() {
        let raw = |code| io_message(&std::io::Error::from_raw_os_error(code));
        assert_eq!(raw(libc::EACCES), "권한이 없어요");
        assert_eq!(raw(libc::EPERM), "권한이 없어요");
        assert_eq!(raw(libc::EROFS), "읽기 전용 디스크예요");
        assert_eq!(raw(libc::ENOSPC), "디스크 공간이 부족해요");
        assert_eq!(raw(libc::EDQUOT), "저장 공간 한도를 넘었어요");
        assert_eq!(raw(libc::ENAMETOOLONG), "폴더나 파일 이름이 너무 길어요");
        assert_eq!(raw(libc::ENOENT), "폴더나 파일을 찾을 수 없어요");
        assert_eq!(raw(libc::EIO), "디스크를 읽고 쓰다 문제가 생겼어요");
        for code in 1..=106 {
            let m = raw(code);
            assert!(!m.contains("os error") && !m.is_ascii(), "{code}: {m}");
        }
        assert_eq!(io_message(&std::io::Error::new(std::io::ErrorKind::InvalidData, "x")), UNDECODABLE);
    }

    #[test]
    fn f1_utf8이_아닌_파일은_한국어_표지로_거절한다() {
        let root = temp_root("undecodable");
        fs::write(root.join("someday.md"), [0xff, 0xfe, 0x00, 0xc3]).unwrap();
        let e = read_text(&root, "someday.md").unwrap_err();
        assert!(e.contains(UNDECODABLE), "{e}");
        assert!(!e.contains("UTF-8") || e.contains("UTF-8이"), "{e}");
    }

    #[test]
    fn f1_쓸_수_없는_폴더에_쓰면_한국어로_알린다() {
        let root = read_only_dir("ro-write");
        let e = write_text(&root, "someday.md", "- [ ] 가\n").unwrap_err();
        let lock = lock_root(&root, Duration::from_millis(10)).err().unwrap_or_default();
        unlock(&root);
        assert_eq!(e, "저장하지 못했어요: 권한이 없어요");
        assert_eq!(lock, "저장 폴더에 쓸 수 없어요: 권한이 없어요");
    }

    #[test]
    fn f1_쓸_수_없는_폴더로는_바꾸지_않고_아무것도_남기지_않는다() {
        let from = temp_root("ro-from");
        fs::write(from.join("settings.json"), "{}").unwrap();
        fs::write(from.join("someday.md"), "- [ ] 가\n").unwrap();
        let to = read_only_dir("ro-to");
        let result = prepare_new_root(Some(&from), &to);
        let left: Vec<_> = fs::read_dir(&to).unwrap().map(|e| e.unwrap().file_name()).collect();
        unlock(&to);
        assert_eq!(result, Err("이 폴더에는 쓸 수 없어요 (권한이 없어요)".to_string()));
        assert!(left.is_empty(), "{left:?}");
    }

    #[test]
    fn f1_없는_폴더로는_바꾸지_않는다() {
        let from = temp_root("missing-from");
        let to = from.join("없음");
        assert_eq!(prepare_new_root(Some(&from), &to), Err("폴더를 찾을 수 없어요".to_string()));
    }

    #[test]
    fn f2_새_폴더에_할_일이_있으면_옮기지_않았다고_알린다() {
        let from = temp_root("prep-from");
        fs::write(from.join("someday.md"), "- [ ] 지금\n").unwrap();
        let empty = temp_root("prep-empty");
        assert_eq!(prepare_new_root(Some(&from), &empty), Ok(Prepared::Copied));
        assert_eq!(fs::read_to_string(empty.join("someday.md")).unwrap(), "- [ ] 지금\n");
        let used = temp_root("prep-used");
        fs::create_dir_all(used.join("daily")).unwrap();
        assert_eq!(prepare_new_root(Some(&from), &used), Ok(Prepared::Kept));
        assert!(!used.join("someday.md").exists());
        // 지금 폴더를 열 수 없으면 옮길 것도 없다
        assert_eq!(prepare_new_root(None, &temp_root("prep-none")), Ok(Prepared::SourceUnavailable));
        let names: Vec<_> = fs::read_dir(&empty).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().to_string()).collect();
        assert_eq!(names, vec!["someday.md"], "확인용 파일이 남았다");
    }

    fn names_in(dir: &Path) -> Vec<String> {
        let mut out = Vec::new();
        fn walk(base: &Path, dir: &Path, out: &mut Vec<String>) {
            for e in fs::read_dir(dir).unwrap() {
                let p = e.unwrap().path();
                out.push(p.strip_prefix(base).unwrap().to_string_lossy().to_string());
                if fs::symlink_metadata(&p).unwrap().is_dir() {
                    walk(base, &p, out);
                }
            }
        }
        walk(dir, dir, &mut out);
        out.sort();
        out
    }

    fn aged(path: &Path) {
        let f = fs::File::create(path).unwrap();
        fs::write(path, "keep").unwrap();
        f.set_modified(SystemTime::now() - Duration::from_secs(2 * 3600)).unwrap();
    }

    #[test]
    fn r4_q1_사용자_tmp_파일과_저장_폴더_밖은_정리하지_않는다() {
        let root = temp_root("q1");
        let ext = temp_root("q1-ext");
        let ext2 = temp_root("q1-ext2");
        let daily = root.join("daily");
        fs::create_dir_all(&daily).unwrap();
        let users = [".my-notes.tmp", ".report.2024-10.tmp", ".backup.2024-10-01.tmp", ".draft-v2.tmp", ".a-b.tmp", ".2026-10-02.md.1a2b-3.tmp", ".1a2b-4.tmp", ".aru-tmp-notes.txt"];
        for n in users {
            aged(&daily.join(n));
        }
        aged(&ext.join(".meeting-notes.tmp"));
        aged(&ext.join(".aru-tmp-1a2b-6.someday-real.md"));
        aged(&ext2.join(".aru-tmp-1a2b-7.x.md"));
        std::os::unix::fs::symlink(ext.join("someday-real.md"), root.join("someday.md")).unwrap();
        std::os::unix::fs::symlink(&ext2, root.join("linked")).unwrap();
        write_text(&root, "daily/2026-10-17.md", "- [ ] 가\n").unwrap();
        write_text(&root, "someday.md", "- [ ] 나\n").unwrap();
        write_text(&root, "linked/x.md", "- [ ] 다\n").unwrap();
        for n in users {
            assert!(daily.join(n).exists(), "사용자 파일 {n}이 지워졌다");
        }
        assert!(ext.join(".meeting-notes.tmp").exists());
        assert!(ext.join(".aru-tmp-1a2b-6.someday-real.md").exists(), "저장 폴더 밖에서 정리했다");
        assert!(ext2.join(".aru-tmp-1a2b-7.x.md").exists(), "심링크 폴더 너머에서 정리했다");
        assert_eq!(fs::read_to_string(ext.join("someday-real.md")).unwrap(), "- [ ] 나\n");
    }

    #[test]
    fn r4_q2_복사_중간에_실패하면_새_폴더는_그대로고_다시_하면_모두_옮긴다() {
        use std::os::unix::fs::PermissionsExt;
        let from = temp_root("q2-from");
        let to = temp_root("q2-to");
        fs::write(to.join("메모.txt"), "내 것").unwrap();
        fs::create_dir_all(from.join("daily")).unwrap();
        fs::write(from.join("someday.md"), "- [ ] 언젠가\n").unwrap();
        fs::write(from.join("settings.json"), "{\"opacity\":40}").unwrap();
        for d in 1..=9 {
            fs::write(from.join(format!("daily/2026-10-0{d}.md")), format!("- [ ] {d}\n")).unwrap();
        }
        let broken = from.join("daily/2026-10-07.md");
        fs::set_permissions(&broken, fs::Permissions::from_mode(0o000)).unwrap();
        let before = names_in(&to);
        let first = prepare_new_root(Some(&from), &to);
        fs::set_permissions(&broken, fs::Permissions::from_mode(0o644)).unwrap();
        assert!(first.is_err(), "{first:?}");
        assert_eq!(names_in(&to), before, "실패했는데 새 폴더에 무언가 남았다");
        assert_eq!(prepare_new_root(Some(&from), &to), Ok(Prepared::Copied));
        for d in 1..=9 {
            assert_eq!(fs::read_to_string(to.join(format!("daily/2026-10-0{d}.md"))).unwrap(), format!("- [ ] {d}\n"));
        }
        assert_eq!(fs::read_to_string(to.join("someday.md")).unwrap(), "- [ ] 언젠가\n");
        assert_eq!(fs::read_to_string(to.join("settings.json")).unwrap(), "{\"opacity\":40}");
        let mut expected = vec!["daily".to_string(), "settings.json".into(), "someday.md".into(), "메모.txt".into()];
        expected.extend((1..=9).map(|d| format!("daily/2026-10-0{d}.md")));
        expected.sort();
        assert_eq!(names_in(&to), expected);
    }

    #[test]
    fn r4_q2_utf8이_아닌_파일도_바이트_그대로_옮긴다() {
        let from = temp_root("q2-bytes-from");
        let to = temp_root("q2-bytes-to");
        fs::create_dir_all(from.join("daily")).unwrap();
        let bytes = [0xffu8, 0xfe, b'-', b' ', 0xc3];
        fs::write(from.join("daily/2026-10-05.md"), bytes).unwrap();
        fs::write(from.join("daily/2026-10-06.md"), "- [ ] 정상\n").unwrap();
        assert_eq!(prepare_new_root(Some(&from), &to), Ok(Prepared::Copied));
        assert_eq!(fs::read(to.join("daily/2026-10-05.md")).unwrap(), bytes);
        assert_eq!(fs::read_to_string(to.join("daily/2026-10-06.md")).unwrap(), "- [ ] 정상\n");
    }

    #[test]
    fn r4_q3_확인용_파일_이름이_겹쳐도_사용자_파일을_건드리지_않는다() {
        let user = temp_root("q3-user").join("내파일.txt");
        fs::write(&user, "내 것").unwrap();
        let linked = temp_root("q3-link");
        std::os::unix::fs::symlink(&user, linked.join(PROBE_FILE)).unwrap();
        assert_eq!(prepare_new_root(None, &linked), Ok(Prepared::SourceUnavailable));
        assert_eq!(fs::read_to_string(&user).unwrap(), "내 것");
        assert!(fs::symlink_metadata(linked.join(PROBE_FILE)).unwrap().file_type().is_symlink());
        assert_eq!(names_in(&linked), vec![PROBE_FILE.to_string()]);

        let plain = temp_root("q3-plain");
        fs::write(plain.join(PROBE_FILE), "x").unwrap();
        assert_eq!(prepare_new_root(None, &plain), Ok(Prepared::SourceUnavailable));
        assert_eq!(fs::read_to_string(plain.join(PROBE_FILE)).unwrap(), "x");

        let dir = temp_root("q3-dir");
        fs::create_dir(dir.join(PROBE_FILE)).unwrap();
        assert_eq!(prepare_new_root(None, &dir), Ok(Prepared::SourceUnavailable));
        assert!(dir.join(PROBE_FILE).is_dir());
    }

    #[cfg(target_os = "macos")]
    fn xattr(path: &Path, name: &str) -> Option<Vec<u8>> {
        use std::os::unix::ffi::OsStrExt;
        let p = std::ffi::CString::new(path.as_os_str().as_bytes()).unwrap();
        let n = std::ffi::CString::new(name).unwrap();
        let mut buf = vec![0u8; 256];
        let len = unsafe { libc::getxattr(p.as_ptr(), n.as_ptr(), buf.as_mut_ptr().cast(), buf.len(), 0, 0) };
        (len >= 0).then(|| buf[..len as usize].to_vec())
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn r4_q4_바꿔_쓸_때_확장_속성을_지킨다() {
        use std::os::unix::ffi::OsStrExt;
        let root = temp_root("q4");
        write_text(&root, "someday.md", "옛\n").unwrap();
        let file = root.join("someday.md");
        let p = std::ffi::CString::new(file.as_os_str().as_bytes()).unwrap();
        for (name, value) in [("user.note", "keep"), ("com.apple.metadata:_kMDItemUserTags", "Red")] {
            let n = std::ffi::CString::new(name).unwrap();
            assert_eq!(unsafe { libc::setxattr(p.as_ptr(), n.as_ptr(), value.as_ptr().cast(), value.len(), 0, 0) }, 0);
        }
        write_text(&root, "someday.md", "새\n").unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "새\n");
        assert_eq!(xattr(&file, "user.note").as_deref(), Some(&b"keep"[..]));
        assert_eq!(xattr(&file, "com.apple.metadata:_kMDItemUserTags").as_deref(), Some(&b"Red"[..]));
    }

    #[test]
    fn r4_q5_잠금_파일이_읽기_전용이거나_폴더여도_잠근다() {
        use std::os::unix::fs::PermissionsExt;
        let ro = temp_root("q5-ro");
        fs::write(ro.join(LOCK_FILE), "").unwrap();
        fs::set_permissions(ro.join(LOCK_FILE), fs::Permissions::from_mode(0o444)).unwrap();
        let held = lock_root(&ro, Duration::from_millis(50));
        assert!(held.is_ok(), "{:?}", held.err());
        assert!(lock_root(&ro, Duration::from_millis(50)).err().unwrap_or_default().starts_with(LOCKED), "읽기 전용 잠금 파일로도 서로 막아야 한다");
        drop(held);
        write_text(&ro, "someday.md", "- [ ] 가\n").unwrap();

        let dir = temp_root("q5-dir");
        fs::create_dir(dir.join(LOCK_FILE)).unwrap();
        let held = lock_root(&dir, Duration::from_millis(50));
        assert!(held.is_ok(), "{:?}", held.err());
        assert!(lock_root(&dir, Duration::from_millis(50)).err().unwrap_or_default().starts_with(LOCKED));
    }

    #[test]
    fn r4_q7_someday_경로가_한계에_닿아도_쓴다() {
        // /var 같은 심링크가 섞인 경로는 커널이 풀면서 길어져 OS 한계에 먼저 걸린다. 앱이 아니라 경로 탓이라 실제 경로로 잰다
        let mut root = fs::canonicalize(temp_root("q7")).unwrap();
        let want = 1023 - "/someday.md".len();
        while root.as_os_str().len() + 1 + 200 + 2 <= want {
            root = root.join("a".repeat(200));
        }
        let last = want - root.as_os_str().len() - 1;
        root = root.join("b".repeat(last));
        fs::create_dir_all(&root).unwrap();
        assert_eq!(root.join("someday.md").as_os_str().len(), 1023);
        write_text(&root, "someday.md", "- [ ] 가\n").unwrap();
        write_text(&root, "someday.md", "- [ ] 나\n").unwrap();
        assert_eq!(read_text(&root, "someday.md").unwrap().as_deref(), Some("- [ ] 나\n"));
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
    }

    #[test]
    fn r4_끊어진_심링크가_가리키는_폴더가_없으면_만들지_않고_실패한다() {
        let root = temp_root("dangling-dir");
        let ext = temp_root("dangling-dir-ext");
        let target = ext.join("마운트안됨").join("x.md");
        std::os::unix::fs::symlink(&target, root.join("someday.md")).unwrap();
        let e = write_text(&root, "someday.md", "- [ ] 가\n").unwrap_err();
        assert!(e.starts_with("저장하지 못했어요"), "{e}");
        assert!(!ext.join("마운트안됨").exists(), "저장 폴더 밖에 폴더를 만들었다");
    }

    #[test]
    fn r4_잠금을_잡은_뒤_저장_폴더를_다시_확인한다() {
        let old = temp_root("relock-old");
        let new = temp_root("relock-new");
        let current = std::sync::Arc::new(std::sync::Mutex::new(old.clone()));
        let switching = lock_root(&old, CLI_LOCK_WAIT).unwrap();
        let writer = {
            let current = current.clone();
            std::thread::spawn(move || {
                let (root, _lock) = lock_current(|| Ok(current.lock().unwrap().clone()), CLI_LOCK_WAIT).unwrap();
                write_text(&root, "someday.md", "- [ ] 가\n").unwrap();
            })
        };
        std::thread::sleep(Duration::from_millis(200));
        *current.lock().unwrap() = new.clone();
        drop(switching);
        writer.join().unwrap();
        assert!(new.join("someday.md").exists(), "바뀐 폴더에 써야 한다");
        assert!(!old.join("someday.md").exists(), "옛 폴더에 썼다");
    }

    #[test]
    fn r4_enolck도_잠금을_지원하지_않는_것으로_본다() {
        let root = temp_root("enolck");
        let file = fs::OpenOptions::new().create(true).truncate(false).write(true).open(root.join(LOCK_FILE)).unwrap();
        let r = acquire(file, "저장 폴더", Duration::from_millis(50), String::new, |_| Err(fs::TryLockError::Error(std::io::Error::from_raw_os_error(libc::ENOLCK))));
        assert!(r.is_ok(), "{:?}", r.err());
    }

    #[test]
    fn r4_읽기_전용_할_일_파일은_고쳐_쓰지_않는다() {
        use std::os::unix::fs::PermissionsExt;
        let root = temp_root("ro-file");
        write_text(&root, "someday.md", "- [ ] 옛\n").unwrap();
        fs::set_permissions(root.join("someday.md"), fs::Permissions::from_mode(0o444)).unwrap();
        let e = write_text(&root, "someday.md", "- [ ] 새\n").unwrap_err();
        assert!(e.contains("읽기 전용 파일"), "{e}");
        assert!(write_text(&root, "someday.md", "").is_err());
        assert_eq!(write_text_if(&root, "someday.md", "x\n", Some("- [ ] 옛\n")).map_err(|e| e.contains("읽기 전용 파일")), Err(true));
        assert_eq!(fs::read_to_string(root.join("someday.md")).unwrap(), "- [ ] 옛\n");
    }

    #[test]
    fn r4_하드링크는_끊지_않는다() {
        let root = temp_root("hardlink");
        let backup = temp_root("hardlink-backup").join("백업.md");
        write_text(&root, "someday.md", "- [ ] 옛\n").unwrap();
        fs::hard_link(root.join("someday.md"), &backup).unwrap();
        write_text(&root, "someday.md", "- [ ] 새\n").unwrap();
        assert_eq!(fs::read_to_string(&backup).unwrap(), "- [ ] 새\n");
        assert_eq!(fs::read_to_string(root.join("someday.md")).unwrap(), "- [ ] 새\n");
    }

    #[test]
    fn r4_지금_저장_폴더_안의_폴더는_새_저장_폴더로_고를_수_없다() {
        let from = temp_root("inside");
        fs::create_dir_all(from.join("daily")).unwrap();
        fs::write(from.join("daily/2026-10-01.md"), "- [ ] 가\n").unwrap();
        fs::create_dir_all(from.join("하위/깊이")).unwrap();
        for target in [from.join("daily"), from.join("하위/깊이")] {
            let e = prepare_new_root(Some(&from), &target).unwrap_err();
            assert!(e.contains("저장 폴더 안"), "{e}");
        }
        assert!(!from.join("daily/daily").exists());
        // 지금 폴더 그 자체는 고를 수 있다(이미 할 일이 있으니 옮기지 않는다)
        assert_eq!(prepare_new_root(Some(&from), &from), Ok(Prepared::Kept));
    }

    fn enotsup(_: &Path, _: &Path) -> std::io::Result<()> {
        Err(std::io::Error::from_raw_os_error(libc::ENOTSUP))
    }

    /// 옮기고, 실패하면 copy_into_with처럼 옮긴 것을 되돌린다
    fn place_staged_with(staging: &Path, to: &Path, resuming: bool, f: fn(&Path, &Path) -> std::io::Result<()>) -> Result<(), String> {
        let staged = entries(staging, &["daily/2026-10-01.md", "someday.md", "settings.json"]);
        let mut placed = Placed::default();
        super::place_staged_with(staging, to, &staged, resuming, f, &mut placed).inspect_err(|_| remove_placed(to, &placed).unwrap())
    }

    /// dir 안의 파일을 표지 항목(크기·해시)으로. 없는 이름은 빈 항목으로 적는다
    fn entries(dir: &Path, names: &[&str]) -> Vec<Entry> {
        names
            .iter()
            .map(|n| match fs::File::open(dir.join(n)).ok().filter(|f| f.metadata().is_ok_and(|m| m.is_file())) {
                Some(mut f) => {
                    let (size, sha256) = digest(&mut f, |_| Ok(())).unwrap();
                    Entry { name: n.to_string(), size, sha256 }
                }
                None => Entry { name: n.to_string(), size: 0, sha256: String::new() },
            })
            .collect()
    }

    fn staged(name: &str) -> (PathBuf, PathBuf) {
        let staging = temp_root(&format!("{name}-staging"));
        let to = temp_root(&format!("{name}-to"));
        fs::create_dir_all(staging.join("daily")).unwrap();
        fs::write(staging.join("daily/2026-10-01.md"), "- [ ] 하루\n").unwrap();
        fs::write(staging.join("someday.md"), "- [ ] 언젠가\n").unwrap();
        fs::write(staging.join("settings.json"), "{}").unwrap();
        (staging, to)
    }

    #[test]
    fn r5_rename_excl을_모르는_디스크에서도_덮지_않고_옮긴다() {
        let (staging, to) = staged("r5-notsup");
        fs::write(staging.join("daily/._2026-10-01.md"), "AppleDouble").unwrap();
        place_staged_with(&staging, &to, false, enotsup).unwrap();
        assert!(!to.join("daily/._2026-10-01.md").exists());
        assert_eq!(fs::read_to_string(to.join("daily/2026-10-01.md")).unwrap(), "- [ ] 하루\n");
        assert_eq!(fs::read_to_string(to.join("someday.md")).unwrap(), "- [ ] 언젠가\n");
        assert_eq!(fs::read_to_string(to.join("settings.json")).unwrap(), "{}");
        // 그 사이 같은 이름이 생겼으면 덮지 않고, 옮긴 것까지 되돌린다
        let (staging, to) = staged("r5-notsup-exists");
        fs::write(to.join("settings.json"), "{\"남의 것\":1}").unwrap();
        let e = place_staged_with(&staging, &to, false, enotsup).unwrap_err();
        assert!(e.contains("같은 이름이 이미 있어요"), "{e}");
        assert_eq!(fs::read_to_string(to.join("settings.json")).unwrap(), "{\"남의 것\":1}");
        assert_eq!(names_in(&to), vec!["settings.json".to_string()], "실패했는데 옮긴 것이 남았다");
        let (staging, to) = staged("r5-notsup-dir");
        fs::create_dir(to.join("daily")).unwrap();
        assert!(place_staged_with(&staging, &to, false, enotsup).is_err());
        assert_eq!(names_in(&to), vec!["daily".to_string()]);
    }

    #[test]
    fn r5_제자리로_옮기는_순서는_daily_someday_settings다() {
        use std::sync::Mutex;
        static ORDER: Mutex<Vec<String>> = Mutex::new(Vec::new());
        fn record(src: &Path, dst: &Path) -> std::io::Result<()> {
            ORDER.lock().unwrap().push(dst.file_name().unwrap().to_string_lossy().to_string());
            fs::rename(src, dst)
        }
        let (staging, to) = staged("r5-order");
        place_staged_with(&staging, &to, false, record).unwrap();
        assert_eq!(*ORDER.lock().unwrap(), vec!["2026-10-01.md", "someday.md", "settings.json"]);
    }

    /// 실제 디스크 이미지(exFAT·FAT 등)에서 확인한다. ARU_DISK_TO(옮길 디스크 안의 빈 자리)가 있을 때만 돈다.
    /// ARU_DISK_FROM을 주면 지금 저장 폴더도 그 디스크에 둔다(없으면 APFS 임시 폴더)
    #[test]
    fn r6_디스크_사이로_저장_폴더를_바꾼다() {
        let Some(to_base) = std::env::var_os("ARU_DISK_TO").map(PathBuf::from) else { return };
        let from_base = std::env::var_os("ARU_DISK_FROM").map(PathBuf::from).unwrap_or_else(|| temp_root("r6-disk-from"));
        let (from, to) = (from_base.join(format!("from-{}", std::process::id())), to_base.join(format!("target-{}", std::process::id())));
        let _ = fs::remove_dir_all(&from);
        let _ = fs::remove_dir_all(&to);
        fs::create_dir_all(from.join("daily")).unwrap();
        fs::create_dir_all(&to).unwrap();
        for day in ["2026-10-01", "2026-10-02", "2026-10-03"] {
            fs::write(from.join(format!("daily/{day}.md")), format!("- [ ] 한글 {day}\n")).unwrap();
        }
        fs::write(from.join("someday.md"), "- [ ] 언젠가\n").unwrap();
        fs::write(from.join("settings.json"), "{\"opacity\":40}").unwrap();
        assert_eq!(prepare_new_root(Some(&from), &to), Ok(Prepared::Copied));
        assert_eq!(fs::read_to_string(to.join("daily/2026-10-03.md")).unwrap(), "- [ ] 한글 2026-10-03\n");
        assert_eq!(fs::read_to_string(to.join("settings.json")).unwrap(), "{\"opacity\":40}");
        let all = names_in(&to);
        let ours: Vec<&String> = all.iter().filter(|n| !n.rsplit('/').next().unwrap_or_default().starts_with("._")).collect();
        assert_eq!(ours, ["daily", "daily/2026-10-01.md", "daily/2026-10-02.md", "daily/2026-10-03.md", "settings.json", "someday.md"]);
        // 원본 디스크의 `._` 보조 파일은 할 일이 아니다. APFS·HFS는 스스로 만들지 않으니 하나라도 있으면 옮긴 것이다
        let mut fs_info: libc::statfs = unsafe { std::mem::zeroed() };
        let c = CString::new(to.as_os_str().as_bytes()).unwrap();
        assert_eq!(unsafe { libc::statfs(c.as_ptr(), &mut fs_info) }, 0);
        let kind = unsafe { std::ffi::CStr::from_ptr(fs_info.f_fstypename.as_ptr()) }.to_string_lossy().to_string();
        if kind == "apfs" || kind == "hfs" {
            assert_eq!(all.len(), ours.len(), "{kind}에 `._` 보조 파일을 옮겼다: {all:?}");
        }
        fs::write(from.join("someday.md"), "- [ ] 바뀜\n").unwrap();
        assert_eq!(prepare_new_root(Some(&from), &to), Ok(Prepared::Kept));
        assert_eq!(fs::read_to_string(to.join("someday.md")).unwrap(), "- [ ] 언젠가\n");
        let _ = fs::remove_dir_all(&to);
        let _ = fs::remove_dir_all(&from);
    }

    fn within<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> T {
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let _ = tx.send(f());
        });
        rx.recv_timeout(Duration::from_secs(3)).expect("3초 안에 끝나지 않았다(멈춤)")
    }

    #[test]
    fn r5_잠금_파일이_fifo면_멈추지_않고_한국어로_실패한다() {
        let root = temp_root("r5-fifo");
        let c = CString::new(root.join(LOCK_FILE).as_os_str().as_bytes()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(c.as_ptr(), 0o644) }, 0);
        let r = within({
            let root = root.clone();
            move || lock_root(&root, Duration::from_millis(50)).map(|_| ())
        });
        let e = r.unwrap_err();
        assert!(e.contains(".aru.lock") && !e.is_ascii(), "{e}");
    }

    #[test]
    fn r5_잠금_파일이_심링크면_따라가지_않는다() {
        let root = temp_root("r5-locklink");
        let outside = temp_root("r5-locklink-out");
        let target = outside.join("created-by-lock");
        std::os::unix::fs::symlink(&target, root.join(LOCK_FILE)).unwrap();
        let e = lock_root(&root, Duration::from_millis(50)).map(|_| ()).unwrap_err();
        assert!(e.contains(".aru.lock"), "{e}");
        assert!(!target.exists(), "저장 폴더 밖에 파일을 만들었다");
        // 살아 있는 파일을 가리켜도 따라가지 않는다
        fs::write(&target, "남의 것").unwrap();
        assert!(lock_root(&root, Duration::from_millis(50)).is_err());
        assert_eq!(fs::read_to_string(&target).unwrap(), "남의 것");
    }

    #[test]
    fn r5_설정_폴더_잠금은_저장_폴더_잠금과_따로_잡힌다() {
        // 맥에서는 설정 폴더가 곧 기본 저장 폴더다. 같은 파일이면 폴더 변경이 자기 잠금에 막힌다
        let dir = temp_root("r5-config-lock");
        let config = lock_config(&dir, Duration::from_millis(50)).unwrap();
        assert!(config.0.is_some());
        let root = lock_root(&dir, Duration::from_millis(50));
        assert!(root.is_ok(), "{:?}", root.err());
        let busy = lock_config(&dir, Duration::from_millis(50)).err().unwrap_or_default();
        assert!(busy.contains("폴더 설정") && !busy.contains("aru 명령") && !busy.starts_with(LOCKED), "{busy}");
    }

    fn age(path: &Path) {
        let t = SystemTime::now() - Duration::from_secs(2 * 3600);
        let f = fs::File::open(path).unwrap();
        f.set_modified(t).unwrap();
    }

    #[test]
    fn r5_죽은_뒤_남은_staging과_확인용_파일은_한_시간이_지나면_정리한다() {
        let from = temp_root("r5-left-from");
        fs::write(from.join("someday.md"), "- [ ] 가\n").unwrap();
        let to = temp_root("r5-left-to");
        let old_staging = to.join(format!("{STAGING_PREFIX}1a-2"));
        fs::create_dir_all(old_staging.join("daily")).unwrap();
        fs::write(old_staging.join("someday.md"), "- [ ] 옛 사본\n").unwrap();
        fs::write(old_staging.join("daily/2026-10-01.md"), "- [ ] 옛\n").unwrap();
        age(&old_staging.join("daily"));
        age(&old_staging);
        let old_probe = to.join(format!("{PROBE_FILE}-1a-3"));
        fs::write(&old_probe, "aru").unwrap();
        age(&old_probe);
        let fresh_staging = to.join(format!("{STAGING_PREFIX}1a-4"));
        fs::create_dir(&fresh_staging).unwrap();
        let mine = to.join(".aru-staging-내것");
        fs::create_dir(&mine).unwrap();
        age(&mine);
        let mine_probe = to.join(format!("{PROBE_FILE}-메모.txt"));
        fs::write(&mine_probe, "x").unwrap();
        age(&mine_probe);
        // 우리 임시 폴더만 남아 있으면 빈 폴더로 보고 할 일을 옮긴다
        assert_eq!(prepare_new_root(Some(&from), &to), Ok(Prepared::Copied));
        assert!(!old_staging.exists(), "한 시간 넘은 staging이 남았다");
        assert!(!old_probe.exists(), "한 시간 넘은 확인용 파일이 남았다");
        assert!(fresh_staging.exists(), "다른 쪽이 쓰는 중일 수 있는 staging을 지웠다");
        assert!(mine.exists() && mine_probe.exists(), "사용자 것을 지웠다");
        assert_eq!(fs::read_to_string(to.join("someday.md")).unwrap(), "- [ ] 가\n");
        // 지금 저장 폴더에 남은 것도 쓸 때 정리한다
        let leftover = to.join(format!("{STAGING_PREFIX}1a-5"));
        fs::create_dir(&leftover).unwrap();
        age(&leftover);
        write_text(&to, "someday.md", "- [ ] 나\n").unwrap();
        assert!(!leftover.exists());
        // 심링크로 둔 staging 이름은 따라가 지우지 않는다
        let outside = temp_root("r5-left-out");
        fs::write(outside.join("keep.md"), "x").unwrap();
        std::os::unix::fs::symlink(&outside, to.join(format!("{STAGING_PREFIX}1a-6"))).unwrap();
        write_text(&to, "someday.md", "- [ ] 다\n").unwrap();
        assert!(outside.join("keep.md").exists());
    }

    #[test]
    fn r5_하드링크_파일은_쓰는_도중_읽어도_잘린_내용을_보지_않는다() {
        let root = temp_root("r5-hard-read");
        let a = format!("- [ ] {}\n", "가".repeat(200_000));
        let b = format!("- [ ] {}\n", "나".repeat(200_000));
        write_text(&root, "someday.md", &a).unwrap();
        fs::hard_link(root.join("someday.md"), temp_root("r5-hard-read-backup").join("백업.md")).unwrap();
        let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let writer = {
            let (root, stop, a, b) = (root.clone(), stop.clone(), a.clone(), b.clone());
            std::thread::spawn(move || {
                let mut i = 0;
                while !stop.load(Ordering::SeqCst) {
                    {
                        let _lock = lock_root(&root, CLI_LOCK_WAIT).unwrap();
                        write_text(&root, "someday.md", if i % 2 == 0 { &b } else { &a }).unwrap();
                    }
                    i += 1;
                    // flock은 공평하지 않다. 쉬지 않고 다시 잡으면 20ms마다 시도하는 읽기가 끝내 못 잡는다
                    std::thread::sleep(Duration::from_millis(2));
                }
            })
        };
        let mut torn = 0;
        for _ in 0..300 {
            let got = read_text(&root, "someday.md").unwrap().unwrap_or_default();
            if got != a && got != b {
                torn += 1;
            }
        }
        stop.store(true, Ordering::SeqCst);
        writer.join().unwrap();
        assert_eq!(torn, 0, "잘린 내용을 읽었다");
    }

    #[test]
    fn r6_appledouble_파일은_할_일로_옮기지_않는다() {
        let from = temp_root("r6-ad-from");
        fs::create_dir_all(from.join("daily")).unwrap();
        fs::write(from.join("daily/2026-10-01.md"), "- [ ] 하루\n").unwrap();
        fs::write(from.join("daily/._2026-10-01.md"), b"\x00\x05\x16\x07AppleDouble").unwrap();
        fs::write(from.join("someday.md"), "- [ ] 언젠가\n").unwrap();
        let to = temp_root("r6-ad-to");
        assert_eq!(prepare_new_root(Some(&from), &to), Ok(Prepared::Copied));
        assert_eq!(names_in(&to), vec!["daily", "daily/2026-10-01.md", "someday.md"]);
    }

    #[test]
    fn r6_하드링크_파일을_읽을_때_잠금_파일을_만들지_않고_읽기_전용_폴더에서도_읽는다() {
        use std::os::unix::fs::PermissionsExt;
        let root = temp_root("r6-ro-read");
        write_text(&root, "someday.md", "- [ ] 가\n").unwrap();
        fs::hard_link(root.join("someday.md"), temp_root("r6-ro-read-backup").join("백업.md")).unwrap();
        fs::set_permissions(&root, fs::Permissions::from_mode(0o555)).unwrap();
        let got = read_text(&root, "someday.md");
        unlock(&root);
        assert_eq!(got, Ok(Some("- [ ] 가\n".to_string())));
        assert!(!root.join(LOCK_FILE).exists(), "읽기만 했는데 잠금 파일을 만들었다");
    }

    #[test]
    fn r6_다른_쪽이_잠금을_쥐고_있어도_하드링크_파일을_기다리지_않고_읽는다() {
        let root = temp_root("r6-held-read");
        write_text(&root, "someday.md", "- [ ] 가\n").unwrap();
        fs::hard_link(root.join("someday.md"), temp_root("r6-held-read-backup").join("백업.md")).unwrap();
        let _held = lock_root(&root, APP_LOCK_WAIT).unwrap();
        let root2 = root.clone();
        let got = within(move || read_text(&root2, "someday.md"));
        assert_eq!(got, Ok(Some("- [ ] 가\n".to_string())));
    }

    #[test]
    fn r6_복사가_끝나지_않은_폴더는_마저_옮기고_표지에_없는_할_일이_있으면_섞지_않는다() {
        let from = temp_root("r6-resume-from");
        fs::create_dir_all(from.join("daily")).unwrap();
        fs::write(from.join("daily/2026-10-01.md"), "- [ ] 하나\n").unwrap();
        fs::write(from.join("daily/2026-10-02.md"), "- [ ] 둘\n").unwrap();
        fs::write(from.join("someday.md"), "- [ ] 언젠가\n").unwrap();
        fs::write(from.join("settings.json"), "{}").unwrap();
        // daily를 옮기던 중 꺼졌다: 표지와 daily 일부만 남았다
        let to = temp_root("r6-resume-to");
        leave_marker(&from, &to, &["daily/2026-10-01.md", "daily/2026-10-02.md", "someday.md", "settings.json"], 1);
        assert_eq!(prepare_new_root(Some(&from), &to), Ok(Prepared::Copied));
        assert_eq!(names_in(&to), vec!["daily", "daily/2026-10-01.md", "daily/2026-10-02.md", "settings.json", "someday.md"]);
        // 표지에 없는 할 일은 그 사이 남이 둔 것이라 이어 하지 않는다(섞지 않는다)
        let to = temp_root("r6-resume-foreign");
        mark(&from, &to, &[]);
        fs::create_dir_all(to.join("daily")).unwrap();
        fs::write(to.join("daily/2026-10-01.md"), "- [ ] 이미 있던 것\n").unwrap();
        assert_eq!(prepare_new_root(Some(&from), &to), Ok(Prepared::Kept));
        assert_eq!(fs::read_to_string(to.join("daily/2026-10-01.md")).unwrap(), "- [ ] 이미 있던 것\n");
        assert_eq!(names_in(&to), vec!["daily", "daily/2026-10-01.md", "settings.json"]);
        // 표지만 남은 채(제자리로 옮기기 전) 꺼졌어도 모두 옮긴다
        let to = temp_root("r6-resume-marker-only");
        mark(&from, &to, &[]);
        assert_eq!(prepare_new_root(Some(&from), &to), Ok(Prepared::Copied));
        assert_eq!(names_in(&to), vec!["daily", "daily/2026-10-01.md", "daily/2026-10-02.md", "settings.json", "someday.md"]);
        // 표지가 없으면 지금처럼 이미 할 일이 있는 폴더로 본다
        let to = temp_root("r6-resume-none");
        fs::create_dir_all(to.join("daily")).unwrap();
        assert_eq!(prepare_new_root(Some(&from), &to), Ok(Prepared::Kept));
        assert_eq!(names_in(&to), vec!["daily", "settings.json"]);
    }

    #[test]
    fn r6_잠금_파일이_권한_없는_폴더면_권한_오류로_알린다() {
        use std::os::unix::fs::PermissionsExt;
        let root = temp_root("r6-lockdir");
        fs::create_dir(root.join(LOCK_FILE)).unwrap();
        fs::set_permissions(root.join(LOCK_FILE), fs::Permissions::from_mode(0o000)).unwrap();
        let e = lock_root(&root, Duration::from_millis(50)).map(|_| ()).unwrap_err();
        unlock(&root.join(LOCK_FILE));
        assert!(e.contains("권한이 없어요"), "{e}");
    }

    #[test]
    fn r6_설정_폴더_잠금_파일도_링크나_fifo면_따라가지_않고_설정_폴더라고_알린다() {
        let dir = temp_root("r6-config-fifo");
        let c = CString::new(dir.join(CONFIG_LOCK_FILE).as_os_str().as_bytes()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(c.as_ptr(), 0o644) }, 0);
        let e = within({
            let dir = dir.clone();
            move || lock_config(&dir, Duration::from_millis(50)).map(|_| ())
        })
        .unwrap_err();
        assert!(e.contains(CONFIG_LOCK_FILE) && e.contains("설정 폴더") && !e.contains("저장 폴더에"), "{e}");
        let dir = temp_root("r6-config-link");
        let outside = temp_root("r6-config-link-out").join("made");
        std::os::unix::fs::symlink(&outside, dir.join(CONFIG_LOCK_FILE)).unwrap();
        assert!(lock_config(&dir, Duration::from_millis(50)).is_err());
        assert!(!outside.exists(), "설정 폴더 밖에 파일을 만들었다");
    }

    #[test]
    fn r6_수정_시각이_미래인_남은_파일도_오래된_것으로_보고_정리한다() {
        let to = temp_root("r6-future");
        let future = SystemTime::now() + Duration::from_secs(25 * 3600);
        let staging = to.join(format!("{STAGING_PREFIX}1a-2"));
        fs::create_dir(&staging).unwrap();
        fs::File::open(&staging).unwrap().set_modified(future).unwrap();
        let probe = to.join(format!("{PROBE_FILE}-1a-3"));
        fs::write(&probe, "aru").unwrap();
        fs::File::open(&probe).unwrap().set_modified(future).unwrap();
        let tmp = to.join(format!("{TEMP_PREFIX}1a-4.someday.md.tmp"));
        fs::write(&tmp, "x").unwrap();
        fs::File::open(&tmp).unwrap().set_modified(future).unwrap();
        write_text(&to, "someday.md", "- [ ] 가\n").unwrap();
        assert!(!staging.exists() && !probe.exists() && !tmp.exists(), "{:?}", names_in(&to));
    }

    fn mkfifo(path: &Path) {
        let c = CString::new(path.as_os_str().as_bytes()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(c.as_ptr(), 0o644) }, 0);
    }

    #[test]
    fn r7_이어_할_때_표지와_다른_빈_파일이나_잘린_파일이_있으면_덮지_않고_kept() {
        let from = temp_root("r7-repair-from");
        fs::create_dir_all(from.join("daily")).unwrap();
        for (d, t) in [("01", "- [ ] 하나\n"), ("02", "- [ ] 둘째 할 일\n"), ("03", "- [ ] 셋\n"), ("04", "- [ ] 넷\n")] {
            fs::write(from.join(format!("daily/2026-10-{d}.md")), t).unwrap();
        }
        fs::write(from.join("someday.md"), "- [ ] 언젠가\n").unwrap();
        let to = temp_root("r7-repair-to");
        mark(&from, &to, &["daily/2026-10-01.md", "daily/2026-10-02.md", "someday.md"]);
        fs::create_dir_all(to.join("daily")).unwrap();
        // 이름만 만들고 쓰기 전에 꺼진 파일, 쓰다 꺼진 파일, 다른 내용의 파일
        fs::write(to.join("daily/2026-10-01.md"), "").unwrap();
        fs::write(to.join("daily/2026-10-02.md"), "- [ ] 둘").unwrap();
        fs::write(to.join("daily/2026-10-03.md"), "- [ ] 다른 맥\n").unwrap();
        fs::write(to.join("someday.md"), "").unwrap();
        // 우리 쓰기는 다 쓴 뒤 이름을 바꾸므로 빈·잘린 파일은 남이 둔 것과 가려낼 수 없다
        let before = snapshot(&to);
        assert_eq!(prepare_new_root(Some(&from), &to), Ok(Prepared::Kept));
        assert_eq!(snapshot(&to), before.into_iter().filter(|(n, _)| n != COPYING_MARKER).collect::<Vec<_>>(), "표지와 다른 파일을 덮었다");
    }

    #[test]
    fn r7_표지의_출처가_지금_폴더와_다르면_이어_하지_않고_섞지_않는다() {
        let from = temp_root("r7-src-from");
        fs::create_dir_all(from.join("daily")).unwrap();
        fs::write(from.join("daily/2026-10-02.md"), "- [ ] 여기\n").unwrap();
        fs::write(from.join("someday.md"), "- [ ] 언젠가\n").unwrap();
        let to = temp_root("r7-src-to");
        fs::write(to.join(COPYING_MARKER), "/다른/맥의/폴더").unwrap();
        fs::create_dir_all(to.join("daily")).unwrap();
        fs::write(to.join("daily/2026-10-01.md"), "- [ ] 거기\n").unwrap();
        assert_eq!(prepare_new_root(Some(&from), &to), Ok(Prepared::Kept));
        assert_eq!(names_in(&to), vec!["daily", "daily/2026-10-01.md"], "섞었거나, 쓰기 시작한 폴더에 표지를 남겼다");
    }

    #[test]
    fn r7_표지가_폴더거나_끊어진_링크면_표지_이름을_알려_준다() {
        let from = temp_root("r7-marker-kind-from");
        fs::write(from.join("someday.md"), "- [ ] 가\n").unwrap();
        let to = temp_root("r7-marker-dir");
        fs::create_dir(to.join(COPYING_MARKER)).unwrap();
        let e = prepare_new_root(Some(&from), &to).unwrap_err();
        assert!(e.contains(COPYING_MARKER), "{e}");
        let to = temp_root("r7-marker-link");
        std::os::unix::fs::symlink(to.join("없음"), to.join(COPYING_MARKER)).unwrap();
        let e = prepare_new_root(Some(&from), &to).unwrap_err();
        assert!(e.contains(COPYING_MARKER), "{e}");
    }

    #[test]
    fn r7_복사_대체_경로는_같은_이름을_덮지_않고_임시_파일을_남기지_않는다() {
        let base = temp_root("r7-copy-new");
        fs::write(base.join("src.md"), "- [ ] 가\n").unwrap();
        copy_new(&base.join("src.md"), &base.join("dst.md")).unwrap();
        assert_eq!(fs::read_to_string(base.join("dst.md")).unwrap(), "- [ ] 가\n");
        fs::write(base.join("taken.md"), "남의 것\n").unwrap();
        assert_eq!(copy_new(&base.join("src.md"), &base.join("taken.md")).unwrap_err().raw_os_error(), Some(libc::EEXIST));
        assert_eq!(fs::read_to_string(base.join("taken.md")).unwrap(), "남의 것\n");
        assert_eq!(names_in(&base), vec!["dst.md", "src.md", "taken.md"]);
    }

    #[test]
    fn r7_64mib가_넘는_파일은_읽지_않고_너무_크다고_알린다() {
        let root = temp_root("r7-huge");
        fs::File::create(root.join("someday.md")).unwrap().set_len(64 * 1024 * 1024 + 1).unwrap();
        let e = read_text(&root, "someday.md").unwrap_err();
        assert!(e.contains("파일이 너무 커요"), "{e}");
    }

    #[test]
    fn r7_할_일_파일이_fifo면_멈추지_않고_특수_파일이라고_알린다() {
        let root = temp_root("r7-data-fifo");
        mkfifo(&root.join("someday.md"));
        let e = within({
            let root = root.clone();
            move || read_text(&root, "someday.md")
        })
        .unwrap_err();
        assert!(e.contains("특수 파일"), "{e}");
    }

    #[test]
    fn r7_수정_시각이_조금_미래인_임시_파일은_다른_맥이_쓰는_중일_수_있어_남긴다() {
        let to = temp_root("r7-near-future");
        let tmp = to.join(format!("{TEMP_PREFIX}1a-4.someday.md.tmp"));
        fs::write(&tmp, "x").unwrap();
        fs::File::open(&tmp).unwrap().set_modified(SystemTime::now() + Duration::from_secs(2 * 3600)).unwrap();
        let old = to.join(format!("{TEMP_PREFIX}1a-5.someday.md.tmp"));
        fs::write(&old, "x").unwrap();
        fs::File::open(&old).unwrap().set_modified(SystemTime::now() - Duration::from_secs(2 * 3600)).unwrap();
        write_text(&to, "someday.md", "- [ ] 가\n").unwrap();
        assert!(tmp.exists(), "쓰는 중일 수 있는 임시 파일을 지웠다");
        assert!(!old.exists(), "오래된 임시 파일을 남겼다");
    }

    // 고치기 전 코드로 돌리면 프로세스가 죽거나(희소 파일) 메모리를 끝없이 쓴다(/dev/zero) — 고친 뒤에만 넣었다
    #[test]
    fn r7_거대한_희소_파일과_dev_zero_링크도_죽거나_끝없이_읽지_않는다() {
        let root = temp_root("r7-sparse");
        fs::File::create(root.join("someday.md")).unwrap().set_len(1 << 54).unwrap();
        let e = within({
            let root = root.clone();
            move || read_text(&root, "someday.md")
        })
        .unwrap_err();
        assert!(e.contains("파일이 너무 커요"), "{e}");
        fs::remove_file(root.join("someday.md")).unwrap();
        std::os::unix::fs::symlink("/dev/zero", root.join("someday.md")).unwrap();
        let e = within({
            let root = root.clone();
            move || read_text(&root, "someday.md")
        })
        .unwrap_err();
        assert!(e.contains("특수 파일"), "{e}");
    }

    fn mark(from: &Path, to: &Path, files: &[&str]) {
        let m = Marker { source: ensure_source_id(from), files: entries(from, files) };
        write_marker(&to.join(COPYING_MARKER), &m).unwrap();
    }

    /// 복사 도중 강제 종료된 상태를 만든다: 표지와, files 중 앞쪽 일부만 옮겨진 새 폴더
    fn leave_marker(from: &Path, to: &Path, files: &[&str], placed: usize) {
        mark(from, to, files);
        for rel in &files[..placed] {
            if let Some(parent) = to.join(rel).parent() {
                fs::create_dir_all(parent).unwrap();
            }
            fs::copy(from.join(rel), to.join(rel)).unwrap();
        }
    }

    fn snapshot(dir: &Path) -> Vec<(String, Vec<u8>)> {
        names_in(dir).into_iter().filter(|n| !name_is_dir(&dir.join(n))).map(|n| (n.clone(), fs::read(dir.join(&n)).unwrap())).collect()
    }

    fn todo_source(name: &str) -> PathBuf {
        let from = temp_root(name);
        fs::create_dir_all(from.join("daily")).unwrap();
        for d in ["01", "02", "03"] {
            fs::write(from.join(format!("daily/2026-10-{d}.md")), format!("- [ ] {d} 하나\n- [ ] {d} 둘\n")).unwrap();
        }
        fs::write(from.join("someday.md"), "- [ ] 언젠가\n").unwrap();
        fs::write(from.join("settings.json"), "{\"allowExternalAdd\":false}").unwrap();
        from
    }

    #[test]
    fn r8_n1_꺼진_뒤_원본을_고치고_이어_하면_새_폴더는_지금_원본과_똑같다() {
        let from = todo_source("r8-n1-from");
        let to = temp_root("r8-n1-to");
        leave_marker(&from, &to, &["daily/2026-10-01.md", "daily/2026-10-02.md", "settings.json"], 3);
        // 꺼진 뒤에도 저장 폴더는 옛 폴더라 사용자가 그곳을 고친다
        fs::write(from.join("daily/2026-10-01.md"), "- [ ] 새로 넣은 일\n- [x] 01 하나\n- [ ] 01 둘\n").unwrap();
        fs::remove_file(from.join("daily/2026-10-02.md")).unwrap();
        fs::write(from.join("settings.json"), "{\"allowExternalAdd\":true}").unwrap();
        assert_eq!(prepare_new_root(Some(&from), &to), Ok(Prepared::Copied));
        let source: Vec<_> = snapshot(&from).into_iter().filter(|(n, _)| !n.starts_with(".aru")).collect();
        assert_eq!(snapshot(&to), source);
    }

    #[test]
    fn r8_n2_표지가_남은_폴더를_복사_없이_쓰기_시작하면_표지를_지워_나중에_되돌리지_않는다() {
        let a = todo_source("r8-n2-a");
        let t = temp_root("r8-n2-t");
        leave_marker(&a, &t, &["daily/2026-10-01.md", "daily/2026-10-02.md"], 2);
        let c = temp_root("r8-n2-c");
        fs::write(c.join("someday.md"), "- [ ] C 것\n").unwrap();
        assert_eq!(prepare_new_root(Some(&c), &t), Ok(Prepared::Kept));
        assert!(!t.join(COPYING_MARKER).exists(), "Kept로 쓰기 시작한 폴더에 표지가 남았다");
        // T를 쓰면서 고친다
        fs::write(t.join("daily/2026-10-01.md"), "- [ ] 01 하나\n").unwrap();
        fs::remove_file(t.join("daily/2026-10-02.md")).unwrap();
        let todos = |d: &Path| snapshot(d).into_iter().filter(|(n, _)| n.starts_with("daily/")).collect::<Vec<_>>();
        let edited = todos(&t);
        assert_eq!(prepare_new_root(Some(&t), &a), Ok(Prepared::Kept));
        assert_eq!(prepare_new_root(Some(&a), &t), Ok(Prepared::Kept));
        assert_eq!(todos(&t), edited, "사용자가 고친 폴더를 되돌렸다");
    }

    #[test]
    fn r8_n2_지금_폴더를_못_열어_바로_쓰기_시작해도_표지를_지운다() {
        let a = todo_source("r8-n2u-a");
        let t = temp_root("r8-n2u-t");
        leave_marker(&a, &t, &["daily/2026-10-01.md"], 1);
        assert_eq!(prepare_new_root(None, &t), Ok(Prepared::SourceUnavailable));
        assert!(!t.join(COPYING_MARKER).exists());
    }

    #[test]
    fn r8_표지에는_사용자_경로를_적지_않고_다른_곳의_표지면_섞지_않는다() {
        let from = todo_source("r8-plain-from");
        let to = temp_root("r8-plain-to");
        leave_marker(&from, &to, &["daily/2026-10-01.md", "daily/2026-10-02.md"], 1);
        // 이어 하다 폴더 설정을 못 쓰면 표지가 다시 남는다. 그 표지를 본다
        assert!(super::prepare_new_root(Some(&from), &to, || Err("x".into())).is_err());
        let marker = fs::read(to.join(COPYING_MARKER)).unwrap();
        let path = fs::canonicalize(&from).unwrap();
        let text = String::from_utf8_lossy(&marker);
        assert!(!text.contains(path.to_string_lossy().as_ref()) && !text.contains("aru-test"), "{text}");
        // 같은 경로라도 다른 맥(다른 폴더)의 표지면 이어 하지 않는다
        let other = temp_root("r8-plain-other");
        fs::create_dir_all(other.join("daily")).unwrap();
        fs::write(other.join("daily/2026-10-05.md"), "- [ ] 다른 맥\n").unwrap();
        let before = snapshot(&to);
        assert_eq!(prepare_new_root(Some(&other), &to), Ok(Prepared::Kept));
        assert_eq!(snapshot(&to).into_iter().filter(|(n, _)| n != COPYING_MARKER).collect::<Vec<_>>(), before.into_iter().filter(|(n, _)| n != COPYING_MARKER).collect::<Vec<_>>());
        assert!(!to.join(COPYING_MARKER).exists());
    }

    #[test]
    fn r8_지금_폴더의_실제_경로를_못_구해도_이미_할_일이_있는_폴더로는_바꾼다() {
        let kept = temp_root("r8-canon-kept");
        fs::write(kept.join("someday.md"), "- [ ] 저기\n").unwrap();
        let gone = temp_root("r8-canon-gone");
        fs::remove_dir_all(&gone).unwrap();
        assert_eq!(prepare_new_root(Some(&gone), &kept), Ok(Prepared::Kept));
    }

    #[test]
    fn r8_n3_64mb가_넘는_할_일_파일이_있어도_폴더는_바뀌고_바이트_그대로_옮긴다() {
        let from = temp_root("r8-big-from");
        fs::create_dir_all(from.join("daily")).unwrap();
        let big = from.join("daily/2026-10-18.md");
        fs::File::create(&big).unwrap().set_len(MAX_READ + 1).unwrap();
        fs::write(from.join("daily/2026-10-17.md"), "- [ ] 하나\n").unwrap();
        let to = temp_root("r8-big-to");
        assert_eq!(prepare_new_root(Some(&from), &to), Ok(Prepared::Copied));
        assert_eq!(fs::metadata(to.join("daily/2026-10-18.md")).unwrap().len(), MAX_READ + 1);
        assert_eq!(fs::read_to_string(to.join("daily/2026-10-17.md")).unwrap(), "- [ ] 하나\n");
    }

    #[test]
    fn r8_복사_대체_경로는_다_쓰기_전에는_이름을_보이지_않는다() {
        let base = temp_root("r8-claim");
        fs::write(base.join("src.json"), vec![b'x'; 32 * 1024 * 1024]).unwrap();
        let dst = base.join("settings.json");
        let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let watcher = {
            let (dst, stop) = (dst.clone(), stop.clone());
            std::thread::spawn(move || {
                let mut short = 0;
                while !stop.load(Ordering::Relaxed) {
                    if fs::metadata(&dst).is_ok_and(|m| m.len() < 32 * 1024 * 1024) {
                        short += 1;
                    }
                }
                short
            })
        };
        copy_new(&base.join("src.json"), &dst).unwrap();
        stop.store(true, Ordering::Relaxed);
        assert_eq!(watcher.join().unwrap(), 0, "다 쓰기 전의 빈 파일이 보였다(꺼지면 빈 설정으로 남는다)");
    }

    #[test]
    fn r8_fifo_위로_써도_잠금을_쥔_채_멈추지_않는다() {
        let root = temp_root("r8-write-fifo");
        mkfifo(&root.join("someday.md"));
        let r = within({
            let root = root.clone();
            move || write_text(&root, "someday.md", "- [ ] 가\n")
        });
        assert_eq!(r, Ok(()));
        assert_eq!(fs::read_to_string(root.join("someday.md")).unwrap(), "- [ ] 가\n");
    }

    #[test]
    fn r8_폴더_설정을_못_쓰고_되돌리기도_못하면_오류에_함께_알린다() {
        use std::os::unix::fs::PermissionsExt;
        let from = todo_source("r8-rollback-from");
        let to = temp_root("r8-rollback-to");
        let lock = to.clone();
        let e = super::prepare_new_root(Some(&from), &to, move || {
            fs::set_permissions(&lock, fs::Permissions::from_mode(0o555)).unwrap();
            Err("폴더 설정을 저장하지 못했어요: x".into())
        })
        .unwrap_err();
        unlock(&to);
        assert!(e.starts_with("폴더 설정을 저장하지 못했어요: x"), "{e}");
        assert!(e.contains("되돌리지 못했어요"), "{e}");
    }

    #[test]
    fn r8_원자적_쓰기의_오류는_언제나_저장하지_못했다로_시작한다() {
        let e = write_atomic(Path::new("/"), "x").unwrap_err();
        assert!(e.starts_with("저장하지 못했어요: "), "{e}");
    }

    #[test]
    fn r8_표지는_폴더_설정을_쓴_뒤에_지우고_쓰기_시작한_폴더의_표지는_잠글_때_지운다() {
        let from = todo_source("r8-order-from");
        let to = temp_root("r8-order-to");
        let seen = std::cell::Cell::new(None);
        super::prepare_new_root(Some(&from), &to, || {
            seen.set(Some(to.join(COPYING_MARKER).exists()));
            Ok(())
        })
        .unwrap();
        assert_eq!(seen.get(), Some(true), "commit 전에 표지를 지우면, 그 사이 꺼졌을 때 다시 해도 Kept가 되어 그 뒤 고친 것이 빠진다");
        assert!(!to.join(COPYING_MARKER).exists());
        // commit 뒤 표지를 지우기 전에 꺼졌다: 그 폴더에 처음 쓸 때(잠금) 지운다
        mark(&from, &to, &["daily/2026-10-01.md"]);
        drop(lock_root(&to, Duration::from_millis(50)).unwrap());
        assert!(!to.join(COPYING_MARKER).exists());
    }

    #[test]
    fn r8_표지의_파일_목록은_옮기는_이름만_믿고_밖은_지우지_않는다() {
        let from = todo_source("r8-escape-from");
        let base = temp_root("r8-escape");
        let to = base.join("to");
        fs::create_dir_all(&to).unwrap();
        fs::write(base.join("outside.md"), "남의 파일\n").unwrap();
        fs::write(to.join("note.md"), "사용자 메모\n").unwrap();
        mark(&from, &to, &["../outside.md", "note.md", "/tmp/x.md", "daily/../../outside.md"]);
        // 우리가 적지 않는 이름이 있으면 우리 표지가 아니다
        assert_eq!(prepare_new_root(Some(&from), &to), Ok(Prepared::Copied));
        assert!(!to.join(COPYING_MARKER).exists());
        assert!(base.join("outside.md").exists(), "저장 폴더 밖 파일을 지웠다");
        assert!(to.join("note.md").exists(), "옮기는 파일이 아닌 사용자 파일을 지웠다");
    }

    #[test]
    fn r9_n2_새_폴더의_daily가_링크면_이어_하지_않고_링크_너머를_지우지_않는다() {
        let from = todo_source("r9-link-from");
        let base = temp_root("r9-link");
        let (to, outside) = (base.join("to"), base.join("outside"));
        fs::create_dir_all(&to).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("2026-10-01.md"), "- [ ] 링크 너머 할 일\n").unwrap();
        fs::write(outside.join(".aru-tmp-1-1"), "링크 너머 임시 이름 파일").unwrap();
        std::os::unix::fs::symlink(&outside, to.join("daily")).unwrap();
        mark(&from, &to, &["daily/2026-10-01.md"]);
        assert_eq!(prepare_new_root(Some(&from), &to), Ok(Prepared::Kept));
        assert_eq!(fs::read_to_string(outside.join("2026-10-01.md")).unwrap(), "- [ ] 링크 너머 할 일\n", "링크 너머 파일을 지웠다");
        assert!(outside.join(".aru-tmp-1-1").exists(), "링크 너머의 임시 이름 파일을 지웠다");
        assert!(fs::symlink_metadata(to.join("daily")).unwrap().file_type().is_symlink());
        assert!(!to.join(COPYING_MARKER).exists());

        let to = base.join("to2");
        fs::create_dir_all(&to).unwrap();
        fs::write(outside.join("someday.md"), "- [ ] 링크 너머 언젠가\n").unwrap();
        std::os::unix::fs::symlink(outside.join("someday.md"), to.join("someday.md")).unwrap();
        mark(&from, &to, &["someday.md"]);
        assert_eq!(prepare_new_root(Some(&from), &to), Ok(Prepared::Kept));
        assert!(fs::symlink_metadata(to.join("someday.md")).unwrap().file_type().is_symlink(), "사용자가 만든 링크를 지웠다");
        assert_eq!(fs::read_to_string(outside.join("someday.md")).unwrap(), "- [ ] 링크 너머 언젠가\n");
    }

    /// 다른 맥의 동기화처럼, daily 파일을 제자리로 옮기기 시작할 때 남의 daily·someday·settings가 새 폴더에 생긴다
    fn foreign_arrives(src: &Path, dst: &Path) -> std::io::Result<()> {
        let to = dst.parent().unwrap().parent().unwrap();
        if dst.parent().unwrap().file_name().is_some_and(|n| n == "daily") && !to.join("daily/2099-01-01.md").exists() {
            fs::write(to.join("daily/2026-10-01.md"), "- [ ] 다른 맥 01\n")?;
            fs::write(to.join("daily/2099-01-01.md"), "- [ ] 다른 맥에만 있는 날\n")?;
            fs::write(to.join("someday.md"), "- [ ] 다른 맥 언젠가\n")?;
            fs::write(to.join("settings.json"), "{\"opacity\":0.9}")?;
        }
        rename_excl(src, dst)
    }

    #[test]
    fn r10_b1_첫_복사가_남의_파일과_부딪혀_실패하면_표지를_지워_다시_해도_남의_파일을_덮지_않는다() {
        let from = todo_source("r10-b1-from");
        let to = temp_root("r10-b1-to");
        let e = super::copy_into_with(&from, &to, || Ok(()), foreign_arrives).unwrap_err();
        assert!(e.contains("같은 이름이 이미 있어요"), "{e}");
        assert!(!to.join(COPYING_MARKER).exists(), "되돌린 첫 복사의 표지가 남았다");
        let foreign = snapshot(&to);
        assert_eq!(prepare_new_root(Some(&from), &to), Ok(Prepared::Kept));
        assert_eq!(snapshot(&to), foreign, "다시 하니 남의 파일을 덮었다");
    }

    #[test]
    fn r10_b2_지우는_순간_daily가_링크여도_링크_너머를_지우지_않는다() {
        let base = temp_root("r10-b2");
        let (to, outside) = (base.join("to"), base.join("outside"));
        fs::create_dir_all(&to).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("2026-10-01.md"), "- [ ] 링크 너머\n").unwrap();
        std::os::unix::fs::symlink(&outside, to.join("daily")).unwrap();
        let listed = entries(&outside, &["2026-10-01.md"]).into_iter().map(|e| Entry { name: format!("daily/{}", e.name), ..e }).collect::<Vec<_>>();
        let e = remove_ours(&to, &listed).unwrap_err();
        assert!(e.contains("링크"), "{e}");
        assert!(outside.join("2026-10-01.md").exists(), "링크 너머 파일을 지웠다");
        // 같은 이름의 폴더는 우리가 둔 것이 아니라 남긴다
        let to = base.join("to2");
        fs::create_dir_all(to.join("daily/2026-10-01.md")).unwrap();
        assert_eq!(remove_ours(&to, &listed), Ok(()));
        assert!(to.join("daily/2026-10-01.md").is_dir());
    }

    #[test]
    fn r10_지울_수_없는_표지_항목이_폴더_변경을_영영_막지_않는다() {
        let from = todo_source("r10-nul-from");
        let to = temp_root("r10-nul-to");
        let id = ensure_source_id(&from);
        fs::write(to.join(COPYING_MARKER), format!("{{\"source\":\"{id}\",\"files\":[{{\"name\":\"daily/a\\u0000.md\",\"size\":0,\"sha256\":\"\"}}]}}")).unwrap();
        // 우리가 적지 않는 이름이 든 표지는 남의 것으로 보고 이어 하지 않는다
        assert_eq!(prepare_new_root(Some(&from), &to), Ok(Prepared::Copied));
        let to = temp_root("r10-nul-to2");
        fs::create_dir_all(to.join("daily")).unwrap();
        fs::write(to.join("daily/2026-10-09.md"), "- [ ] 다른 맥\n").unwrap();
        fs::write(to.join(COPYING_MARKER), format!("{{\"source\":\"{id}\",\"files\":[{{\"name\":\"daily/a\\u0000.md\",\"size\":0,\"sha256\":\"\"}}]}}")).unwrap();
        assert_eq!(prepare_new_root(Some(&from), &to), Ok(Prepared::Kept));
        assert!(!to.join(COPYING_MARKER).exists());
        // 우리는 파일만 옮기므로 목록 이름의 폴더는 남이 만든 것이다
        let to = temp_root("r10-dirent-to");
        fs::create_dir_all(to.join("daily/2026-10-01.md")).unwrap();
        mark(&from, &to, &["daily/2026-10-01.md"]);
        assert_eq!(prepare_new_root(Some(&from), &to), Ok(Prepared::Kept));
        assert!(to.join("daily/2026-10-01.md").is_dir());
        assert!(!to.join(COPYING_MARKER).exists());
    }

    #[test]
    fn r10_표지_목록이_길어도_금방_맞춘다() {
        let from = temp_root("r10-huge-from");
        fs::create_dir_all(from.join("daily")).unwrap();
        for i in 0..1000 {
            fs::write(from.join(format!("daily/2030-{i}.md")), "- [ ] x\n").unwrap();
        }
        // 파일마다 fsync하는 비용은 목록 길이와 상관없으니, 빈 목록과 견준다
        let took = |name: &str, n: usize| {
            let to = temp_root(name);
            let m = Marker { source: ensure_source_id(&from), files: (0..n).map(|i| Entry { name: format!("daily/y{i}.md"), size: 0, sha256: String::new() }).collect() };
            write_marker(&to.join(COPYING_MARKER), &m).unwrap();
            let start = Instant::now();
            assert_eq!(prepare_new_root(Some(&from), &to), Ok(Prepared::Copied));
            start.elapsed()
        };
        let (base, long) = (took("r10-huge-to0", 0), took("r10-huge-to1", 300_000));
        assert!(long < base + Duration::from_secs(3), "빈 목록 {base:?}, 30만 개 {long:?}");
    }

    #[test]
    fn r10_원본에_아이디를_못_남겨도_꺼진_복사를_이어_한다() {
        use std::os::unix::fs::PermissionsExt;
        let from = todo_source("r10-ro-from");
        fs::set_permissions(&from, fs::Permissions::from_mode(0o555)).unwrap();
        let to = temp_root("r10-ro-to");
        leave_marker(&from, &to, &["daily/2026-10-01.md", "daily/2026-10-02.md", "daily/2026-10-03.md", "someday.md", "settings.json"], 1);
        let r = prepare_new_root(Some(&from), &to);
        unlock(&from);
        assert_eq!(r, Ok(Prepared::Copied));
        // exFAT 등은 ._ 보조 파일을 스스로 만든다
        let todos = |d: &Path| snapshot(d).into_iter().filter(|(n, _)| !n.contains("/._") && !n.starts_with("._") && !n.starts_with(".aru")).collect::<Vec<_>>();
        assert_eq!(todos(&to), todos(&from));
        // .aru-id 자리에 폴더가 있어도 늘 같은 아이디다
        let from = todo_source("r10-iddir-from");
        fs::create_dir(from.join(SOURCE_ID)).unwrap();
        let id = ensure_source_id(&from);
        assert_eq!(source_id(&from), Some(id));
    }

    #[test]
    fn r10_앱이_쓰는_파일도_읽기_상한을_넘지_않는다() {
        let root = temp_root("r10-cap");
        let exact = "a".repeat(MAX_READ as usize);
        write_text(&root, "someday.md", &exact).unwrap();
        let e = write_text(&root, "someday.md", &format!("{exact}b")).unwrap_err();
        assert!(e.starts_with("저장하지 못했어요: ") && e.contains("64MB"), "{e}");
        assert_eq!(fs::metadata(root.join("someday.md")).unwrap().len(), MAX_READ);
    }

    /// 다른 맥의 동기화처럼 새 폴더에 daily/2099와 someday가 생긴다
    fn arrive(to: &Path) -> std::io::Result<()> {
        fs::create_dir_all(to.join("daily"))?;
        fs::write(to.join("daily/2099-01-01.md"), "- [ ] 다른 맥에만 있는 날\n")?;
        fs::write(to.join("someday.md"), "- [ ] 다른 맥 언젠가\n")
    }

    fn foreign_before_someday(src: &Path, dst: &Path) -> std::io::Result<()> {
        if dst.file_name().is_some_and(|n| n == "someday.md") {
            arrive(dst.parent().unwrap())?;
        }
        rename_excl(src, dst)
    }

    /// exFAT·SMB처럼 RENAME_EXCL이 없어 복사로 두는 경로
    fn foreign_before_someday_notsup(src: &Path, dst: &Path) -> std::io::Result<()> {
        if dst.file_name().is_some_and(|n| n == "someday.md") {
            arrive(dst.parent().unwrap())?;
        }
        enotsup(src, dst)
    }

    #[test]
    fn r11_되돌릴_때_그_사이_daily에_들어온_남의_파일은_지우지_않는다() {
        let places: [(&str, fn(&Path, &Path) -> std::io::Result<()>); 2] = [("r11-undo", foreign_before_someday), ("r11-undo-copy", foreign_before_someday_notsup)];
        for (name, place) in places {
            let from = todo_source(&format!("{name}-from"));
            let to = temp_root(&format!("{name}-to"));
            let e = super::copy_into_with(&from, &to, || Ok(()), place).unwrap_err();
            assert!(e.contains("같은 이름이 이미 있어요"), "{name}: {e}");
            assert_eq!(fs::read_to_string(to.join("daily/2099-01-01.md")).ok().as_deref(), Some("- [ ] 다른 맥에만 있는 날\n"), "{name}: 되돌리며 남의 파일을 지웠다");
            assert_eq!(names_in(&to), vec!["daily", "daily/2099-01-01.md", "someday.md"], "{name}: 우리가 옮긴 것을 남겼다");
        }
        // 폴더 설정을 못 써서 되돌릴 때도
        let from = todo_source("r11-undo-commit-from");
        let to = temp_root("r11-undo-commit-to");
        let t = to.clone();
        let r = super::copy_into_with(
            &from,
            &to,
            move || {
                fs::write(t.join("daily/2099-01-01.md"), "- [ ] 다른 맥에만 있는 날\n").unwrap();
                Err("x".into())
            },
            rename_excl,
        );
        assert!(r.is_err());
        assert_eq!(names_in(&to), vec!["daily", "daily/2099-01-01.md"]);
        // 남의 것이 없으면 daily까지 지워 처음 그대로 둔다
        let to = temp_root("r11-undo-clean-to");
        assert!(super::copy_into_with(&from, &to, || Err("x".into()), rename_excl).is_err());
        assert_eq!(names_in(&to), Vec::<String>::new());
    }

    #[test]
    fn r11_이어_할_때_우리가_둔_것과_다른_할_일_파일이_있으면_섞지_않고_kept() {
        let from = todo_source("r11-resume-from");
        let todos = |d: &Path| snapshot(d).into_iter().filter(|(n, _)| n.starts_with("daily/") || n == "someday.md").collect::<Vec<_>>();
        // 우리가 둔 파일을 다른 맥이 같은 이름으로 바꿨다
        let to = temp_root("r11-resume-changed");
        leave_marker(&from, &to, &["daily/2026-10-01.md", "daily/2026-10-02.md", "someday.md"], 2);
        fs::write(to.join("daily/2026-10-01.md"), "- [ ] 다른 맥\n").unwrap();
        let before = todos(&to);
        assert_eq!(prepare_new_root(Some(&from), &to), Ok(Prepared::Kept));
        assert_eq!(todos(&to), before, "그 사이 바뀐 파일을 덮었다");
        // 표지에 없는 남의 할 일 파일이 들어왔다
        let to = temp_root("r11-resume-extra");
        leave_marker(&from, &to, &["daily/2026-10-01.md", "daily/2026-10-02.md"], 1);
        fs::write(to.join("daily/2099-01-01.md"), "- [ ] 다른 맥에만 있는 날\n").unwrap();
        let before = todos(&to);
        assert_eq!(prepare_new_root(Some(&from), &to), Ok(Prepared::Kept));
        assert_eq!(todos(&to), before, "남의 daily와 섞었다");
        // 목록이 빈 표지인데 남의 할 일이 있다
        let to = temp_root("r11-resume-empty");
        mark(&from, &to, &[]);
        fs::create_dir_all(to.join("daily")).unwrap();
        fs::write(to.join("daily/2026-10-01.md"), "- [ ] 다른 맥 1001\n").unwrap();
        fs::write(to.join("someday.md"), "- [ ] 다른 맥 언젠가\n").unwrap();
        let before = todos(&to);
        assert_eq!(prepare_new_root(Some(&from), &to), Ok(Prepared::Kept));
        assert_eq!(todos(&to), before, "빈 목록으로 이어 하며 섞었다");
        // 표지 그대로면 지금처럼 이어 한다
        let to = temp_root("r11-resume-same");
        leave_marker(&from, &to, &["daily/2026-10-01.md", "daily/2026-10-02.md", "someday.md"], 2);
        assert_eq!(prepare_new_root(Some(&from), &to), Ok(Prepared::Copied));
        assert_eq!(todos(&to), todos(&from));
    }

    #[test]
    fn r11_너무_큰_표지는_남의_표지로_보고_막히지_않는다() {
        let from = todo_source("r11-bigmark-from");
        let to = temp_root("r11-bigmark-to");
        fs::File::create(to.join(COPYING_MARKER)).unwrap().set_len(MAX_READ + 1).unwrap();
        fs::create_dir_all(to.join("daily")).unwrap();
        fs::write(to.join("daily/2026-10-01.md"), "- [ ] 다른 맥\n").unwrap();
        assert_eq!(prepare_new_root(Some(&from), &to), Ok(Prepared::Kept));
        assert!(!to.join(COPYING_MARKER).exists());
        assert_eq!(fs::read_to_string(to.join("daily/2026-10-01.md")).unwrap(), "- [ ] 다른 맥\n");
    }

    #[test]
    fn r11_대신_아이디는_다시_마운트하면_바뀌는_dev_번호를_쓰지_않는다() {
        let from = todo_source("r11-fid");
        let dev = fs::metadata(&from).unwrap().dev() as u64;
        assert!(volume_uuid(&from).is_some(), "APFS 볼륨의 UUID를 읽지 못했다");
        let id = folder_id(&from).unwrap();
        assert!(!id.contains(&format!("{dev:016x}")), "{id}");
        assert_eq!(folder_id(&from).as_ref(), Some(&id));
        assert_ne!(folder_id(&todo_source("r11-fid-other")).as_ref(), Some(&id));
        // 실제 디스크를 다시 붙여 확인할 때만(ARU_ID_DIR): 아이디를 찍는다
        if let Some(dir) = std::env::var_os("ARU_ID_DIR") {
            println!("ARU_FOLDER_ID {:?}", folder_id(Path::new(&dir)));
        }
    }
}
