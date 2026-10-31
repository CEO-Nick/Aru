<!-- 초안. CI에서 아직 돌려 보지 않았다(패키지·인증 결과가 나오면 아래 「확인 필요」를 지운다). -->
# Microsoft Store 제출 노트 (Windows판)

맥 `docs/APP_REVIEW_NOTES.md`에 대응한다. Partner Center 제출 절차, 「인증 메모(Notes for certification)」에 붙여 넣을 글, 제한 기능 사유 문구를 둔다. 코드·매니페스트(`src-tauri/msix/AppxManifest.xml`)가 바뀌면 함께 고친다.

## 1. 계정·비용 (2026-10 확인)

| 항목 | 값 |
|---|---|
| 개인 개발자 등록비 | 무료 (2025-09부터, 2026-10 확인) |
| 회사 계정 등록비 | 무료 (2026-05부터, 2026-10 확인) |
| 앱 판매 수수료 | MS 결제를 쓰는 앱은 15% (2026-10 확인) |
| 이름 예약 | 3개월 유지. 그 안에 제출하지 않으면 풀린다 |
| 부가세 | 한국은 Microsoft-managed 국가 — MS가 부가세를 걷고 낸다 |
| 지급 | 세금 서류 W-8BEN(비미국 개인) + 한국 은행 계좌 등록 |

## 2. 제출 전에 해 둘 것

1. Partner Center에서 앱 이름 「Aru」 예약 → **제품 관리 → 제품 ID**의 `Package/Identity/Name`, `Package/Identity/Publisher`, `PublisherDisplayName` 세 값을 받는다. 이 값이 `scripts/msix-build.ps1`의 `-IdentityName`·`-Publisher`·`-PublisherDisplayName`이다(CI 값과 다르다).
2. 개인정보 처리방침 URL 준비. 앱이 네트워크를 쓰지 않아 법적 필수는 아닐 수 있으나 제출 설문 흐름상 실무적으로 필요하다.
3. 베타는 **Private audience**로 연다. ⚠️ Public으로 한 번 내면 그 앱은 Private으로 되돌릴 수 없고, 유료 앱이면 Private 테스터도 결제해야 한다 → 베타 기간은 무료로 두거나 처음부터 Private으로.
4. `pwsh scripts/msix-build.ps1 -Arch x64,arm64 …`로 `.msixbundle`을 만든다(서명 없이 — 스토어가 서명한다). 로컬 WACK를 한 번 돌려 둔다.

## 3. 제출 6섹션

| 섹션 | 채울 것 |
|---|---|
| 가격 및 사용 가능 여부 | 1회 결제 가격, 시장(대한민국 포함), 공개 범위(베타는 Private audience) |
| 속성 | 범주 「생산성」, 개인정보 처리방침 URL, 시스템 요구(Windows 10 1903 이상, x64·arm64) |
| 연령 등급 | IARC 설문 — 사용자 간 소통·위치·구매 없음 |
| 패키지 | `Aru_<버전>.msixbundle` 업로드. 버전 네 번째 자리는 0 |
| 스토어 목록 | 한국어·영어 설명, 스크린샷(최소 1장), 로고 |
| 제출 옵션 | 게시 시점, **인증 메모**(아래 4절), **제한 기능 사유**(아래 5절) |

## 4. 인증 메모 (Notes for certification)

맥 심사 노트를 Windows 표현으로 옮겼다.

### 한국어

Aru는 바탕화면 위에 떠 있는 작은 할 일 창입니다. 할 일은 사용자의 PC에 마크다운 파일로만 저장됩니다(기본은 문서 폴더의 `Documents\Aru`, 사용자가 고르면 그 폴더. 앱 설정 파일은 `%LOCALAPPDATA%\dev.aruu.aru`).

**AI 도구 연결은 사용자가 누를 때만 동작합니다.**
- 설정 → "AI 도구에 연결"의 버튼을 눌러야만 동작하며, 앱이 스스로 다른 앱에 연결하지 않습니다.
- Claude Code·Codex 버튼은 등록 명령을 클립보드에 복사할 뿐입니다. 사용자가 직접 터미널(PowerShell·명령 프롬프트)에 붙여 넣어 실행합니다.
- Claude 데스크톱 버튼은 확장 파일(`.mcpb`)을 앱 캐시 폴더에 만들고 Windows의 파일 연결로 Claude 데스크톱에 엽니다. 설치 여부는 Claude가 사용자에게 묻습니다.

**다른 앱의 설정을 고치지 않습니다.** Claude·Codex 등 다른 앱의 설정 파일을 읽거나 쓰지 않습니다. 앱이 쓰는 곳은 위 기본 저장 폴더와 사용자가 폴더 선택 대화상자에서 고른 저장 폴더뿐입니다.

