// Inspect a WebView2 page over the Chrome DevTools Protocol: dump
// console messages, uncaught exceptions, and basic DOM state.
// Usage: node cdp-inspect.mjs <webSocketDebuggerUrl>
const wsUrl = process.argv[2];
if (!wsUrl) {
  console.error("usage: node cdp-inspect.mjs <webSocketDebuggerUrl>");
  process.exit(1);
}

const ws = new WebSocket(wsUrl);
let nextId = 1;
const pending = new Map();

function send(method, params = {}) {
  return new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg.result ?? msg.error);
    pending.delete(msg.id);
    return;
  }
  if (msg.method === "Runtime.consoleAPICalled") {
    const args = (msg.params.args ?? [])
      .map((a) => a.value ?? a.description ?? JSON.stringify(a.preview ?? a))
      .join(" ");
    console.log(`[console.${msg.params.type}] ${args}`);
  } else if (msg.method === "Runtime.exceptionThrown") {
    const d = msg.params.exceptionDetails;
    const desc = d.exception?.description ?? d.text;
    console.log(`[exception] ${desc} (at ${d.url ?? "?"}:${d.lineNumber})`);
  } else if (msg.method === "Log.entryAdded") {
    const e = msg.params.entry;
    console.log(`[log.${e.level}/${e.source}] ${e.text} (${e.url ?? ""})`);
  }
};

ws.onopen = async () => {
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Network.enable");

  // Reload so we capture errors from a fresh page load (skip with
  // a second "noreload" argument to inspect the current state).
  if (process.argv[3] === "noreload") {
    await new Promise((r) => setTimeout(r, 1000));
  } else {
    await send("Page.enable");
    await send("Page.reload", { ignoreCache: true });
    await new Promise((r) => setTimeout(r, 6000));
  }

  const dom = await send("Runtime.evaluate", {
    expression: `JSON.stringify({
      readyState: document.readyState,
      title: document.title,
      bodyChildren: document.body ? document.body.children.length : -1,
      rootHtmlLength: (document.getElementById("root")?.innerHTML ?? "").length,
      scripts: Array.from(document.scripts).map(s => s.src || "inline"),
    })`,
    returnByValue: true,
  });
  console.log("[dom]", dom.result?.value ?? JSON.stringify(dom));
  ws.close();
  process.exit(0);
};

ws.onerror = (e) => {
  console.error("websocket error", e.message ?? e);
  process.exit(1);
};
