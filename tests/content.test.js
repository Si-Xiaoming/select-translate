/**
 * 用轻量 DOM / chrome 打桩来验证 content.js 的行为（沙箱里跑不起真实浏览器）。
 * 覆盖：自动划词、快捷键、快捷键配置变更、剪贴板兜底、上下文失效、重复注入卸载。
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const shortcutSource = fs.readFileSync(path.join(ROOT, "shortcut.js"), "utf8");
const contentSource = fs.readFileSync(path.join(ROOT, "content.js"), "utf8");

function makeElement(tag) {
  const el = {
    tagName: String(tag || "div").toUpperCase(),
    id: "",
    className: "",
    style: {},
    children: [],
    handlers: {},
    innerHTML: "",
    parentNode: null,
    textContent: "",
    classList: {
      add() {},
      remove() {},
      toggle() {},
      contains() {
        return false;
      }
    },
    addEventListener(type, fn) {
      (el.handlers[type] = el.handlers[type] || []).push(fn);
    },
    removeEventListener(type, fn) {
      const list = el.handlers[type] || [];
      const index = list.indexOf(fn);
      if (index >= 0) list.splice(index, 1);
    },
    appendChild(child) {
      child.parentNode = { removeChild: () => {} };
      el.children.push(child);
      return child;
    },
    querySelector(selector) {
      if (selector === ".enzh-bubble-btn" && el.innerHTML.indexOf("enzh-bubble-btn") >= 0) {
        if (!el.__btn) el.__btn = makeElement("button");
        return el.__btn;
      }
      return null;
    },
    getBoundingClientRect() {
      return { width: 220, height: 72, left: 0, top: 0, right: 220, bottom: 72 };
    },
    contains(node) {
      return node === el;
    }
  };
  return el;
}

function createEnv(options) {
  const opts = options || {};
  const docHandlers = { capture: {}, bubble: {} };
  const elements = new Map();
  const docElement = makeElement("html");
  const state = {
    storageSync: Object.assign(
      { sourceLang: "auto", targetLang: "zh-CN", autoTranslate: true, shortcut: "Alt+T" },
      opts.settings || {}
    ),
    storageLocal: {},
    storageChangedListeners: [],
    messages: [],
    runtimeId: opts.dead ? undefined : "test-extension-id",
    lastError: null,
    clipboard: opts.clipboard || "",
    selection: opts.selection || "",
    sendMessageImpl: null,
    translateResponse: opts.translateResponse || {
      ok: true,
      query: "hello",
      translation: "你好",
      engine: "Google",
      sourceLang: "en",
      targetLang: "zh-CN"
    }
  };

  const document = {
    activeElement: makeElement("body"),
    documentElement: docElement,
    addEventListener(type, fn, capture) {
      const bucket = capture ? docHandlers.capture : docHandlers.bubble;
      (bucket[type] = bucket[type] || []).push(fn);
    },
    removeEventListener(type, fn, capture) {
      const bucket = capture ? docHandlers.capture : docHandlers.bubble;
      const list = bucket[type] || [];
      const index = list.indexOf(fn);
      if (index >= 0) list.splice(index, 1);
    },
    getElementById(id) {
      return elements.get(id) || null;
    },
    createElement(tag) {
      const el = makeElement(tag);
      el.ownerLayer = true;
      return el;
    },
    dispatch(type, event) {
      const seq = (docHandlers.capture[type] || []).concat(docHandlers.bubble[type] || []);
      for (const fn of seq.slice()) {
        fn(event);
      }
    },
    listenerCount(type) {
      return (docHandlers.capture[type] || []).length + (docHandlers.bubble[type] || []).length;
    }
  };

  // documentElement.appendChild 需要把气泡登记到 elements 里，模拟 getElementById 找得到
  docElement.appendChild = (child) => {
    child.parentNode = { removeChild: (node) => elements.delete(node.id) };
    if (child.id) elements.set(child.id, child);
    docElement.children.push(child);
    return child;
  };
  docElement.removeChild = (child) => {
    if (child && child.id) elements.delete(child.id);
  };

  const storage = {
    sync: {
      async get(defaults) {
        const out = Object.assign({}, defaults || {});
        for (const key of Object.keys(state.storageSync)) out[key] = state.storageSync[key];
        return out;
      },
      async set(values) {
        Object.assign(state.storageSync, values);
      }
    },
    local: {
      async get(key) {
        if (typeof key === "string") return { [key]: state.storageLocal[key] };
        return Object.assign({}, state.storageLocal);
      },
      async set(values) {
        Object.assign(state.storageLocal, values);
      }
    },
    onChanged: {
      addListener(fn) {
        state.storageChangedListeners.push(fn);
      },
      removeListener(fn) {
        const index = state.storageChangedListeners.indexOf(fn);
        if (index >= 0) state.storageChangedListeners.splice(index, 1);
      }
    }
  };

  const chrome = {
    runtime: {
      get id() {
        return state.runtimeId;
      },
      get lastError() {
        return state.lastError;
      },
      sendMessage(message, callback) {
        if (state.dead) throw new Error("Extension context invalidated.");
        state.messages.push(message);
        const response = state.sendMessageImpl
          ? state.sendMessageImpl(message)
          : state.translateResponse;
        setTimeout(() => {
          if (typeof callback === "function") callback(response);
        }, 0);
      }
    },
    storage
  };

  const selectionStub = {
    isCollapsed: !state.selection,
    toString() {
      return state.selection;
    },
    getRangeAt() {
      return {
        getBoundingClientRect() {
          return { width: 120, height: 18, left: 100, top: 200, right: 220, bottom: 218 };
        }
      };
    }
  };

  const window = {
    innerWidth: 1280,
    innerHeight: 900,
    getSelection() {
      return selectionStub;
    }
  };

  const sandbox = {
    window,
    document,
    chrome,
    navigator: {
      clipboard: {
        async readText() {
          return state.clipboard;
        }
      }
    },
    setTimeout: (fn, ms) => {
      const timer = setTimeout(fn, ms);
      if (timer.unref) timer.unref();
      return timer;
    },
    clearTimeout,
    console,
    Promise,
    Date,
    Math,
    JSON,
    String,
    Number,
    Object,
    Array,
    RegExp,
    Error
  };
  window.window = window;
  sandbox.self = window;
  window.document = document;
  window.navigator = sandbox.navigator;
  window.setTimeout = sandbox.setTimeout;
  window.clearTimeout = sandbox.clearTimeout;
  window.chrome = chrome;

  const context = vm.createContext(sandbox);
  vm.runInContext(shortcutSource, context, { filename: "shortcut.js" });

  return { context, sandbox, window, document, state, elements };
}

function injectContent(env) {
  vm.runInContext(contentSource, env.context, { filename: "content.js" });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function mouseEvent(props) {
  return Object.assign({ button: 0, clientX: 300, clientY: 320, target: makeElement("p") }, props);
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
  // 1. 自动划词：选中文字后 mouseup 触发翻译，气泡显示译文
  {
    const env = createEnv({ selection: "  Hello   world. " });
    injectContent(env);
    await sleep(20);
    env.document.dispatch("mouseup", mouseEvent({}));
    await sleep(60);
    const sent = env.state.messages;
    check(sent.length === 1 && sent[0].type === "TRANSLATE", "mouseup 发送 TRANSLATE", sent);
    check(sent[0] && sent[0].text === "Hello world.", "选中文字已清理空白", sent[0]);
    check(sent[0] && sent[0].automatic === true, "自动划词标记 automatic", sent[0]);
    const bubble = env.elements.get("__enzh_bubble__");
    check(!!bubble && bubble.innerHTML.indexOf("你好") >= 0, "气泡显示译文", bubble && bubble.innerHTML);
  }

  // 2. 快捷键：Alt+T 命中，写去重时间戳，且请求不是自动模式
  {
    const env = createEnv({ selection: "Hello world" });
    injectContent(env);
    await sleep(20);
    const event = keyEvent({ code: "KeyT", key: "t", altKey: true });
    env.document.dispatch("keydown", event);
    await sleep(60);
    check(event.defaultPrevented === true, "快捷键 preventDefault");
    check(env.state.messages.length === 1, "快捷键发送一次翻译", env.state.messages);
    check(env.state.messages[0] && env.state.messages[0].automatic === false, "快捷键不算自动模式", env.state.messages[0]);
    check(typeof env.state.storageLocal.shortcutHandledAt === "number", "写入 shortcutHandledAt 供后台去重", env.state.storageLocal);
    const bubble = env.elements.get("__enzh_bubble__");
    check(!!bubble && bubble.innerHTML.indexOf("你好") >= 0, "快捷键气泡显示译文", bubble && bubble.innerHTML);
  }

  // 3. 快捷键：没有选区时用剪贴板
  {
    const env = createEnv({ selection: "", clipboard: "clipboard text" });
    injectContent(env);
    await sleep(20);
    env.document.dispatch("keydown", keyEvent({ code: "KeyT", key: "t", altKey: true }));
    await sleep(60);
    const sent = env.state.messages;
    check(sent.length === 1 && sent[0].text === "clipboard text", "快捷键剪贴板兜底", sent);
  }

  // 4. 没有选区且剪贴板为空时给出提示，不请求网络
  {
    const env = createEnv({ selection: "", clipboard: "" });
    injectContent(env);
    await sleep(20);
    env.document.dispatch("keydown", keyEvent({ code: "KeyT", key: "t", altKey: true }));
    await sleep(60);
    const bubble = env.elements.get("__enzh_bubble__");
    check(env.state.messages.length === 0, "无内容时不发请求", env.state.messages);
    check(!!bubble && bubble.innerHTML.indexOf("先选中文字") >= 0, "无内容时给出提示", bubble && bubble.innerHTML);
  }

  // 5. 快捷键冲突：只按 Alt+Shift+Q 不会触发 Alt+T
  {
    const env = createEnv({ selection: "Hello" });
    injectContent(env);
    await sleep(20);
    env.document.dispatch("keydown", keyEvent({ code: "KeyQ", key: "q", altKey: true, shiftKey: true }));
    await sleep(40);
    check(env.state.messages.length === 0, "不匹配的组合键不触发", env.state.messages);
  }

  // 6. 上下文失效：不抛英文报错，只提示一次并可刷新
  {
    const env = createEnv({ selection: "Hello", dead: true, settings: { autoTranslate: true } });
    injectContent(env);
    await sleep(20);
    let crashed = null;
    try {
      env.document.dispatch("mouseup", mouseEvent({}));
      await sleep(80);
      env.document.dispatch("mouseup", mouseEvent({}));
      await sleep(40);
    } catch (e) {
      crashed = e;
    }
    check(crashed === null, "上下文失效不抛异常", crashed && crashed.message);
    const bubble = env.elements.get("__enzh_bubble__");
    check(
      !!bubble && bubble.innerHTML.indexOf("扩展已更新") >= 0 && bubble.innerHTML.indexOf("Extension context invalidated") < 0,
      "失效时只给中文提示",
      bubble && bubble.innerHTML
    );
    check(!!bubble && bubble.innerHTML.indexOf("刷新页面") >= 0, "失效提示带刷新按钮", bubble && bubble.innerHTML);
  }

  // 7. 重复注入（扩展更新后重新注入）：旧实例卸载，只翻译一次
  {
    const env = createEnv({ selection: "Hello world" });
    injectContent(env);
    await sleep(20);
    injectContent(env);
    await sleep(20);
    check(env.document.listenerCount("mouseup") === 1, "重复注入后只剩一个 mouseup 监听", env.document.listenerCount("mouseup"));
    env.document.dispatch("keydown", keyEvent({ code: "KeyT", key: "t", altKey: true }));
    await sleep(60);
    check(env.state.messages.length === 1, "重复注入后按一次快捷键只翻译一次", env.state.messages);
    env.document.dispatch("mouseup", mouseEvent({}));
    await sleep(60);
    check(env.state.messages.length === 2, "重复注入后 mouseup 只翻译一次", env.state.messages);
  }

  // 8. 设置变更：改快捷键后立即生效
  {
    const env = createEnv({ selection: "Hello world" });
    injectContent(env);
    await sleep(20);
    env.state.storageSync.shortcut = "Ctrl+Shift+Q";
    for (const fn of env.state.storageChangedListeners.slice()) {
      fn({ shortcut: { newValue: "Ctrl+Shift+Q" } }, "sync");
    }
    env.document.dispatch("keydown", keyEvent({ code: "KeyT", key: "t", altKey: true }));
    await sleep(40);
    check(env.state.messages.length === 0, "旧快捷键不再触发", env.state.messages);
    env.document.dispatch("keydown", keyEvent({ code: "KeyQ", key: "q", ctrlKey: true, shiftKey: true }));
    await sleep(60);
    check(env.state.messages.length === 1, "新快捷键生效", env.state.messages);
  }

  // 9. 关闭自动划词后 mouseup 不发请求，快捷键仍然可用
  {
    const env = createEnv({ selection: "Hello world", settings: { autoTranslate: false } });
    injectContent(env);
    await sleep(20);
    env.document.dispatch("mouseup", mouseEvent({}));
    await sleep(80);
    check(env.state.messages.length === 0, "自动划词关闭后 mouseup 不翻译", env.state.messages);
    env.document.dispatch("keydown", keyEvent({ code: "KeyT", key: "t", altKey: true }));
    await sleep(60);
    check(env.state.messages.length === 1, "自动划词关闭后快捷键仍可用", env.state.messages);
  }

  // 10. 后台 lastError 也可以是上下文失效
  {
    const env = createEnv({ selection: "Hello" });
    injectContent(env);
    await sleep(20);
    env.state.sendMessageImpl = () => {
      env.state.lastError = { message: "Extension context invalidated." };
      return undefined;
    };
    env.document.dispatch("keydown", keyEvent({ code: "KeyT", key: "t", altKey: true }));
    await sleep(80);
    const bubble = env.elements.get("__enzh_bubble__");
    check(!!bubble && bubble.innerHTML.indexOf("扩展已更新") >= 0, "lastError 上下文失效同样友好提示", bubble && bubble.innerHTML);
  }

  // 11. 输入框内自动划词不打扰
  {
    const env = createEnv({ selection: "Hello world" });
    injectContent(env);
    await sleep(20);
    const input = makeElement("input");
    env.document.dispatch("mouseup", mouseEvent({ target: input }));
    await sleep(80);
    check(env.state.messages.length === 0, "输入框内 mouseup 不自动翻译", env.state.messages);
  }

  // 12. 气泡内点击不触发翻译
  {
    const env = createEnv({ selection: "Hello world" });
    injectContent(env);
    await sleep(20);
    env.document.dispatch("mouseup", mouseEvent({}));
    await sleep(60);
    const bubble = env.elements.get("__enzh_bubble__");
    env.document.dispatch("mouseup", mouseEvent({ target: bubble }));
    await sleep(60);
    check(env.state.messages.length === 1, "点击气泡不重复翻译", env.state.messages);
  }

  console.log(failures === 0 ? "\nALL PASS" : "\n" + failures + " FAILED");
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("HARNESS ERROR", e);
  process.exit(2);
});
