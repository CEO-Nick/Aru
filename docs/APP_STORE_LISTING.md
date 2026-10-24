# App Store Connect 입력값

App Store Connect에서 앱을 만들고 칸마다 붙여 넣을 값이다. 글자 수는 `node scripts/listing-check.mjs`로 잰다(한도 넘으면 실패). 기능·권한이 바뀌면 `docs/APP_REVIEW_NOTES.md`·`site/privacy.html`과 함께 고친다.

## 0. 정해야 하는 것

| 항목 | 상태 | 메모 |
|---|---|---|
| 스토어 이름 | 결정 | **`Aru - 늘 떠 있는 할 일`** (2026-10-24). `Aru` 단독은 다른 개발자의 iOS AI 비서 앱이 쓰고 있다(apps.apple.com/kr/app/aru/id6781350361). 앱 안 이름(Dock·메뉴 막대)은 `Aru` 그대로 |
| 가격 | 결정 | 1회 결제 **₩4,400** (미국 $2.99 등급, 2026-10-24). 비슷한 떠 있는 창·메뉴 막대 할 일 앱이 ₩4,400~₩7,700에 몰려 있다. 내 몫은 건당 ₩3,400(부가세 10%·소규모 사업자 프로그램 수수료 15% 제외) — 소규모 사업자 프로그램 가입 필수, 안 하면 30% |
| 첫 출시 버전 | 결정 | `1.0.0` (2026-10-23). `tauri.conf.json`·`package.json`·`Cargo.toml`이 같은 값이어야 한다 |
| 판매 국가 | 제안 | 전체 국가. 앱 화면이 한국어뿐이라 한국만으로 시작해도 된다 |

### 이름 후보 (30자 이하)

| 후보 | 비고 |
|---|---|
| `Aru - 늘 떠 있는 할 일` | 한국어 스토어용. 기능이 바로 읽힌다 |
| `Aru: 오늘 할 일` | 짧다 |
| `Aru - Floating To-Do` | 영어 스토어용 |

## 1. 앱 정보

| 칸 | 값 |
|---|---|
| 번들 ID | `dev.aruu.aru` (코드가 이 값을 쓴다. 다른 값으로 만들면 안 된다) |
| SKU | `aru-mac` (사용자에게 안 보인다. 아무 값이나 고유하면 된다) |
| 기본 언어 | 한국어 |
| 1차 카테고리 | 생산성 (Productivity) |
| 2차 카테고리 | 개발자 도구 (Developer Tools) — AI 도구 연결을 내세운다면. 아니면 비워 둔다 |
| 콘텐츠 권한 | 제3자 콘텐츠 없음 |
| 연령 등급 | 설문 전부 "없음" → 4+ (사용자 간 소통·웹 브라우징·구매·위치 없음) |
| 저작권 | `© 2026 조익현` (판매자 이름과 맞춘다) |

## 2. 개인정보

| 칸 | 값 |
|---|---|
| 개인정보 처리방침 URL | `https://aruu.dev/aru/privacy.html` (`site/privacy.html`. 제출 전에 서버에 올린다) |
| 데이터 수집 | **"데이터를 수집하지 않음"** — 앱이 인터넷으로 아무것도 보내지 않는다. 의견 폼은 사용자가 브라우저에서 직접 보내는 것이라 앱의 수집이 아니다 |
| 추적 | 하지 않음 |

## 3. 버전 정보 — 한국어

### 부제 (30자)
```
모든 창 위에, 오늘 할 일
```

### 프로모션 텍스트 (170자, 심사 없이 언제든 바꿀 수 있다)
```
작은 창 하나에 오늘 할 일만. 다른 앱을 쓰는 동안에도 늘 화면 위에 떠 있고, ⌥Space로 어디서든 바로 적어요. 계정도 서버도 없이, 할 일은 내 맥의 파일로 남아요.
```

### 설명 (4000자)
```
Aru는 맥 화면 맨 위에 떠 있는 작은 할 일 창이에요. 오늘 할 일과 언젠가 할 일을 한 창에 두고, 무슨 일을 하든 시야에서 놓치지 않게 해 줘요.

■ 늘 위에, 그러나 가볍게
핀을 켜 두면 편집기를 누르든 브라우저를 누르든 Aru가 그 위에 떠 있어요. 핀을 끄면 보통 창처럼 뒤로 가요. 창을 흐리게 하면 뒤의 작업이 비쳐 보여요.

■ ⌥Space로 어디서든
다른 앱을 쓰다가 할 일이 떠오르면 ⌥Space. 입력창이 뜨고, Enter를 누르면 오늘 할 일에 들어간 뒤 하던 앱으로 돌아가요. Tab을 누르면 언젠가 목록에 넣어요.

■ 끝내지 못한 일은 다음 날로
자정이 지나면 남은 일이 어디서 넘어왔는지 표시를 달고 다음 날로 넘어와요. 그 날짜에 그대로 두거나 언젠가 목록으로 보내도록 바꿀 수 있어요. 며칠 맥을 꺼 두었어도 다음에 켤 때 한 번에 정리해요.

■ 한 달을 한눈에
달력을 열면 날짜마다 할 일이 보여요. 날짜를 골라 바로 고치고, 언젠가 할 일을 달력 칸에 끌어다 놓으면 그 날짜로 옮겨져요. 앞으로의 날짜에 미리 적어 둔 일은 그날이 되면 오늘 목록에 나타나요.

■ AI에게 "할 일에 넣어 줘"
Claude Code, Codex, Claude 데스크톱과 연결하면 대화하다가 "오늘 할 일에 넣어 줘"라고 할 때 Aru에 바로 들어가요. AI가 넣은 할 일에는 AI 표시가 붙고, 방금 들어온 묶음은 한 번에 되돌릴 수 있어요. AI는 넣기만 하고 지우거나 고치지 않아요. 설정에서 끌 수 있어요.

■ 할 일은 내 맥의 텍스트 파일로
적는 대로 알아서 저장하고, 날짜마다 마크다운 파일 하나로 남겨요. 다른 편집기로 열어도 그대로 읽혀요. 저장 폴더를 iCloud Drive나 Dropbox로 바꾸면 다른 맥과 함께 쓸 수 있어요.

■ 계정도, 서버도 없어요
로그인이 없고, 사용 기록을 모으지 않으며, 앱이 인터넷으로 아무것도 보내지 않아요. 한 번 결제하면 끝이에요.
```

