# Select Translate

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Manifest](https://img.shields.io/badge/Manifest-V3-brightgreen)](manifest.json)
[![Edge](https://img.shields.io/badge/Microsoft%20Edge-Extension-0078D7)](https://www.microsoft.com/edge)
[![Chrome](https://img.shields.io/badge/Google%20Chrome-Extension-4285F4)](https://www.google.com/chrome/)
[![PDF](https://img.shields.io/badge/PDF-Select%20to%20Translate-orange)](#pdf--ieee-xplore)
[![Free](https://img.shields.io/badge/API%20Key-Not%20Required-success)](#translation-engines)

**Free select-to-translate** for **Microsoft Edge** and **Google Chrome**.  
Highlight a word or short phrase on any webpage — or inside the **built-in PDF viewer** and **IEEE Xplore stamp PDFs** — and get an instant translation.

> 免费划词翻译 · 任选源语言 / 目标语言 · 支持网页、浏览器 PDF、IEEE stamp

---

## Why this extension?

Most “page translators” struggle with academic PDFs. Chromium’s built-in PDF viewer blocks content-script injection, so floating bubbles often fail.

**Select Translate** uses the reliable path:

| Surface | How it works |
|--------|----------------|
| Web pages | Select text → floating bubble |
| Built-in PDF viewer | Select → **right-click → Translate** (`selectionText`) |
| [IEEE Xplore stamp](https://ieeexplore.ieee.org/stamp/stamp.jsp?tp=&arnumber=10205476) | Same as PDF (embedded viewer) |
| Anywhere | `Alt+T` (copy first if selection is unavailable) |

No account. No API key. Open source.

---

## Features

- **Any language pair** — pick source & target in the popup (30+ languages), with **auto-detect**
- **Select-to-translate** on normal pages
- **PDF / IEEE-friendly** via context menu (the only stable free approach for Chromium PDF)
- **Free engines** — Google Translate (`gtx`) + MyMemory fallback
- **Sync settings** across devices (`chrome.storage.sync`)
- **Keyboard shortcut** `Alt+T`
- Manifest V3, Edge & Chrome ready

---

## Install (load unpacked)

### Microsoft Edge

1. Open `edge://extensions/`
2. Enable **Developer mode**
3. **Load unpacked** → select this repository folder
4. For local PDF files: open extension details → enable **Allow access to file URLs**

### Google Chrome

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. **Load unpacked** → select this repository folder
4. Enable **Allow access to file URLs** if you open local PDFs

---

## Usage

1. Click the toolbar icon → choose **Source** and **Target** languages (default: Auto → 简体中文)
2. On a webpage: select a word/phrase → read the bubble
3. In a PDF or IEEE stamp page: select text → right-click → **翻译「…」→ …**
4. Optional: press `Alt+T`

---

## PDF & IEEE Xplore

Chromium / Edge PDF UI runs in an isolated viewer; other extensions **cannot inject** scripts into it.

The browser still exposes selected text to the **contextMenus** API. That is how this extension translates PDFs for free — including IEEE `stamp.jsp` pages.

---

## Translation engines

| Priority | Engine | Key required |
|----------|--------|--------------|
| 1 | Google Translate public `gtx` endpoint | No |
| 2 | [MyMemory](https://mymemory.translated.net/) public API | No |

Focused on **words / short phrases** (~80 characters). Not a full-page translator.

---

## Supported languages (selection)

English, 简体中文, 繁體中文, Japanese, Korean, French, German, Spanish, Portuguese, Russian, Italian, Arabic, Hindi, Thai, Vietnamese, Indonesian, and more — see `languages.js`.

---

## Project layout

```
├── manifest.json      # MV3 extension manifest
├── background.js      # Context menu, shortcut, translate orchestration
├── languages.js       # Language list + sync settings
├── translator.js      # Free translation backends
├── content.js/css     # In-page select bubble
├── popup.*            # Language picker + manual lookup
├── result.*           # PDF result popup window
└── icons/             # Extension icons
```

---

## Privacy

- Translation requests go only to the configured free endpoints (Google / MyMemory)
- Language preferences sync via browser sync storage
- No analytics, no accounts, no telemetry in this repo

---

## Contributing

Issues and PRs welcome — especially:

- More language labels / locale UI
- Better PDF UX ideas that stay Manifest-V3 compliant
- Edge / Chrome Web Store packaging tips

---

## License

MIT — see [LICENSE](LICENSE).

---

## Keywords

`chrome-extension` `edge-extension` `select-to-translate` `pdf-translate` `ieee-xplore` `manifest-v3` `free-translator` `划词翻译` `PDF翻译`
