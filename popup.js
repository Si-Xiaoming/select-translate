const qEl = document.getElementById("q");
const goEl = document.getElementById("go");
const outEl = document.getElementById("out");
const lastEl = document.getElementById("last");
const sourceEl = document.getElementById("sourceLang");
const targetEl = document.getElementById("targetLang");
const swapEl = document.getElementById("swap");
const pairSub = document.getElementById("pairSub");
const autoTranslateEl = document.getElementById("autoTranslate");
const openShortcutsEl = document.getElementById("openShortcuts");
const shortcutButton = document.getElementById("shortcutButton");
const shortcutText = document.getElementById("shortcutText");
const shortcutReset = document.getElementById("shortcutReset");
const shortcutHint = document.getElementById("shortcutHint");
const howtoShortcut = document.getElementById("howtoShortcut");

const SHORTCUT_HINT_DEFAULT =
  "点击上方按键框后按下新的组合键（需包含 Ctrl / Alt / ⌘）。在网页中选中文字后按下即可翻译。";

let currentShortcut = "";
let capturing = false;
let hintTimer = null;

const Sc = window.SelectTranslateShortcut || null;

/* ------------------------------------------------------------------ 通用 */

function sendToBackground(message) {
  try {
    chrome.runtime.sendMessage(message, () => {
      // 读取 lastError，避免控制台出现 Unchecked runtime.lastError
      void chrome.runtime.lastError;
    });
  } catch (_) {}
}

function fillSelect(el, includeAuto) {
  el.innerHTML = "";
  for (const lang of LANGUAGES) {
    if (!includeAuto && lang.code === "auto") continue;
    const opt = document.createElement("option");
    opt.value = lang.code;
    opt.textContent = lang.nameZh + " (" + lang.code + ")";
    el.appendChild(opt);
  }
}

function updatePairLabel(settings) {
  const from = shortLangLabel(settings.sourceLang);
  const to = shortLangLabel(settings.targetLang);
  pairSub.textContent = `免费 · ${from} → ${to} · 网页 / PDF / IEEE`;
}

/* -------------------------------------------------------------- 快捷键 UI */

function displayShortcut(shortcut) {
  if (!shortcut) return "未设置";
  return Sc ? Sc.display(shortcut) : shortcut;
}

function renderShortcut() {
  const label = displayShortcut(currentShortcut);
  shortcutText.textContent = label;
  howtoShortcut.textContent = currentShortcut ? label : "（未设置）";
  shortcutButton.classList.toggle("unset", !currentShortcut);
}

function setHint(text, tone) {
  shortcutHint.textContent = text;
  shortcutHint.className = tone ? "hint " + tone : "hint";
  clearTimeout(hintTimer);
  if (tone) {
    hintTimer = setTimeout(() => {
      if (!capturing) setHint(SHORTCUT_HINT_DEFAULT);
    }, 4500);
  }
}

function startCapture() {
  capturing = true;
  shortcutButton.classList.add("capturing");
  shortcutText.textContent = "按下组合键…";
  setHint("按下新的组合键：Esc 取消，Backspace 清除快捷键。");
}

function stopCapture() {
  capturing = false;
  shortcutButton.classList.remove("capturing");
  renderShortcut();
}

async function applyShortcut(combo) {
  const normalized = combo && Sc ? Sc.normalize(combo) : "";
  stopCapture();
  currentShortcut = normalized;
  renderShortcut();
  try {
    const next = await saveSettings({ shortcut: normalized });
    currentShortcut = next.shortcut || "";
    renderShortcut();
    sendToBackground({ type: "SAVE_SETTINGS", settings: next });
  } catch (_) {}
  if (currentShortcut) {
    setHint("已保存：" + displayShortcut(currentShortcut) + "。已打开的网页会立即生效，无需刷新。", "ok");
  } else {
    setHint("快捷键已关闭；仍可用右键菜单或下面的手动翻译。", "ok");
  }
}

