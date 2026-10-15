//! 라이선스와 체험 기간.
//! 판매를 시작하기 전까지는 `LICENSING_ENABLED`를 꺼 둔다. 꺼져 있어도 체험 시작일과
//! "이미 쓰던 사용자" 여부는 기록해 둬서, 켜는 날 기존 사용자를 잠그지 않는다.

use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};
use std::path::Path;

pub const LICENSING_ENABLED: bool = false;
pub const TRIAL_DAYS: i64 = 7;
/// 라이선스 서명 확인용 공개 키. 발급용 비밀 키는 개발자 맥(~/.aru)과 결제 서버에만 있다
pub const PUBLIC_KEY: &str = "8MenjvvEsGnwLg5F3odgeWGIzq5YO/a73beQIWofL74=";
const RECORD_FILE: &str = "license.json";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LicenseInfo {
    pub name: String,
    pub order: String,
    pub date: String,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct Record {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    #[serde(default, rename = "trialStart", skip_serializing_if = "Option::is_none")]
    pub trial_start: Option<String>,
    #[serde(default)]
    pub grandfathered: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "state", rename_all = "lowercase")]
pub enum Status {
    /// 판매 전. 아무것도 보여주지 않는다
    Disabled,
    Licensed { name: String },
    /// 판매 전부터 쓰던 사용자는 계속 무료
    Grandfathered,
    Trial {
        #[serde(rename = "daysLeft")]
        days_left: i64,
    },
    Expired,
}

#[derive(Deserialize)]
struct Payload {
    n: String,
    o: String,
    d: String,
}

/// 키의 서명이 맞으면 누구에게 발급했는지 돌려준다
pub fn verify(key: &str, public_key_b64: &str) -> Result<LicenseInfo, String> {
    let invalid = || "라이선스 키가 올바르지 않아요".to_string();
    let body = key.trim().strip_prefix("ARU-").ok_or_else(invalid)?;
    let (payload_b64, sig_b64) = body.split_once('.').ok_or_else(invalid)?;
    let payload = URL_SAFE_NO_PAD.decode(payload_b64).map_err(|_| invalid())?;
    let sig_bytes: [u8; 64] = URL_SAFE_NO_PAD
        .decode(sig_b64)
        .map_err(|_| invalid())?
        .try_into()
        .map_err(|_| invalid())?;
    let pub_bytes: [u8; 32] = STANDARD
        .decode(public_key_b64)
        .map_err(|_| invalid())?
        .try_into()
        .map_err(|_| invalid())?;
    let verifying = VerifyingKey::from_bytes(&pub_bytes).map_err(|_| invalid())?;
    verifying
        .verify_strict(&payload, &Signature::from_bytes(&sig_bytes))
        .map_err(|_| invalid())?;
    let p: Payload = serde_json::from_slice(&payload).map_err(|_| invalid())?;
    Ok(LicenseInfo { name: p.n, order: p.o, date: p.d })
}

/// 1970-01-01부터 며칠째인지(그레고리력)
fn day_number(date: &str) -> Option<i64> {
    let mut parts = date.split('-').map(|p| p.parse::<i64>().ok());
    let (y, m, d) = (parts.next()??, parts.next()??, parts.next()??);
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    Some(era * 146097 + doe - 719468)
}

/// 이미 할 일을 적어 둔 적이 있으면 "기존 사용자"다
fn has_existing_data(data_root: &Path) -> bool {
    let daily_has_files = std::fs::read_dir(data_root.join("daily"))
        .map(|mut it| it.any(|e| e.map(|e| e.path().extension().is_some_and(|x| x == "md")).unwrap_or(false)))
        .unwrap_or(false);
    daily_has_files || data_root.join("someday.md").is_file()
}

pub fn read_record(config_dir: &Path) -> Option<Record> {
    let text = std::fs::read_to_string(config_dir.join(RECORD_FILE)).ok()?;
    serde_json::from_str(&text).ok()
}

fn write_record(config_dir: &Path, record: &Record) -> Result<(), String> {
    std::fs::create_dir_all(config_dir).map_err(|e| e.to_string())?;
    let text = serde_json::to_string_pretty(record).map_err(|e| e.to_string())?;
    std::fs::write(config_dir.join(RECORD_FILE), text).map_err(|e| e.to_string())
}

/// 처음 불릴 때 체험 시작일과 기존 사용자 여부를 남기고, 지금 상태를 돌려준다
pub fn status(config_dir: &Path, data_root: &Path, today: &str, enabled: bool, public_key: &str) -> Status {
    let record = match read_record(config_dir) {
        Some(r) => r,
        None => {
            let r = Record { key: None, trial_start: Some(today.into()), grandfathered: has_existing_data(data_root) };
            let _ = write_record(config_dir, &r);
            r
        }
    };
    if !enabled {
        return Status::Disabled;
    }
    if let Some(info) = record.key.as_deref().and_then(|k| verify(k, public_key).ok()) {
        return Status::Licensed { name: info.name };
    }
    if record.grandfathered {
        return Status::Grandfathered;
    }
    let start = record.trial_start.as_deref().and_then(day_number);
    let now = day_number(today);
    match (start, now) {
        (Some(s), Some(n)) => {
            let left = TRIAL_DAYS - (n - s);
            if left > 0 { Status::Trial { days_left: left } } else { Status::Expired }
        }
        _ => Status::Trial { days_left: TRIAL_DAYS },
    }
}

/// 키를 확인하고 맞으면 저장한다
pub fn activate(config_dir: &Path, key: &str, public_key: &str) -> Result<LicenseInfo, String> {
    let info = verify(key, public_key)?;
    let mut record = read_record(config_dir).unwrap_or_default();
    record.key = Some(key.trim().to_string());
    write_record(config_dir, &record)?;
    Ok(info)
}

