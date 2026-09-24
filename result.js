(() => {
  const params = new URLSearchParams(location.search);
  const q = params.get("q") || "";
  const t = params.get("t") || "";
  const e = params.get("e") || "";
  const sl = params.get("sl") || "";
  const tl = params.get("tl") || "";
  const det = params.get("det") || "";
  const err = params.get("err") || "";

  document.getElementById("q").textContent = q;
  const tEl = document.getElementById("t");
  if (err) {
    tEl.textContent = err;
    tEl.classList.add("err");
  } else {
    tEl.textContent = t;
  }
  const bits = [];
  if (e) bits.push("引擎：" + e);
  if (sl || tl) bits.push((sl || "?") + " → " + (tl || "?"));
  if (det) bits.push("检测：" + det);
  if (!bits.length) bits.push("Select Translate");
  document.getElementById("meta").textContent = bits.join(" · ");
})();
