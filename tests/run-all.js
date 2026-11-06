/**
 * 一键跑全部测试：node tests/run-all.js
 *
 * 说明：这些是纯 Node 打桩测试，不需要浏览器。
 * 它们把 content.js / background.js / popup.js 放进 vm 沙箱里，
 * 用假的 DOM 与 chrome API 驱动，覆盖划词、快捷键、右键菜单等入口。
 */
const { spawnSync } = require("child_process");
const path = require("path");

const files = ["shortcut.test.js", "content.test.js", "background.test.js", "popup.test.js"];

let failed = 0;
for (const file of files) {
  console.log("\n=== " + file + " ===");
  const result = spawnSync(process.execPath, [path.join(__dirname, file)], {
    stdio: "inherit"
  });
  if (result.status !== 0) {
    failed += 1;
    console.log("--- " + file + " 失败 ---");
  }
}

console.log(failed === 0 ? "\n全部测试通过" : "\n" + failed + " 个测试文件失败");
process.exit(failed === 0 ? 0 : 1);
