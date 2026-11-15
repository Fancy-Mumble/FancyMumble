/**
 * Drive `perf.tsx` through every scenario and print what each one cost.
 *
 * Usage, from the `ui` directory:
 *
 *     node preview/perf.mjs                  # build, then run every scenario
 *     node preview/perf.mjs --no-build       # reuse the last build
 *     node preview/perf.mjs parent arrive    # only these
 *
 * The numbers that matter are `updates` - message rows React had to commit
 * again - and `rowMs`, the time it spent in them. A row that updates when
 * nothing about it moved is the thing every phase of the performance work is
 * trying to remove, so a scenario's `updates` falling to zero is the whole
 * point rather than a side effect.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const page = join(here, "dist-perf", "perf.html");

const EDGES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

/**
 * `scroll` is deliberately not in here.
 *
 * Headless Chromium with no compositor never dispatches the scroll event, so
 * the window never grows and the scenario reports a confident zero. Growing the
 * window costs what mounting a hundred rows costs, which `mount` already says.
 * Run it by hand in a real browser if the scroll path itself is in question.
 */
const ALL = ["mount", "parent", "roster", "talk", "react", "arrive"];

const args = process.argv.slice(2);
const build = !args.includes("--no-build");
const chosen = args.filter((arg) => !arg.startsWith("--"));
const scenarios = chosen.length > 0 ? chosen : ALL;

function edge() {
  const found = EDGES.find((path) => existsSync(path));
  if (!found) throw new Error("msedge.exe not found in either Program Files location");
  return found;
}

if (build) {
  console.log("building preview/perf ...");
  const result = spawnSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["vite", "build", "-c", join(here, "vite.perf.config.ts")],
    { cwd: join(here, ".."), stdio: "inherit", shell: true },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!existsSync(page)) {
  console.error(`no build at ${page} - drop --no-build`);
  process.exit(1);
}

/** Pull the harness's one line of JSON back out of the dumped document. */
function readReport(dom) {
  const pre = dom.match(/<pre id="perf-result">([\s\S]*?)<\/pre>/);
  const title = dom.match(/<title>([\s\S]*?)<\/title>/);
  const raw = (pre?.[1] ?? title?.[1] ?? "").trim();
  if (!raw.startsWith("{")) return null;
  try {
    return JSON.parse(raw.replaceAll("&quot;", '"').replaceAll("&amp;", "&"));
  } catch {
    return null;
  }
}

const rows = [];
for (const scenario of scenarios) {
  const url = `file:///${page.replaceAll("\\", "/")}?n=500&scenario=${scenario}`;
  const result = spawnSync(
    edge(),
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--allow-file-access-from-files",
      "--disable-features=Translate,BackForwardCache",
      "--virtual-time-budget=30000",
      "--dump-dom",
      url,
    ],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  const report = readReport(result.stdout ?? "");
  if (!report) {
    console.error(`${scenario}: no result (browser exit ${result.status})`);
    continue;
  }
  rows.push(report);
}

const head = ["scenario", "steps", "mounts", "updates", "listCommits", "rowMs", "wallMs", "heapMb"];
const widths = head.map((key) =>
  Math.max(key.length, ...rows.map((row) => String(row[key] ?? "").length)),
);
const line = (cells) => cells.map((cell, index) => String(cell ?? "").padStart(widths[index])).join("  ");

console.log("");
console.log(line(head));
console.log(widths.map((width) => "-".repeat(width)).join("  "));
for (const row of rows) console.log(line(head.map((key) => row[key])));
console.log("");