function onCaptureKeyDown(e) {
  if (!capturing) return;
  if (!Sc) {
    stopCapture();
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  if (e.repeat) return;

  if (e.key === "Escape") {
    stopCapture();
    setHint("已取消修改。");
    return;
  }

  const modifierOnly = Sc.modifierLabel(e);
  if (modifierOnly) {
    shortcutText.textContent = (modifierOnly === "Meta" ? "⌘" : modifierOnly) + " + …";
    return;
  }

  const isClearKey = e.key === "Backspace" || e.key === "Delete";
  if (isClearKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
    applyShortcut("");
    return;
  }

  const combo = Sc.fromEvent(e);
  if (!combo) {
    setHint("组合键必须包含 Ctrl / Alt / ⌘ 修饰键。", "warn");
    return;
  }
  if (Sc.isReserved(combo)) {
    setHint(Sc.display(combo) + " 已被浏览器占用，请换一个组合。", "warn");
    return;
  }
  applyShortcut(combo);
}

shortcutButton.addEventListener("click", () => {
  if (capturing) {
    stopCapture();
    setHint(SHORTCUT_HINT_DEFAULT);
    return;
  }
  startCapture();
});

shortcutReset.addEventListener("click", () => {
  if (!Sc) return;
  applyShortcut(Sc.DEFAULT_SHORTCUT);
});

document.addEventListener("keydown", onCaptureKeyDown, true);

openShortcutsEl.addEventListener("click", () => {
  const isEdge = /Edg\//.test(navigator.userAgent);
  const url = isEdge ? "edge://extensions/shortcuts" : "chrome://extensions/shortcuts";
  const fallback = () => setHint("浏览器不允许直接跳转，请手动打开地址栏输入 " + url, "warn");
  try {
    chrome.tabs.create({ url }, () => {
      if (chrome.runtime.lastError) fallback();
    });
  } catch (_) {
    fallback();
  }
});

/* ---------------------------------------------------------------- 语言 UI */

async function loadLangUI() {
  fillSelect(sourceEl, true);
  fillSelect(targetEl, false);
  const settings = await loadSettings();
  sourceEl.value = settings.sourceLang;
  targetEl.value = settings.targetLang;
  autoTranslateEl.checked = settings.autoTranslate;
  currentShortcut = settings.shortcut || "";
  renderShortcut();
  updatePairLabel(settings);
}

async function persistFromUI() {
  const next = await saveSettings({
    sourceLang: sourceEl.value,
    targetLang: targetEl.value,
    autoTranslate: autoTranslateEl.checked
  });
  sourceEl.value = next.sourceLang;
  targetEl.value = next.targetLang;
  updatePairLabel(next);
  sendToBackground({ type: "SAVE_SETTINGS", settings: next });
}

/* ---------------------------------------------------------------- 翻译 UI */

function render(el, result) {
  if (!result) {
    el.hidden = false;
    el.className = "out muted";
    el.textContent = "暂无";
    return;
  }
  el.hidden = false;
  if (!result.ok) {
    el.className = "out err";
    el.textContent = result.error || "翻译失败";
    return;
  }
  el.className = "out";
  el.innerHTML =
    '<div class="q"></div><div class="a"></div><div class="meta"></div>';
  el.querySelector(".q").textContent = result.query || "";
  el.querySelector(".a").textContent = result.translation || "";
  const pair =
    shortLangLabel(result.sourceLang || "") +
    " → " +
    shortLangLabel(result.targetLang || "");
  el.querySelector(".meta").textContent = [
    result.engine ? "引擎：" + result.engine : "",
    pair,
    result.detected ? "检测：" + result.detected : ""
  ]
    .filter(Boolean)
    .join(" · ");
}

async function loadLast() {
  let data = {};
  try {
    data = await chrome.storage.session.get("lastResult");
  } catch (_) {}
  if (!data.lastResult) {
    data = await chrome.storage.local.get("lastResult");
  }
  render(lastEl, data.lastResult || null);
}

async function doTranslate() {
  const text = (qEl.value || "").trim();
  if (!text) return;
  outEl.hidden = false;
  outEl.className = "out muted";
  outEl.textContent = "翻译中…";
  try {
    chrome.runtime.sendMessage({ type: "TRANSLATE", text }, (res) => {
      if (chrome.runtime.lastError) {
        render(outEl, { ok: false, error: chrome.runtime.lastError.message || "扩展无响应" });
        return;
      }
      render(outEl, res);
      loadLast();
    });
  } catch (e) {
    render(outEl, { ok: false, error: (e && e.message) || "扩展无响应" });
  }
}

sourceEl.addEventListener("change", persistFromUI);
targetEl.addEventListener("change", persistFromUI);
autoTranslateEl.addEventListener("change", persistFromUI);
swapEl.addEventListener("click", async () => {
  let sl = sourceEl.value;
  let tl = targetEl.value;
  if (sl === "auto") sl = "en";
  sourceEl.value = tl;
  targetEl.value = sl === "auto" ? "en" : sl;
  await persistFromUI();
});

goEl.addEventListener("click", doTranslate);
qEl.addEventListener("keydown", (e) => {
  if (capturing) return;
  if (e.key === "Enter") doTranslate();
});

loadLangUI()
  .then(loadLast)
  .catch(() => {
    pairSub.textContent = "设置读取失败，请重新打开弹窗";
  });
