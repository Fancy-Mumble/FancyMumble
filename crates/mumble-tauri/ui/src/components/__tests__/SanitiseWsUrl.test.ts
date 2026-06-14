import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { sanitiseWsUrl } from "../chat/livedoc/sanitiseWsUrl";

describe("sanitiseWsUrl", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rewrites 0.0.0.0 to the fallback host and preserves port/path/query", () => {
    const out = sanitiseWsUrl(
      "ws://0.0.0.0:64740/ws/0/59/untitled-document?token=abc",
      "mumble.example.com",
    );
    expect(out).toBe(
      "ws://mumble.example.com:64740/ws/0/59/untitled-document?token=abc",
    );
  });

  it("rewrites IPv6 unspecified [::] to the fallback host", () => {
    const out = sanitiseWsUrl(
      "ws://[::]:64740/ws/0/59/doc",
      "mumble.example.com",
    );
    expect(out).toBe("ws://mumble.example.com:64740/ws/0/59/doc");
  });

  it("leaves a routable host untouched", () => {
    const url = "ws://chat.example.com:64740/ws/0/1/doc?token=x";
    expect(sanitiseWsUrl(url, "fallback.example.com")).toBe(url);
  });

  it("leaves the URL untouched when fallback host is null", () => {
    const url = "ws://0.0.0.0:64740/ws/0/1/doc";
    expect(sanitiseWsUrl(url, null)).toBe(url);
  });

  it("leaves the URL untouched when fallback host is empty", () => {
    const url = "ws://0.0.0.0:64740/ws/0/1/doc";
    expect(sanitiseWsUrl(url, "")).toBe(url);
  });

  it("returns the input unchanged when the URL is malformed", () => {
    expect(sanitiseWsUrl("not a url", "mumble.example.com")).toBe("not a url");
  });

  it("returns the input unchanged when input is empty", () => {
    expect(sanitiseWsUrl("", "mumble.example.com")).toBe("");
  });

  it("logs a warning when it rewrites a bind-all host", () => {
    const warn = vi.spyOn(console, "warn");
    sanitiseWsUrl("ws://0.0.0.0:64740/ws", "host.example.com");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0].join(" ")).toContain("0.0.0.0");
  });

  it("does not warn when no rewrite happens", () => {
    const warn = vi.spyOn(console, "warn");
    sanitiseWsUrl("ws://chat.example.com:64740/ws", "host.example.com");
    expect(warn).not.toHaveBeenCalled();
  });

  it("supports wss URLs", () => {
    const out = sanitiseWsUrl(
      "wss://0.0.0.0:443/ws/0/1/doc",
      "secure.example.com",
    );
    expect(out).toBe("wss://secure.example.com/ws/0/1/doc");
  });
});
