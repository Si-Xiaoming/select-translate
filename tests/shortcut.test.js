const fs = require("fs");
const path = require("path");
const vm = require("vm");

const file = path.join(__dirname, "..", "shortcut.js");
const source = fs.readFileSync(file, "utf8");

const sandbox = { console };
sandbox.window = sandbox;
sandbox.self = sandbox;
const context = vm.createContext(sandbox);

// 模拟扩展更新后重复注入同一文件
vm.runInContext(source, context);
vm.runInContext(source, context);
const Sc = sandbox.SelectTranslateShortcut;

let failures = 0;
function eq(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures++;
    console.log("FAIL", label, "actual=", JSON.stringify(actual), "expected=", JSON.stringify(expected));
  } else {
    console.log("ok  ", label, JSON.stringify(actual));
  }
}

function ev(props) {
  return Object.assign({ code: "", key: "", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false }, props);
}

eq(Sc.normalize("alt+t"), "Alt+T", "normalize 小写");
eq(Sc.normalize(" shift + ctrl + y "), "Ctrl+Shift+Y", "normalize 顺序");
eq(Sc.normalize("T"), "", "normalize 缺修饰键");
eq(Sc.normalize("Alt+"), "", "normalize 残缺");
eq(Sc.normalize("Foo+Bar"), "", "normalize 非法");
eq(Sc.normalize("Alt+Space"), "Alt+Space", "normalize Space");
eq(Sc.normalize("Ctrl+Alt+ArrowUp"), "Ctrl+Alt+Up", "normalize 方向键");
eq(Sc.normalize("Ctrl+F5"), "Ctrl+F5", "normalize 功能键");
eq(Sc.normalize("Command+Shift+K"), "Meta+Shift+K", "normalize Command");
eq(Sc.normalize("Alt+0"), "Alt+0", "normalize 数字");

eq(Sc.matches(ev({ code: "KeyT", key: "t", altKey: true }), "Alt+T"), true, "matches Alt+T");
eq(Sc.matches(ev({ code: "KeyT", key: "t", ctrlKey: true }), "Alt+T"), false, "matches 缺 Alt");
eq(Sc.matches(ev({ code: "KeyT", key: "t", altKey: true, shiftKey: true }), "Alt+T"), false, "matches 多 Shift");
eq(Sc.matches(ev({ code: "KeyY", key: "Y", ctrlKey: true, shiftKey: true }), "Ctrl+Shift+Y"), true, "matches Ctrl+Shift+Y");
eq(Sc.matches(ev({ code: "KeyT", key: "T", altKey: true }), "Alt+T"), true, "matches 大写 key（大写锁定）");
eq(Sc.matches(ev({ key: "T", altKey: true }), "Alt+T"), true, "matches 无 code 兜底");
eq(Sc.matches(ev({ code: "Digit1", key: "!", altKey: true }), "Alt+1"), true, "matches Alt+1");
eq(Sc.matches(ev({ code: "KeyT", key: "t", altKey: true }), ""), false, "matches 空配置");
eq(Sc.matches(ev({ code: "F5", key: "F5" }), "F5"), false, "matches 无修饰键组合非法");
eq(Sc.matches(ev({ code: "KeyK", key: "k", metaKey: true }), "Meta+K"), true, "matches Meta+K");

eq(Sc.fromEvent(ev({ code: "KeyT", key: "t", altKey: true })), "Alt+T", "fromEvent Alt+T");
eq(Sc.fromEvent(ev({ code: "KeyT", key: "t" })), "", "fromEvent 无修饰键");
eq(Sc.fromEvent(ev({ key: "Alt", altKey: true })), "", "fromEvent 只有修饰键");
eq(Sc.fromEvent(ev({ code: "Space", key: " ", ctrlKey: true })), "Ctrl+Space", "fromEvent Space");
eq(Sc.fromEvent(ev({ code: "Digit1", key: "!", altKey: true, shiftKey: true })), "Alt+Shift+1", "fromEvent 数字");
eq(Sc.fromEvent(ev({ code: "Slash", key: "/", ctrlKey: true })), "", "fromEvent 不支持符号");

eq(Sc.isModifierOnly(ev({ key: "Alt" })), true, "isModifierOnly Alt");
eq(Sc.isModifierOnly(ev({ key: "Alt", code: "AltLeft" })), true, "isModifierOnly Alt+code");
eq(Sc.isModifierOnly(ev({ key: "a", code: "KeyA" })), false, "isModifierOnly A");
eq(Sc.modifierLabel(ev({ key: "Control" })), "Ctrl", "modifierLabel Ctrl");
eq(Sc.modifierLabel(ev({ key: "Meta" })), "Meta", "modifierLabel Meta");
eq(Sc.modifierLabel(ev({ key: "a" })), "", "modifierLabel 非修饰键");

eq(Sc.isReserved("Ctrl+T"), true, "isReserved Ctrl+T");
eq(Sc.isReserved("Ctrl+Shift+T"), true, "isReserved Ctrl+Shift+T");
eq(Sc.isReserved("Alt+T"), false, "isReserved Alt+T");
eq(Sc.isReserved("Alt+Shift+Q"), false, "isReserved Alt+Shift+Q");

eq(Sc.display("Alt+T"), "Alt+T", "display Alt+T");
eq(Sc.display("Meta+T"), "⌘+T", "display Meta");
eq(Sc.display(""), "", "display 空");
eq(Sc.DEFAULT_SHORTCUT, "Alt+T", "默认值");

// 重复注入后 API 依然可用，且没有抛重复声明错误
eq(typeof sandbox.SelectTranslateShortcut.matches, "function", "重复注入后可用");

console.log(failures === 0 ? "\nALL PASS" : "\n" + failures + " FAILED");
process.exit(failures === 0 ? 0 : 1);
