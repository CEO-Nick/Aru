# Aru Windows판 이식 설계 (초안)

- 기준: `Aru-mas` 브랜치 `mas`, HEAD `8526360`
- 근거: Windows 타깃 `cargo check` 실측(에러 63건, 전부 `storage.rs` + `lib.rs` 2건) · Rust 계층 OS 종속 인벤토리(`scratchpad/windows-port/inventory.md`, 11개 관심사 · 테스트 191개 분류)
- 성격: **코드를 고치기 전 설계 합의용.** 아래 「판단 필요」 10개에 답이 모이면 작업 순서대로 착수한다.

## 0. 전제

| 항목 | 결정 | 이유 |
|---|---|---|
| 배포 | **Microsoft Store, MSIX, 1회 결제, 업데이트는 Store** | PRINCIPLES 원칙 8·정책표(서버·계정·라이선스 키 없음). 결제를 받으면서 서버를 두지 않는 길은 스토어뿐이다. 버린 GitHub Releases판이 라이선스 서버를 필요로 했던 이유가 이것 |
| 코드 공유 | 한 레포, 한 브랜치. `cfg(windows)` 분기 | 프론트(Vue)는 OS 무관. Rust도 `storage.rs` 한 파일이 본진이라 포크할 이유가 없다 |
| 최소 OS | Windows 10 1903(19H1) 이상 | MSIX 파일 쓰기 가상화 끄기(아래 D1)가 1903부터. WebView2는 Win11 내장, Win10은 Edge와 함께 배포된 Evergreen 런타임 |
| 아키텍처 | x64 + arm64 (`.msixbundle`) | Rust·WebView2 모두 arm64 지원. arm64는 이 맥의 UTM VM에서 네이티브로 검증된다 |

## 1. 범위 — 무엇이 바뀌고 무엇이 안 바뀌나

| 층 | Windows에서 바뀌는 것 | 근거 |
|---|---|---|
| 프론트 Vue·core | 거의 없음. 사용자 문구 몇 개(「Finder에서 열기」, ⌥Space 표기), 폴더 표시명(`~`·iCloud 상수), AI 연결 명령의 따옴표 규칙 | 인벤토리 3.1·10.10, `src/components/SettingsPanel.vue:116`, `src/core/folderLabel.ts:11-20`, `src/core/aiConnect.ts:4-11` |
| `storage.rs` | **본진.** Unix 전용 import 3줄 + POSIX 호출 약 25개 함수 | `cargo check` 63건 전부 여기 |
| `lib.rs` platform mod | 비맥 스텁 10개를 Windows 구현으로 채움(투명도·포커스 복귀·종료 훅·Claude 데스크톱·OS 버전). 맥 전용 창 옵션 2개 분기 | 인벤토리 2장 F11~F19, `lib.rs:41`·`737` 컴파일 에러 |
| `cli.rs` | 홈·설정 폴더·오늘 날짜·실행 파일 경로의 Windows 분기 | 인벤토리 ⑦·⑧, 폴백 F4·F5·F7 |
| `mcpb.rs` | `platforms`에 `win32` 추가, 명령 경로를 alias로 | 인벤토리 10.1·10.2 |
| 빌드·패키징 | MSIX 매니페스트·패키징 스크립트·CI 워크플로우 신설 | 현재 CI 없음(`release.yml` 삭제됨), 맥은 `scripts/mas-build.sh` 로컬 빌드 |

## 2. 저장 계층 — 불변식별 Windows 대응

인벤토리 5장의 불변식 10개를 기준으로 「맥 메커니즘 → Windows 메커니즘」을 정한다. **불변식은 바꾸지 않는다. 메커니즘만 바꾼다.**

### 2.0 구조

`storage.rs`의 OS 호출을 `storage/sys/unix.rs`·`storage/sys/windows.rs`로 빼고, 공통 로직은 같은 함수 시그니처를 부른다(std가 쓰는 방식). 분기 대상 함수는 약 12개다.

