/**
 * The first-run wizard on its Appearance step, at whatever width the window is.
 *
 * Only here to look at the theme grid on a phone-width viewport, where the
 * fixed-width tiles used to leave a third of the row empty.
 */
import { createRoot } from "react-dom/client";
import { CssBaseline } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import "@core/i18n";
import "@standard/theme.css";
import "@standard/global.css";
import { createNebulaTheme } from "@nebula/theme";
import { FirstRunSetup } from "@nebula/components/setup/FirstRunSetup";

// Enough of Tauri for the page to render without a host: `get_system_specs`
// and the certificate call both just get nothing back.
(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
  invoke: () => Promise.resolve(null),
  transformCallback: () => 0,
};

const params = new URLSearchParams(location.search);

// `?frame=412` draws the page inside an iframe of that CSS width. Headless Edge
// refuses to give a window a viewport below ~504px, and an iframe is a real
// viewport as far as media queries are concerned - which is the only way to see
// the `xs` half of the layout from here.
const frame = params.get("frame");
if (frame) {
  const inner = new URLSearchParams(params);
  inner.delete("frame");
  const iframe = document.createElement("iframe");
  iframe.src = `${location.pathname}?${inner.toString()}`;
  iframe.width = frame;
  iframe.height = params.get("frameHeight") ?? "915";
  iframe.style.border = "0";
  document.body.replaceChildren(iframe);
}

const scheme = params.get("scheme") === "light" ? "light" : "dark";

if (!frame)
  createRoot(document.getElementById("root")!).render(
  <ThemeProvider theme={createNebulaTheme(scheme)}>
    <CssBaseline />
    <div style={{ height: "100vh" }}>
      <FirstRunSetup onComplete={() => {}} />
    </div>
  </ThemeProvider>,
);

// Walk to the step under `?step=` (1-4, Appearance by default): a screenshot
// cannot type, and the point of the page is holding one step against another.
const step = Number(new URLSearchParams(location.search).get("step") ?? 3);
setTimeout(() => {
  const input = document.querySelector("input") as HTMLInputElement | null;
  if (input) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, "Test");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
  const next = () =>
    [...document.querySelectorAll("button")]
      .find((button) => /next/i.test(button.textContent ?? ""))
      ?.click();
  for (let hop = 1; hop < step; hop += 1) setTimeout(next, hop * 60);
}, 200);

// ?measure=1 writes the geometry of the layout chain into the DOM, so
// `--dump-dom` can say which box is the one that overflows.
if (new URLSearchParams(location.search).has("measure")) {
  setTimeout(() => {
    const grid = document.querySelector('[role="radiogroup"]') as HTMLElement | null;
    const chain: string[] = [`viewport ${window.innerWidth}`];
    for (let node = grid; node; node = node.parentElement) {
      const box = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      chain.push(
        `${node.tagName}.${node.className.toString().slice(0, 24)} w=${box.width.toFixed(1)} ` +
          `x=${box.left.toFixed(1)} scroll=${node.scrollWidth} display=${style.display} ` +
          `cols=${style.gridTemplateColumns.slice(0, 60)} width=${style.width}`,
      );
    }
    const out = document.createElement("pre");
    out.id = "measure";
    out.textContent = chain.join("\n");
    document.body.appendChild(out);
  }, 600);
}
