use std::ffi::OsStr;
use std::fs;
use std::os::windows::ffi::OsStrExt;
use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
use std::os::windows::io::AsRawHandle;
use std::path::{Path, PathBuf};
use std::time::Duration;

use windows_sys::Win32::Foundation::*;
use windows_sys::Win32::Security::Cryptography::{BCryptGenRandom, BCRYPT_USE_SYSTEM_PREFERRED_RNG};
use windows_sys::Win32::Storage::FileSystem::{
    FileBasicInfo, FileDispositionInfo, FileDispositionInfoEx, GetFileInformationByHandle, GetFileType, MoveFileExW, SetFileInformationByHandle,
    BY_HANDLE_FILE_INFORMATION, DELETE, FILE_ATTRIBUTE_ARCHIVE, FILE_ATTRIBUTE_HIDDEN, FILE_ATTRIBUTE_NORMAL, FILE_ATTRIBUTE_READONLY,
    FILE_ATTRIBUTE_REPARSE_POINT, FILE_ATTRIBUTE_SYSTEM, FILE_BASIC_INFO, FILE_DISPOSITION_FLAG_DELETE, FILE_DISPOSITION_FLAG_POSIX_SEMANTICS,
    FILE_DISPOSITION_INFO, FILE_DISPOSITION_INFO_EX, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_READ_ATTRIBUTES, FILE_TYPE_DISK,
};

use crate::storage::OsErr;

// 공통 코드와 이 파일이 만들어 내는 오류. 이름은 맥에서 같은 자리에 쓰는 errno이고, os_error가 전부 같은 말로 옮긴다
pub(crate) const EAGAIN: i32 = ERROR_RETRY as i32;
pub(crate) const EEXIST: i32 = ERROR_ALREADY_EXISTS as i32;
pub(crate) const EFBIG: i32 = ERROR_FILE_TOO_LARGE as i32;
pub(crate) const EIO: i32 = ERROR_IO_DEVICE as i32;
pub(crate) const ELOOP: i32 = ERROR_STOPPED_ON_SYMLINK as i32;
pub(crate) const ENOMEM: i32 = ERROR_NOT_ENOUGH_MEMORY as i32;
pub(crate) const ENOTDIR: i32 = ERROR_DIRECTORY as i32;
const EISDIR: i32 = ERROR_DIRECTORY_NOT_SUPPORTED as i32;
const ESPIPE: i32 = ERROR_BAD_FILE_TYPE as i32;

pub(crate) const READ_ONLY_FIX: &str = "파일 속성에서 읽기 전용을 풀면";

fn err(code: i32) -> std::io::Error {
    std::io::Error::from_raw_os_error(code)
}