| sys 함수 | 맥 구현(현행) | Windows 구현 |
|---|---|---|
| `open_lock` | `O_NOFOLLOW\|O_NONBLOCK` | `FILE_FLAG_OPEN_REPARSE_POINT`로 열고 핸들 속성이 reparse point면 링크로 판정해 거부 |
| `open_regular` | 종류 확인 → `O_NONBLOCK` → 재확인 | `metadata().is_file()` → 열기 → `GetFileType == FILE_TYPE_DISK` 재확인 |
| `create_temp` | `openat(O_EXCL\|O_NOFOLLOW)` | `create_new(true)` (CREATE_NEW는 같은 이름의 링크가 있어도 실패한다) |
| `rename_replace` | `renameat` | `std::fs::rename` (Rust 1.99의 Windows 구현은 `FILE_RENAME_FLAG_POSIX_SEMANTICS`를 쓴다 — 다른 프로세스가 대상 파일을 열어 둬도 교체된다. 확인 필요: 공유 모드에 `FILE_SHARE_DELETE`가 없는 핸들이면 여전히 실패) |
| `rename_excl` | `renamex_np(RENAME_EXCL)` | `MoveFileExW(src, dst, 0)` — 플래그 없는 MoveFileEx는 대상이 있으면 `ERROR_ALREADY_EXISTS`로 실패한다. **지금의 비맥 폴백(F3, 확인 후 rename)보다 낫다.** 원자적이고 exFAT·SMB에서도 동작하므로 `ENOTSUP` 복사 폴백은 안 탄다 |
| `copy_meta` | `fcopyfile(ACL\|XATTR)` | 파일 속성 비트(readonly·hidden·system·archive)만 임시 파일 핸들에 `SetFileInformationByHandle(FileBasicInfo)`로 복사(구현 시 경로가 없어 `SetFileAttributesW` 대신). ACL·대체 데이터 스트림(ADS)은 복사하지 않음 → D3 |
| `open_dir_nofollow` · `same_in` · `unlink_in` | 폴더 fd 기준 `openat`/`fstatat`/`unlinkat` | 경로 기준. 지우기는 `FILE_FLAG_OPEN_REPARSE_POINT`로 핸들을 열어 일반 파일임을 확인한 뒤 `FileDispositionInfoEx`로 핸들 단위 삭제 — 「확인한 그 객체」를 지우는 점은 `unlinkat`과 같다 |
| `volume_id` | `getattrlist(ATTR_VOL_UUID)` | `volume_serial_number()`(핸들 메타데이터). 볼륨 일련번호는 재마운트해도 안 바뀌므로 **맥의 UUID 경로와 같은 급**이다. 비맥 폴백 F2(dev 번호)는 Windows에선 쓰지 않는다 |
| `random_bytes` | `getentropy` | `BCryptGenRandom` 또는 `ProcessPrng` |
| `metadata_tuple` (read_settled) | `(len, mtime, mtime_nsec, ctime, ctime_nsec, nlink)` | `(len, last_write_time, number_of_links, file_index)`를 `GetFileInformationByHandle`로 직접 읽는다. **실측(2026-10-19):** std의 `number_of_links`·`file_index`·`volume_serial_number`·`change_time`은 rustc 1.99 stable에서 전부 미안정(`windows_by_handle`·`windows_change_time`)이라 std 경로는 못 쓴다. `ChangeTime`이 필요해지면 `GetFileInformationByHandleEx(FileBasicInfo)`. ReFS는 파일 번호가 128비트라 `FILE_ID_INFO`로 바꿀 후보 |
| `io_message` | errno 33종 → 한국어 | Win32 오류 코드 표로 별도 작성(`ERROR_ACCESS_DENIED`·`SHARING_VIOLATION`·`LOCK_VIOLATION`·`DISK_FULL`·`PATH_NOT_FOUND`·`FILENAME_EXCED_RANGE`·`BAD_NETPATH`·`NETNAME_DELETED` 등). 번호는 남긴다(의견 보내기 추적용) |
| `is_reparse` | `symlink_metadata().file_type().is_symlink()` | 같은 API. Windows는 junction도 reparse point라 `is_symlink()`가 참. `follow_links`는 그대로 |

### 2.1 불변식별 판정

