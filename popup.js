const qEl = document.getElementById("q");
const goEl = document.getElementById("go");
const outEl = document.getElementById("out");
const lastEl = document.getElementById("last");
const sourceEl = document.getElementById("sourceLang");
const targetEl = document.getElementById("targetLang");
const swapEl = document.getElementById("swap");
const pairSub = document.getElementById("pairSub");

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

async function loadLangUI() {
  fillSelect(sourceEl, true);
  fillSelect(targetEl, false);
  const settings = await loadSettings();
  sourceEl.value = settings.sourceLang;
  targetEl.value = settings.targetLang;
  updatePairLabel(settings);
}

async function persistFromUI() {
  const next = await saveSettings({
    sourceLang: sourceEl.value,
    targetLang: targetEl.value
  });
  sourceEl.value = next.sourceLang;
  targetEl.value = next.targetLang;
  updatePairLabel(next);
  chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings: next });
}

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
  chrome.runtime.sendMessage({ type: "TRANSLATE", text }, (res) => {
    render(outEl, res);
    loadLast();
  });
}

sourceEl.addEventListener("change", persistFromUI);
targetEl.addEventListener("change", persistFromUI);
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
  if (e.key === "Enter") doTranslate();
});

loadLangUI().then(loadLast);
