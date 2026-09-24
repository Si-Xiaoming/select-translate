importScripts("languages.js", "translator.js");

const MENU_ID = "translate-selection";
const RESULT_WIDTH = 380;
const RESULT_HEIGHT = 240;

chrome.runtime.onInstalled.addListener(async () => {
  await ensureDefaults();
  await refreshContextMenu();
});

chrome.runtime.onStartup.addListener(async () => {
  await refreshContextMenu();
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

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !info.selectionText) return;
  await handleTranslate(info.selectionText, tab);
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "translate-selection") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id == null) return;

  let text = "";
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: () => {
        const s = window.getSelection && window.getSelection();
        return s ? String(s.toString() || "").trim() : "";
      }
    });
    text = (results || []).map((r) => r && r.result).find((t) => t) || "";
  } catch (_) {}

  if (!text && isInjectableUrl(tab.url)) {
    try {
      const clipResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: async () => {
          try {
            return (await navigator.clipboard.readText()) || "";
          } catch {
            return "";
          }
        }
      });
      text = (clipResults && clipResults[0] && clipResults[0].result) || "";
    } catch (_) {}
  }

  if (!text) {
    await showNotification(
      "Select Translate",
      "PDF: select → right-click → Translate; or copy then Alt+T"
    );
    return;
  }
  await handleTranslate(text, tab);
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || !msg.type) return;

  if (msg.type === "TRANSLATE") {
    (async () => {
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
    : "Translation failed";
  const message = result.ok
    ? `${shortLangLabel(result.sourceLang)} → ${shortLangLabel(result.targetLang)} · ${result.engine}`
    : result.error || "Unknown error";
  await showNotification(title, message);
}

function isInjectableUrl(url) {
  if (!url) return false;
  return !/^(chrome|edge|devtools|chrome-extension|edge-extension|about|view-source|chrome-error):/i.test(
    url
  );
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
