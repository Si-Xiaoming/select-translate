/**
 * popup.js 快捷键录制 UI 验证（打桩 DOM + chrome）。
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const languagesSource = fs.readFileSync(path.join(ROOT, "languages.js"), "utf8");
const shortcutSource = fs.readFileSync(path.join(ROOT, "shortcut.js"), "utf8");
const popupSource = fs.readFileSync(path.join(ROOT, "popup.js"), "utf8");

function makeElement(tag) {
  const classes = new Set();
  const el = {
    tagName: String(tag || "div").toUpperCase(),
    id: "",
    value: "",
    textContent: "",
    innerHTML: "",
    hidden: false,
    children: [],
    handlers: {},
    className: "",
    classList: {
      add(name) {
        classes.add(name);
      },
      remove(name) {
        classes.delete(name);
      },
      toggle(name, force) {
        const next = force === undefined ? !classes.has(name) : !!force;
        if (next) classes.add(name);
        else classes.delete(name);
        return next;
      },
      contains(name) {
        return classes.has(name);
      }
    },
    addEventListener(type, fn) {
      (el.handlers[type] = el.handlers[type] || []).push(fn);
    },
    removeEventListener() {},
    appendChild(child) {
      el.children.push(child);
      return child;
    },
    querySelector(selector) {
      el.__children = el.__children || {};
      if (!el.__children[selector]) el.__children[selector] = makeElement("div");
      return el.__children[selector];
    }
  };
  return el;
}

function createEnv(options) {
  const opts = options || {};
  const ids = {};
  const state = {
    sync: { sourceLang: "auto", targetLang: "zh-CN", autoTranslate: true, shortcut: "Alt+T" },
    session: {},
    local: {},
    messages: [],
    tabCreates: []
  };
  const keydownHandlers = [];

  const document = {
    handlers: {},
    activeElement: null,
    getElementById(id) {
      if (!ids[id]) {
        const el = makeElement(id === "autoTranslate" ? "input" : "div");
        el.id = id;
        ids[id] = el;
      }
      return ids[id];
    },
    createElement(tag) {
      return makeElement(tag);
    },
    addEventListener(type, fn, capture) {
      if (type === "keydown" && capture) keydownHandlers.push(fn);
    },
    removeEventListener() {},
    dispatchKeydown(event) {
      for (const fn of keydownHandlers.slice()) fn(event);
    }
  };

  const chrome = {
    runtime: {
      lastError: undefined,
      sendMessage(message, cb) {
        state.messages.push(message);
        if (typeof cb === "function") cb({ ok: true });
      }
    },
    storage: {
      sync: {
        async get(defaults) {
          const out = Object.assign({}, defaults || {});
          for (const key of Object.keys(state.sync)) out[key] = state.sync[key];
          return out;
        },
        async set(values) {
          Object.assign(state.sync, values);
        }
      },
      local: {
        async get() {
          return Object.assign({}, state.local);
        },
        async set(values) {
          Object.assign(state.local, values);
        }
      },
      session: {
        async get() {
          return Object.assign({}, state.session);
        }
      }
    },
    tabs: {
      create(details, cb) {
        state.tabCreates.push(details.url);
        if (typeof cb === "function") cb();
      }
    }
  };

  const sandbox = {
    document,
    chrome,
    navigator: { userAgent: opts.userAgent || "Mozilla/5.0 Chrome/126.0.0.0" },
    console,
    setTimeout,
    clearTimeout,
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
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(languagesSource, context, { filename: "languages.js" });
  vm.runInContext(shortcutSource, context, { filename: "shortcut.js" });
  vm.runInContext(popupSource, context, { filename: "popup.js" });

  return { context, sandbox, ids, state, document, get: (id) => ids[id] };
}

function keyEvent(props) {
  return Object.assign(
    {
      code: "",
      key: "",
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      metaKey: false,
      repeat: false,
      defaultPrevented: false,
      isComposing: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {}
    },
    props
  );
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

function click(el) {
  for (const fn of el.handlers.click || []) fn({ target: el });
}

async function main() {
  // 1. 默认快捷键展示
  {
    const env = createEnv();
    await sleep(30);
    check(env.get("shortcutText").textContent === "Alt+T", "默认显示 Alt+T", env.get("shortcutText").textContent);
    check(env.get("howtoShortcut").textContent === "Alt+T", "用法区同步显示快捷键", env.get("howtoShortcut").textContent);
    check(env.get("sourceLang").children.length > 1, "语言下拉已填充", env.get("sourceLang").children.length);
  }

  // 2. 录制新的组合键并保存
  {
    const env = createEnv();
    await sleep(30);
    click(env.get("shortcutButton"));
    check(env.get("shortcutText").textContent.indexOf("按下组合键") >= 0, "点击后进入录制状态", env.get("shortcutText").textContent);
    env.document.dispatchKeydown(keyEvent({ code: "KeyQ", key: "q", ctrlKey: true, shiftKey: true }));
    await sleep(40);
    check(env.state.sync.shortcut === "Ctrl+Shift+Q", "新快捷键已写入 sync", env.state.sync.shortcut);
    check(env.get("shortcutText").textContent === "Ctrl+Shift+Q", "界面显示新快捷键", env.get("shortcutText").textContent);
    check(/已保存/.test(env.get("shortcutHint").textContent), "给出保存提示", env.get("shortcutHint").textContent);
    const saved = env.state.messages.find((m) => m.type === "SAVE_SETTINGS");
    check(!!saved && saved.settings.shortcut === "Ctrl+Shift+Q", "通知后台刷新设置", saved);
  }

  // 3. 浏览器占用的组合键被拒绝
  {
    const env = createEnv();
    await sleep(30);
    click(env.get("shortcutButton"));
    env.document.dispatchKeydown(keyEvent({ code: "KeyT", key: "t", ctrlKey: true }));
    await sleep(30);
    check(env.state.sync.shortcut === "Alt+T", "Ctrl+T 被拒绝，设置不变", env.state.sync.shortcut);
    check(/占用/.test(env.get("shortcutHint").textContent), "提示组合键已被占用", env.get("shortcutHint").textContent);
    check(/warn/.test(env.get("shortcutHint").className), "提示使用警告样式", env.get("shortcutHint").className);
  }

  // 4. 没有强修饰键的组合被拒绝
  {
    const env = createEnv();
    await sleep(30);
    click(env.get("shortcutButton"));
    env.document.dispatchKeydown(keyEvent({ code: "KeyQ", key: "q" }));
    await sleep(30);
    check(env.state.sync.shortcut === "Alt+T", "不带 Ctrl/Alt 的组合被拒绝", env.state.sync.shortcut);
    check(/必须包含/.test(env.get("shortcutHint").textContent), "提示需要修饰键", env.get("shortcutHint").textContent);
  }

  // 5. 只按修饰键时给出预览，不算完成录制
  {
    const env = createEnv();
    await sleep(30);
    click(env.get("shortcutButton"));
    env.document.dispatchKeydown(keyEvent({ key: "Alt", altKey: true }));
    await sleep(20);
    check(env.get("shortcutText").textContent.indexOf("Alt") >= 0, "只按修饰键时显示预览", env.get("shortcutText").textContent);
    check(env.state.sync.shortcut === "Alt+T", "只按修饰键不保存", env.state.sync.shortcut);
  }

  // 6. Backspace 清除快捷键
  {
    const env = createEnv();
    await sleep(30);
    click(env.get("shortcutButton"));
    env.document.dispatchKeydown(keyEvent({ code: "Backspace", key: "Backspace" }));
    await sleep(40);
    check(env.state.sync.shortcut === "", "Backspace 清空快捷键", env.state.sync.shortcut);
    check(env.get("shortcutText").textContent === "未设置", "显示未设置", env.get("shortcutText").textContent);
  }

  // 7. Esc 取消录制
  {
    const env = createEnv();
    await sleep(30);
    click(env.get("shortcutButton"));
    env.document.dispatchKeydown(keyEvent({ code: "Escape", key: "Escape" }));
    await sleep(30);
    check(env.state.sync.shortcut === "Alt+T", "Esc 取消不改设置", env.state.sync.shortcut);
    check(env.get("shortcutText").textContent === "Alt+T", "Esc 后恢复显示", env.get("shortcutText").textContent);
  }

  // 8. 恢复默认
  {
    const env = createEnv();
    env.state.sync.shortcut = "Ctrl+Shift+Q";
    await sleep(30);
    // 重新载入以读取到 Ctrl+Shift+Q
    const env2 = createEnv();
    env2.state.sync.shortcut = "Ctrl+Shift+Q";
    click(env2.get("shortcutReset"));
    await sleep(40);
    check(env2.state.sync.shortcut === "Alt+T", "恢复默认写回 Alt+T", env2.state.sync.shortcut);
  }

  // 9. 打开浏览器快捷键设置
  {
    const env = createEnv({ userAgent: "Mozilla/5.0 Edg/126.0.0.0" });
    await sleep(30);
    click(env.get("openShortcuts"));
    check(
      env.state.tabCreates.length === 1 && env.state.tabCreates[0] === "edge://extensions/shortcuts",
      "Edge 下打开 edge://extensions/shortcuts",
      env.state.tabCreates
    );
  }

  // 10. 录制状态下不会误触发其它快捷键逻辑
  {
    const env = createEnv();
    await sleep(30);
    click(env.get("shortcutButton"));
    const event = keyEvent({ code: "KeyQ", key: "q", altKey: true });
    env.document.dispatchKeydown(event);
    await sleep(40);
    check(event.defaultPrevented === true, "录制时拦截按键默认行为");
    check(env.state.sync.shortcut === "Alt+Q", "Alt+Q 正常保存", env.state.sync.shortcut);
  }

  console.log(failures === 0 ? "\nALL PASS" : "\n" + failures + " FAILED");
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("HARNESS ERROR", e);
  process.exit(2);
});
