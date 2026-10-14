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
      currentWindow: { label: "main" },
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
          setTimeout(() => window.__emit("file-changed", { path: args.path, source: "self" }));
          return null;
        case "get_data_root":
          return "/Users/me/Library/Application Support/dev.aruu.floatingtodo";
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
  window.__setFile = (path, content) => {
    if (content === null) delete window.__mockFs[path];
    else window.__mockFs[path] = content;
    persist();
  };
})();