fn is_reparse(m: &fs::Metadata) -> bool {
    m.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

/// 잠금 파일을 연다. Err(None)은 링크 같은 쓸 수 없는 종류라는 뜻이다.
/// FILE_FLAG_OPEN_REPARSE_POINT로 링크 자체를 열고, 열린 것이 링크면 거부한다(맥의 O_NOFOLLOW). 따라가면 저장 폴더 밖에 파일을 만든다
pub(crate) fn open_lock(path: &Path) -> Result<fs::File, Option<std::io::Error>> {
    let file = match fs::OpenOptions::new().create(true).truncate(false).write(true).custom_flags(FILE_FLAG_OPEN_REPARSE_POINT).open(path) {
        Ok(file) => file,
        // 같은 이름의 폴더여도 맥처럼 읽기로 열어 잠가 본다. 폴더는 BACKUP_SEMANTICS 없이는 열리지 않는다
        Err(e) => match fs::OpenOptions::new().read(true).custom_flags(FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS).open(path) {
            Ok(file) => file,
            Err(_) if fs::symlink_metadata(path).is_ok_and(|m| !m.is_file() && !m.is_dir()) => return Err(None),
            Err(read) if fs::symlink_metadata(path).is_ok_and(|m| m.is_dir()) => return Err(Some(read)),
            Err(_) => return Err(Some(e)),
        },
    };
    match file.metadata() {
        Ok(m) if is_reparse(&m) => Err(None),
        Ok(m) if m.is_file() || m.is_dir() => Ok(file),
        Ok(_) => Err(None),
        Err(e) => Err(Some(e)),
    }
}

pub(crate) fn lock_unsupported(e: &std::io::Error) -> bool {
    e.kind() == std::io::ErrorKind::Unsupported || e.raw_os_error().is_some_and(|c| c == ERROR_INVALID_FUNCTION as i32 || c == ERROR_NOT_SUPPORTED as i32)
}

fn info_of(file: &fs::File) -> std::io::Result<BY_HANDLE_FILE_INFORMATION> {
    let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
    if unsafe { GetFileInformationByHandle(file.as_raw_handle() as HANDLE, &mut info) } == 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(info)
}

// 링크 수·파일 번호·볼륨 일련번호는 std에서 아직 불안정(windows_by_handle)이라 핸들에 직접 묻는다.
// 폴더는 BACKUP_SEMANTICS 없이 열면 ACCESS_DENIED다. 속성 읽기 권한만 청하므로 다른 프로그램의 공유 금지에 걸리지 않는다
fn info_at(path: &Path) -> std::io::Result<BY_HANDLE_FILE_INFORMATION> {
    let file = fs::OpenOptions::new().access_mode(FILE_READ_ATTRIBUTES).custom_flags(FILE_FLAG_BACKUP_SEMANTICS).open(path)?;
    info_of(&file)
}

fn joined(high: u32, low: u32) -> u64 {
    (high as u64) << 32 | low as u64
}

pub(crate) struct Stamp {
    pub(crate) len: u64,
    pub(crate) links: u64,
    key: (u64, u64, u32, u64),
}

impl Stamp {
    pub(crate) fn same(&self, other: &Stamp) -> bool {
        self.key == other.key
    }
}

pub(crate) fn stamp(file: &fs::File) -> std::io::Result<Stamp> {
    let i = info_of(file)?;
    let len = joined(i.nFileSizeHigh, i.nFileSizeLow);
    let written = joined(i.ftLastWriteTime.dwHighDateTime, i.ftLastWriteTime.dwLowDateTime);
    Ok(Stamp { len, links: i.nNumberOfLinks as u64, key: (len, written, i.nNumberOfLinks, joined(i.nFileIndexHigh, i.nFileIndexLow)) })
}

pub(crate) fn links(path: &Path, _: &fs::Metadata) -> u64 {
    info_at(path).map(|i| i.nNumberOfLinks as u64).unwrap_or(1)
}

pub(crate) fn file_id(path: &Path, _: &fs::Metadata) -> Option<(u64, u64)> {
    info_at(path).ok().map(|i| (i.dwVolumeSerialNumber as u64, joined(i.nFileIndexHigh, i.nFileIndexLow)))
}

/// 일반 파일만 연다(사용자 심링크는 따라간다). 예약 장치 이름(CON·NUL)이나 파이프를 가리키는 링크는 끝이 없거나 멈출 수 있다.
/// 미리 본 종류와 연 뒤의 종류를 둘 다 본다
pub(crate) fn open_regular(path: &Path) -> std::io::Result<Option<fs::File>> {
    let special = |m: &fs::Metadata| err(if m.is_dir() { EISDIR } else { ESPIPE });
    // 폴더는 BACKUP_SEMANTICS 없이 열면 ACCESS_DENIED라, 열기 전에 가려야 맞는 오류를 낸다
    let opened = match fs::metadata(path) {
        Ok(m) if !m.is_file() => return Err(special(&m)),
        Ok(_) => fs::OpenOptions::new().read(true).open(path),
        Err(e) => Err(e),
    };
    let file = match opened {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        r => r?,
    };
    let meta = file.metadata()?;
    if !meta.is_file() || unsafe { GetFileType(file.as_raw_handle() as HANDLE) } != FILE_TYPE_DISK {
        return Err(special(&meta));
    }
    Ok(Some(file))
}

/// 읽기 전용·숨김·시스템·보관 속성만 옮긴다. ACL·대체 데이터 스트림은 옮기지 않는다(설계 D3)
pub(crate) fn copy_meta(_: &Path, meta: &fs::Metadata, tmp: &fs::File) {
    let attrs = meta.file_attributes() & (FILE_ATTRIBUTE_READONLY | FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM | FILE_ATTRIBUTE_ARCHIVE);
    // 시각이 0이면 그 시각은 바꾸지 않는다. 속성 0도 「바꾸지 않음」이라 NORMAL로 지운다
    let info = FILE_BASIC_INFO { CreationTime: 0, LastAccessTime: 0, LastWriteTime: 0, ChangeTime: 0, FileAttributes: if attrs == 0 { FILE_ATTRIBUTE_NORMAL } else { attrs } };
    unsafe { SetFileInformationByHandle(tmp.as_raw_handle() as HANDLE, FileBasicInfo, (&raw const info).cast(), size_of::<FILE_BASIC_INFO>() as u32) };
}

pub(crate) fn no_follow(options: &mut fs::OpenOptions) -> &mut fs::OpenOptions {
    options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
}

// Windows에는 폴더 핸들 기준(*at) 열기가 없어 경로로 다룬다. 확인한 뒤 폴더 자체가 바뀌치기되는 경합은 막지 못한다(설계 10장)
pub(crate) struct Dir(PathBuf);

impl Dir {
    pub(crate) fn open(path: &Path) -> std::io::Result<Dir> {
        match fs::metadata(path)? {
            m if m.is_dir() => Ok(Dir(path.to_path_buf())),
            _ => Err(err(ENOTDIR)),
        }
    }

    pub(crate) fn create_new(&self, name: &str) -> std::io::Result<fs::File> {
        fs::OpenOptions::new().write(true).create_new(true).custom_flags(FILE_FLAG_OPEN_REPARSE_POINT).open(self.0.join(name))
    }

    /// 백신·동기화 프로그램·편집기가 공유 금지로 잠깐 쥐고 있으면 교체가 실패한다. 잠깐씩 다시 해 보고, 끝내 안 되면
    /// 그 오류를 돌려줘 화면의 자동 저장이 다시 시도하게 한다(설계 D4)
    pub(crate) fn rename_in(&self, from: &str, to: &OsStr) -> std::io::Result<()> {
        let (from, to) = (self.0.join(from), self.0.join(to));
        let mut tries = 0;
        loop {
            match fs::rename(&from, &to) {
                Err(e) if tries < 10 && e.raw_os_error().is_some_and(|c| [ERROR_SHARING_VIOLATION, ERROR_LOCK_VIOLATION, ERROR_ACCESS_DENIED].contains(&(c as u32))) => {
                    tries += 1;
                    std::thread::sleep(Duration::from_millis(50));
                }
                r => return r,
            }
        }
    }

    pub(crate) fn open_in(&self, name: &str) -> std::io::Result<fs::File> {
        let file = fs::OpenOptions::new().read(true).custom_flags(FILE_FLAG_OPEN_REPARSE_POINT).open(self.0.join(name))?;
        if is_reparse(&file.metadata()?) {
            return Err(err(ELOOP));
        }
        Ok(file)
    }

    /// 없으면 성공. 이름으로 지우지 않고, 링크를 따라가지 않고 연 핸들로 그 객체를 지운다 — 확인한 것과 지우는 것이 같다
    pub(crate) fn unlink_in(&self, name: &str) -> std::io::Result<()> {
        let path = self.0.join(name);
        let file = match fs::OpenOptions::new().access_mode(DELETE | FILE_READ_ATTRIBUTES).custom_flags(FILE_FLAG_OPEN_REPARSE_POINT).open(&path) {
            Ok(file) => file,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            // 폴더는 BACKUP_SEMANTICS 없이 열면 ACCESS_DENIED라 권한 문제로 보인다
            Err(e) if e.raw_os_error() == Some(ERROR_ACCESS_DENIED as i32) && fs::symlink_metadata(&path).is_ok_and(|m| m.is_dir()) => return Err(err(EISDIR)),
            Err(e) => return Err(e),
        };
        if file.metadata()?.is_dir() {
            return Err(err(EISDIR));
        }
        let handle = file.as_raw_handle() as HANDLE;
        let posix = FILE_DISPOSITION_INFO_EX { Flags: FILE_DISPOSITION_FLAG_DELETE | FILE_DISPOSITION_FLAG_POSIX_SEMANTICS };
        if unsafe { SetFileInformationByHandle(handle, FileDispositionInfoEx, (&raw const posix).cast(), size_of::<FILE_DISPOSITION_INFO_EX>() as u32) } != 0 {
            return Ok(());
        }
        let e = std::io::Error::last_os_error();
        // FAT·exFAT·일부 네트워크 폴더는 POSIX 방식 지우기를 모른다. 핸들이 닫힐 때 지우는 예전 방식으로 지운다
        if !e.raw_os_error().is_some_and(|c| [ERROR_INVALID_PARAMETER, ERROR_NOT_SUPPORTED, ERROR_INVALID_FUNCTION].contains(&(c as u32))) {
            return Err(e);
        }
        let classic = FILE_DISPOSITION_INFO { DeleteFile: true };
        if unsafe { SetFileInformationByHandle(handle, FileDispositionInfo, (&raw const classic).cast(), size_of::<FILE_DISPOSITION_INFO>() as u32) } == 0 {
            return Err(std::io::Error::last_os_error());
        }
        Ok(())
    }
}

/// parent가 있으면 그 폴더 안의 name을, 없으면 path를 링크를 따라가지 않고 폴더로 연다
pub(crate) fn open_dir_nofollow(path: &Path, parent: Option<(&Dir, &str)>) -> std::io::Result<Dir> {
    match parent {
        Some((dir, name)) => {
            let path = dir.0.join(name);
            let m = fs::symlink_metadata(&path)?;
            if is_reparse(&m) {
                return Err(err(ELOOP));
            }
            if !m.is_dir() {
                return Err(err(ENOTDIR));
            }
            Ok(Dir(path))
        }
        // 저장 폴더 자체는 사용자가 고른 것이라 링크여도 따라간다
        None => Dir::open(path),
    }
}

/// 볼륨 일련번호. 다시 붙여도 바뀌지 않아 맥의 볼륨 UUID 자리에 쓴다. 없으면(0) None
pub(crate) fn volume_uuid(path: &Path) -> Option<[u8; 16]> {
    let serial = info_at(path).ok()?.dwVolumeSerialNumber;
    let mut id = [0u8; 16];
    id[..4].copy_from_slice(&serial.to_le_bytes());
    (serial != 0).then_some(id)
}

pub(crate) fn random_bytes(bytes: &mut [u8]) -> bool {
    unsafe { BCryptGenRandom(std::ptr::null_mut(), bytes.as_mut_ptr(), bytes.len() as u32, BCRYPT_USE_SYSTEM_PREFERRED_RNG) == 0 }
}

/// 직접 부르는 Win32 함수에는 std처럼 긴 경로(MAX_PATH 초과) 처리가 없어 `\\?\` 절대 경로로 넘긴다
fn verbatim(path: &Path) -> std::io::Result<Vec<u16>> {
    let abs: Vec<u16> = std::path::absolute(path)?.as_os_str().encode_wide().collect();
    let w = |s: &str| s.encode_utf16().collect::<Vec<u16>>();
    let mut out = if abs.starts_with(&w(r"\\?\")) || abs.starts_with(&w(r"\\.\")) {
        abs
    } else if abs.starts_with(&w(r"\\")) {
        [w(r"\\?\UNC\").as_slice(), &abs[2..]].concat()
    } else {
        [w(r"\\?\").as_slice(), &abs].concat()
    };
    if out.contains(&0) {
        return Err(std::io::ErrorKind::InvalidInput.into());
    }
    out.push(0);
    Ok(out)
}

/// 그 사이 같은 이름이 생겼으면 덮지 않고 실패한다(빈 폴더도 rename으로는 덮여 버린다).
/// 플래그 없는 MoveFileExW는 대상이 있으면 ERROR_ALREADY_EXISTS로 실패한다 — 확인과 옮기기가 한 번이다
pub(crate) fn rename_excl(src: &Path, dst: &Path) -> std::io::Result<()> {
    let (s, d) = (verbatim(src)?, verbatim(dst)?);
    if unsafe { MoveFileExW(s.as_ptr(), d.as_ptr(), 0) } == 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(())
}

pub(crate) fn is_notsup(e: &std::io::Error) -> bool {
    e.kind() == std::io::ErrorKind::Unsupported
}

pub(crate) fn os_error(code: i32) -> Option<OsErr> {
    Some(match code as u32 {
        ERROR_ACCESS_DENIED => OsErr::Denied,
        ERROR_WRITE_PROTECT => OsErr::ReadOnlyDisk,
        ERROR_DISK_FULL | ERROR_HANDLE_DISK_FULL => OsErr::NoSpace,
        ERROR_DISK_QUOTA_EXCEEDED => OsErr::Quota,
        ERROR_FILENAME_EXCED_RANGE => OsErr::NameTooLong,
        ERROR_INVALID_NAME => OsErr::BadName,
        ERROR_FILE_NOT_FOUND | ERROR_PATH_NOT_FOUND => OsErr::NotFound,
        ERROR_DIRECTORY => OsErr::NotDir,
        ERROR_DIRECTORY_NOT_SUPPORTED => OsErr::IsDir,
        ERROR_FILE_EXISTS | ERROR_ALREADY_EXISTS => OsErr::Exists,
        ERROR_BUSY => OsErr::Busy,
        ERROR_SHARING_VIOLATION | ERROR_LOCK_VIOLATION => OsErr::InUse,
        ERROR_CRC | ERROR_IO_DEVICE => OsErr::Io,
        ERROR_NOT_READY | ERROR_DEV_NOT_EXIST | ERROR_BAD_NETPATH | ERROR_NETNAME_DELETED | ERROR_BAD_NET_NAME | ERROR_SEM_TIMEOUT | ERROR_NETWORK_UNREACHABLE
        | ERROR_HOST_UNREACHABLE => OsErr::Disconnected,
        ERROR_STOPPED_ON_SYMLINK | ERROR_CANT_RESOLVE_FILENAME => OsErr::Loop,
        ERROR_TOO_MANY_OPEN_FILES => OsErr::TooManyOpen,
        ERROR_NOT_SUPPORTED => OsErr::NotSupported,
        ERROR_FILE_TOO_LARGE => OsErr::TooBig,
        ERROR_BAD_FILE_TYPE => OsErr::Special,
        ERROR_RETRY => OsErr::Again,
        ERROR_DIR_NOT_EMPTY => OsErr::NotEmpty,
        _ => return None,
    })
}
