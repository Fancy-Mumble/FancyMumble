// Frontend memory analysis over the Chrome DevTools Protocol.
// Reports JS heap usage, DOM node weight (top contributors by attribute
// and text bytes - where data-URLs hide), data-URL totals, and
// localStorage usage.
// Usage: node cdp-memory-analysis.mjs <webSocketDebuggerUrl>
const wsUrl = process.argv[2];
if (!wsUrl) {
  console.error("usage: node cdp-memory-analysis.mjs <webSocketDebuggerUrl>");
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
  }
};

const DOM_ANALYSIS = `(() => {
  const all = document.querySelectorAll("*");
  const rows = [];
  let dataUrlCount = 0, dataUrlBytes = 0, totalAttrBytes = 0, totalTextBytes = 0;
  for (const el of all) {
    let attrBytes = 0;
    for (const a of el.attributes) {
      attrBytes += a.value.length;
      if (a.value.startsWith("data:")) { dataUrlCount++; dataUrlBytes += a.value.length; }
    }
    let textBytes = 0;
    for (const n of el.childNodes) {
      if (n.nodeType === Node.TEXT_NODE) textBytes += n.textContent.length;
    }
    totalAttrBytes += attrBytes;
    totalTextBytes += textBytes;
    const own = attrBytes + textBytes;
    if (own > 20000) {
      const attrHints = [];
      for (const a of el.attributes) {
        if (a.value.length > 20000) attrHints.push(a.name + "=" + a.value.slice(0, 80));
      }
      rows.push({
        tag: el.tagName, id: el.id || undefined,
        cls: (el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || "").toString().slice(0, 60),
        ownKB: Math.round(own / 1024),
        attrHints,
        textHint: textBytes > 20000 ? (el.childNodes[0]?.textContent ?? "").slice(0, 80) : undefined,
      });
    }
  }
  rows.sort((a, b) => b.ownKB - a.ownKB);
  const ls = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    ls[k] = Math.round((localStorage.getItem(k) ?? "").length / 1024);
  }
  const lsTop = Object.entries(ls).sort((a, b) => b[1] - a[1]).slice(0, 12);
  return JSON.stringify({
    route: location.pathname,
    elements: all.length,
    bodyHtmlMB: Math.round(document.body.innerHTML.length / 1024 / 1024 * 10) / 10,
    totalAttrMB: Math.round(totalAttrBytes / 1024 / 1024 * 10) / 10,
    totalTextMB: Math.round(totalTextBytes / 1024 / 1024 * 10) / 10,
    dataUrlCount, dataUrlMB: Math.round(dataUrlBytes / 1024 / 1024 * 10) / 10,
    top: rows.slice(0, 15),
    localStorageTopKB: lsTop,
  }, null, 1);
})()`;

ws.onopen = async () => {
  await send("Runtime.enable");
  await send("Performance.enable");

  const metrics = await send("Performance.getMetrics");
  const interesting = ["Nodes", "JSEventListeners", "Documents", "Frames", "JSHeapUsedSize", "JSHeapTotalSize"];
  console.log("=== Performance metrics ===");
  for (const m of metrics.metrics ?? []) {
    if (interesting.includes(m.name)) {
      const v = m.name.includes("Heap") ? `${Math.round(m.value / 1024 / 1024)} MB` : m.value;
      console.log(`${m.name}: ${v}`);
    }
  }

  const dom = await send("Runtime.evaluate", { expression: DOM_ANALYSIS, returnByValue: true });
  console.log("=== DOM / storage analysis ===");
  console.log(dom.result?.value ?? JSON.stringify(dom));

  ws.close();
  process.exit(0);
};

ws.onerror = (e) => {
  console.error("websocket error", e.message ?? e);
  process.exit(1);
};