**네트워크를 쓰지 않습니다.** 앱은 인터넷에 접속하지 않고, 사용 통계·분석·광고가 없습니다. 화면은 앱 패키지 안의 로컬 페이지를 WebView2로 그립니다. "의견 보내기"는 사용자가 누를 때만 기본 브라우저로 의견 폼을 엽니다. 앱이 직접 무언가를 보내지 않습니다.

**명령어(`aru`)와 MCP 서버는 같은 패키지 안의 실행 파일입니다.** AI 도구가 실행하는 `aru` 명령은 패키지의 App Execution Alias(`aru.exe`)로, 이 패키지에 들어 있는 콘솔용 실행 파일(`aru-cli.exe`)을 가리킵니다. 따로 내려받거나 설치하는 코드가 없습니다. 이 명령은 앱과 같은 저장 폴더의 할 일 파일만 읽고 쓰며, 설정의 "AI·명령어로 추가 허용"을 끄면 할 일을 넣지 못합니다.

**확인 방법:** 앱을 열고 입력칸에 할 일을 적은 뒤 Enter를 누르면 됩니다. 명령어는 PowerShell에서 `aru list`로 확인할 수 있습니다. 로그인·계정·인앱 결제가 없습니다.

### English

Aru is a small to-do window that floats above the desktop. To-dos are stored only as Markdown files on the user's PC (`Documents\Aru` by default, or a folder the user picks; app settings live in `%LOCALAPPDATA%\dev.aruu.aru`).

**AI connection happens only on user action.**
- It runs only when the user presses a button under Settings → "Connect to AI tools". The app never connects to other apps on its own.
- The Claude Code and Codex buttons only copy a registration command to the clipboard. The user pastes and runs it in a terminal (PowerShell or Command Prompt).
- The Claude Desktop button creates an extension file (`.mcpb`) in the app's cache folder and opens it with Claude Desktop through the Windows file association. Claude asks the user whether to install it.

**It does not modify other apps' settings.** The app never reads or writes configuration files of Claude, Codex, or any other app. It writes only to the default storage folder above and to a folder the user chose in the folder picker.

**It does not use the network.** The app makes no internet connections and has no analytics, tracking, or ads. The UI is the app's own bundled local pages rendered by WebView2. "Send feedback" opens a feedback form in the default browser only when the user clicks it. The app itself sends nothing.

**The `aru` command and MCP server ship in the same package.** The `aru` command that AI tools run is the package's App Execution Alias (`aru.exe`), which points to the console executable (`aru-cli.exe`) inside this package. No code is downloaded or installed separately. The command reads and writes only the to-do files in the app's storage folder, and it cannot add to-dos when the user turns off "Allow adding from AI and commands" in Settings.

**How to try it:** Open the app, type a to-do in the input field, and press Enter. The command can be tried with `aru list` in PowerShell. There is no login, account, or in-app purchase.

## 5. 제한 기능(restricted capability) 사유

Partner Center는 제한 기능을 선언한 패키지에 사유를 요구한다. 제출 옵션의 해당 칸에 붙여 넣는다.

### 5.1 runFullTrust (필수)

> 한국어: Aru는 Win32 데스크톱 앱(Rust + WebView2)을 MSIX로 패키징한 것이라 full trust 프로세스로 실행되어야 합니다. 이 기능은 앱 실행 파일과 명령어용 콘솔 실행 파일(App Execution Alias `aru`)을 시작하는 데만 쓰이며, 다른 프로세스를 관리자 권한으로 띄우거나 시스템 설정을 바꾸지 않습니다.
>
> English: Aru is a Win32 desktop app (Rust + WebView2) packaged as MSIX, so it must run as a full-trust process. The capability is used only to start the app's own executable and its console executable exposed through the `aru` App Execution Alias. The app does not elevate, launch other processes with administrator rights, or change system settings.

### 5.2 unvirtualizedResources — 쓰지 않는다 (2026-10-19 D1 번복)

MSIX 파일 쓰기 가상화를 끄려면 이 제한 기능이 필요한데, Microsoft 문서가 「Microsoft와 파트너의 특정 PC 게임용, 다른 용도는 의도하지 않음」이라고 적고 있어(https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/app-capability-declarations) 심사 거절 위험이 있다. 대신 기본 저장 폴더를 가상화 대상이 아닌 문서 폴더(`Documents\Aru`)에 두어 탐색기·다른 편집기·동기화 도구가 같은 실제 경로를 보고, 앱을 지워도 할 일 파일이 남게 한다. 설정 파일만 `%LOCALAPPDATA%\dev.aruu.aru`에 두며 이 폴더는 가상화돼도 무방하다(패키지 안의 앱과 `aru` alias만 읽는다). 매니페스트의 제한 기능은 `runFullTrust` 하나다.
