# App Review 노트 / Notes for App Review

App Store Connect의 "App Review 정보 → 메모"에 붙여 넣는 글이다. 코드나 권한(entitlements)이 바뀌면 함께 고친다.

## 한국어

Aru는 바탕화면 위에 떠 있는 작은 할 일 창입니다. 할 일은 사용자의 맥에 마크다운 파일로만 저장됩니다(기본은 앱 컨테이너, 사용자가 고르면 그 폴더).

**AI 도구 연결은 사용자가 누를 때만 동작합니다.**
- 설정 → "AI 도구에 연결"의 버튼을 눌러야만 동작하며, 앱이 스스로 다른 앱에 연결하지 않습니다.
- Claude Code·Codex 버튼은 등록 명령을 클립보드에 복사할 뿐입니다. 사용자가 직접 터미널에 붙여 넣어 실행합니다.
- Claude 데스크톱 버튼은 확장 파일(`.mcpb`)을 앱 캐시 폴더에 만들고 Claude 데스크톱으로 엽니다. 설치 여부는 Claude가 사용자에게 묻습니다.

**다른 앱의 설정을 고치지 않습니다.** Claude·Codex 등 다른 앱의 설정 파일을 읽거나 쓰지 않습니다. 샌드박스 밖의 파일은 사용자가 파일 대화상자에서 고른 저장 폴더만 씁니다.

**네트워크를 쓰지 않습니다.** 앱은 인터넷에 접속하지 않고, 사용 통계·분석·광고가 없습니다.
- `com.apple.security.network.client` 권한은 WKWebView가 앱에 들어 있는 화면(로컬 페이지)을 불러오는 데 필요해서 켰습니다. 이 권한이 없으면 창이 빈 채로 뜹니다(서명한 샌드박스 테스트 빌드에서 이 권한을 빼고 확인했습니다. 작은 창과 빠른 입력창이 모두 빈 화면이었습니다).
- "의견 보내기"는 사용자가 누를 때만 기본 브라우저로 의견 폼을 엽니다. 앱이 직접 무언가를 보내지 않습니다.

**명령어(CLI)와 MCP 서버는 앱 자신의 서명된 실행 파일입니다.** AI 도구가 실행하는 `aru` 명령은 `Aru.app/Contents/MacOS/aru`, 곧 이 앱 번들 안의 같은 실행 파일이며 따로 내려받거나 설치하는 코드가 없습니다. 이 명령도 앱과 같은 샌드박스 안에서 돌며 앱이 쓰는 저장 폴더의 할 일 파일만 읽고 씁니다. 설정의 "AI·명령어로 추가 허용"을 끄면 할 일을 넣지 못합니다.

**확인 방법:** 앱을 열고 입력칸에 할 일을 적은 뒤 Enter를 누르면 됩니다. 로그인·계정·인앱 결제가 없습니다.

## English

Aru is a small to-do window that floats above the desktop. To-dos are stored only as Markdown files on the user's Mac (the app container by default, or a folder the user picks).

**AI connection happens only on user action.**
- It runs only when the user presses a button under Settings → "Connect to AI tools". The app never connects to other apps on its own.
- The Claude Code and Codex buttons only copy a registration command to the clipboard. The user pastes and runs it in Terminal.
- The Claude Desktop button creates an extension file (`.mcpb`) in the app's cache folder and opens it with Claude Desktop. Claude asks the user whether to install it.

**It does not modify other apps' settings.** The app never reads or writes configuration files of Claude, Codex, or any other app. Outside the sandbox it only writes to the storage folder the user chose in the file dialog.

**It does not use the network.** The app makes no internet connections and has no analytics, tracking, or ads.
- The `com.apple.security.network.client` entitlement is enabled because WKWebView needs it to load the app's own bundled pages. Without it the window opens blank (verified on a signed sandboxed test build with the entitlement removed: both the main window and the quick-add window rendered blank).
- "Send feedback" opens a feedback form in the default browser only when the user clicks it. The app itself sends nothing.

**The CLI and MCP server are the app's own signed binary.** The `aru` command that AI tools run is `Aru.app/Contents/MacOS/aru`, the same executable inside this app bundle. No code is downloaded or installed separately. The command runs in the same sandbox and reads and writes only the to-do files in the app's storage folder, and it cannot add to-dos when the user turns off "Allow adding from AI and commands" in Settings.

**How to try it:** Open the app, type a to-do in the input field, and press Enter. There is no login, account, or in-app purchase.
