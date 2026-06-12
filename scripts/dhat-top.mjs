// Summarize a dhat-heap.json: top allocation sites by bytes live at
// the global heap peak (gb) and at program end (eb).
// Usage: node dhat-top.mjs <dhat-heap.json> [count]
import { readFileSync } from "node:fs";

const file = process.argv[2] ?? "dhat-heap.json";
const count = Number(process.argv[3] ?? 12);
const j = JSON.parse(readFileSync(file, "utf8"));

const mb = (b) => (b / 1024 / 1024).toFixed(1) + " MB";

function frames(pp) {
  return pp.fs
    .map((i) => j.ftbl[i])
    .filter((f) => f && !/^\[root\]/.test(f))
    // Drop allocator/runtime noise so app frames surface.
    .filter((f) => !/alloc::|__rust_alloc|RawVec|core::|dhat::|std::sys/.test(f))
    .slice(0, 4)
    .map((f) => f.replace(/^0x[0-9a-f]+: /, "").replace(/ \(.*?:\d+:\d+\)/, ""));
}

console.log(`total blocks: ${j.pps.length} sites; t-gmax total: ${mb(j.pps.reduce((s, p) => s + (p.gb ?? 0), 0))}; end total: ${mb(j.pps.reduce((s, p) => s + (p.eb ?? 0), 0))}`);

for (const key of ["gb", "eb"]) {
  console.log(`\n=== top sites by ${key === "gb" ? "bytes at global peak" : "bytes at exit"} ===`);
  const top = [...j.pps].sort((a, b) => (b[key] ?? 0) - (a[key] ?? 0)).slice(0, count);
  for (const pp of top) {
    if (!pp[key]) continue;
    console.log(`${mb(pp[key])}  (total ever: ${mb(pp.tb)})`);
    for (const f of frames(pp)) console.log(`    ${f}`);
  }
}
