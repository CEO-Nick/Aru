use std::ffi::{CString, OsStr};
use std::fs;
use std::os::fd::{AsRawFd, FromRawFd};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::Path;

use crate::storage::OsErr;

pub(crate) use libc::{EAGAIN, EEXIST, EFBIG, EIO, ELOOP, ENOMEM, ENOTDIR};

pub(crate) const READ_ONLY_FIX: &str = "Finder에서 쓰기 권한을 주면";

/// 잠금 파일을 연다. Err(None)은 링크·FIFO 같은 쓸 수 없는 종류라는 뜻이다.
/// O_NOFOLLOW: 링크를 따라가면 저장 폴더 밖에 파일을 만든다. O_NONBLOCK: FIFO는 상대가 열 때까지 open에서 멈춘다(대기 시간이 소용없다)
pub(crate) fn open_lock(path: &Path) -> Result<fs::File, Option<std::io::Error>> {
    let flags = libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC;
    // flock은 읽기 전용으로 연 파일이나 폴더에도 걸린다. 잠금 파일이 읽기 전용이 됐거나 같은 이름의 폴더가 생겨도
    // 쓰기로 못 연다는 이유만으로 모든 저장을 막지 않는다
    let file = match fs::OpenOptions::new().create(true).truncate(false).write(true).custom_flags(flags).open(path) {
        Ok(file) => file,
        Err(e) => match fs::OpenOptions::new().read(true).custom_flags(flags).open(path) {
            Ok(file) => file,
            Err(_) if fs::symlink_metadata(path).is_ok_and(|m| !m.is_file() && !m.is_dir()) => return Err(None),
            // 같은 이름의 폴더면 쓰기로 열 때의 EISDIR이 아니라 읽기로 열 때의 오류(권한 등)가 진짜 원인이다
            Err(read) if e.raw_os_error() == Some(libc::EISDIR) => return Err(Some(read)),
            Err(_) => return Err(Some(e)),
        },
    };
    match file.metadata() {
        Ok(m) if m.is_file() || m.is_dir() => Ok(file),
        Ok(_) => Err(None),
        Err(e) => Err(Some(e)),
    }
}

pub(crate) fn lock_unsupported(e: &std::io::Error) -> bool {
    e.kind() == std::io::ErrorKind::Unsupported
        || e.raw_os_error().is_some_and(|code| code == libc::ENOTSUP || code == libc::EOPNOTSUPP || code == libc::ENOLCK)
}

pub(crate) struct Stamp {
    pub(crate) len: u64,
    pub(crate) links: u64,
    key: (u64, i64, i64, i64, i64),
}

impl Stamp {
    pub(crate) fn same(&self, other: &Stamp) -> bool {
        self.key == other.key
    }
}

pub(crate) fn stamp(file: &fs::File) -> std::io::Result<Stamp> {
    let m = file.metadata()?;
    Ok(Stamp { len: m.len(), links: m.nlink(), key: (m.len(), m.mtime(), m.mtime_nsec(), m.ctime(), m.ctime_nsec()) })
}

pub(crate) fn links(_: &Path, meta: &fs::Metadata) -> u64 {
    meta.nlink()
}

pub(crate) fn file_id(_: &Path, meta: &fs::Metadata) -> Option<(u64, u64)> {
    Some((meta.dev(), meta.ino()))
}

/// 일반 파일만 연다(사용자 심링크는 따라간다). FIFO는 open·read에서 끝없이 멈추고(잠금을 쥔 채 멈출 수 있다), 장치(/dev/zero)는 끝이 없다.
/// 미리 본 종류와 연 뒤의 종류를 둘 다 본다 — 소켓은 open이 엉뚱한 오류를 내고, 그 사이 FIFO로 바뀔 수도 있다
pub(crate) fn open_regular(path: &Path) -> std::io::Result<Option<fs::File>> {
    let special = |m: &fs::Metadata| std::io::Error::from_raw_os_error(if m.is_dir() { libc::EISDIR } else { libc::ESPIPE });
    let opened = match fs::metadata(path) {
        Ok(m) if !m.is_file() => return Err(special(&m)),
        Ok(_) => fs::OpenOptions::new().read(true).custom_flags(libc::O_NONBLOCK | libc::O_CLOEXEC).open(path),
        Err(e) => Err(e),
    };
    let file = match opened {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        r => r?,
    };
    let meta = file.metadata()?;
    if !meta.is_file() {
        return Err(special(&meta));
    }
    Ok(Some(file))
}

