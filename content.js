/**
 * 划词翻译内容脚本。
 *
 * 关键点：
 * 1. 单实例：扩展更新/重载后 background.js 会重新注入本脚本，旧实例必须
 *    自行卸载监听器，否则旧上下文里的 chrome.* 会抛
 *    "Extension context invalidated"。
 * 2. 快捷键：页面内自行监听组合键（可在弹窗里改），不依赖
 *    edge://extensions/shortcuts 是否可编辑；按下的同时给后台写一个时间戳，
 *    供 background 的浏览器级快捷键去重，避免翻译两次。
 * 3. 设置：直接读 chrome.storage.sync，不再绕一次 GET_SETTINGS。
 */
(() => {
  const INSTANCE_KEY = "__selectTranslateInstance";
  const BUBBLE_ID = "__enzh_bubble__";
  const MAX_CHARS = 80;
  const PING_KEY = "shortcutHandledAt";
  const DEFAULT_SETTINGS = {
    sourceLang: "auto",
    targetLang: "zh-CN",
    autoTranslate: true,
    shortcut: "Alt+T"
  };
  const Sc = window.SelectTranslateShortcut || null;

  // 卸载上一个实例（同一页面上可能已经存在扩展更新前注入的旧脚本）。
  const previous = window[INSTANCE_KEY];
  if (previous && typeof previous.destroy === "function") {
    try {
      previous.destroy();
    } catch (_) {}
  }

  let alive = true;
  let stale = false;
  let staleShown = false;
  let hideTimer = null;
  let lastQuery = "";
  let lastAt = 0;
  let lastMouse = { x: 0, y: 0 };
  let settings = Object.assign({}, DEFAULT_SETTINGS);
  const teardownFns = [];

  function on(target, type, handler, options) {
    if (!target || typeof target.addEventListener !== "function") return;
    target.addEventListener(type, handler, options);
    teardownFns.push(() => {
      try {
        target.removeEventListener(type, handler, options);
      } catch (_) {}
    });
  }

  function destroy() {
    alive = false;
    while (teardownFns.length) {
      try {
        teardownFns.pop()();
      } catch (_) {}
    }
    clearTimeout(hideTimer);
    if (window[INSTANCE_KEY] === instance) {
      try {
        delete window[INSTANCE_KEY];
      } catch (_) {
        window[INSTANCE_KEY] = undefined;
      }
    }
    const el = document.getElementById(BUBBLE_ID);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  const instance = { destroy: destroy };
  window[INSTANCE_KEY] = instance;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function contextAlive() {
    try {
      return !!(typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id);
    } catch (_) {
      return false;
    }
  }

  function isContextError(message) {
    return /extension context invalidated|context invalidated|extension has been updated|message port closed/i.test(
      String(message || "")
    );
  }

  function isNoReceiverError(message) {
    return /could not establish connection|receiving end does not exist/i.test(String(message || ""));
  }

  /* ---------------------------------------------------------------- 设置 */

  async function loadSettings() {
    if (!contextAlive()) return;
    try {
      const data = await chrome.storage.sync.get(DEFAULT_SETTINGS);
      applySettings(data);
    } catch (_) {}
  }

  function applySettings(data) {
    if (!data) return;
    settings.sourceLang = data.sourceLang || DEFAULT_SETTINGS.sourceLang;
    settings.targetLang = data.targetLang || DEFAULT_SETTINGS.targetLang;
    settings.autoTranslate = data.autoTranslate !== false;
    const raw = data.shortcut != null ? data.shortcut : DEFAULT_SETTINGS.shortcut;
    settings.shortcut = Sc ? Sc.normalize(raw) || "" : String(raw || "");
  }

  const settingsReady = loadSettings();

  function onStorageChanged(changes, area) {
    if (area !== "sync" || !changes) return;
    if (changes.sourceLang) {
      settings.sourceLang = changes.sourceLang.newValue || DEFAULT_SETTINGS.sourceLang;
    }
    if (changes.targetLang) {
      settings.targetLang = changes.targetLang.newValue || DEFAULT_SETTINGS.targetLang;
    }
    if (changes.autoTranslate) {
      settings.autoTranslate = changes.autoTranslate.newValue !== false;
      if (!settings.autoTranslate) hideBubble();
    }
    if (changes.shortcut) {
      const raw = changes.shortcut.newValue;
      settings.shortcut = Sc ? Sc.normalize(raw) || "" : String(raw || "");
    }
  }

  try {
    chrome.storage.onChanged.addListener(onStorageChanged);
    teardownFns.push(() => {
      try {
        chrome.storage.onChanged.removeListener(onStorageChanged);
      } catch (_) {}
    });
  } catch (_) {}

  /* ------------------------------------------------------------ 选区读取 */

  function cleanText(raw) {
    return String(raw || "")
      .replace(/\u00ad/g, "")
      .replace(/(\w)-\s+(\w)/g, "$1$2")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isEditableTarget(el) {
    if (!el) return false;
    const tag = String(el.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    if (el.isContentEditable) return true;
    return false;
  }

  /** 输入框内的选区（window.getSelection 读不到 input/textarea 的选中文字） */
  function editableSelection() {
    const el = document.activeElement;
    if (!el) return "";
    const tag = String(el.tagName || "").toLowerCase();
    if (tag !== "input" && tag !== "textarea") return "";
    try {
      const start = el.selectionStart;
      const end = el.selectionEnd;
      if (start == null || end == null || start === end) return "";
      return cleanText(el.value.slice(start, end));
    } catch (_) {
      return "";
    }
  }

  function activeElementRect() {
    const el = document.activeElement;
    if (!el || typeof el.getBoundingClientRect !== "function") return null;
    try {
      return el.getBoundingClientRect();
    } catch (_) {
      return null;
    }
  }

  /** @returns {{ text: string, rect: DOMRect|null }} */
  function selectionInfo() {
    const sel = window.getSelection && window.getSelection();
    if (sel && !sel.isCollapsed) {
      const text = cleanText(sel.toString());
      if (text) {
        let rect = null;
        try {
          rect = sel.getRangeAt(0).getBoundingClientRect();
        } catch (_) {}
        return { text: text, rect: rect };
      }
    }
    const editText = editableSelection();
    if (editText) return { text: editText, rect: activeElementRect() };
    return { text: "", rect: null };
  }

  /** 只要选中了字母/数字才值得翻译 */
  function looksTranslatable(text) {
    return /[\p{L}\p{N}]/u.test(String(text || ""));
  }

  /** 自动划词时的软过滤：没锁语言、纯符号等噪音不弹窗 */
  function shouldSkipAuto(text) {
    if (!text) return true;
    if (!looksTranslatable(text)) return true;
    if (settings.sourceLang === "en" && !/[A-Za-z]/.test(text)) return true;
    return false;
  }

  function mouseAnchor() {
    if (lastMouse.x || lastMouse.y) return { x: lastMouse.x, y: lastMouse.y };
    // 纯键盘操作时没有鼠标坐标，用一个比较居中的位置
    return {
      x: Math.max(24, window.innerWidth / 2 - 140),
      y: Math.max(80, window.innerHeight / 3)
    };
  }

  function anchorFrom(info) {
    const rect = info && info.rect;
    if (rect && (rect.width || rect.height)) {
      return { x: rect.right || rect.left, y: rect.bottom || rect.top };
    }
    return mouseAnchor();
  }

  /* -------------------------------------------------------------- 气泡 UI */

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function ensureBubble() {
    let el = document.getElementById(BUBBLE_ID);
    if (el) return el;
    el = document.createElement("div");
    el.id = BUBBLE_ID;
    el.className = "enzh-bubble";
    el.style.display = "none";
    el.addEventListener("mousedown", (e) => e.stopPropagation());
    el.addEventListener("mouseup", (e) => e.stopPropagation());
    document.documentElement.appendChild(el);
    return el;
  }

  function placeBubble(el, x, y) {
    const pad = 12;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    el.style.display = "block";
    el.style.left = "0px";
    el.style.top = "0px";
    const rect = el.getBoundingClientRect();
    let left = x + 8;
    let top = y + 12;
    if (left + rect.width + pad > vw) left = Math.max(pad, vw - rect.width - pad);
    if (top + rect.height + pad > vh) top = Math.max(pad, y - rect.height - 12);
    el.style.left = left + "px";
    el.style.top = top + "px";
  }

  function showLoading(x, y, query) {
    const el = ensureBubble();
    el.innerHTML =
      '<div class="enzh-bubble-q">' +
      escapeHtml(query) +
      '</div><div class="enzh-bubble-loading">翻译中…</div>';
    placeBubble(el, x, y);
    clearTimeout(hideTimer);
  }

  function showResult(x, y, result) {
    const el = ensureBubble();
    if (!result || !result.ok) {
      el.innerHTML =
        '<div class="enzh-bubble-err">' +
        escapeHtml((result && result.error) || "翻译失败") +
        "</div>";
    } else {
      const pair =
        (result.sourceLang || "?") + " → " + (result.targetLang || "?");
      el.innerHTML =
        '<div class="enzh-bubble-q">' +
        escapeHtml(result.query) +
        '</div><div class="enzh-bubble-a">' +
        escapeHtml(result.translation) +
        '</div><div class="enzh-bubble-meta">' +
        escapeHtml((result.engine || "") + " · " + pair) +
        " · Esc</div>";
    }
    placeBubble(el, x, y);
    scheduleHide(el, 5000);
  }

  /** 轻提示（没有选区、快捷键已改等）：不请求网络 */
  function showHint(message) {
    const el = ensureBubble();
    el.innerHTML = '<div class="enzh-bubble-hint">' + escapeHtml(message) + "</div>";
    const anchor = mouseAnchor();
    placeBubble(el, anchor.x, anchor.y);
    scheduleHide(el, 3200);
  }

  function scheduleHide(el, ms) {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      el.style.display = "none";
    }, ms);
  }

  function hideBubble() {
    const el = document.getElementById(BUBBLE_ID);
    if (el) el.style.display = "none";
    clearTimeout(hideTimer);
  }

  /**
   * 扩展上下文失效（例如扩展刚被更新/重载）。
   * 只提示一次，并且给个刷新按钮，不再抛英文报错。
   */
  function markStale() {
    stale = true;
    if (staleShown) return;
    staleShown = true;
    const el = ensureBubble();
    el.innerHTML =
      '<div class="enzh-bubble-err">扩展已更新，当前页面需要刷新一次。</div>' +
      '<div class="enzh-bubble-meta">刷新后划词和快捷键即可恢复，无需重新安装。</div>' +
      '<button class="enzh-bubble-btn" type="button">刷新页面</button>';
    const anchor = mouseAnchor();
    placeBubble(el, anchor.x, anchor.y);
    clearTimeout(hideTimer);
    const btn = el.querySelector(".enzh-bubble-btn");
    if (btn) {
      btn.addEventListener("click", () => {
        try {
          location.reload();
        } catch (_) {}
      });
    }
  }

  /* ------------------------------------------------------------ 后台通信 */

  function sendTranslate(text, automatic) {
    return new Promise((resolve) => {
      if (!contextAlive()) {
        resolve({ ok: false, contextLost: true });
        return;
      }
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve({ ok: false, error: "翻译超时，请重试。" });
        }
      }, 15000);
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      try {
        chrome.runtime.sendMessage(
          { type: "TRANSLATE", text: text, automatic: !!automatic },
          (res) => {
            const err = chrome.runtime.lastError;
            if (err) {
              finish({ ok: false, error: err.message || "扩展无响应" });
              return;
            }
            finish(res || { ok: false, error: "扩展无响应" });
          }
        );
      } catch (e) {
        finish({ ok: false, error: (e && e.message) || "扩展无响应" });
      }
    });
  }

  async function requestTranslate(text, automatic) {
    let res = await sendTranslate(text, automatic);
    if (res && res.contextLost) {
      markStale();
      return res;
    }
    const firstError = (res && res.error) || "";
    if (isContextError(firstError)) {
      markStale();
      return { ok: false, contextLost: true };
    }
    // MV3 后台偶尔还在唤醒中，稍等重试一次
    if (isNoReceiverError(firstError)) {
      await sleep(320);
      if (!contextAlive()) {
        markStale();
        return { ok: false, contextLost: true };
      }
      res = await sendTranslate(text, automatic);
      const secondError = (res && res.error) || "";
      if (isContextError(secondError)) {
        markStale();
        return { ok: false, contextLost: true };
      }
    }
    return res;
  }

  async function readClipboard() {
    if (!contextAlive()) return "";
    try {
      if (navigator.clipboard && typeof navigator.clipboard.readText === "function") {
        return cleanText(await navigator.clipboard.readText());
      }
    } catch (_) {}
    return "";
  }

  /* ------------------------------------------------------------ 翻译入口 */

  async function runTranslate(raw, pos, options) {
    const explicit = !!(options && options.explicit);
    const text = cleanText(raw);
    if (!text) {
      if (explicit) showHint("先选中文字（或先复制文字）再按快捷键");
      return;
    }
    if (!looksTranslatable(text)) {
      if (explicit) showHint("选中的内容没有可翻译的文字");
      return;
    }
    if (text.length > MAX_CHARS) {
      if (explicit) showHint("选中的文字超过 " + MAX_CHARS + " 个字符");
      return;
    }
    if (!explicit && shouldSkipAuto(text)) return;

    if (stale) return;
    showLoading(pos.x, pos.y, text);
    const result = await requestTranslate(text, !explicit);
    if (stale || !result) return;
    if (result.skipped) {
      hideBubble();
      return;
    }
    showResult(pos.x, pos.y, result);
  }

  /* -------------------------------------------------------------- 快捷键 */

  function isShortcutEvent(e) {
    if (!alive || stale) return false;
    if (e.defaultPrevented || e.isComposing) return false;
    if (!Sc || !settings.shortcut) return false;
    return Sc.matches(e, settings.shortcut);
  }

  async function translateFromShortcut() {
    await settingsReady;
    if (!alive || stale) return;
    const info = selectionInfo();
    const pos = anchorFrom(info);
    if (info.text) {
      await runTranslate(info.text, pos, { explicit: true });
      return;
    }
    const clip = await readClipboard();
    if (clip) {
      await runTranslate(clip, pos, { explicit: true });
      return;
    }
    showHint("先选中文字（或先复制文字）再按快捷键");
  }

  function onKeyDown(e) {
    if (!isShortcutEvent(e)) return;
    e.preventDefault();
    e.stopPropagation();
    // 标记“这次按键由页面处理”，让后台的浏览器级快捷键不必再翻译一遍
    try {
      chrome.storage.local.set({ [PING_KEY]: Date.now() });
    } catch (_) {}
    translateFromShortcut();
  }

  /* ------------------------------------------------------------ 划词翻译 */

  async function autoTranslateAt(x, y) {
    await settingsReady;
    if (!alive || stale || !settings.autoTranslate) return;
    await sleep(10);
    if (!alive || stale || !settings.autoTranslate) return;

    const info = selectionInfo();
    const text = info.text;
    if (!text) {
      hideBubble();
      return;
    }
    if (text.length > MAX_CHARS) return;
    if (shouldSkipAuto(text)) return;

    const now = Date.now();
    if (text === lastQuery && now - lastAt < 400) return;
    lastQuery = text;
    lastAt = now;

    await runTranslate(text, { x: x, y: y }, { explicit: false });
  }

  function onMouseUp(e) {
    if (!alive || stale) return;
    if (e.button !== 0) return;
    lastMouse = { x: e.clientX, y: e.clientY };
    if (isEditableTarget(e.target)) return;
    const bubble = document.getElementById(BUBBLE_ID);
    if (bubble && e.target && typeof bubble.contains === "function" && bubble.contains(e.target)) {
      return;
    }
    autoTranslateAt(e.clientX, e.clientY);
  }

  function onMouseDown(e) {
    lastMouse = { x: e.clientX, y: e.clientY };
  }

  function onEscape(e) {
    if (e.key === "Escape") hideBubble();
  }

  on(document, "mousedown", onMouseDown, true);
  on(document, "mouseup", onMouseUp, true);
  on(document, "keydown", onKeyDown, true);
  on(document, "keydown", onEscape, true);
})();
