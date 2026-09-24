/**
 * Shared language list + settings helpers (service worker + popup).
 * Codes follow Google Translate / MyMemory conventions.
 */

const DEFAULT_SETTINGS = {
  sourceLang: "auto",
  targetLang: "zh-CN"
};

/** @type {{ code: string, name: string, nameZh: string }[]} */
const LANGUAGES = [
  { code: "auto", name: "Detect language", nameZh: "自动检测" },
  { code: "en", name: "English", nameZh: "英语" },
  { code: "zh-CN", name: "Chinese (Simplified)", nameZh: "简体中文" },
  { code: "zh-TW", name: "Chinese (Traditional)", nameZh: "繁體中文" },
  { code: "ja", name: "Japanese", nameZh: "日语" },
  { code: "ko", name: "Korean", nameZh: "韩语" },
  { code: "fr", name: "French", nameZh: "法语" },
  { code: "de", name: "German", nameZh: "德语" },
  { code: "es", name: "Spanish", nameZh: "西班牙语" },
  { code: "pt", name: "Portuguese", nameZh: "葡萄牙语" },
  { code: "ru", name: "Russian", nameZh: "俄语" },
  { code: "it", name: "Italian", nameZh: "意大利语" },
  { code: "ar", name: "Arabic", nameZh: "阿拉伯语" },
  { code: "hi", name: "Hindi", nameZh: "印地语" },
  { code: "th", name: "Thai", nameZh: "泰语" },
  { code: "vi", name: "Vietnamese", nameZh: "越南语" },
  { code: "id", name: "Indonesian", nameZh: "印尼语" },
  { code: "nl", name: "Dutch", nameZh: "荷兰语" },
  { code: "pl", name: "Polish", nameZh: "波兰语" },
  { code: "tr", name: "Turkish", nameZh: "土耳其语" },
  { code: "sv", name: "Swedish", nameZh: "瑞典语" },
  { code: "uk", name: "Ukrainian", nameZh: "乌克兰语" },
  { code: "cs", name: "Czech", nameZh: "捷克语" },
  { code: "el", name: "Greek", nameZh: "希腊语" },
  { code: "he", name: "Hebrew", nameZh: "希伯来语" },
  { code: "ro", name: "Romanian", nameZh: "罗马尼亚语" },
  { code: "hu", name: "Hungarian", nameZh: "匈牙利语" },
  { code: "fi", name: "Finnish", nameZh: "芬兰语" },
  { code: "da", name: "Danish", nameZh: "丹麦语" },
  { code: "no", name: "Norwegian", nameZh: "挪威语" },
  { code: "ms", name: "Malay", nameZh: "马来语" }
];

const LANG_BY_CODE = Object.fromEntries(LANGUAGES.map((l) => [l.code, l]));

function langLabel(code, preferZh) {
  const item = LANG_BY_CODE[code];
  if (!item) return code;
  return preferZh ? item.nameZh : item.name;
}

function shortLangLabel(code) {
  const item = LANG_BY_CODE[code];
  if (!item) return code;
  if (code === "auto") return "自动";
  if (code === "zh-CN") return "中文";
  if (code === "zh-TW") return "繁中";
  return item.nameZh || item.name;
}

/** MyMemory uses zh-CN; map a few aliases */
function toMyMemoryCode(code) {
  if (code === "auto") return "autodetect";
  if (code === "zh-CN") return "zh-CN";
  if (code === "zh-TW") return "zh-TW";
  return code;
}

async function loadSettings() {
  const data = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return {
    sourceLang: data.sourceLang || DEFAULT_SETTINGS.sourceLang,
    targetLang: data.targetLang || DEFAULT_SETTINGS.targetLang
  };
}

async function saveSettings(partial) {
  const current = await loadSettings();
  const next = {
    sourceLang: partial.sourceLang != null ? partial.sourceLang : current.sourceLang,
    targetLang: partial.targetLang != null ? partial.targetLang : current.targetLang
  };
  if (next.sourceLang !== "auto" && next.sourceLang === next.targetLang) {
    if (partial.sourceLang != null && partial.targetLang == null) {
      next.targetLang = next.sourceLang === "zh-CN" ? "en" : "zh-CN";
    } else if (partial.targetLang != null && partial.sourceLang == null) {
      next.sourceLang = "auto";
    } else {
      next.sourceLang = "auto";
    }
  }
  await chrome.storage.sync.set({
    sourceLang: next.sourceLang,
    targetLang: next.targetLang
  });
  return next;
}

if (typeof self !== "undefined") {
  self.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
  self.LANGUAGES = LANGUAGES;
  self.LANG_BY_CODE = LANG_BY_CODE;
  self.langLabel = langLabel;
  self.shortLangLabel = shortLangLabel;
  self.toMyMemoryCode = toMyMemoryCode;
  self.loadSettings = loadSettings;
  self.saveSettings = saveSettings;
}
