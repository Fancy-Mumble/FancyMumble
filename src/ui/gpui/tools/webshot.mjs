// Photograph a page of the web UI the way this view is measured against it,
// over the Chrome DevTools protocol, with nothing but Node (22 or later: its
// own `fetch` and `WebSocket`).
//
//   node tools/webshot.mjs --url <url> --out shot.png
//        [--width 1410] [--height 758] [--budget 9000]
//        [--click <css selector>] [--after 3000]
//        [--dump boxes.txt] [--timeout 90000] [--chrome <path>]
//
// Why not `chrome --headless --screenshot --window-size=W,H`: that runs the
// page in a viewport about 94 pixels shorter than the window and only grows
// it to the asked size when it takes the picture. Whatever CSS lays out
// follows; whatever a script placed (a menu, a popover, a tooltip, a sheet)
// stays where it was put, and was photographed about 94 pixels off. Here the
// page has the asked size from before it loads.
//
// What it does, in order:
//   1. starts headless Chrome on a fresh profile, with a DevTools port;
//   2. sets the device metrics (width, height, scale 1) on a blank page;
//   3. navigates, and runs the page on virtual time for `--budget` ms (as
//      the old command's `--virtual-time-budget` did), pausing it while a
//      request is pending, then waits for the fonts;
//   4. with `--click`, presses what the selector finds (pointer and mouse
//      down and up, and a click) and runs `--after` ms more;
//   5. writes the picture; with `--dump`, every box on the page, one line
//      each: tag, `[x,y wxh]`, and for text its words, size, line height,
//      weight, spacing, colour and family, and its fill, edges and corners;
//   6. stops the Chrome it started, by its process id, whatever happened.
// It gives up, and stops Chrome, after `--timeout` ms.

