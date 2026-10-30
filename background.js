importScripts("languages.js", "translator.js");

const MENU_ID = "translate-selection";
const RESULT_WIDTH = 380;
const RESULT_HEIGHT = 240;

/** 与 content.js 里写的键名保持一致 */
const SHORTCUT_PING_KEY = "shortcutHandledAt";
/** 页面内的快捷键处理过之后，多宽的窗口内认为“这次按键已经处理过” */
const SHORTCUT_DEDUPE_WINDOW = 2500;
/** 等页面里 content script 先响应按键（它写的是 storage.local，落地有几十毫秒延迟） */
const SHORTCUT_DEDUPE_DELAY = 220;

chrome.runtime.onInstalled.addListener(async () => {
  await ensureDefaults();
  await refreshContextMenu();
  // 扩展被安装/更新/重载后，已经打开的页面里跑的还是旧内容脚本：
  // 重新注入一份，旧实例会自行卸载，页面不用刷新也能继续划词。
  await refreshOpenTabs();
});

chrome.runtime.onStartup.addListener(async () => {
  await refreshContextMenu();
  await refreshOpenTabs();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && (changes.sourceLang || changes.targetLang)) {
    refreshContextMenu();
  }
});

async function ensureDefaults() {
  const data = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  if (!data.sourceLang || !data.targetLang) {
    await chrome.storage.sync.set({
      sourceLang: data.sourceLang || DEFAULT_SETTINGS.sourceLang,
      targetLang: data.targetLang || DEFAULT_SETTINGS.targetLang
    });
  }
}

async function refreshContextMenu() {
  const settings = await loadSettings();
  const to = shortLangLabel(settings.targetLang);
  await new Promise((resolve) => {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create(
        {
          id: MENU_ID,
          title: `翻译「%s」→ ${to}`,
          contexts: ["selection"]
        },
        resolve
      );
    });
  });
}

/* --------------------------------------------------------- 内容脚本维护 */

function isInjectableUrl(url) {
  if (!url) return false;
  return !/^(chrome|edge|devtools|chrome-extension|edge-extension|about|view-source|chrome-error|edge-error):/i.test(
    url
  );
}

async function injectCompanionScripts(tabId) {
  try {
    await chrome.scripting.insertCSS({
      target: { tabId, allFrames: true },
      files: ["content.css"]
    });
  } catch (_) {
    try {
      await chrome.scripting.insertCSS({ target: { tabId }, files: ["content.css"] });
    } catch (_) {}
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["shortcut.js", "content.js"]
    });
    return true;
  } catch (_) {}
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["shortcut.js", "content.js"]
    });
    return true;
  } catch (_) {
    return false;
  }
}

async function refreshOpenTabs() {
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({});
  } catch (_) {
    return;
  }
  const targets = (tabs || []).filter(
    (tab) => tab && tab.id != null && !tab.discarded && isInjectableUrl(tab.url)
  );
  // 分小批并发，避免一次性把浏览器压住
  const batchSize = 6;
  for (let i = 0; i < targets.length; i += batchSize) {
    await Promise.all(targets.slice(i, i + batchSize).map((tab) => injectCompanionScripts(tab.id)));
  }
}

/* ---------------------------------------------------------------- 快捷键 */

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pageHandledShortcutRecently() {
  try {
    const data = await chrome.storage.local.get(SHORTCUT_PING_KEY);
    const at = Number(data[SHORTCUT_PING_KEY] || 0);
    return Date.now() - at < SHORTCUT_DEDUPE_WINDOW;
  } catch (_) {
    return false;
  }
}

async function activeTabFromQuery() {
  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tabs && tabs[0]) return tabs[0];
  } catch (_) {}
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return (tabs && tabs[0]) || null;
  } catch (_) {
    return null;
  }
}

async function selectionFromPage(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabId, allFrames: true },
      func: () => {
        const selection = window.getSelection && window.getSelection();
        return selection ? String(selection.toString() || "").trim() : "";
      }
    });
    return (results || []).map((item) => item && item.result).find((text) => text) || "";
  } catch (_) {
    return "";
  }
}

async function clipboardFromPage(tabId) {
  if (!tabId) return "";
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: async () => {
        try {
          return (await navigator.clipboard.readText()) || "";
        } catch (_) {
          return "";
        }
      }
    });
    return (results && results[0] && results[0].result) || "";
  } catch (_) {
    return "";
  }
}

chrome.commands.onCommand.addListener(async (command, commandTab) => {
  if (command !== "translate-selection") return;
  try {
    // 页面内快捷键（content.js）通常已经处理过这次按键，避免重复翻译
    await sleep(SHORTCUT_DEDUPE_DELAY);
    if (await pageHandledShortcutRecently()) return;

    const tab =
      commandTab && commandTab.id != null ? commandTab : await activeTabFromQuery();
    if (!tab || tab.id == null) return;
    if (await pageHandledShortcutRecently()) return;

    let text = await selectionFromPage(tab.id);
    if (!text && isInjectableUrl(tab.url)) {
      text = await clipboardFromPage(tab.id);
    }

    if (!text) {
      await showNotification(
        "Select Translate",
        "没有取到选中的文字：内置 PDF 请「选中 → 右键 → 翻译」，或先复制再用快捷键。"
      );
      return;
    }
    await handleTranslate(text, tab);
  } catch (_) {
    // 快捷键在任何情况下都不应该抛到控制台
  }
});

