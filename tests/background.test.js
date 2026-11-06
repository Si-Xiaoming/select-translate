/**
 * background.js 行为验证（打桩 chrome API + fetch）。
 * 覆盖：扩展更新后重新注入、快捷键去重、选区/剪贴板兜底、翻译与提示。
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");

function createEnv(options) {
  const opts = options || {};
  const calls = {
    executeScript: [],
    insertCSS: [],
    notifications: [],
    contextMenusCreated: [],
    fetch: [],
    tabsQueried: 0
  };

  const listeners = {
    installed: [],
    startup: [],
    command: [],
    message: [],
    contextMenuClicked: [],
    storageChanged: []
  };

  const state = {
    sync: { sourceLang: "auto", targetLang: "zh-CN", autoTranslate: true, shortcut: "Alt+T" },
    local: Object.assign({}, opts.local || {}),
    session: {},
    tabs: opts.tabs || [],
    selection: opts.selection || "",
    clipboard: opts.clipboard || ""
  };

  function event(list) {
    return {
      addListener(fn) {
        list.push(fn);
      }
    };
  }

  const chrome = {
    runtime: {
      onInstalled: event(listeners.installed),
      onStartup: event(listeners.startup),
      onMessage: event(listeners.message),
      getURL(p) {
        return "chrome-extension://test/" + p;
      }
    },
    commands: { onCommand: event(listeners.command) },
    contextMenus: {
      onClicked: event(listeners.contextMenuClicked),
      removeAll(cb) {
        if (cb) cb();
      },
      create(info, cb) {
        calls.contextMenusCreated.push(info);
        if (cb) cb();
      }
    },
    storage: {
      sync: {
        async get(defaults) {
          if (opts.storageFails) throw new Error("storage unavailable");
          const out = Object.assign({}, defaults || {});
          for (const key of Object.keys(state.sync)) out[key] = state.sync[key];
          return out;
        },
        async set(values) {
          Object.assign(state.sync, values);
        }
      },
      local: {
        async get(key) {
          if (typeof key === "string") return { [key]: state.local[key] };
          return Object.assign({}, state.local);
        },
        async set(values) {
          Object.assign(state.local, values);
        }
      },
      session: {
        async get(key) {
          if (typeof key === "string") return { [key]: state.session[key] };
          return Object.assign({}, state.session);
        },
        async set(values) {
          Object.assign(state.session, values);
        }
      },
      onChanged: event(listeners.storageChanged)
    },
    tabs: {
      async query() {
        calls.tabsQueried++;
        return state.tabs;
      },
      async update() {},
      async sendMessage() {
        throw new Error("no receiver");
      }
    },
    scripting: {
      async executeScript(details) {
        calls.executeScript.push(details);
        if (opts.scriptingFails) throw new Error("cannot inject");
        if (details.files) return [];
        if (details.func) {
          const source = String(details.func);
          if (source.indexOf("clipboard") >= 0) return [{ result: state.clipboard }];
          return (opts.perFrameSelection || [state.selection]).map((text) => ({ result: text }));
        }
        return [];
      },
      async insertCSS(details) {
        calls.insertCSS.push(details);
        if (opts.scriptingFails) throw new Error("cannot inject css");
        return undefined;
      }
    },
    windows: {
      async create() {
        return { id: 1 };
      },
      async update() {}
    },
    notifications: {
      async create(info) {
        calls.notifications.push(info);
        return "id";
      }
    }
  };
  const labels = {};

  const sandbox = {
    chrome,
    console,
    fetch: async (url) => {
      calls.fetch.push(url);
      const failCount = opts.fetchFailCount || 0;
      if (opts.fetchFails || calls.fetch.length <= failCount) throw new Error("network down");
      return {
        ok: true,
        async json() {
          if (String(url).indexOf("mymemory") >= 0) {
            return { responseData: { translatedText: "你好" } };
          }
          return [["你好", "hello", null, null, 10], null, "en"];
        }
      };
    },
    setTimeout: (fn, ms) => {
      // 不能 unref：background 的 sleep 是真正被 await 的
      return setTimeout(fn, ms);
    },
    clearTimeout,
    URLSearchParams,
    Promise,
    Date,
    Number,
    String,
    Object,
    Array,
    JSON,
    Math,
    RegExp,
    Error
  };
  sandbox.self = sandbox;
  // importScripts：把依赖脚本注入同一个上下文
  sandbox.importScripts = (...files) => {
    for (const file of files) {
      const source = fs.readFileSync(path.join(ROOT, file), "utf8");
      vm.runInContext(source, sandbox.__context, { filename: file });
    }
  };

  const context = vm.createContext(sandbox);
  sandbox.__context = context;
  vm.runInContext(fs.readFileSync(path.join(ROOT, "background.js"), "utf8"), context, { filename: "background.js" });

  return { context, sandbox, listeners, state, calls };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let failures = 0;
function check(condition, label, extra) {
  if (condition) {
    console.log("ok   " + label);
  } else {
    failures++;
    console.log("FAIL " + label + (extra !== undefined ? " -> " + JSON.stringify(extra) : ""));
  }
}

async function main() {
  // 1. 扩展更新后重新注入内容脚本
  {
    const env = createEnv({
      tabs: [
        { id: 1, url: "https://example.com/a" },
        { id: 2, url: "chrome://extensions/" },
        { id: 3, url: "file:///tmp/local.pdf" },
        { id: 4, url: "https://example.com/b", discarded: true }
      ]
    });
    await env.listeners.installed[0]({ reason: "update" });
    const injected = env.calls.executeScript.filter((c) => c.files);
    const tabIds = injected.map((c) => c.target.tabId);
    check(tabIds.indexOf(1) >= 0, "更新后向普通网页重新注入", tabIds);
    check(tabIds.indexOf(2) < 0, "不向 chrome:// 页面注入", tabIds);
    check(tabIds.indexOf(4) < 0, "不向已休眠标签页注入", tabIds);
    check(
      injected.every((c) => c.files.join(",") === "shortcut.js,content.js"),
      "注入顺序包含 shortcut.js 与 content.js",
      injected.map((c) => c.files)
    );
    check(env.calls.contextMenusCreated.length === 1, "更新后重建右键菜单", env.calls.contextMenusCreated);
  }

  // 2. 页面已处理快捷键时不重复翻译
  {
    const env = createEnv({ local: { shortcutHandledAt: Date.now() }, selection: "hello" });
    await env.listeners.command[0]("translate-selection", { id: 1, url: "https://example.com/" });
    check(env.calls.fetch.length === 0, "页面已处理快捷键时后台不翻译", env.calls.fetch);
    check(env.calls.executeScript.length === 0, "页面已处理快捷键时后台不读选区", env.calls.executeScript);
  }

  // 3. 页面没有内容脚本时，后台读选区并翻译
  {
    const env = createEnv({ selection: "hello world", tabs: [{ id: 9, url: "https://example.com/" }] });
    await env.listeners.command[0]("translate-selection", { id: 9, url: "https://example.com/" });
    check(env.calls.fetch.length === 1, "后台回退路径发起翻译请求", env.calls.fetch);
    const toast = env.calls.executeScript.find((c) => c.func && String(c.func).indexOf("__enzh_translate_toast__") >= 0);
    check(!!toast, "翻译结果用页内 toast 展示", env.calls.executeScript.map((c) => c.files || "func"));
    check(env.state.session.lastResult && env.state.session.lastResult.ok === true, "记住最近一次结果", env.state.session.lastResult);
  }

  // 4. 没有选区时用剪贴板
  {
    const env = createEnv({ selection: "", clipboard: "copied text", tabs: [{ id: 5, url: "https://example.com/" }] });
    await env.listeners.command[0]("translate-selection", { id: 5, url: "https://example.com/" });
    check(env.calls.fetch.length === 1 && env.calls.fetch[0].indexOf("copied") >= 0, "剪贴板兜底参与翻译", env.calls.fetch);
  }

  // 5. 什么都没有时给中文通知
  {
    const env = createEnv({ selection: "", clipboard: "", tabs: [{ id: 6, url: "https://example.com/" }] });
    await env.listeners.command[0]("translate-selection", { id: 6, url: "https://example.com/" });
    check(env.calls.fetch.length === 0, "无内容不请求翻译", env.calls.fetch);
    check(env.calls.notifications.length === 1, "无内容时给通知", env.calls.notifications);
    const message = env.calls.notifications[0] && env.calls.notifications[0].message;
    check(/右键/.test(message || ""), "通知提示右键菜单路径", message);
  }

  // 6. 翻译失败时降级到 MyMemory，再失败则报错（不崩溃）
  {
    const env = createEnv({ selection: "hello", tabs: [{ id: 7, url: "https://example.com/" }], fetchFails: true });
    let crashed = null;
    try {
      await env.listeners.command[0]("translate-selection", { id: 7, url: "https://example.com/" });
    } catch (e) {
      crashed = e;
    }
    check(crashed === null, "网络失败不抛出", crashed && crashed.message);
    check(env.state.session.lastResult && env.state.session.lastResult.ok === false, "失败结果也会记录", env.state.session.lastResult);
  }

  // 7. 非本扩展命令不处理
  {
    const env = createEnv({ local: { shortcutHandledAt: Date.now() }, tabs: [{ id: 8, url: "https://example.com/" }] });
    await env.listeners.command[0]("something-else", { id: 8, url: "https://example.com/" });
    check(env.calls.fetch.length === 0 && env.calls.executeScript.length === 0, "其它命令忽略", env.calls);
  }

  // 8. TRANSLATE 消息：自动模式尊重 autoTranslate 开关
  {
    const env = createEnv({ local: { shortcutHandledAt: Date.now() } });
    env.state.sync.autoTranslate = false;
    let response = null;
    const handled = env.listeners.message[0](
      { type: "TRANSLATE", text: "hello", automatic: true },
      {},
      (res) => {
        response = res;
      }
    );
    await sleep(30);
    check(handled === true, "异步消息返回 true 保持通道", handled);
    check(response && response.skipped === true, "自动模式关闭时跳过", response);
    check(env.calls.fetch.length === 0, "跳过时不请求翻译", env.calls.fetch);
  }

  // 9. SAVE_SETTINGS 会刷新右键菜单标题
  {
    const env = createEnv({ local: { shortcutHandledAt: Date.now() } });
    let response = null;
    env.listeners.message[0]({ type: "SAVE_SETTINGS", settings: { targetLang: "ja" } }, {}, (res) => {
      response = res;
    });
    await sleep(50);
    check(response && response.targetLang === "ja", "保存设置返回新配置", response);
    const menu = env.calls.contextMenusCreated[env.calls.contextMenusCreated.length - 1];
    check(!!menu && menu.title.indexOf("日语") >= 0, "右键菜单标题跟随目标语言", menu);
  }

  // 10. 关键监听器必须全部注册（防止"右键点了没反应"这类回归）
  {
    const env = createEnv();
    check(env.listeners.installed.length === 1, "注册 runtime.onInstalled", env.listeners.installed.length);
    check(env.listeners.startup.length === 1, "注册 runtime.onStartup", env.listeners.startup.length);
    check(env.listeners.message.length === 1, "注册 runtime.onMessage", env.listeners.message.length);
    check(env.listeners.command.length === 1, "注册 commands.onCommand", env.listeners.command.length);
    check(
      env.listeners.contextMenuClicked.length === 1,
      "注册 contextMenus.onClicked（右键翻译入口）",
      env.listeners.contextMenuClicked.length
    );
  }

  // 11. 右键菜单点击：用 info.selectionText 翻译，并在页内弹出结果
  {
    const env = createEnv({ tabs: [{ id: 21, url: "https://example.com/paper" }] });
    const onClicked = env.listeners.contextMenuClicked[0];
    check(typeof onClicked === "function", "存在右键菜单点击处理函数", typeof onClicked);
    await onClicked(
      { menuItemId: "translate-selection", selectionText: "  hello world  " },
      { id: 21, url: "https://example.com/paper" }
    );
    check(env.calls.fetch.length === 1, "右键菜单点击后发起翻译请求", env.calls.fetch);
    check(
      env.calls.fetch.length === 1 && env.calls.fetch[0].indexOf("hello%20world") >= 0,
      "右键菜单把选中文字传给翻译引擎",
      env.calls.fetch
    );
    const toast = env.calls.executeScript.find(
      (c) => c.func && String(c.func).indexOf("__enzh_translate_toast__") >= 0
    );
    check(!!toast, "右键菜单结果显示在页面内", env.calls.executeScript.map((c) => c.files || "func"));
    check(
      env.state.session.lastResult && env.state.session.lastResult.ok === true,
      "右键菜单结果写入最近一次",
      env.state.session.lastResult
    );
  }

  // 12. 右键菜单：非本菜单项、空选区都不处理
  {
    const env = createEnv({ tabs: [{ id: 22, url: "https://example.com/" }] });
    const onClicked = env.listeners.contextMenuClicked[0];
    await onClicked({ menuItemId: "something-else", selectionText: "hello" }, { id: 22, url: "https://example.com/" });
    await onClicked({ menuItemId: "translate-selection", selectionText: "   " }, { id: 22, url: "https://example.com/" });
    check(env.calls.fetch.length === 0, "其它菜单项/空选区不触发翻译", env.calls.fetch);
  }

  // 13. PDF 等无法注入脚本的页面：退回小窗 + 通知，而不是静默失败
  {
    const env = createEnv({ tabs: [{ id: 23, url: "https://ieeexplore.ieee.org/stamp/stamp.jsp" }], scriptingFails: true });
    await env.listeners.contextMenuClicked[0](
      { menuItemId: "translate-selection", selectionText: "hello" },
      { id: 23, url: "https://ieeexplore.ieee.org/stamp/stamp.jsp" }
    );
    check(env.calls.fetch.length === 1, "注入失败的页面仍完成翻译", env.calls.fetch);
    check(env.calls.notifications.length === 1, "注入失败时给通知", env.calls.notifications);
  }

  // 14. 读设置/存储异常时也要有可见反馈，不能"点了没反应"
  {
    const env = createEnv({ tabs: [{ id: 24, url: "https://example.com/" }], storageFails: true });
    let crashed = null;
    try {
      await env.listeners.contextMenuClicked[0](
        { menuItemId: "translate-selection", selectionText: "hello" },
        { id: 24, url: "https://example.com/" }
      );
    } catch (e) {
      crashed = e;
    }
    check(crashed === null, "右键翻译异常不外抛", crashed && crashed.message);
    check(env.calls.notifications.length === 1, "异常时仍有通知反馈", env.calls.notifications);
  }

  // 15. Google 失败（含超时）时自动切到 MyMemory
  {
    const env = createEnv({ tabs: [{ id: 25, url: "https://example.com/" }], fetchFailCount: 1 });
    await env.listeners.contextMenuClicked[0](
      { menuItemId: "translate-selection", selectionText: "hello" },
      { id: 25, url: "https://example.com/" }
    );
    check(env.calls.fetch.length === 2, "Google 失败后重试 MyMemory", env.calls.fetch);
    check(
      env.state.session.lastResult &&
        env.state.session.lastResult.ok === true &&
        env.state.session.lastResult.engine === "MyMemory",
      "回退引擎可用",
      env.state.session.lastResult
    );
  }

  console.log(failures === 0 ? "\nALL PASS" : "\n" + failures + " FAILED");
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("HARNESS ERROR", e);
  process.exit(2);
});
