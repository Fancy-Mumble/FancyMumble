import { describe, expect, it } from "vitest";
import { buildInviteLink, parseInviteLink, splitAddress } from "./inviteLink";

describe("invite links", () => {
  it("round-trips a code, an address and a name", () => {
    const link = buildInviteLink({
      code: "k3m9x2p7qr4t",
      host: "chat.example.org",
      port: 64738,
      name: "Frog Pond",
    });
    expect(link).toBe("fancy://invite/k3m9x2p7qr4t?server=chat.example.org%3A64738&name=Frog+Pond");
    expect(parseInviteLink(link)).toEqual({
      code: "k3m9x2p7qr4t",
      host: "chat.example.org",
      port: 64738,
      name: "Frog Pond",
    });
  });

  it("prefers the address the operator advertises over the one dialled", () => {
    // Dialled over the LAN; the operator knows the world reaches it elsewhere.
    const link = buildInviteLink({
      code: "abc",
      host: "192.168.1.5",
      port: 64738,
      advertised: "voice.example.org",
    });
    expect(parseInviteLink(link)).toMatchObject({ host: "voice.example.org", port: 64738 });
    const withPort = buildInviteLink({
      code: "abc",
      host: "10.0.0.1",
      port: 1,
      advertised: "voice.example.org:5000",
    });
    expect(parseInviteLink(withPort)).toMatchObject({ host: "voice.example.org", port: 5000 });
  });

  it("keeps an IPv6 address intact", () => {
    const link = buildInviteLink({ code: "abc", host: "2001:db8::1", port: 64738 });
    expect(parseInviteLink(link)).toMatchObject({ host: "2001:db8::1", port: 64738 });
    expect(splitAddress("[2001:db8::1]:7000")).toEqual({ host: "2001:db8::1", port: 7000 });
  });

  it("refuses what is not an invite this client can follow", () => {
    expect(parseInviteLink("https://example.org/invite/abc?server=h:1")).toBeNull();
    expect(parseInviteLink("fancy://meeting/evt-1?t=x")).toBeNull();
    expect(parseInviteLink("fancy://invite/abc")).toBeNull();
    expect(parseInviteLink("fancy://invite/not%20a%20code?server=h:1")).toBeNull();
    expect(parseInviteLink("fancy://invite/abc?server=h:99999")).toBeNull();
    expect(parseInviteLink("not a url")).toBeNull();
  });

  it("falls back to the default port and tolerates a missing name", () => {
    expect(parseInviteLink("fancy://invite/abc?server=chat.example.org")).toEqual({
      code: "abc",
      host: "chat.example.org",
      port: 64738,
      name: "",
    });
  });
});
