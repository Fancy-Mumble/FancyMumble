import { describe, it, expect } from "vitest";
import {
  isLocalMediaSrc,
  isMediaBase,
  neutraliseRemoteMedia,
  styleValueFetches,
  trustMediaBase,
} from "../remoteMedia";

const PNG = "data:image/png;base64,iVBORw0KGgo=";

/** Run the pass over `html` and hand back the body it left. */
function neutralised(html: string): HTMLElement {
  const doc = new DOMParser().parseFromString(html, "text/html");
  neutraliseRemoteMedia(doc.body);
  return doc.body;
}

describe("isLocalMediaSrc", () => {
  it("accepts media the message carries inline", () => {
    expect(isLocalMediaSrc(PNG)).toBe(true);
    expect(isLocalMediaSrc("data:video/mp4;base64,AAAA")).toBe(true);
    expect(isLocalMediaSrc("blob:https://tauri.localhost/1234")).toBe(true);
  });

  it("accepts a path on the app's own origin", () => {
    // Relative addresses resolve to the bundled assets, never the network.
    expect(isLocalMediaSrc("p.png")).toBe(true);
    expect(isLocalMediaSrc("/assets/p.png")).toBe(true);
  });

  it("refuses anything that has to be fetched", () => {
    for (const src of [
      "https://t.example/p.png",
      "http://127.0.0.1:9/p.png",
      "//t.example/p.png",
      "\\\\t.example\\p.png",
      "file:///C:/x.png",
      "data:text/html,x",
      "javascript:alert(1)",
    ]) {
      expect(isLocalMediaSrc(src), src).toBe(false);
    }
  });
});

describe("neutraliseRemoteMedia", () => {
  it("turns a remote picture into a guarded link to it", () => {
    const body = neutralised('<p>hi <img src="https://t.example/p.png" alt="pixel"></p>');

    expect(body.querySelector("img")).toBeNull();
    const link = body.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://t.example/p.png");
    expect(link?.dataset["external"]).toBe("true");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link?.getAttribute("title")).toBe("pixel");
    expect(link?.textContent).toBe("https://t.example/p.png");
  });

  it("leaves an inline picture alone", () => {
    const body = neutralised(`<img src="${PNG}" alt="shot">`);

    expect(body.querySelector("img")?.getAttribute("src")).toBe(PNG);
  });

  it("drops a remote picture that no link could follow", () => {
    const body = neutralised('<img src="//t.example/p.png"><img src="file:///C:/x.png"><p>text</p>');

    expect(body.innerHTML).toBe("<p>text</p>");
  });

  it("strips the attributes that fetch without being a source", () => {
    const body = neutralised(
      `<img src="${PNG}" srcset="https://t.example/2x.png 2x"><table background="https://t.example/bg.png"><tbody><tr><td>x</td></tr></tbody></table>` +
        `<video src="data:video/mp4;base64,AAAA" poster="https://t.example/poster.png"></video>`,
    );

    expect(body.innerHTML).not.toContain("t.example");
  });

  it("links a remote clip and drops remote sources", () => {
    const body = neutralised(
      '<video src="https://t.example/clip.mp4"></video><audio controls><source src="https://t.example/a.ogg"></audio>',
    );

    expect(body.querySelector("video")).toBeNull();
    expect(body.querySelector("source")).toBeNull();
    expect(body.querySelector("a")?.getAttribute("href")).toBe("https://t.example/clip.mp4");
  });

  it("drops every style declaration that could fetch, and keeps the rest", () => {
    const body = neutralised(
      '<span style="color: red; background: url(https://t.example/a.png)">a</span>' +
        '<span style="background-image: \\75rl(https://t.example/b.png)">b</span>' +
        '<span style="background-image: image-set(&quot;https://t.example/c.png&quot; 1x)">c</span>',
    );

    expect(body.innerHTML).not.toContain("t.example");
    expect(body.querySelector("span")?.getAttribute("style")).toBe("color: red");
    expect(body.querySelectorAll("[style]")).toHaveLength(1);
  });
});

describe("styleValueFetches", () => {
  it("catches the ways a value can fetch", () => {
    expect(styleValueFetches("url(x)")).toBe(true);
    expect(styleValueFetches("URL (x)")).toBe(true);
    expect(styleValueFetches('image-set("x" 1x)')).toBe(true);
    expect(styleValueFetches("\\75rl(x)")).toBe(true);
  });

  it("lets ordinary values through", () => {
    expect(styleValueFetches("red")).toBe(false);
    expect(styleValueFetches("1px solid #333")).toBe(false);
  });
});

describe("a server's GIF proxy", () => {
  it("accepts only a base shaped like one", () => {
    expect(isMediaBase("https://chat.example.org/gif?")).toBe(true);
    expect(isMediaBase("http://127.0.0.1:8090/gif?")).toBe(true);
    for (const base of [
      "https://",
      "https://?",
      "https://chat.example.org/gif",
      "https://chat.example.org/gif?u=",
      "javascript:alert(1)?",
      "https://a@chat.example.org/gif?",
    ]) {
      expect(isMediaBase(base), base).toBe(false);
    }
  });

  it("lets pictures under a trusted base render, and nothing beside it", () => {
    trustMediaBase("https://proxy.example.net/gif?");
    const doc = new DOMParser().parseFromString(
      '<img src="https://proxy.example.net/gif?u=a&amp;sig=b"><img src="https://proxy.example.net/other.png">',
      "text/html",
    );
    neutraliseRemoteMedia(doc.body);

    expect(doc.body.querySelectorAll("img")).toHaveLength(1);
    expect(doc.body.querySelector("a")?.getAttribute("href")).toBe("https://proxy.example.net/other.png");
    expect(isLocalMediaSrc("https://proxy.example.net.evil.com/gif?u=a")).toBe(false);
  });
});
