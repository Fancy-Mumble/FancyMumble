/**
 * Tests for the Pandoc-style YAML metadata block that surfaces the
 * header/footer/page-number settings in the Markdown view.
 */

import { describe, expect, it } from "vitest";
import { serializeFrontMatter, parseFrontMatter } from "../chat/livedoc/liveDocFrontMatter";
import {
  DEFAULT_DECORATION,
  DEFAULT_HEADER_FOOTER,
  DEFAULT_PAGE_SETUP,
} from "../chat/livedoc/useLiveDoc";

describe("serializeFrontMatter", () => {
  it("emits nothing when every zone is disabled", () => {
    expect(serializeFrontMatter(DEFAULT_HEADER_FOOTER)).toBe("");
  });

  it("emits only the enabled, independent zones", () => {
    const block = serializeFrontMatter({
      ...DEFAULT_HEADER_FOOTER,
      headerEnabled: true,
      header: "Quarterly report",
      showPageNumber: true,
      pageNumberStyle: "page-of",
    });
    expect(block).toBe('---\nheader: "Quarterly report"\npage-numbers: page-of\n---\n\n');
    expect(block).not.toContain("footer");
  });

  it("includes a non-blank band style", () => {
    const block = serializeFrontMatter({
      ...DEFAULT_HEADER_FOOTER,
      footerEnabled: true,
      footer: "Confidential",
      footerStyle: "banded",
    });
    expect(block).toContain('footer: "Confidential"');
    expect(block).toContain("footer-style: banded");
  });
});

describe("parseFrontMatter", () => {
  it("returns a null patch and the original text when there is no block", () => {
    const { patch, body } = parseFrontMatter("# Title\n\nBody");
    expect(patch).toBeNull();
    expect(body).toBe("# Title\n\nBody");
  });

  it("leaves a stray --- block alone when it carries no known keys", () => {
    // A document that merely starts with a horizontal rule and has another one
    // later must NOT be mistaken for front matter (which would eat the span,
    // including any page break inside it).
    const text = '---\n\nIntro\n\n<div data-page-break=""></div>\n\n---\n\nMore';
    const { patch, body } = parseFrontMatter(text);
    expect(patch).toBeNull();
    expect(body).toBe(text);
    expect(body).toContain("data-page-break");
  });

  it("strips the block and turns present keys into enabled zones", () => {
    const { patch, body } = parseFrontMatter(
      '---\nheader: "Top"\npage-numbers: roman\n---\n\n# Title\n',
    );
    expect(body).toBe("# Title\n");
    expect(patch).toEqual({
      headerEnabled: true,
      footerEnabled: false,
      showPageNumber: true,
      header: "Top",
      pageNumberStyle: "roman",
    });
  });

  it("treats a missing key as that zone being off", () => {
    const { patch } = parseFrontMatter('---\nfooter: "Only footer"\n---\nbody');
    expect(patch?.headerEnabled).toBe(false);
    expect(patch?.footerEnabled).toBe(true);
    expect(patch?.footer).toBe("Only footer");
    expect(patch?.showPageNumber).toBe(false);
  });

  it("round-trips through serialize -> parse", () => {
    const hf = {
      ...DEFAULT_HEADER_FOOTER,
      headerEnabled: true,
      header: 'He said "hi": ok',
      footerEnabled: true,
      footer: "Confidential",
      footerStyle: "austin" as const,
      showPageNumber: true,
      pageNumberStyle: "slash" as const,
    };
    const { patch, body } = parseFrontMatter(serializeFrontMatter(hf) + "Body");
    expect(body).toBe("Body");
    expect(patch).toMatchObject({
      headerEnabled: true,
      header: 'He said "hi": ok',
      footerEnabled: true,
      footer: "Confidential",
      footerStyle: "austin",
      showPageNumber: true,
      pageNumberStyle: "slash",
    });
  });
});

describe("front matter layout block", () => {
  it("emits page geometry when a layout is supplied", () => {
    const block = serializeFrontMatter(DEFAULT_HEADER_FOOTER, {
      pageSetup: DEFAULT_PAGE_SETUP,
      decoration: DEFAULT_DECORATION,
    });
    expect(block).toBe("---\npage-size: a4\norientation: portrait\nmargin: normal\ncolumns: 1\n---\n\n");
  });

  it("emits columns, border and watermark when set", () => {
    const block = serializeFrontMatter(DEFAULT_HEADER_FOOTER, {
      pageSetup: { ...DEFAULT_PAGE_SETUP, size: "letter", orientation: "landscape", columns: 2 },
      decoration: { border: "thin", watermark: "DRAFT" },
    });
    expect(block).toContain("page-size: letter");
    expect(block).toContain("orientation: landscape");
    expect(block).toContain("columns: 2");
    expect(block).toContain("border: thin");
    expect(block).toContain('watermark: "DRAFT"');
  });

  it("parses geometry + decoration into separate patches and disables furniture", () => {
    const { patch, pageSetup, decoration, body } = parseFrontMatter(
      "---\npage-size: letter\norientation: landscape\nmargin: wide\ncolumns: 3\nborder: medium\nwatermark: \"DRAFT\"\n---\n\n# Title\n",
    );
    expect(body).toBe("# Title\n");
    expect(pageSetup).toEqual({
      size: "letter",
      orientation: "landscape",
      margin: "wide",
      columns: 3,
    });
    expect(decoration).toEqual({ border: "medium", watermark: "DRAFT" });
    // A layout-only block leaves the header/footer zones off.
    expect(patch).toMatchObject({ headerEnabled: false, footerEnabled: false, showPageNumber: false });
  });

  it("ignores unknown enum values", () => {
    const { pageSetup, decoration } = parseFrontMatter(
      "---\npage-size: tabloid\ncolumns: 9\nborder: dotted\n---\nbody",
    );
    // page-size/columns/border were all invalid -> no geometry/decoration patch.
    expect(pageSetup).toBeNull();
    expect(decoration).toBeNull();
  });

  it("round-trips the full layout through serialize -> parse", () => {
    const pageSetup = {
      ...DEFAULT_PAGE_SETUP,
      size: "legal" as const,
      orientation: "landscape" as const,
      margin: "narrow" as const,
      marginX: 40,
      marginY: 60,
      columns: 2 as const,
    };
    const deco = { border: "thin" as const, watermark: "Internal" };
    const block = serializeFrontMatter(DEFAULT_HEADER_FOOTER, { pageSetup, decoration: deco });
    const parsed = parseFrontMatter(block + "Body");
    expect(parsed.body).toBe("Body");
    expect(parsed.pageSetup).toEqual({
      size: "legal",
      orientation: "landscape",
      margin: "narrow",
      marginX: 40,
      marginY: 60,
      columns: 2,
    });
    expect(parsed.decoration).toEqual({ border: "thin", watermark: "Internal" });
  });
});