#[cfg(test)]
mod tests {
    use super::*;

    // 테스트 전용 키 쌍으로 만든 키(실제 판매 키와 무관)
    const TEST_PUB: &str = "93hBZ661wWhmTGpRMY2KgIXegD98M+luqu9wuTb0v5I=";
    const TEST_KEY: &str = "ARU-eyJ2IjoxLCJuIjoi7YWM7Iqk7Yq4IOyCrOyaqeyekCIsIm8iOiJvcmRlci0xIiwiZCI6IjIwMjYtMTAtMTUifQ.g52OEDpQojUdsO7ZAsycL4C0yHmHtUEz5U7X11Lv_CBFYms9IlHFpZqD7xhNJF5wMb3EAQsU8VLS1G1QKPUXBw";

    fn dirs(name: &str) -> (std::path::PathBuf, std::path::PathBuf) {
        let base = std::env::temp_dir().join(format!("aru-license-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let (config, data) = (base.join("config"), base.join("data"));
        std::fs::create_dir_all(&config).unwrap();
        std::fs::create_dir_all(&data).unwrap();
        (config, data)
    }

    #[test]
    fn 결제_서버가_만든_키를_확인한다() {
        let info = verify(TEST_KEY, TEST_PUB).unwrap();
        assert_eq!(info, LicenseInfo { name: "테스트 사용자".into(), order: "order-1".into(), date: "2026-10-15".into() });
    }

    #[test]
    fn 한_글자라도_바꾼_키나_다른_공개_키로는_통과하지_않는다() {
        let tampered = TEST_KEY.replacen("eyJ2", "eyJ3", 1);
        assert!(verify(&tampered, TEST_PUB).is_err());
        assert!(verify(TEST_KEY, PUBLIC_KEY).is_err());
        assert!(verify("아무 글자", TEST_PUB).is_err());
    }

    #[test]
    fn 꺼져_있으면_아무것도_막지_않지만_체험_시작일은_남긴다() {
        let (config, data) = dirs("disabled");
        assert_eq!(status(&config, &data, "2026-10-15", false, TEST_PUB), Status::Disabled);
        assert_eq!(read_record(&config).unwrap().trial_start.as_deref(), Some("2026-10-15"));
    }

    #[test]
    fn 처음_켠_새_사용자는_7일_체험이고_8일째부터_잠긴다() {
        let (config, data) = dirs("trial");
        assert_eq!(status(&config, &data, "2026-10-15", true, TEST_PUB), Status::Trial { days_left: 7 });
        assert_eq!(status(&config, &data, "2026-10-21", true, TEST_PUB), Status::Trial { days_left: 1 });
        assert_eq!(status(&config, &data, "2026-10-22", true, TEST_PUB), Status::Expired);
    }

    #[test]
    fn 기록을_처음_남길_때_이미_할_일이_있었으면_계속_무료다() {
        let (config, data) = dirs("grandfather");
        std::fs::create_dir_all(data.join("daily")).unwrap();
        std::fs::write(data.join("daily/2026-10-14.md"), "- [ ] 하나\n").unwrap();
        status(&config, &data, "2026-10-15", false, TEST_PUB);
        assert_eq!(status(&config, &data, "2027-01-01", true, TEST_PUB), Status::Grandfathered);
    }

    #[test]
    fn 키를_등록하면_체험이_끝났어도_쓸_수_있고_틀린_키는_저장하지_않는다() {
        let (config, data) = dirs("activate");
        status(&config, &data, "2026-10-01", true, TEST_PUB);
        assert!(activate(&config, "ARU-틀림.틀림", TEST_PUB).is_err());
        assert_eq!(status(&config, &data, "2026-10-15", true, TEST_PUB), Status::Expired);
        activate(&config, TEST_KEY, TEST_PUB).unwrap();
        assert_eq!(status(&config, &data, "2026-10-15", true, TEST_PUB), Status::Licensed { name: "테스트 사용자".into() });
    }

    #[test]
    fn 실제_토스_테스트_결제로_발급된_키를_실제_공개_키로_확인한다() {
        // 2026-10-15 토스페이 테스트 결제 → 결제 서버가 발급한 키
        let key = "ARU-eyJ2IjoxLCJuIjoidGVzdEBleGFtcGxlLmNvbSIsIm8iOiJhcnUtMTc5MjA3MDA1OTc5NC0yODc0NzgzMjkzMzAiLCJkIjoiMjAyNi0xMC0xNSJ9.Mynd5U9DVNH3Z61oWKOA1rneZj9WDGR-VZ1r9z9HfjywzMVtfKeDwRoxreEx-QvsaK5BQbAdwbX5wa7Jyuw-BA";
        let info = verify(key, PUBLIC_KEY).unwrap();
        assert_eq!(info.name, "test@example.com");
        assert_eq!(info.order, "aru-1792070059794-287478329330");
        let (config, data) = dirs("real");
        status(&config, &data, "2026-10-01", true, PUBLIC_KEY);
        activate(&config, key, PUBLIC_KEY).unwrap();
        assert_eq!(status(&config, &data, "2026-12-01", true, PUBLIC_KEY), Status::Licensed { name: "test@example.com".into() });
    }

    #[test]
    fn 날짜_차이를_센다() {
        assert_eq!(day_number("1970-01-01"), Some(0));
        assert_eq!(day_number("2026-03-01").unwrap() - day_number("2026-02-28").unwrap(), 1);
        assert_eq!(day_number("2028-03-01").unwrap() - day_number("2028-02-28").unwrap(), 2);
    }
}
