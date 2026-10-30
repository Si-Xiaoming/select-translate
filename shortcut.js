/**
 * 快捷键工具（content script 与 popup 共用）。
 *
 * 说明：
 * - 整个文件用 IIFE 包装，避免扩展更新后重复注入时，在同一隔离世界里
 *   重复声明顶层 `const` 而抛 "Identifier has already been declared"。
 * - 组合键统一存成可读字符串，例如 "Alt+T" / "Ctrl+Shift+Y"，
 *   修饰键顺序固定为 Ctrl → Alt → Shift → Meta。
 */
(() => {
  const DEFAULT_SHORTCUT = "Alt+T";
  /** 统一显示顺序：Windows 习惯 Ctrl+Shift+…，Mac 习惯 ⌘+Shift+… */
  const MODIFIER_ORDER = ["Ctrl", "Meta", "Alt", "Shift"];

  /** event.code -> 统一键名 */
  const CODE_TO_KEY = {
    Space: "Space",
    Escape: "Esc",
    Enter: "Enter",
    NumpadEnter: "Enter",
    Tab: "Tab",
    Backspace: "Backspace",
    Delete: "Delete",
    Insert: "Insert",
    Home: "Home",
    End: "End",
    PageUp: "PageUp",
    PageDown: "PageDown",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right"
  };

  /** event.key -> 统一键名（e.code 缺失时的兜底） */
  const KEY_TO_KEY = {
    " ": "Space",
    Spacebar: "Space",
    Escape: "Esc",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right"
  };

  /** 只按修饰键时不构成完整组合键 */
  const MODIFIER_KEYS = new Set([
    "Control",
    "Alt",
    "Shift",
    "Meta",
    "AltGraph",
    "OS",
    "Super",
    "Hyper",
    "Fn",
    "CapsLock"
  ]);

  /** 小写写法 -> 统一键名 */
  const KEY_ALIASES = {
    space: "Space",
    spacebar: "Space",
    esc: "Esc",
    escape: "Esc",
    enter: "Enter",
    return: "Enter",
    tab: "Tab",
    backspace: "Backspace",
    delete: "Delete",
    del: "Delete",
    insert: "Insert",
    home: "Home",
    end: "End",
    pageup: "PageUp",
    pgup: "PageUp",
    pagedown: "PageDown",
    pgdn: "PageDown",
    up: "Up",
    arrowup: "Up",
    down: "Down",
    arrowdown: "Down",
    left: "Left",
    arrowleft: "Left",
    right: "Right",
    arrowright: "Right"
  };

  /** 浏览器 / 系统占用的组合键：录入了也抢不到，直接提示换一个 */
  const RESERVED = new Set([
    "Ctrl+T",
    "Ctrl+N",
    "Ctrl+W",
    "Ctrl+R",
    "Ctrl+L",
    "Ctrl+D",
    "Ctrl+F",
    "Ctrl+P",
    "Ctrl+S",
    "Ctrl+H",
    "Ctrl+J",
    "Ctrl+U",
    "Ctrl+O",
    "Ctrl+K",
    "Ctrl+G",
    "Ctrl+Shift+T",
    "Ctrl+Shift+N",
    "Ctrl+Shift+W",
    "Ctrl+Shift+R",
    "Ctrl+Shift+I",
    "Ctrl+Shift+J",
    "Ctrl+Shift+C",
    "Ctrl+Shift+P",
    "Ctrl+Tab",
    "Ctrl+Shift+Tab",
    "Ctrl+PageUp",
    "Ctrl+PageDown",
    "Alt+D",
    "Alt+E",
    "Alt+F",
    "Alt+Left",
    "Alt+Right",
    "Alt+Home",
    "F5",
    "F11",
    "F12",
    "Esc",
    "Tab"
  ]);

  function canonicalModifier(raw) {
    const token = String(raw || "").trim().toLowerCase();
    if (token === "ctrl" || token === "control") return "Ctrl";
    if (token === "alt" || token === "option") return "Alt";
    if (token === "shift") return "Shift";
    if (
      token === "meta" ||
      token === "cmd" ||
      token === "command" ||
      token === "win" ||
      token === "super"
    ) {
      return "Meta";
    }
    return "";
  }

  function canonicalKey(raw) {
    const key = String(raw || "").trim();
    if (!key) return "";
    if (/^[a-z]$/i.test(key)) return key.toUpperCase();
    if (/^[0-9]$/.test(key)) return key;
    const fn = /^f([1-9]|1[0-2])$/i.exec(key);
    if (fn) return "F" + fn[1];
    const alias = KEY_ALIASES[key.toLowerCase()];
    return alias || "";
  }

  function parse(shortcut) {
    const text = String(shortcut || "").trim();
    if (!text) return null;
    const parts = text
      .split("+")
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length < 2) return null;

    const key = canonicalKey(parts.pop());
    if (!key) return null;

    const mods = new Set();
    for (const part of parts) {
      const mod = canonicalModifier(part);
      if (!mod) return null;
      mods.add(mod);
    }
    if (!mods.size) return null;

    return {
      key: key,
      ctrl: mods.has("Ctrl"),
      alt: mods.has("Alt"),
      shift: mods.has("Shift"),
      meta: mods.has("Meta")
    };
  }

  /** 规范化；非法组合返回空串 */
  function normalize(shortcut) {
    const parsed = parse(shortcut);
    if (!parsed) return "";
    const parts = [];
    for (const mod of MODIFIER_ORDER) {
      const flag =
        (mod === "Ctrl" && parsed.ctrl) ||
        (mod === "Alt" && parsed.alt) ||
        (mod === "Shift" && parsed.shift) ||
        (mod === "Meta" && parsed.meta);
      if (flag) parts.push(mod);
    }
    parts.push(parsed.key);
    return parts.join("+");
  }

  function keyFromEvent(e) {
    if (!e) return "";
    const code = String(e.code || "");
    let m = /^Key([A-Z])$/.exec(code);
    if (m) return m[1];
    m = /^Digit([0-9])$/.exec(code);
    if (m) return m[1];
    m = /^Numpad([0-9])$/.exec(code);
    if (m) return m[1];
    m = /^F([1-9]|1[0-2])$/.exec(code);
    if (m) return "F" + m[1];
    if (code && CODE_TO_KEY[code]) return CODE_TO_KEY[code];

    const key = String(e.key || "");
    if (key.length === 1) {
      if (/[a-z]/i.test(key)) return key.toUpperCase();
      if (/[0-9]/.test(key)) return key;
      return "";
    }
    if (KEY_TO_KEY[key]) return KEY_TO_KEY[key];
    m = /^F([1-9]|1[0-2])$/i.exec(key);
    if (m) return "F" + m[1];
    return "";
  }

  function modifiersOf(e) {
    const mods = [];
    if (e && e.ctrlKey) mods.push("Ctrl");
    if (e && e.metaKey) mods.push("Meta");
    if (e && e.altKey) mods.push("Alt");
    if (e && e.shiftKey) mods.push("Shift");
    return mods;
  }

  function isModifierOnly(e) {
    return MODIFIER_KEYS.has(String((e && e.key) || ""));
  }

  /**
   * 把键盘事件转成组合键字符串。
   * requireModifier 为 true 时，必须带 Ctrl / Alt / Meta（Shift 单独不算）。
   */
  function fromEvent(e, options) {
    const requireModifier = !options || options.requireModifier !== false;
    if (!e || isModifierOnly(e)) return "";
    const key = keyFromEvent(e);
    if (!key) return "";
    const mods = modifiersOf(e);
    if (requireModifier) {
      const hasStrong = mods.indexOf("Ctrl") >= 0 || mods.indexOf("Alt") >= 0 || mods.indexOf("Meta") >= 0;
      if (!hasStrong) return "";
    }
    mods.push(key);
    return mods.join("+");
  }

  function matches(e, shortcut) {
    const parsed = parse(shortcut);
    if (!parsed || !e || isModifierOnly(e)) return false;
    if (!!e.ctrlKey !== parsed.ctrl) return false;
    if (!!e.altKey !== parsed.alt) return false;
    if (!!e.shiftKey !== parsed.shift) return false;
    if (!!e.metaKey !== parsed.meta) return false;
    return keyFromEvent(e) === parsed.key;
  }

  function isReserved(shortcut) {
    const normalized = normalize(shortcut);
    if (!normalized) return false;
    return RESERVED.has(normalized);
  }

  /** 录制过程中只按住修饰键时，返回 "Alt" 这类标签；否则返回空串 */
  function modifierLabel(e) {
    if (!e || !isModifierOnly(e)) return "";
    const key = String(e.key || "");
    if (key === "Control") return "Ctrl";
    if (key === "Meta" || key === "OS" || key === "Super") return "Meta";
    if (key === "Alt" || key === "AltGraph") return "Alt";
    if (key === "Shift") return "Shift";
    return "";
  }

  /** 展示用：Meta 显示成 ⌘，更接近 Mac 习惯 */
  function display(shortcut) {
    const normalized = normalize(shortcut);
    if (!normalized) return "";
    return normalized.replace(/\bMeta\b/g, "⌘");
  }

  const api = {
    DEFAULT_SHORTCUT: DEFAULT_SHORTCUT,
    normalize: normalize,
    parse: parse,
    matches: matches,
    fromEvent: fromEvent,
    isModifierOnly: isModifierOnly,
    modifierLabel: modifierLabel,
    isReserved: isReserved,
    display: display,
    keyFromEvent: keyFromEvent
  };

  const globalScope = typeof window !== "undefined" ? window : self;
  globalScope.SelectTranslateShortcut = api;
})();