import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, at, all) => {
    if (arg.startsWith("--")) pairs.push([arg.slice(2), all[at + 1]?.startsWith("--") ? "" : all[at + 1] ?? ""]);
    return pairs;
  }, []),
);
const need = (key) => {
  if (!args[key]) {
    console.error(`webshot: --${key} is needed`);
    process.exit(2);
  }
  return args[key];
};
const url = need("url");
const out = need("out");
const width = Number(args.width ?? 1410);
const height = Number(args.height ?? 758);
const budget = Number(args.budget ?? 9000);
const after = Number(args.after ?? 3000);
const timeout = Number(args.timeout ?? 90000);
const chrome =
  args.chrome ||
  process.env.CHROME ||
  (process.platform === "win32"
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : "google-chrome");

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "webshot-"));
const browser = spawn(
  chrome,
  [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--use-angle=swiftshader",
    "--enable-gpu-rasterization",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    `--window-size=${width},${height}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

/** Stop the Chrome this started, and everything it started, by its id. */
function stop() {
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/PID", String(browser.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      process.kill(-browser.pid, "SIGKILL");
    }
  } catch {
    try {
      browser.kill("SIGKILL");
    } catch {
      // Gone already.
    }
  }
  try {
    fs.rmSync(profile, { recursive: true, force: true });
  } catch {
    // Chrome may hold a file a moment longer; the temp folder is the
    // system's to clear.
  }
}

const giveUp = setTimeout(() => {
  console.error(`webshot: gave up after ${timeout} ms`);
  stop();
  process.exit(3);
}, timeout);

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** The DevTools port Chrome chose, once it has written it down. */
async function devtoolsPort() {
  const file = path.join(profile, "DevToolsActivePort");
  for (let tries = 0; tries < 200; tries++) {
    try {
      // Read while Chrome may still be writing it: on Windows that is
      // refused (EBUSY) until it is done, and is asked again.
      const [port] = fs.readFileSync(file, "utf8").split("\n");
      if (port) return Number(port);
    } catch {
      // Not there yet, or not finished.
    }
    await sleep(50);
  }
  throw new Error("Chrome never opened its DevTools port");
}

/** A connection to the blank page, and a way to ask it things. */
async function connect(port) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = targets.find((target) => target.type === "page");
  if (!page) throw new Error("no page to drive");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((open, fail) => {
    ws.onopen = open;
    ws.onerror = fail;
  });
  let next = 0;
  const pending = new Map();
  const listeners = new Map();
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { done, fail } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) fail(new Error(`${message.error.message}`));
      else done(message.result);
    } else if (message.method) {
      for (const listener of listeners.get(message.method) ?? []) listener(message.params);
    }
  };
  const send = (method, params = {}) =>
    new Promise((done, fail) => {
      const id = ++next;
      pending.set(id, { done, fail });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const once = (method) =>
    new Promise((done) => {
      const listener = (params) => {
        listeners.set(method, (listeners.get(method) ?? []).filter((l) => l !== listener));
        done(params);
      };
      listeners.set(method, [...(listeners.get(method) ?? []), listener]);
    });
  // The requests still out, by id, to say which held things up.
  const out = new Map();
  const listen = (method, listener) => listeners.set(method, [...(listeners.get(method) ?? []), listener]);
  listen("Network.requestWillBeSent", ({ requestId, request }) => out.set(requestId, request.url));
  listen("Network.loadingFinished", ({ requestId }) => out.delete(requestId));
  listen("Network.loadingFailed", ({ requestId }) => out.delete(requestId));
  return { ws, send, once, out };
}

/** Run the page on virtual time for `ms`, paused while a request is out.
 *  A request that never ends would hold it for ever: past three times the
 *  budget in real time (and at least ten seconds), the clock is let run
 *  regardless, and what was still out is said. */
async function run(cdp, ms) {
  const expired = cdp.once("Emulation.virtualTimeBudgetExpired");
  await cdp.send("Emulation.setVirtualTimePolicy", {
    policy: "pauseIfNetworkFetchesPending",
    budget: ms,
  });
  const cap = Math.max(10000, ms * 3);
  const finished = await Promise.race([expired.then(() => true), sleep(cap).then(() => false)]);
  if (!finished) {
    console.error(`webshot: still waiting on ${[...cdp.out.values()].join(", ") || "something"}; going on`);
    await cdp.send("Emulation.setVirtualTimePolicy", { policy: "advance" });
    await sleep(ms);
  }
}

/** The page's fonts, once they are in, or after five seconds regardless. */
async function fonts(cdp) {
  await Promise.race([evaluate(cdp, "document.fonts.ready.then(() => true)"), sleep(5000)]);
}

/** What the page says `expression` comes to, promises awaited. */
async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

// Every box on the page, one line each; the format the crate's measuring
// notes read (`[x,y wxh]`, then what is drawn there).
const DUMP = `(() => {
  const out = [];
  const walk = (el, depth) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) { for (const child of el.children) walk(child, depth + 1); return; }
    const c = getComputedStyle(el);
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(" ").slice(0, 40);
    const bits = ["  ".repeat(depth) + el.tagName.toLowerCase(), "[" + r.x.toFixed(1) + "," + r.y.toFixed(1) + " " + r.width.toFixed(1) + "x" + r.height.toFixed(1) + "]"];
    const id = el.getAttribute("data-testid");
    if (id) bits.push("#" + id);
    if (own) bits.push(JSON.stringify(own) + " " + c.fontSize + "/" + c.lineHeight + " w" + c.fontWeight + " ls" + c.letterSpacing + " " + c.color + " ff " + c.fontFamily.slice(0, 40));
    if (c.backgroundColor !== "rgba(0, 0, 0, 0)") bits.push("bg " + c.backgroundColor);
    if (c.backgroundImage !== "none") bits.push("bgi " + c.backgroundImage.slice(0, 160));
    if (c.borderTopWidth !== "0px") bits.push("bt " + c.borderTopWidth + " " + c.borderTopStyle + " " + c.borderTopColor);
    if (c.borderBottomWidth !== "0px") bits.push("bb " + c.borderBottomWidth + " " + c.borderBottomColor);
    if (c.borderTopLeftRadius !== "0px") bits.push("rad " + c.borderTopLeftRadius);
    if (c.boxShadow !== "none") bits.push("sh " + c.boxShadow);
    if (c.opacity !== "1") bits.push("op " + c.opacity);
    if (el.tagName === "svg") { bits.push("svg " + (el.getAttribute("class") ?? "") + " sw" + c.strokeWidth + " " + c.color); out.push(bits.join(" ")); return; }
    out.push(bits.join(" "));
    for (const child of el.children) walk(child, depth + 1);
  };
  walk(document.body, 0);
  return out.join("\\n");
})()`;

try {
  const cdp = await connect(await devtoolsPort());
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Network.enable");
  // The size before anything is laid out at all.
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  // Virtual time from the first instant, so the page's own timers (a
  // preview's `?click=`, its `&dump`) fall inside the budget as before.
  await cdp.send("Emulation.setVirtualTimePolicy", { policy: "pause" });
  const loaded = cdp.once("Page.loadEventFired");
  await cdp.send("Page.navigate", { url });
  const ran = run(cdp, budget);
  await loaded;
  await ran;
  await fonts(cdp);
  if (args.click) {
    const pressed = await evaluate(
      cdp,
      `(() => {
        const target = document.querySelector(${JSON.stringify(args.click)});
        if (!target) return false;
        for (const kind of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"])
          target.dispatchEvent(new MouseEvent(kind, { bubbles: true, cancelable: true, view: window }));
        return true;
      })()`,
    );
    if (!pressed) throw new Error(`nothing matches ${args.click}`);
    await run(cdp, after);
    await fonts(cdp);
  }
  const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(out, Buffer.from(shot.data, "base64"));
  if (args.dump) fs.writeFileSync(args.dump, await evaluate(cdp, DUMP));
  cdp.ws.close();
  console.log(`${url} -> ${out} (${width}x${height})`);
} catch (error) {
  console.error(`webshot: ${error.message}`);
  process.exitCode = 1;
} finally {
  clearTimeout(giveUp);
  stop();
}