/* ---------------------------------------------------------------- 消息 */

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || !msg.type) return;

  if (msg.type === "TRANSLATE") {
    (async () => {
      if (msg.automatic) {
        const settings = await loadSettings();
        if (!settings.autoTranslate) {
          sendResponse({ ok: false, skipped: true });
          return;
        }
      }
      const result = await translateWithSettings(msg.text);
      await rememberResult(result);
      sendResponse(result);
    })();
    return true;
  }

  if (msg.type === "GET_SETTINGS") {
    (async () => {
      sendResponse(await loadSettings());
    })();
    return true;
  }

  if (msg.type === "SAVE_SETTINGS") {
    (async () => {
      const next = await saveSettings(msg.settings || {});
      await refreshContextMenu();
      sendResponse(next);
    })();
    return true;
  }
});

/* ---------------------------------------------------------------- 翻译 */

async function translateWithSettings(raw) {
  const settings = await loadSettings();
  return translateText(raw, settings.sourceLang, settings.targetLang);
}

async function handleTranslate(raw, tab) {
  const result = await translateWithSettings(raw);
  await rememberResult(result);
  await presentResult(result, tab);
}

async function rememberResult(result) {
  const payload = { lastResult: { ...result, at: Date.now() } };
  try {
    await chrome.storage.session.set(payload);
  } catch (_) {
    await chrome.storage.local.set(payload);
  }
}

async function presentResult(result, tab) {
  if (result.ok && tab && tab.id != null && isInjectableUrl(tab.url)) {
    try {
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ["content.css"]
      });
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: showToastInPage,
        args: [result]
      });
      return;
    } catch (_) {}
  }

  await openResultPanel(result);
  const title = result.ok
    ? `${result.query} → ${result.translation}`
    : "翻译失败";
  const message = result.ok
    ? `${shortLangLabel(result.sourceLang)} → ${shortLangLabel(result.targetLang)} · ${result.engine}`
    : result.error || "未知错误";
  await showNotification(title, message);
}

function showToastInPage(result) {
  const ID = "__enzh_translate_toast__";
  let el = document.getElementById(ID);
  if (!el) {
    el = document.createElement("div");
    el.id = ID;
    el.className = "enzh-toast";
    document.documentElement.appendChild(el);
  }
  const escapeHtml = (s) =>
    String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  if (!result.ok) {
    el.innerHTML =
      '<div class="enzh-toast-err">' +
      escapeHtml(result.error || "翻译失败") +
      "</div>";
  } else {
    const pair =
      (result.sourceLang || "?") + " → " + (result.targetLang || "?");
    el.innerHTML =
      '<div class="enzh-toast-q">' +
      escapeHtml(result.query) +
      '</div><div class="enzh-toast-a">' +
      escapeHtml(result.translation) +
      '</div><div class="enzh-toast-meta">' +
      escapeHtml((result.engine || "") + " · " + pair) +
      "</div>";
  }
  el.classList.add("enzh-toast-show");
  clearTimeout(el.__hideTimer);
  el.__hideTimer = setTimeout(() => {
    el.classList.remove("enzh-toast-show");
  }, 4500);
}

async function openResultPanel(result) {
  const params = new URLSearchParams();
  if (result.query) params.set("q", result.query);
  if (result.ok) {
    params.set("t", result.translation);
    params.set("e", result.engine || "");
    params.set("sl", result.sourceLang || "");
    params.set("tl", result.targetLang || "");
    if (result.detected) params.set("det", result.detected);
  } else {
    params.set("err", result.error || "翻译失败");
  }
  const url = chrome.runtime.getURL("result.html") + "?" + params.toString();

  try {
    const existing = await chrome.storage.session.get("resultWindowId");
    if (existing.resultWindowId != null) {
      await chrome.windows.update(existing.resultWindowId, { focused: true });
      const tabs = await chrome.tabs.query({ windowId: existing.resultWindowId });
      if (tabs && tabs[0]) {
        await chrome.tabs.update(tabs[0].id, { url });
        return;
      }
    }
  } catch (_) {}

  const win = await chrome.windows.create({
    url,
    type: "popup",
    width: RESULT_WIDTH,
    height: RESULT_HEIGHT,
    focused: true
  });
  try {
    await chrome.storage.session.set({ resultWindowId: win.id });
  } catch (_) {}
}

async function showNotification(title, message) {
  try {
    await chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: String(title).slice(0, 100),
      message: String(message).slice(0, 250),
      priority: 1
    });
  } catch (_) {}
}
