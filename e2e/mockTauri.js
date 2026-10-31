// 브라우저에서 Tauri 백엔드를 흉내 낸다. 파일은 sessionStorage에 두어 새로고침(=앱 재시작)해도 남는다.
(() => {
  const saved = sessionStorage.getItem("__mockFs");
  window.__mockFs = saved ? JSON.parse(saved) : { ...(window.__initialFiles || {}) };
  window.__writes = [];
  window.__calls = [];
  window.__listeners = {};
  const callbacks = new Map();
  let nextId = 1;

  const persist = () => sessionStorage.setItem("__mockFs", JSON.stringify(window.__mockFs));
  function writeFile(path, content) {
    if (content === "") delete window.__mockFs[path];
    else window.__mockFs[path] = content;
    window.__writes.push([path, content]);
    persist();
    setTimeout(() => window.__emit("file-changed", { path, source: window.__TAURI_INTERNALS__.metadata.currentWindow.label }));
    // 녹화 무대처럼 여러 창을 한 페이지에 띄울 때 다른 창에도 파일 변경을 알린다
    if (window.parent !== window) window.parent.postMessage({ type: "fs-write", path, content }, "*");
  }
  // E2E_PLATFORM=win: 같은 화면을 Windows 경로·명령·OS 이름으로 그린다
  const WIN = window.__platform === "windows";
  const HOME = WIN ? "C:\\Users\\me" : "/Users/me";
  const DEFAULT_ROOT = WIN ? "C:\\Users\\me\\Documents\\Aru" : "/Users/me/Library/Application Support/dev.aruu.aru";
  const ARU_COMMAND = WIN ? "C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\aru.exe" : "/Applications/Aru.app/Contents/MacOS/aru";
  // 저장 폴더를 열 수 있는지(외장 디스크·iCloud가 늦게 붙는 경우)는 새로고침해도 이어지게 둔다
  const rootOk = () => sessionStorage.getItem("__rootUnavailable") !== "1";
  const rootPath = () => sessionStorage.getItem("__rootPath") || DEFAULT_ROOT;
  window.__setRootAvailable = (ok) => sessionStorage.setItem("__rootUnavailable", ok ? "0" : "1");
  const rootError = () => `저장 폴더를 열 수 없어요: ${rootPath()}`;

  window.__TAURI_INTERNALS__ = {
    metadata: {
      currentWindow: { label: location.hash.startsWith("#overview") ? "overview" : location.hash.startsWith("#quick") ? "quick" : "main" },
      currentWebview: { windowLabel: "main", label: "main" },
    },
    transformCallback(cb) {
      const id = nextId++;
      callbacks.set(id, cb);
      return id;
    },
    unregisterCallback(id) {
      callbacks.delete(id);
    },
    async invoke(cmd, args = {}) {
      // 조건부 쓰기(write_text_if)도 "쓰기 시도"로 세도록 write_text 이름으로 남긴다. 조건이 있었는지는 args.expected로 안다
      window.__calls.push([cmd === "write_text_if" ? "write_text" : cmd, args]);
      switch (cmd) {
        case "read_text": {
          if (!rootOk()) throw rootError();
          // UTF-8이 아닌 파일 등 Rust read_to_string이 실패하는 경우
          if ((window.__badReads || []).includes(args.path)) throw "글자로 풀 수 없는 파일이에요 (UTF-8이 아니에요)";
          // iCloud 동기화 중 등 잠깐의 읽기 오류
          if ((window.__flakyReads || []).includes(args.path)) throw "Input/output error (os error 5)";
          // __snapRead: 실제처럼 읽은 순간의 내용을 돌려준다(지연은 그 뒤 응답이 오가는 시간). 없으면 지연이 끝난 때의 내용
          const snap = window.__mockFs[args.path] ?? null;
          await new Promise((r) => setTimeout(r, window.__readDelay ?? 0));
          return window.__snapRead ? snap : (window.__mockFs[args.path] ?? null);
        }
        case "list_names": {
          if (!rootOk()) throw rootError();
          const prefix = `${args.path}/`;
          const names = Object.keys(window.__mockFs)
            .filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/"))
            .map((p) => p.slice(prefix.length));
          await new Promise((r) => setTimeout(r, window.__readDelay ?? 0));
          return names;
        }
        case "write_text":
          // 외장 디스크·네트워크 폴더처럼 쓰기가 느린 경우. 비교와 쓰기는 지연이 끝날 때 한 번에 한다
          if (window.__writeDelay) await new Promise((r) => setTimeout(r, window.__writeDelay));
          if (!rootOk()) throw rootError();
          if (window.__failWrites) throw "디스크 오류(모의)";
          writeFile(args.path, args.content);
          return null;
        case "write_text_if": {
          // 시험마다 n번째 쓰기를 실패시키는 등 세밀한 장애를 넣는다. 던지면 그 쓰기가 실패한다(지연 전에 불린다)
          window.__beforeWrite?.(args);
          // 파일 하나만 막히거나(__hangPaths, __releasePaths()로 푼다) 실패하는(__failPaths) 경우
          if ((window.__hangPaths || []).includes(args.path)) await new Promise((r) => (window.__hungPaths ||= []).push(r));
          if ((window.__failPaths || []).includes(args.path)) throw "디스크 오류(경로 모의)";
          if (window.__writeDelay) await new Promise((r) => setTimeout(r, window.__writeDelay));
          // 끊긴 네트워크 폴더(hard mount)처럼 응답이 오지 않는 쓰기. __releaseWrites()를 부르면 그제야 이어서 쓴다
          if (window.__hangWrites) await new Promise((r) => (window.__hung ||= []).push(r));
          if (!rootOk()) throw rootError();
          if (window.__lockBusy) throw "저장 폴더가 잠겨 있어요(모의)";
          if (window.__failWrites) throw "디스크 오류(모의)";
          // 앱이 읽은 뒤 쓰기 전에 aru 명령이 끼어든 것처럼 한 번 쓴다
          const cli = window.__interleave?.[args.path];
          if (cli !== undefined) {
            delete window.__interleave[args.path];
            window.__setFile(args.path, cli);
          }
          // __churn[path]=n: 쓰기를 시도할 때마다 직전에 다른 곳이 한 줄씩 더한다(n번까지). 합치기 상한을 넘기는 경우
          if (window.__churn?.[args.path] > 0) {
            window.__churn[args.path]--;
            window.__churnN = (window.__churnN || 0) + 1;
            window.__setFile(args.path, (window.__mockFs[args.path] ?? "") + `- [ ] 바깥${window.__churnN}\n`);
          }
          const current = window.__mockFs[args.path] ?? "";
          if (args.expected !== null && args.expected !== undefined && current !== args.expected) return { ok: false, current };
          writeFile(args.path, args.content);
          // __respDelay: 파일에는 이미 들어갔고 응답만 늦게 오는 경우
          if (window.__respDelay) await new Promise((r) => setTimeout(r, window.__respDelay));
          return { ok: true, current: null };
        }
        case "set_window_opacity":
          // __failOpacity: 앞으로 실패시킬 횟수
          if (window.__failOpacity > 0) {
            window.__failOpacity--;
            throw "창 투명도를 바꾸지 못했어요(모의)";
          }
          if (window.parent !== window) window.parent.postMessage({ type: "opacity", alpha: args.alpha }, "*");
          return null;
        case "open_overview":
          if (window.parent !== window) window.parent.postMessage({ type: "open-overview" }, "*");
          return null;
        case "plugin:window|set_always_on_top":
          if (window.parent !== window) window.parent.postMessage({ type: "pin", value: args.value }, "*");
          return null;
        case "hide_quick":
          if (window.parent !== window) window.parent.postMessage({ type: "hide-quick" }, "*");
          return null;
        case "plugin:app|version":
          if (window.__failVersion) throw "버전을 읽지 못했어요(모의)";
          return "0.2.1";
        case "recent_ai_batches":
          return window.__aiBatches ?? [];
        case "ai_connect_info":
          if (window.__aiInfoFail) throw window.__aiInfoFail;
          return { command: window.__aruCommand ?? ARU_COMMAND, claudeDesktop: window.__claudeDesktop ?? true };
        case "install_claude_desktop":
          // __installDelay: Claude 데스크톱이 열리기까지의 시간, __installFail: Rust가 돌려준 실패 이유
          if (window.__installDelay) await new Promise((r) => setTimeout(r, window.__installDelay));
          if (window.__installFail) throw window.__installFail;
          return null;
        case "os_version":
          if (window.__osVersionFail) throw "OS 버전을 읽지 못했어요(모의)";
          return WIN ? "Windows 11 (26100)" : "macOS 15.1";
        case "platform_info":
          return { os: WIN ? "windows" : "macos" };
        case "get_data_root":
          return rootPath();
        case "data_root_info":
          return { path: rootPath(), isDefault: !sessionStorage.getItem("__rootPath"), home: HOME };
        case "data_root_status":
          return rootOk() ? { ok: true, path: rootPath(), error: null } : { ok: false, path: rootPath(), error: "폴더가 없어요(모의)" };
        case "set_data_root": {
          if (window.__failSetRoot) throw window.__failSetRoot;
          // copied: 지금 할 일을 새 폴더로 옮겼는가(이미 할 일이 있는 폴더면 false)
          // reason: copied(옮김) · kept(이미 할 일이 있는 폴더) · sourceUnavailable(지금 폴더를 열 수 없어 옮길 게 없음)
          const copied = window.__setRootCopied ?? true;
          const changed = { copied, reason: window.__setRootReason ?? (copied ? "copied" : "kept") };
          // 실제 앱은 data-root-changed를 보내 창이 새로고침된다. 기존 시나리오는 새로고침 전 상태를 보므로 __setRootEmits일 때만 보낸다
          if (window.__setRootEmits) {
            sessionStorage.setItem("__rootPath", args.path);
            setTimeout(() => window.__emit("data-root-changed", changed));
          }
          return changed;
        }
        case "reset_data_root":
          sessionStorage.removeItem("__rootPath");
          window.__setRootAvailable(true);
          setTimeout(() => window.__emit("data-root-changed", null));
          return null;
        case "plugin:dialog|open":
          return window.__pickResult ?? null;
        case "plugin:event|emit":
          window.__emit(args.event, args.payload);
          return null;
        case "plugin:event|listen":
          (window.__listeners[args.event] ||= []).push(args.handler);
          return args.handler;
        default:
          return null;
      }
    },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };

  window.__emit = (event, payload) => {
    for (const id of window.__listeners[event] || []) {
      callbacks.get(id)?.({ event, id, payload });
    }
  };
  window.__releaseWrites = () => {
    window.__hangWrites = false;
    for (const release of (window.__hung || []).splice(0)) release();
  };
  window.__releasePaths = () => {
    window.__hangPaths = [];
    for (const release of (window.__hungPaths || []).splice(0)) release();
  };
  window.__setFile = (path, content) => {
    if (content === null) delete window.__mockFs[path];
    else window.__mockFs[path] = content;
    persist();
  };
})();