### 키워드 (100자, 쉼표로 구분, 띄어쓰기 없이)
```
할일,투두,todo,체크리스트,작업관리,메모,플로팅,항상위,생산성,마크다운,캘린더,일정,AI,MCP
```

### 이번 버전의 새로운 기능 (첫 출시는 비워 둔다)

### 지원 URL
```
https://aruu.dev/aru/
```

### 마케팅 URL
```
https://aruu.dev/aru/
```

## 4. 버전 정보 — 영어 (English)

앱 화면은 한국어뿐이다. 영어 스토어 정보를 넣으면 영어권 사용자가 한국어 화면을 받게 되니, 넣을지 판매 국가와 함께 정한다.

### Subtitle (30)
```
To-dos above every window
```

### Promotional text (170)
```
Just today's to-dos in one small window that stays on top while you work. Add from anywhere with ⌥Space. No account, no server: your to-dos are files on your Mac.
```

### Description (4000)
```
Aru is a small to-do window that floats above everything on your Mac. Keep today's to-dos and someday to-dos in one window, and never lose sight of them while you work.

■ Always on top, never in the way
With the pin on, Aru stays above your editor and browser. Turn the pin off and it behaves like a normal window. Lower the opacity to see your work through it.

■ Add from anywhere with ⌥Space
Thought of something while in another app? Press ⌥Space, type, and hit Enter. It lands in today's list and you're back where you were. Press Tab to send it to Someday instead.

■ Unfinished to-dos move to the next day
After midnight, what's left carries over to the new day, marked with the day it came from. You can keep them on their day or send them to Someday instead. Even if your Mac was off for days, it all catches up the next time you open Aru.

■ The whole month at a glance
Open the calendar to see every day's to-dos. Pick a day to edit it, or drag a Someday item onto a date to schedule it. To-dos written for a future date show up in today's list when the day comes.

■ "Add it to my to-dos," says your AI
Connect Claude Code, Codex, or Claude Desktop, and ask them to add to-dos mid-conversation. AI-added items get an AI badge, and the latest batch can be undone at once. AI tools can only add, never delete or edit. You can turn this off in Settings.

■ Your to-dos are text files on your Mac
Everything saves automatically, one Markdown file per day, readable in any editor. Point the storage folder at iCloud Drive or Dropbox to share it across Macs.

■ No account, no server
No login, no analytics, and the app sends nothing over the internet. Pay once and it's yours.

The app's interface is in Korean.
```

### Keywords (100)
```
todo,to-do,checklist,tasks,floating,always on top,productivity,markdown,calendar,planner,AI,MCP
```

## 5. 스크린샷

맥 규격 2880×1800(16:10) PNG 5장. 다시 찍기: `node e2e/record/store-shots.mjs` (실제 앱 화면을 모의 저장소로 띄워 찍는다).

| 파일 | 장면 |
|---|---|
| `docs/app-store/screenshots/ko/01-main.png` | 모든 창 위에, 오늘 할 일 |
| `docs/app-store/screenshots/ko/02-quick.png` | ⌥Space 빠른 입력 |
| `docs/app-store/screenshots/ko/03-overview.png` | 월 달력 |
| `docs/app-store/screenshots/ko/04-midnight.png` | 끝내지 못한 일은 다음 날로 |
| `docs/app-store/screenshots/ko/05-ai.png` | AI에게 말하면 할 일로 |

## 6. App Review 정보

| 칸 | 값 |
|---|---|
| 로그인 필요 | 아니요 |
| 연락처 | 이름·전화·이메일 — 판매자 본인 것을 넣는다 |
| 메모 | `docs/APP_REVIEW_NOTES.md` 전문(한국어+영어) |
| 수출 규정(암호화) | Info.plist에 `ITSAppUsesNonExemptEncryption = false`가 있어 묻지 않는다 |

## 7. 빌드 올리기

`docs/APP_REVIEW_NOTES.md`와 별개로, 빌드 절차는 `scripts/mas-build.sh` 머리말이 정본이다. 계정 없이 리허설: `MAS_DRY_RUN=1 scripts/mas-build.sh`.
