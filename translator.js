/**
 * Free translators (no API key).
 * Primary: Google Translate unofficial gtx endpoint
 * Fallback: MyMemory public API
 */

const MAX_CHARS = 80;

function normalizeQuery(raw) {
  if (!raw) return "";
  let text = String(raw).replace(/\s+/g, " ").trim();
  // PDF selection often inserts soft hyphens / line-break hyphens
  text = text.replace(/\u00ad/g, "").replace(/(\w)-\s+(\w)/g, "$1$2");
  if (text.length > MAX_CHARS) {
    text = text.slice(0, MAX_CHARS).trim();
  }
  return text;
}

function looksTranslatable(text) {
  if (!text) return false;
  // Reject whitespace-only / pure punctuation
  return /[\p{L}\p{N}]/u.test(text);
}

async function translateGoogle(text, sourceLang, targetLang) {
  const sl = sourceLang || "auto";
  const tl = targetLang || "zh-CN";
  const url =
    "https://translate.googleapis.com/translate_a/single?client=gtx&sl=" +
    encodeURIComponent(sl) +
    "&tl=" +
    encodeURIComponent(tl) +
    "&dt=t&q=" +
    encodeURIComponent(text);
  const res = await fetch(url);
  if (!res.ok) throw new Error("Google HTTP " + res.status);
  const data = await res.json();
  const parts = (data && data[0]) || [];
  const out = parts.map((p) => p && p[0]).filter(Boolean).join("");
  if (!out) throw new Error("Google empty result");
  const detected = data && data[2] ? String(data[2]) : "";
  return { text: out, engine: "Google", detected };
}

async function translateMyMemory(text, sourceLang, targetLang) {
  const sl = toMyMemoryCode(sourceLang || "auto");
  const tl = toMyMemoryCode(targetLang || "zh-CN");
  const url =
    "https://api.mymemory.translated.net/get?q=" +
    encodeURIComponent(text) +
    "&langpair=" +
    encodeURIComponent(sl + "|" + tl);
  const res = await fetch(url);
  if (!res.ok) throw new Error("MyMemory HTTP " + res.status);
  const data = await res.json();
  const out = data && data.responseData && data.responseData.translatedText;
  if (!out) throw new Error("MyMemory empty result");
  // MyMemory sometimes echoes INVALID LANGUAGE PAIR etc.
  if (/INVALID|PLEASE SELECT/i.test(out)) throw new Error(out);
  return { text: out, engine: "MyMemory", detected: "" };
}

async function translateText(raw, sourceLang, targetLang) {
  const query = normalizeQuery(raw);
  if (!query) {
    return { ok: false, error: "没有可翻译的文本" };
  }
  if (!looksTranslatable(query)) {
    return { ok: false, error: "请选择有效文字", query };
  }

  const sl = sourceLang || "auto";
  let tl = targetLang || "zh-CN";
  if (sl !== "auto" && sl === tl) {
    return { ok: false, error: "源语言与目标语言相同", query };
  }

  try {
    const r = await translateGoogle(query, sl, tl);
    return {
      ok: true,
      query,
      translation: r.text,
      engine: r.engine,
      sourceLang: sl,
      targetLang: tl,
      detected: r.detected || ""
    };
  } catch (e1) {
    try {
      const r = await translateMyMemory(query, sl, tl);
      return {
        ok: true,
        query,
        translation: r.text,
        engine: r.engine,
        sourceLang: sl,
        targetLang: tl,
        detected: r.detected || ""
      };
    } catch (e2) {
      return {
        ok: false,
        query,
        sourceLang: sl,
        targetLang: tl,
        error: "翻译失败：" + (e2.message || e1.message || "网络错误")
      };
    }
  }
}

// Backward-compatible alias
async function translateEnToZh(raw) {
  return translateText(raw, "en", "zh-CN");
}

if (typeof self !== "undefined") {
  self.normalizeQuery = normalizeQuery;
  self.looksTranslatable = looksTranslatable;
  self.translateText = translateText;
  self.translateEnToZh = translateEnToZh;
  self.MAX_CHARS = MAX_CHARS;
}
