/**
 * Unit tests for the Live Doc header/footer meta (roadmap item 4).
 *
 * The interim single-zone header/footer state lives in the shared Yjs
 * `meta` map.  These tests drive a real `Y.Doc` through the read/write
 * helpers and assert the values round-trip + clamp as expected.
 */
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  DEFAULT_HEADER_FOOTER,
  setLiveDocHeaderFooter,
} from "../chat/livedoc/useLiveDoc";

function readMeta(doc: Y.Doc) {
  const meta = doc.getMap("meta");
  return {
    enabled: meta.get("headerFooterEnabled"),
    header: meta.get("headerText"),
    footer: meta.get("footerText"),
    showPageNumber: meta.get("showPageNumber"),
  };
}

describe("liveDoc header/footer meta", () => {
  it("exposes disabled empty defaults", () => {
    expect(DEFAULT_HEADER_FOOTER).toEqual({
      enabled: false,
      header: "",
      footer: "",
      showPageNumber: false,
    });
  });

  it("writes a full patch to the shared meta map", () => {
    const doc = new Y.Doc();
    setLiveDocHeaderFooter(doc, {
      enabled: true,
      header: "My report",
      footer: "Confidential",
      showPageNumber: true,
    });
    expect(readMeta(doc)).toEqual({
      enabled: true,
      header: "My report",
      footer: "Confidential",
      showPageNumber: true,
    });
  });

  it("patches only the provided keys", () => {
    const doc = new Y.Doc();
    setLiveDocHeaderFooter(doc, { enabled: true, header: "First" });
    setLiveDocHeaderFooter(doc, { footer: "Bottom" });
    const meta = readMeta(doc);
    expect(meta.enabled).toBe(true);
    expect(meta.header).toBe("First");
    expect(meta.footer).toBe("Bottom");
  });

  it("clamps header and footer to 200 characters", () => {
    const doc = new Y.Doc();
    const long = "x".repeat(500);
    setLiveDocHeaderFooter(doc, { header: long, footer: long });
    const meta = readMeta(doc);
    expect((meta.header as string).length).toBe(200);
    expect((meta.footer as string).length).toBe(200);
  });

  it("propagates changes to an observer", () => {
    const doc = new Y.Doc();
    const seen: unknown[] = [];
    doc.getMap("meta").observe(() => seen.push(doc.getMap("meta").get("headerText")));
    setLiveDocHeaderFooter(doc, { header: "Live" });
    expect(seen).toContain("Live");
  });
});
