//! 사용자가 고른 저장 폴더의 security-scoped bookmark.
//! 샌드박스는 폴더 선택 창에서 고른 순간에만 그 폴더를 열어 주므로, 다음 실행과 aru 명령은 이걸 풀어서 연다.

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use objc2::runtime::Bool;
use objc2_foundation::{NSData, NSString, NSURLBookmarkCreationOptions, NSURLBookmarkResolutionOptions, NSURL};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

pub fn create(path: &str) -> Result<String, String> {
    of_url(&NSURL::fileURLWithPath(&NSString::from_str(path)))
}

fn of_url(url: &NSURL) -> Result<String, String> {
    let data = url
        .bookmarkDataWithOptions_includingResourceValuesForKeys_relativeToURL_error(
            NSURLBookmarkCreationOptions::WithSecurityScope,
            None,
            None,
        )
        .map_err(|_| "이 폴더에 다시 접근할 권한을 저장하지 못했어요".to_string())?;
    Ok(STANDARD.encode(data.to_vec()))
}

pub struct Resolved {
    pub path: String,
    /// bookmark가 낡아(폴더 이동·디스크 교체 등) 새로 만든 것. 부르는 쪽이 location.json에 고쳐 쓴다
    pub refreshed: Option<String>,
}

/// 풀어 둔 폴더는 프로세스가 끝날 때까지 열어 둔다.
/// 읽고 쓸 때마다 다시 열면 접근 횟수가 쌓여 결국 막히므로 bookmark마다 한 번만 연다
pub fn resolve(mark: &str) -> Result<Resolved, String> {
    static OPENED: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    let opened = OPENED.get_or_init(Default::default);
    if let Some(path) = opened.lock().unwrap().get(mark) {
        return Ok(Resolved { path: path.clone(), refreshed: None });
    }
    let unreadable = || "저장 폴더 접근 권한 정보를 풀지 못했어요".to_string();
    let bytes = STANDARD.decode(mark).map_err(|_| unreadable())?;
    let data = NSData::with_bytes(&bytes);
    let mut stale = Bool::NO;
    let url = unsafe {
        NSURL::URLByResolvingBookmarkData_options_relativeToURL_bookmarkDataIsStale_error(
            &data,
            NSURLBookmarkResolutionOptions::WithSecurityScope,
            None,
            &mut stale,
        )
    }
    .map_err(|_| unreadable())?;
    if !unsafe { url.startAccessingSecurityScopedResource() } {
        return Err("저장 폴더에 접근할 수 없어요".into());
    }
    let path = url.path().map(|p| p.to_string()).ok_or("저장 폴더 경로가 없어요")?;
    // 낡은 bookmark를 그대로 두면 다음 실행에서 못 풀릴 수 있다. 접근이 열려 있는 지금 새로 만든다
    let refreshed = if stale.as_bool() { of_url(&url).ok() } else { None };
    let mut opened = opened.lock().unwrap();
    opened.insert(mark.to_string(), path.clone());
    if let Some(fresh) = &refreshed {
        opened.insert(fresh.clone(), path.clone());
    }
    Ok(Resolved { path, refreshed })
}
