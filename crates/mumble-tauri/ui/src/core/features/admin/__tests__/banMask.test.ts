import { describe, expect, it } from "vitest";
import type { BanEntry } from "../../../types";
import {
  banCovers,
  banFromWire,
  banToWire,
  maskFromWire,
  maskToWire,
  maxMask,
  plainAddress,
  withAddress,
} from "../banMask";

function ban(overrides: Partial<BanEntry>): BanEntry {
  return { address: "", mask: 128, name: "", hash: "", reason: "", start: "", duration: 0, ...overrides };
}

describe("ban masks between the UI and the wire", () => {
  it("counts one IPv4 address as 128 on the wire and 32 on screen", () => {
    expect(maskToWire("203.0.113.7", 32)).toBe(128);
    expect(maskFromWire("203.0.113.7", 128)).toBe(32);
  });

  it("turns an IPv4 network both ways", () => {
    expect(maskToWire("10.0.0.0", 24)).toBe(120);
    expect(maskFromWire("10.0.0.0", 120)).toBe(24);
    expect(maskToWire("10.0.0.0", 8)).toBe(104);
  });

  it("treats an IPv4 address written in its mapped form as the IPv4 address", () => {
    expect(plainAddress("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(plainAddress("0:0:0:0:0:FFFF:203.0.113.7")).toBe("203.0.113.7");
    expect(maskToWire("::ffff:203.0.113.7", 32)).toBe(128);
    expect(banToWire(ban({ address: "::ffff:203.0.113.7", mask: 32 }))).toMatchObject({
      address: "203.0.113.7",
      mask: 128,
    });
  });

  it("leaves IPv6 masks as they are", () => {
    expect(maskToWire("2001:db8::1", 64)).toBe(64);
    expect(maskFromWire("2001:db8::1", 64)).toBe(64);
    expect(maskToWire("2001:db8::1", 128)).toBe(128);
  });

  it("keeps the edges inside what each kind of address has", () => {
    expect(maskToWire("10.0.0.1", 0)).toBe(96);
    expect(maskToWire("10.0.0.1", 33)).toBe(128);
    expect(maskToWire("10.0.0.1", -4)).toBe(96);
    expect(maskToWire("2001:db8::1", 0)).toBe(0);
    expect(maskToWire("2001:db8::1", 200)).toBe(128);
  });

  it("shows a wire count below the IPv4 prefix as what it does: every IPv4 address", () => {
    // What the old editor sent for "one address": 32 over sixteen bytes.
    expect(maskFromWire("203.0.113.7", 32)).toBe(0);
    expect(maskFromWire("203.0.113.7", 0)).toBe(0);
    expect(maskFromWire("203.0.113.7", 96)).toBe(0);
  });

  it("round-trips a whole entry and keeps everything else", () => {
    const wire = { address: "198.51.100.4", mask: 120, name: "n", hash: "h", reason: "r", start: "s", duration: 9 };
    const shown = banFromWire(wire);
    expect(shown).toEqual({ ...wire, mask: 24 });
    expect(banToWire(shown)).toEqual(wire);
    const v6 = { ...wire, address: "2001:db8:0:0:0:0:0:1", mask: 48 };
    expect(banToWire(banFromWire(v6))).toEqual(v6);
  });

  it("knows how many bits each kind of address has", () => {
    expect(maxMask("10.0.0.1")).toBe(32);
    expect(maxMask("2001:db8::1")).toBe(128);
    expect(maxMask("")).toBe(128);
  });
});

describe("withAddress", () => {
  it("makes a fresh entry cover exactly the address typed into it", () => {
    let entry = ban({ mask: 128 });
    for (const typed of ["1", "10", "10.0.0", "10.0.0.1"]) entry = withAddress(entry, typed);
    expect(entry.mask).toBe(32);
    expect(withAddress(ban({ mask: 128 }), "2001:db8::1").mask).toBe(128);
  });

  it("keeps a network mask that fits the new address", () => {
    expect(withAddress(ban({ address: "10.0.0.0", mask: 24 }), "10.0.1.0").mask).toBe(24);
    expect(withAddress(ban({ address: "2001:db8::", mask: 48 }), "10.0.0.0").mask).toBe(32);
  });
});

describe("banCovers", () => {
  it("matches a network the way the server does", () => {
    expect(banCovers(ban({ address: "10.0.0.0", mask: 24 }), "10.0.0.77")).toBe(true);
    expect(banCovers(ban({ address: "10.0.0.0", mask: 24 }), "10.0.1.77")).toBe(false);
    expect(banCovers(ban({ address: "10.0.0.5", mask: 32 }), "10.0.0.5")).toBe(true);
    expect(banCovers(ban({ address: "10.0.0.5", mask: 32 }), "10.0.0.6")).toBe(false);
    expect(banCovers(ban({ address: "2001:db8::", mask: 32 }), "2001:db8:1::9")).toBe(true);
    expect(banCovers(ban({ address: "2001:db8::", mask: 32 }), "2001:db9::9")).toBe(false);
  });

  it("never lets an IPv4 ban cover an IPv6 address", () => {
    expect(banCovers(ban({ address: "10.0.0.0", mask: 0 }), "2001:db8::1")).toBe(false);
  });
});
