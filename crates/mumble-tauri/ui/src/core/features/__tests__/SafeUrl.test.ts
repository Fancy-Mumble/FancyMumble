import { describe, expect, it } from "vitest";
import { safeImageUrl, safeLinkUrl } from "../../utils/safeUrl";

describe("safeLinkUrl", () => {
  it("accepts http(s) and mailto", () => {
    expect(safeLinkUrl("https://example.com/x")).toBe("https://example.com/x");
    expect(safeLinkUrl("http://example.com")).toBe("http://example.com");
    expect(safeLinkUrl("mailto:a@b.c")).toBe("mailto:a@b.c");
  });

  it("rejects javascript: and data: schemes", () => {
    expect(safeLinkUrl("javascript:alert(1)")).toBeNull();
    expect(safeLinkUrl("JAVASCRIPT:alert(1)")).toBeNull();
    expect(safeLinkUrl("data:text/html,<script>")).toBeNull();
    expect(safeLinkUrl("vbscript:msgbox")).toBeNull();
  });

  it("rejects scheme obfuscation via embedded control characters", () => {
    expect(safeLinkUrl("java\tscript:alert(1)")).toBeNull();
    expect(safeLinkUrl("java\nscript:alert(1)")).toBeNull();
  });

  it("returns null for empty / nullish input", () => {
    expect(safeLinkUrl(null)).toBeNull();
    expect(safeLinkUrl(undefined)).toBeNull();
    expect(safeLinkUrl("")).toBeNull();
  });
});

describe("safeImageUrl", () => {
  it("accepts http(s), blob and data:image", () => {
    expect(safeImageUrl("https://x/y.png")).toBe("https://x/y.png");
    expect(safeImageUrl("blob:https://x/abc")).toBe("blob:https://x/abc");
    expect(safeImageUrl("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
  });

  it("rejects javascript: and non-image data: URLs", () => {
    expect(safeImageUrl("javascript:alert(1)")).toBeNull();
    expect(safeImageUrl("data:text/html,<script>")).toBeNull();
  });
});