| 불변식 | Windows에서 지켜지나 | 비고 |
|---|---|---|
| 1 원자적 교체, 도중 꺼져도 원본 온전 | **지킴** | `sync_all` = `FlushFileBuffers`. `*at`을 쓴 이유였던 PATH_MAX는 `\\?\` 긴 경로(std 자동) + 앱 매니페스트 `longPathAware`로 대신한다 |
| 2 링크·하드링크·읽기 전용·권한·ACL·xattr 보존 | **대부분 지킴, ACL·ADS는 못 지킴** | 링크는 대상에 쓰기, 하드링크(`number_of_links`)는 제자리 쓰기, 읽기 전용은 거부(문구 「파일 속성에서 읽기 전용을 풀면」) 전부 가능. ACL·ADS는 D3 |
| 3 우리가 만든 것만 지움, 링크 너머 불가침 | **지킴** | 핸들 단위 삭제로 확인-삭제 사이 경합 없음. 임시 파일 이름 규칙·1시간·해시 비교는 OS 무관 |
| 4 특수·거대 파일에 멈추지 않음 | **지킴(위협 모델이 다름)** | Windows 파일 시스템에는 FIFO가 없다. 대신 예약 장치 이름(`CON`·`NUL`·`COM1`)과 `\\.\pipe\` 링크가 같은 역할 → `FILE_TYPE_DISK` 재확인이 막는다. 64MiB 상한·희소 파일 처리는 그대로 |
| 5 저장 폴더 밖 금지 | **지킴** | `Path::components`가 `C:`를 `Prefix`로 내므로 `Normal`만 허용하는 `resolve`가 그대로 막는다 |
| 6 폴더 단위 잠금 | **지킴 + 한 가지 추가** | `File::try_lock`은 Windows에서 `LockFileEx`. std 기본 공유 모드가 READ·WRITE·DELETE라 여러 프로세스가 `.aru.lock`을 열 수 있다. **추가**: 다른 프로그램(에디터·백신·OneDrive)이 `.md`를 공유 금지로 열어 둔 경우 `ERROR_SHARING_VIOLATION`이 나는데, 이건 POSIX에 없는 오류라 「잠깐 기다렸다 다시」 부류로 넣어야 한다 → D4 |
| 7 읽기는 잠금 없이, 잘린 내용 반환 금지 | **지킴** | 메타데이터 튜플만 바뀜(위 표) |
| 8 못 열면 기본 폴더로 안 넘어감, bookmark | **지킴(bookmark는 사라짐)** | MSIX full-trust 앱은 사용자가 고른 폴더를 권한 저장 없이 다음 실행에도 연다. `location.json`은 `{"root"}`만(폴백 F9·F10 그대로). Defender 「제어된 폴더 액세스」가 켜진 PC에서는 문서 폴더 쓰기가 `ACCESS_DENIED` → 기존 「저장 폴더를 열 수 없어요」 경로로 뜨되 문구에 힌트 한 줄 |
| 9 폴더 변경 복사 한 덩어리 | **지킴** | staging·표지·해시·`.aru-id` 전부 경로 기반. `._` AppleDouble 필터는 무해하니 둔다(맥에서 복사해 온 동기화 폴더에 실제로 있다) |
| 10 앱 ↔ CLI 같은 설정 폴더 | **지킴(D1 전제)** | 아래 2.2 |

### 2.2 저장 폴더 위치와 홈 (불변식 10)

- `app_dirs()` Windows 분기(2026-10-19 번복, D1·D2): 설정 폴더 = `%LOCALAPPDATA%\dev.aruu.aru`(location.json·ai-batches.json·잠금), **기본 저장 폴더 = `Documents\Aru`**(`SHGetKnownFolderPath(FOLDERID_Documents)`, 못 구하면 `%USERPROFILE%\Documents\Aru`). 리눅스 분기처럼 설정 ≠ 데이터다. 폴백 F7(XDG)은 Windows에선 쓰지 않는다.
- **MSIX 파일 쓰기 가상화는 그대로 둔다.** 끄는 데 필요한 `unvirtualizedResources`는 스토어가 거절할 수 있는 제한 기능이다. 가상화는 AppData·레지스트리에만 걸리므로 설정 폴더는 가상화돼도 패키지 안의 앱과 alias CLI가 같은 가상 경로를 보고(불변식 10 유지), 문서 폴더는 가상화 대상이 아니라 탐색기·다른 편집기와도 같은 실제 경로다. 결정적 이유: 가상화된 AppData는 앱을 지우면 함께 지워져 원칙 3을 깬다.
- 홈: `USERPROFILE` → 없으면 `SHGetKnownFolderPath(FOLDERID_Profile)`. **`HOME`은 Windows에서 무시한다** — Git Bash·MSYS가 `/c/Users/x` 꼴로 넣어 두는 값이라 받으면 엉뚱한 곳에 쓴다(카탈로그 AI-022의 Windows 판).
- 샌드박스 컨테이너 홈 판별(`container_home`·`NSHomeDirectory`)은 Windows에 대응물이 없어 `None`.

### 2.3 오늘 날짜

`localtime_r` 대신 `GetLocalTime()`(시스템 시간대). Windows CRT의 `TZ` 환경 변수는 서식도 의미도 달라(`KST-9`) 지원하지 않는다고 적는다. 지금의 비맥 폴백 F5(UTC 날짜)는 **버그 수준**이라(한국은 오전 9시까지 어제로 보인다) 반드시 바꾼다.

## 3. 실행 파일·CLI·AI 연결

- **콘솔용 실행 파일을 따로 둔다**(D5). 현재 한 실행 파일이 GUI(`windows_subsystem = "windows"`)이면서 `aru list`·`aru mcp`도 맡는데, Windows에서 GUI 서브시스템 실행 파일은 터미널에 붙지 않아 `aru list`가 아무것도 출력하지 않고 프롬프트가 바로 돌아온다. `[[bin]] aru-cli`(콘솔 서브시스템)를 추가해 `aru_lib::cli::entry`만 부른다. 두 실행 파일은 같은 MSIX 안이라 같은 패키지 ID·같은 폴더를 본다. **구현 메모(2026-10-19):** tauri 번들러는 `[[bin]]`을 전부 `Aru.app/Contents/MacOS/`에 넣으므로 `required-features = ["windows-cli"]`로 가두고 `tauri.windows.conf.json`의 `build.features`로 Windows 빌드에서만 켠다. cargo를 직접 부르는 Windows 빌드에는 `--features windows-cli`가 필요하다.
- **`aru` 명령은 MSIX AppExecutionAlias로 PATH에 자동 노출**된다(`%LOCALAPPDATA%\Microsoft\WindowsApps\aru.exe`). 맥의 「번들 안 실행 파일 경로를 복사해 붙여넣기」보다 낫다.
- `ai_connect_info.command`와 `mcpb.rs`의 `mcp_config.command`는 **alias 경로를 돌려준다**. `current_exe()`를 쓰면 `C:\Program Files\WindowsApps\dev.aruu.aru_0.2.8.0_x64__…\aru-cli.exe`가 나오는데, 이 경로는 업데이트마다 바뀌고 ACL로 막혀 있어 Claude Code 등록이 다음 버전에서 깨진다.
- 등록 명령 따옴표: 프론트 `aiConnect.ts`가 POSIX 작은따옴표로 감싸는데 PowerShell·cmd는 큰따옴표다. Rust가 `platform: "windows"`를 내려주고 프론트가 분기한다.
- Claude 데스크톱 감지: `%LOCALAPPDATA%\AnthropicClaude\claude.exe` 존재 여부. `.mcpb` 열기는 셸 연결(`ShellExecute`)로 — Claude 데스크톱이 `.mcpb` 확장자를 등록한다. `mcpb.rs`의 `platforms`에 `win32` 추가.
- 실행 인자 판별 `is_launch_arg`(`-psn_` 등)는 Windows에 대응물이 없어 그대로 둔다.

## 4. 창·단축키·종료 (`lib.rs` platform::windows)

| 항목 | 맥 | Windows 설계 | 확인 필요 |
|---|---|---|---|
| 창 모양 | `titleBarStyle: Overlay` + 신호등 숨김 | `decorations: false` + `shadow: true`, Win11 둥근 모서리는 `DwmSetWindowAttribute(DWMWA_WINDOW_CORNER_PREFERENCE)`. 드래그 영역은 이미 있음(`core:window:allow-start-dragging`) | — |
| 투명도 | `NSWindow.alphaValue` | `WS_EX_LAYERED` + `SetLayeredWindowAttributes(LWA_ALPHA)` | **WebView2가 layered window에서 그려지는지 실측(D6).** 안 되면 Windows판은 투명도 설정을 숨긴다(원칙 7) |
| 모든 데스크톱에 표시 | `visibleOnAllWorkspaces` | 공개 API 없음. 지원하지 않는다고 적는다 | — |
| 빠른 입력 단축키 | ⌥Space | ⌥Space는 창 시스템 메뉴·PowerToys Run과 겹친다 → D7. 등록 실패해도 앱은 계속(현행) | — |
| 포커스 복귀 | 직전 앱 pid → `activateWithOptions` | 띄우기 직전 `GetForegroundWindow()` HWND 보관, 닫을 때 `SetForegroundWindow(prev)`. 우리 창이 포그라운드일 때 호출하므로 포그라운드 잠금에 걸리지 않는다. `QuickState`의 타입을 pid에서 플랫폼 핸들로 | VM에서 확인 |
| 두 번 실행 | macOS가 막고 `RunEvent::Reopen` | `tauri-plugin-single-instance`를 Windows에만 다시 넣어 두 번째 실행이 기존 창을 보이게. `Reopen` 분기는 `cfg(macos)` | — |
| 종료·로그아웃 | `applicationShouldTerminate` 훅, 최대 11초 저장 | `WM_QUERYENDSESSION`에서 저장 시작 + `ShutdownBlockReasonCreate`로 「저장 중」 표시, `WM_ENDSESSION`에서 저장이 끝나거나 11초까지 메시지를 돌리며 기다린 뒤 해제. 메인 스레드의 최상위 창 전부를 서브클래스한다(tao는 자기 숨은 창이 `WM_ENDSESSION`을 받는 즉시 `process::exit(0)`하고 창 순서가 정해져 있지 않다). Alt+F4·창 닫기는 맥과 같이 프론트 `onCloseRequested`가 저장 후 **숨기기**(종료 아님). 종료는 트레이 「종료」 | **tao가 `WM_QUERYENDSESSION`을 먼저 소비하는지, Windows가 11초를 기다려 주는지 실측** |
| 앱 메뉴 | Cmd+Q 가로채는 메뉴 | 없음(320px 창에 메뉴 막대는 부적절). 종료는 트레이 메뉴 + Alt+F4 | — |
| 트레이 | 흑백 템플릿 이미지 | 템플릿 개념이 없어 라이트·다크 작업 표시줄용 `.ico` 별도 제작 | — |
| OS 버전 | `NSProcessInfo` | `RtlGetVersion` → 「Windows 11 (26100)」. `GetVersionEx`는 매니페스트 없이는 거짓말한다 | — |

## 5. 패키징·CI

### 5.1 MSIX

Tauri 2 번들러는 NSIS·MSI만 만든다. MSIX는 직접 만든다 — `scripts/msix-build.ps1`(맥의 `mas-build.sh`에 대응).

1. `tauri build --no-bundle` → `aru.exe`(Tauri 2는 `mainBinaryName`을 안 주면 Cargo 패키지명을 쓴다. `Aru.exe`가 아니다) + `aru-cli.exe` + 리소스
2. `AppxManifest.xml` 템플릿(Publisher는 Partner Center 값으로 치환) — `runFullTrust`(패키지형 Win32 앱의 표준 제한 기능, 심사 때 사유 한 줄), `uap5:AppExecutionAlias aru.exe → aru-cli.exe`(Application 하나에 `uap5:Extension Executable` + `desktop4:Subsystem="console"`, Windows Terminal과 같은 구조), `MinVersion 10.0.18362.0`. 가상화 끄기 선언은 넣지 않는다(D1)
3. `makeappx pack` → `signtool sign`(사이드로드용 자체 서명 인증서. 스토어 제출본은 스토어가 서명)
4. x64·arm64 두 패키지를 `makeappx bundle`로 `.msixbundle`
5. 앱 매니페스트(실행 파일 임베드)에 `longPathAware`

### 5.2 CI — `.github/workflows/windows.yml`(windows-latest)

| 단계 | 무엇을 검증하나 |
|---|---|
| `cargo test`(x64 호스트) | Rust 191개 테스트가 **진짜 NTFS**에서. 공유 위반·열린 파일 교체·긴 경로·예약 이름이 여기서 걸린다 |
| `npm test` · `npm run e2e`(Chromium) | 프론트 27개 시나리오를 실제 Windows의 크로미움으로 |
| `cargo build --target aarch64-pc-windows-msvc` | arm64 빌드 가능 여부(실행은 VM) |
| MSIX 패키징 → `Add-AppxPackage` 사이드로드 → `aru list` | **패키지 문맥**에서 alias·가상화 끄기·폴더 일치가 실제로 되는지 |
| tauri-driver + msedgedriver | 설치된 실제 앱을 띄워 조작·스크린샷(아티팩트). Tauri 공식 WebDriver는 Windows·Linux만 지원 |
| WACK(`appcert.exe`) | 스토어 인증 사전 검사. CI 실행 가능 여부는 착수 때 확인 |

전제: `gh auth login -h github.com` 1회(현재 사내 GHE만 로그인). 공개 레포면 무료, 비공개면 Windows 러너는 분당 2배.

### 5.3 VM(UTM, Windows 11 ARM) — CI가 못 보는 것만

스토어 설치본(arm64) 동작, 단축키 충돌, 포커스 복귀, 투명도 A/B(D6), 트레이 아이콘 라이트·다크, 로그아웃 중 저장, 제어된 폴더 액세스 차단 체험, Claude 데스크톱 `.mcpb` 설치 흐름, DPI 125·150%. 카탈로그 `[Win]` 표시 케이스 전부 이 라운드에서 돈다.

## 6. 테스트 이식

인벤토리 4.2의 Unix 의존 테스트 45개를 세 묶음으로 나눈다.

| 묶음 | 처리 | 예 |
|---|---|---|
| 메커니즘이 Unix뿐 | `#[cfg(unix)]`로 남긴다 | FIFO 5건, `/dev/zero`, xattr, `sw_vers`, errno 1..=106 순회, `OsStrExt::from_bytes` |
| 같은 불변식의 Windows 쌍이 있음 | `#[cfg(windows)]` 쌍을 새로 쓴다 | 심링크 12건 → `symlink_file`(러너는 관리자라 생성 가능, 권한 없으면 skip) · 읽기 전용 파일 → `set_readonly(true)` · 읽기 전용 **폴더**(0o555)는 Windows에서 쓰기를 막지 않으므로 `icacls /deny`로 · PATH_MAX → `\\?\` 260자 초과 · errno 표 → Win32 코드 표 |
| Windows에만 있는 위협 | 새로 쓴다 | 공유 금지로 열어 둔 `.md` 교체(D4), 예약 이름(`CON`) 저장 폴더, junction 저장 폴더, `USERPROFILE` 없음, `HOME=/c/Users/x` 무시 |

`cli_process.rs`는 `HOME`으로 위치를 바꾸는데 Windows에선 `USERPROFILE`과 `LOCALAPPDATA`를 바꿔야 한다. `b9`의 `TZ=Etc/GMT-14`는 Windows에서 의미가 없어 `cfg(unix)`.

## 7. 프론트·e2e

- Rust가 `platform`을 내려주면(`ai_connect_info`에 필드 추가 또는 `platform_info` 커맨드) 프론트가 문구·따옴표·폴더 표시명을 분기한다. 사용자에게 보이는 맥 문구는 「Finder에서 열기」 1곳과 Rust 오류 문구 2곳(「Finder에서 쓰기 권한을」, 「macOS」)뿐이다. 나머지 「⌥」·「맥」은 주석이다.
- `folderLabel.ts`: `~` 축약을 `USERPROFILE`로, iCloud 상수 대신 OneDrive 알려진 폴더.
- `mockTauri.js`에 Windows 프로필(`DEFAULT_ROOT = C:\Users\me\AppData\Local\dev.aruu.aru`, alias 경로, `os_version = Windows 11`)을 넣고 `E2E_PLATFORM=win`으로 27개 시나리오를 한 번 더 돌린다. **이게 맥에서 돌리는 Windows 화면 테스트다.** `09-settings.mjs:57` 「Finder에서 열기」 단언은 플랫폼 분기.

## 8. 작업 순서 (PR 단위)

| # | 작업 | 완료 기준 |
|---|---|---|
| 1 | `storage/sys` 분리 + Windows 구현 | 맥에서 `cargo check --target x86_64-pc-windows-msvc` 0 에러(지금 63). 맥 테스트 191개 그대로 통과 |
| 2 | `cli.rs`·`lib.rs` Windows 분기, `aru-cli` bin, single-instance, platform::windows | `cargo clippy --target …` 0 경고 |
| 3 | 프론트 플랫폼 분기 + mockTauri Windows 프로필 | `E2E_PLATFORM=win npm run e2e` 통과(맥에서) |
| 4 | 테스트 이식(cfg 분리·Windows 쌍) + CI 워크플로우 | windows-latest에서 `cargo test`·e2e 전부 초록 |
| 5 | MSIX 스크립트·매니페스트 + 사이드로드 스모크 + WACK | CI 아티팩트에 `.msixbundle`·WACK 보고서·스크린샷 |
| 6 | VM 라운드(카탈로그 `[Win]` 전부) → `docs/STORE_NOTES.md`(심사 노트) | Partner Center 제출 가능 |

1번이 가장 크다. 2~3번은 1번과 독립이라 병렬 가능.

진행(2026-10-19): ①·②·③ 구현 완료, ④의 CI 워크플로우와 ⑤의 MSIX 자산·스토어 노트는 CI에서 안 돌려 본 초안, 전부 작업 트리에 미커밋. ②는 `platform_info`·`aru-cli`(feature `windows-cli`)·`tauri.windows.conf.json`·platform::windows(투명도·둥근 모서리·포커스 복귀·로그아웃 저장·Claude 데스크톱·OS 버전)·Windows 전용 single-instance·Ctrl+Alt+Space·컬러 트레이 아이콘. 맥 `cargo test` 198+8. 남은 것: ④ 테스트 cfg 분리·Windows 쌍(Unix 전용 테스트 45개), `storage::move_legacy_dir` dead-code 가드. ① Windows `cargo check` 0 에러, 맥 `cargo test` 190+8 유지. ③ vitest 379, e2e 454(맥·win 프로필 둘 다). ③이 정한 Rust 계약: `invoke("platform_info")` → `{ os: "macos" | "windows" | "linux" }`, 실패 시 프론트가 userAgent로 추정. ②가 이 커맨드를 구현한다.

## 9. 판단 필요

| # | 질문 | 내 추천 | 근거 |
|---|---|---|---|
| D1 | MSIX 파일 쓰기 가상화를 끌까 | **끄지 않는다** (2026-10-19 번복) | 끄려면 제한 기능 `unvirtualizedResources`가 필요한데 MS 문서가 「Microsoft·파트너의 특정 PC 게임용」이라 적고 있고 정책 10.6.3 거절 사례가 있다. 대신 D2로 해결 |
| D2 | 기본 저장 폴더 | **문서 폴더 `Documents\Aru`**(`FOLDERID_Documents`, OneDrive 알려진 폴더 이동 반영). 설정 폴더는 `%LOCALAPPDATA%\dev.aruu.aru` (2026-10-19 번복) | 가상화된 AppData는 **앱을 지우면 패키지 폴더째 삭제**돼 원칙 3 「Aru가 없어져도 데이터는 남는다」를 깬다. 문서 폴더는 가상화 대상이 아니라 앱·CLI·탐색기·다른 편집기가 같은 실제 경로를 본다. 제어된 폴더 액세스는 기본 꺼져 있고, 걸리면 기존 「저장 폴더에 쓸 수 없어요」 경로로 드러난다 |
| D3 | 교체 쓰기에서 ACL·ADS 보존 | **보존하지 않는다(`fs::rename`)** | 대안 `ReplaceFileW`는 ACL·ADS·생성 시각을 지키지만 중간 실패 시 원본이 중간 상태로 남을 수 있어 불변식 1과 충돌. 맥에서도 xattr 복사는 「실패해도 저장은 막지 않는」 best-effort였고, `.md`에 사용자 눈에 띄는 ADS는 없다 |
| D4 | 공유 위반(`SHARING_VIOLATION`) 처리 | **50ms×10 재시도 후 「다른 프로그램이 이 파일을 쓰는 중이에요」로 실패, 자동 저장이 다시 시도** | 잠금 실패(`LOCKED`)와 같은 부류로 화면이 재시도하게 |
| D5 | CLI 콘솔 실행 파일 분리 | **분리(`aru-cli.exe`)** | 3장. 안 나누면 `AttachConsole` 꼼수로 가능하나 프롬프트가 기다리지 않고 출력이 섞인다 |
| D6 | 투명도 | **VM에서 A/B 실측 후 결정** | WebView2 + layered window 조합은 문서로 확정 못 함 |
| D7 | 빠른 입력 기본 단축키 | **Ctrl+Alt+Space, 이미 등록돼 있으면 Ctrl+Shift+Space** | Alt+Space는 시스템 메뉴·PowerToys Run. 설정으로 빼지 않는다(원칙 7). 실기(2026-10-31): 다른 상주 프로그램이 Ctrl+Alt+Space를 먼저 등록한 PC에서 등록 실패(diag.log `HotKey already registered`) → 두 번째 후보를 둔다 |
| D8 | 아키텍처 | **x64 + arm64** | 비용은 CI 빌드 한 줄, arm64 검증은 UTM VM이 네이티브 |
| D9 | 최소 OS | **Windows 10 1903** | D1의 하한. Win11 전용으로 좁히면 설계는 안 바뀌고 대상만 준다 |
| D10 | Windows e2e 프로필(`E2E_PLATFORM=win`) | **넣는다** | 비용 작고(mock 상수 + 단언 1곳) 맥에서 Windows 화면 회귀를 잡는다 |

## 10. 이 계획의 약점 (자체 검토)

- **실측 없이 적은 Windows API 동작 4곳**: `fs::rename`의 POSIX 의미론 적용 범위, `change_time` 안정화 여부, WebView2 layered window, tao의 `WM_QUERYENDSESSION`. 각각 D6·4장에 「확인 필요」로 표시했고, 1번 PR의 cargo check와 5.3 VM 라운드에서 판정된다. 틀려도 설계가 뒤집히진 않고 대체 경로(`last_write_time` 대체, 투명도 숨김, `ShutdownBlockReason`만)가 있다.
- **핸들 기준 삭제는 `unlinkat`보다 한 단계 약하다.** 「폴더를 연 뒤 그 폴더 기준으로」가 아니라 「파일 경로로 핸들을 열어 확인 후 그 핸들로」다. 폴더 자체가 바꿔치기되는 경합은 못 막는다. 저장 폴더는 사용자 소유라 이 위협은 맥에서도 공격자 모델이었다.
- **Store 심사 변수**: `runFullTrust` 사유 승인, 개인정보 처리방침 URL 요구 여부(네트워크 없음이라 불필요로 보이나 Partner Center 설문에 달림). 6번 PR 전까지 Partner Center 앱 이름 예약과 설문을 먼저 해 두면 막판 변수가 준다.
- **CI에서 WACK·사이드로드가 되는지**는 통설만 있고 직접 해 보지 않았다. 안 되면 그 두 단계만 VM으로 옮긴다.
- **이식 PR이 크다.** 1번 PR은 `storage.rs` 약 25개 함수를 건드린다. `sys` 분리를 먼저 맥 전용으로 한 번(동작 불변, 테스트 191 통과) 커밋하고 그 위에 Windows 구현을 얹으면 리뷰가 둘로 나뉜다.