pub(crate) fn copy_meta(original: &Path, _: &fs::Metadata, tmp: &fs::File) {
    #[cfg(target_os = "macos")]
    if let Ok(src) = fs::OpenOptions::new().read(true).custom_flags(libc::O_NONBLOCK | libc::O_CLOEXEC).open(original) {
        unsafe { libc::fcopyfile(src.as_raw_fd(), tmp.as_raw_fd(), std::ptr::null_mut(), libc::COPYFILE_ACL | libc::COPYFILE_XATTR) };
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (original, tmp);
}

pub(crate) fn no_follow(options: &mut fs::OpenOptions) -> &mut fs::OpenOptions {
    options.custom_flags(libc::O_NOFOLLOW)
}

pub(crate) struct Dir(fs::File);

impl Dir {
    pub(crate) fn open(path: &Path) -> std::io::Result<Dir> {
        fs::File::open(path).map(Dir)
    }

    pub(crate) fn create_new(&self, name: &str) -> std::io::Result<fs::File> {
        let name = CString::new(name)?;
        let flags = libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC;
        let fd = unsafe { libc::openat(self.0.as_raw_fd(), name.as_ptr(), flags, 0o666 as libc::c_uint) };
        if fd < 0 {
            return Err(std::io::Error::last_os_error());
        }
        Ok(unsafe { fs::File::from_raw_fd(fd) })
    }

    pub(crate) fn rename_in(&self, from: &str, to: &OsStr) -> std::io::Result<()> {
        let from = CString::new(from)?;
        let to = CString::new(to.as_bytes())?;
        if unsafe { libc::renameat(self.0.as_raw_fd(), from.as_ptr(), self.0.as_raw_fd(), to.as_ptr()) } != 0 {
            return Err(std::io::Error::last_os_error());
        }
        Ok(())
    }

    pub(crate) fn open_in(&self, name: &str) -> std::io::Result<fs::File> {
        let c = CString::new(name)?;
        let fd = unsafe { libc::openat(self.0.as_raw_fd(), c.as_ptr(), libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC) };
        if fd < 0 {
            return Err(std::io::Error::last_os_error());
        }
        Ok(unsafe { fs::File::from_raw_fd(fd) })
    }

    /// 없으면 성공. 같은 이름의 폴더는 macOS가 EPERM(권한)으로 답해 문구가 틀리므로 EISDIR로 바꾼다
    pub(crate) fn unlink_in(&self, name: &str) -> std::io::Result<()> {
        let c = CString::new(name)?;
        if unsafe { libc::unlinkat(self.0.as_raw_fd(), c.as_ptr(), 0) } == 0 {
            return Ok(());
        }
        let e = std::io::Error::last_os_error();
        let mut st: libc::stat = unsafe { std::mem::zeroed() };
        let is_dir = unsafe { libc::fstatat(self.0.as_raw_fd(), c.as_ptr(), &mut st, libc::AT_SYMLINK_NOFOLLOW) } == 0 && (st.st_mode & libc::S_IFMT) == libc::S_IFDIR;
        match e.raw_os_error() {
            Some(libc::ENOENT) => Ok(()),
            Some(libc::EPERM) if is_dir => Err(std::io::Error::from_raw_os_error(libc::EISDIR)),
            _ => Err(e),
        }
    }
}

/// parent가 있으면 그 폴더 안의 name을, 없으면 path를 링크를 따라가지 않고 폴더로 연다
pub(crate) fn open_dir_nofollow(path: &Path, parent: Option<(&Dir, &str)>) -> std::io::Result<Dir> {
    let flags = libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC;
    let fd = match parent {
        Some((dir, name)) => {
            let name = CString::new(name)?;
            unsafe { libc::openat(dir.0.as_raw_fd(), name.as_ptr(), flags | libc::O_NOFOLLOW) }
        }
        // 저장 폴더 자체는 사용자가 고른 것이라 링크여도 따라간다
        None => {
            let path = CString::new(path.as_os_str().as_bytes())?;
            unsafe { libc::open(path.as_ptr(), flags) }
        }
    };
    if fd < 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(Dir(unsafe { fs::File::from_raw_fd(fd) }))
}

/// 볼륨 UUID. 없으면(0) None
#[cfg(target_os = "macos")]
pub(crate) fn volume_uuid(path: &Path) -> Option<[u8; 16]> {
    let c = CString::new(path.as_os_str().as_bytes()).ok()?;
    let mut st: libc::statfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::statfs(c.as_ptr(), &mut st) } != 0 {
        return None;
    }
    let mount = unsafe { std::ffi::CStr::from_ptr(st.f_mntonname.as_ptr()) };
    let mut list: libc::attrlist = unsafe { std::mem::zeroed() };
    list.bitmapcount = libc::ATTR_BIT_MAP_COUNT;
    list.volattr = libc::ATTR_VOL_INFO | libc::ATTR_VOL_UUID;
    #[repr(C)]
    struct Reply {
        len: u32,
        uuid: [u8; 16],
    }
    let mut reply = Reply { len: 0, uuid: [0; 16] };
    // 볼륨 속성은 볼륨의 맨 위 폴더에 물어야 한다
    let r = unsafe { libc::getattrlist(mount.as_ptr(), (&raw mut list).cast(), (&raw mut reply).cast(), size_of::<Reply>(), 0) };
    (r == 0 && reply.len as usize >= size_of::<Reply>() && reply.uuid != [0; 16]).then_some(reply.uuid)
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn volume_uuid(_: &Path) -> Option<[u8; 16]> {
    None
}

pub(crate) fn random_bytes(bytes: &mut [u8]) -> bool {
    unsafe { libc::getentropy(bytes.as_mut_ptr().cast(), bytes.len()) == 0 }
}

/// 그 사이 같은 이름이 생겼으면 덮지 않고 실패한다(빈 폴더도 rename으로는 덮여 버린다)
pub(crate) fn rename_excl(src: &Path, dst: &Path) -> std::io::Result<()> {
    #[cfg(target_os = "macos")]
    {
        let (s, d) = (CString::new(src.as_os_str().as_bytes())?, CString::new(dst.as_os_str().as_bytes())?);
        if unsafe { libc::renamex_np(s.as_ptr(), d.as_ptr(), libc::RENAME_EXCL) } != 0 {
            return Err(std::io::Error::last_os_error());
        }
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        if fs::symlink_metadata(dst).is_ok() {
            return Err(std::io::Error::from_raw_os_error(libc::EEXIST));
        }
        fs::rename(src, dst)
    }
}

pub(crate) fn is_notsup(e: &std::io::Error) -> bool {
    e.raw_os_error().is_some_and(|c| c == libc::ENOTSUP || c == libc::EOPNOTSUPP)
}

pub(crate) fn os_error(code: i32) -> Option<OsErr> {
    Some(match code {
        libc::EACCES | libc::EPERM => OsErr::Denied,
        libc::EROFS => OsErr::ReadOnlyDisk,
        libc::ENOSPC => OsErr::NoSpace,
        libc::EDQUOT => OsErr::Quota,
        libc::ENAMETOOLONG => OsErr::NameTooLong,
        libc::EILSEQ => OsErr::BadName,
        libc::ENOENT => OsErr::NotFound,
        libc::ENOTDIR => OsErr::NotDir,
        libc::EISDIR => OsErr::IsDir,
        libc::EEXIST => OsErr::Exists,
        libc::EBUSY | libc::ETXTBSY => OsErr::Busy,
        libc::EIO => OsErr::Io,
        libc::ENXIO | libc::ENODEV | libc::ENOTCONN | libc::ETIMEDOUT | libc::ENETDOWN | libc::ENETUNREACH | libc::EHOSTDOWN | libc::EHOSTUNREACH | libc::ESTALE => OsErr::Disconnected,
        libc::ELOOP => OsErr::Loop,
        libc::EMFILE | libc::ENFILE => OsErr::TooManyOpen,
        libc::ENOTSUP | libc::EOPNOTSUPP => OsErr::NotSupported,
        libc::EFBIG => OsErr::TooBig,
        libc::ESPIPE => OsErr::Special,
        libc::EAGAIN | libc::EINTR => OsErr::Again,
        _ => return None,
    })
}
