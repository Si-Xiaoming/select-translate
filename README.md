# Select Translate（划词翻译）

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Manifest](https://img.shields.io/badge/Manifest-V3-brightgreen)](manifest.json)
[![Edge](https://img.shields.io/badge/Microsoft%20Edge-%E6%8F%92%E4%BB%B6-0078D7)](https://www.microsoft.com/edge)
[![Chrome](https://img.shields.io/badge/Google%20Chrome-%E6%8F%92%E4%BB%B6-4285F4)](https://www.google.com/chrome/)
[![PDF](https://img.shields.io/badge/PDF-%E5%88%92%E8%AF%8D%E7%BF%BB%E8%AF%91-orange)](#pdf--ieee-xplore)
[![Free](https://img.shields.io/badge/%E6%97%A0%E9%9C%80-API%20Key-success)](#翻译引擎)

**面向 Edge / Chrome 的免费划词翻译扩展。**  
在网页、浏览器内置 PDF 阅读器，以及 [IEEE Xplore stamp](https://ieeexplore.ieee.org/stamp/stamp.jsp?tp=&arnumber=10205476) 等嵌入式 PDF 里选中文字即可翻译；**源语言 / 目标语言可自由选择**，无需 API Key。

> Free select-to-translate for Edge/Chrome · any language pair · PDF & IEEE friendly · no API key

---

## 为什么做这个？

很多整页翻译插件在学术 PDF 上不好用：Chromium 内置 PDF 阅读器禁止注入内容脚本，浮层划词经常失效。

本扩展采用更稳妥的路径：

| 场景 | 用法 |
|------|------|
| 普通网页 | 选中文字 → 浮层显示译文 |
| 浏览器内置 PDF | 选中 → **右键 → 翻译**（`selectionText`） |
| [IEEE Xplore stamp](https://ieeexplore.ieee.org/stamp/stamp.jsp?tp=&arnumber=10205476) | 与 PDF 相同（嵌入阅读器） |
| 任意页面 | `Alt+T`（取不到选区时可先复制再按） |

无需账号、无需 API Key，开源免费。

---

## 功能

- **任选语言对**：弹窗设置源语言 / 目标语言（30+ 语种，支持自动检测）
- **网页划词翻译**
- **PDF / IEEE 友好**：右键菜单（Chromium PDF 上最稳的免费方案）
- **免费引擎**：Google Translate（`gtx`）+ MyMemory 回退
- **设置同步**：`chrome.storage.sync`
- **快捷键** `Alt+T`
- Manifest V3，兼容 Edge 与 Chrome

---

## 安装（加载已解压的扩展）

### Microsoft Edge

1. 打开 `edge://extensions/`
2. 开启 **开发人员模式**
3. **加载解压缩的扩展** → 选择本仓库目录
4. 若需翻译本地 PDF：扩展详情中开启 **允许访问文件 URL**

### Google Chrome

1. 打开 `chrome://extensions/`
2. 开启 **开发者模式**
3. **加载已解压的扩展程序** → 选择本仓库目录
4. 本地 PDF 同样需开启 **允许访问文件网址**

---

## 用法

1. 点击工具栏图标 → 选择 **源语言** 与 **目标语言**（默认：自动检测 → 简体中文）
2. 网页：选中单词/短句 → 查看浮层
3. PDF / IEEE stamp：选中后右键 → **翻译「…」→ …**
4. 可选：按 `Alt+T`

---

## PDF & IEEE Xplore

Chromium / Edge 的 PDF 界面运行在隔离阅读器中，其他扩展**无法注入脚本**。

浏览器仍会把选中文本交给 **右键菜单 API**。本扩展正是据此免费翻译 PDF，包括 IEEE 的 `stamp.jsp` 页面。

---

## 翻译引擎

| 优先级 | 引擎 | 是否需要 Key |
|--------|------|----------------|
| 1 | Google Translate 公开 `gtx` 接口 | 否 |
| 2 | [MyMemory](https://mymemory.translated.net/) 公共 API | 否 |

面向**单词 / 短句**（约 80 字符以内），不是整页翻译器。

---

## 支持的语言（节选）

英语、简体中文、繁體中文、日语、韩语、法语、德语、西班牙语、葡萄牙语、俄语、意大利语、阿拉伯语、印地语、泰语、越南语、印尼语等，完整列表见 `languages.js`。

---

## 目录结构

```
├── manifest.json      # MV3 清单
├── background.js      # 右键菜单 / 快捷键 / 翻译调度
├── languages.js       # 语言列表与同步设置
├── translator.js      # 免费翻译后端
├── content.js/css     # 网页划词浮层
├── popup.*            # 语言选择与手动查词
├── result.*           # PDF 结果小窗
└── icons/             # 图标
```

---

## 隐私

- 翻译请求仅发往上述免费接口（Google / MyMemory）
- 语言偏好通过浏览器同步存储
- 本仓库无统计、无账号、无遥测

---

## 参与贡献

欢迎 Issue / PR，尤其是：

- 更多语言标签或界面本地化
- 在 Manifest V3 约束下改进 PDF 体验
- Edge / Chrome 网上应用店打包经验

---

## 许可证

MIT — 见 [LICENSE](LICENSE)。

---

## English (summary)

**Select Translate** is a free Edge/Chrome extension for select-to-translate with configurable source/target languages. It works on web pages and—via the context menu—on Chromium’s built-in PDF viewer and IEEE Xplore stamp PDFs. No API key required. See sections above for install and usage.

---

## 关键词

`划词翻译` `PDF翻译` `chrome-extension` `edge-extension` `select-to-translate` `pdf-translate` `ieee-xplore` `manifest-v3` `free-translator`
