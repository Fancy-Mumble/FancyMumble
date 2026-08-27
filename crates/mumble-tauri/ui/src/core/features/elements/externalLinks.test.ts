import { describe, expect, it } from "vitest";
import { describeLink, isTrustedLink, withTrustedHost } from "./externalLinks";

describe("describeLink", () => {
  it("splits the host from the rest so a warning can weight them apart", () => {
    expect(describeLink("https://intfeet.com/customize?a=1#top")).toEqual({
      host: "intfeet.com",
      rest: "/customize?a=1#top",
      scheme: "HTTPS",
    });
  });

  it("badges a plain http link as such rather than implying transport security", () => {
    expect(describeLink("http://example.org/").scheme).toBe("HTTP");
  });

  it("keeps the port, since a different port is a different service", () => {
    expect(describeLink("https://example.org:8443/x").host).toBe("example.org:8443");
  });

  it("names an internationalised host in punycode", () => {
    // The pretty rendering of this is indistinguishable from "apple.com", which
    // is the entire point of registering it.
    expect(describeLink("https://аpple.com/id").host).toBe("xn--pple-43d.com");
  });

  it("refuses to name a host for a scheme that must never be trusted", () => {
    for (const url of ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,<b>x"]) {
      expect(describeLink(url).host).toBe("");
    }
  });

  it("falls back to the raw string when the URL does not parse", () => {
    expect(describeLink("not a url")).toEqual({ host: "", rest: "not a url", scheme: null });
  });
});

describe("isTrustedLink", () => {
  const hosts = ["example.com"];

  it("passes a host the user vouched for", () => {
    expect(isTrustedLink("https://example.com/anything", hosts)).toBe(true);
  });

  it("does not treat a lookalike registration as the trusted host", () => {
    expect(isTrustedLink("https://evil-example.com/", hosts)).toBe(false);
    expect(isTrustedLink("https://example.com.evil.tld/", hosts)).toBe(false);
  });

  it("does not let a subdomain inherit the parent's trust", () => {
    expect(isTrustedLink("https://login.example.com/", hosts)).toBe(false);
  });

  it("never trusts a scheme that has no host to key on", () => {
    expect(isTrustedLink("javascript:alert(1)", ["", "example.com"])).toBe(false);
  });
});

describe("withTrustedHost", () => {
  it("adds the host", () => {
    expect(withTrustedHost([], "https://example.com/x")).toEqual(["example.com"]);
  });

  it("does not add a second copy", () => {
    expect(withTrustedHost(["example.com"], "https://example.com/y")).toEqual(["example.com"]);
  });

  it("adds nothing for a URL there is no host to trust in", () => {
    expect(withTrustedHost(["example.com"], "javascript:alert(1)")).toEqual(["example.com"]);
  });
});
