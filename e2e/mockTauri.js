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
      window.__calls.push([cmd, args]);
      switch (cmd) {
        case "read_text":
          return window.__mockFs[args.path] ?? null;
        case "write_text":
          if (window.__failWrites) throw "디스크 오류(모의)";
          if (args.content === "") delete window.__mockFs[args.path];
          else window.__mockFs[args.path] = args.content;
          window.__writes.push([args.path, args.content]);
          persist();
          setTimeout(() => window.__emit("file-changed", { path: args.path, source: window.__TAURI_INTERNALS__.metadata.currentWindow.label }));
          // 녹화 무대처럼 여러 창을 한 페이지에 띄울 때 다른 창에도 파일 변경을 알린다
          if (window.parent !== window) window.parent.postMessage({ type: "fs-write", path: args.path, content: args.content }, "*");
          return null;
        case "set_window_opacity":
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
        case "pending_update":
          return window.__asUpdate(window.__pendingUpdate);
        case "check_update_now":
          await new Promise((r) => setTimeout(r, window.__checkDelay ?? 0));
          if (window.__failCheck) throw "연결 실패(모의)";
          return window.__asUpdate(window.__checkResult);
        case "plugin:app|version":
          return "0.2.1";
        case "recent_ai_batches":
          return window.__aiBatches ?? [];
        case "os_version":
          return "macOS 15.1";
        case "install_update":
          await new Promise((r) => setTimeout(r, window.__installDelay ?? 0));
          if (window.__failInstall) throw "내려받기 실패(모의)";
          return null;
        case "get_data_root":
          return "/Users/me/Library/Application Support/dev.aruu.aru";
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

  // 테스트에선 버전만 줘도 되게 한다. 실제 앱은 { version, notes }를 준다
  window.__asUpdate = (u) => (u == null ? null : typeof u === "string" ? { version: u, notes: "" } : u);

  window.__emit = (event, payload) => {
    for (const id of window.__listeners[event] || []) {
      callbacks.get(id)?.({ event, id, payload });
    }
  };
  window.__setFile = (path, content) => {
    if (content === null) delete window.__mockFs[path];
    else window.__mockFs[path] = content;
    persist();
  };
})();
