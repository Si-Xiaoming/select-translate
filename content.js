(() => {
  const TOAST_ID = "__enzh_bubble__";
  const MAX_CHARS = 80;
  let hideTimer = null;
  let lastQuery = "";
  let lastAt = 0;
  let sourceLang = "auto";

  function isEditableTarget(el) {
    if (!el) return false;
    const tag = (el.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    if (el.isContentEditable) return true;
    return false;
  }

  function getSelectedText() {
    const sel = window.getSelection && window.getSelection();
    if (!sel || sel.isCollapsed) return "";
    return String(sel.toString() || "")
      .replace(/\u00ad/g, "")
      .replace(/(\w)-\s+(\w)/g, "$1$2")
      .replace(/\s+/g, " ")
      .trim();
  }

  /** Soft filter: only skip obvious same-script noise when source is Latin-only */
  function shouldSkipSelection(text) {
    if (!text) return true;
    if (!/[\p{L}\p{N}]/u.test(text)) return true;
    // If user locked source to English, prefer Latin selections
    if (sourceLang === "en") {
      const letters = text.replace(/[^A-Za-z]/g, "");
      if (!letters) return true;
    }
    return false;
  }

  function ensureBubble() {
    let el = document.getElementById(TOAST_ID);
    if (el) return el;
    el = document.createElement("div");
    el.id = TOAST_ID;
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
  }

  function showResult(x, y, result) {
    const el = ensureBubble();
    if (!result.ok) {
      el.innerHTML =
        '<div class="enzh-bubble-err">' +
        escapeHtml(result.error || "翻译失败") +
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

  function scheduleHide(el, ms) {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      el.style.display = "none";
    }, ms);
  }

  function hideBubble() {
    const el = document.getElementById(TOAST_ID);
    if (el) el.style.display = "none";
    clearTimeout(hideTimer);
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function requestTranslate(text) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: "TRANSLATE", text }, (res) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          resolve(res || { ok: false, error: "无响应" });
        });
      } catch (e) {
        resolve({ ok: false, error: e.message || "扩展上下文失效" });
      }
    });
  }

  function refreshSettings() {
    try {
      chrome.runtime.sendMessage({ type: "GET_SETTINGS" }, (res) => {
        if (res && res.sourceLang) sourceLang = res.sourceLang;
      });
    } catch (_) {}
  }

  refreshSettings();
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "sync" && changes.sourceLang) {
        sourceLang = changes.sourceLang.newValue || "auto";
      }
    });
  } catch (_) {}

  async function onMouseUp(e) {
    if (e.button !== 0) return;
    if (isEditableTarget(e.target)) return;
    if (e.target && e.target.closest && e.target.closest("#" + TOAST_ID)) return;

    await new Promise((r) => setTimeout(r, 10));

    let text = getSelectedText();
    if (!text || text.length > MAX_CHARS) {
      if (!text) hideBubble();
      return;
    }
    if (shouldSkipSelection(text)) return;

    const now = Date.now();
    if (text === lastQuery && now - lastAt < 400) return;
    lastQuery = text;
    lastAt = now;

    const x = e.clientX;
    const y = e.clientY;
    showLoading(x, y, text);
    const result = await requestTranslate(text);
    showResult(x, y, result);
  }

  document.addEventListener("mouseup", onMouseUp, true);
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape") hideBubble();
    },
    true
  );
})();
