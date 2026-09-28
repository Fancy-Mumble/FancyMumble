import { describe as suite, expect, it } from "vitest";
import { SNAP, portAt } from "./NodeCanvas";

/**
 * Where a wire lands when it is released near a socket rather than on one.
 *
 * The complaint this answers: a socket is a nine-pixel dot, and dropping a
 * wire used to mean hitting it. The editor knows what is being reached for
 * long before the pointer is on top of it, so it should say so.
 */

/** A socket of the usual size, centred where the test puts it. */
function socket(x: number, y: number) {
  return {
    getBoundingClientRect: () => ({
      left: x - 4.5,
      right: x + 4.5,
      top: y - 4.5,
      bottom: y + 4.5,
    }),
  } as unknown as HTMLElement;
}

const ports = new Map<string, HTMLElement>([
  ["a|in|when", socket(100, 100)],
  ["a|in|plus", socket(100, 130)],
  ["b|out|out", socket(400, 100)],
]);

suite("dropping a wire near a socket", () => {
  it("lands on the socket the pointer is actually on", () => {
    expect(portAt(ports, 100, 100, SNAP)).toEqual({ node: "a", side: "in", port: "when" });
  });

  it("lands on it from a short distance away, which is the whole point", () => {
    // Twelve pixels clear of the dot: a miss, before this, and a release that
    // silently did nothing.
    expect(portAt(ports, 112, 100, SNAP)?.port).toBe("when");
  });

  it("still misses when the pointer is nowhere near", () => {
    // The other half of it: snapping that reached across the canvas would
    // connect things nobody was pointing at.
    expect(portAt(ports, 160, 100, SNAP)).toBeNull();
  });

  it("takes the nearest socket, not whichever came first", () => {
    // Two sockets 30px apart are both within reach from between them, and
    // landing on the wrong one is worse than landing on none: it is a wire
    // the operator has to notice and undo.
    expect(portAt(ports, 100, 122, SNAP)?.port).toBe("plus");
    expect(portAt(ports, 100, 108, SNAP)?.port).toBe("when");
  });

  it("considers only the sockets the caller will accept", () => {
    // While a wire is in the air that means the ones it may legally land on,
    // so it can never be pulled towards a port that would refuse it.
    const inputsOnly = portAt(ports, 400, 100, SNAP, (at) => at.side === "in");
    expect(inputsOnly).toBeNull();
    expect(portAt(ports, 400, 100, SNAP, (at) => at.side === "out")?.node).toBe("b");
  });

  it("measures from the socket's edge, so every direction costs the same", () => {
    const right = portAt(ports, 100 + 4.5 + 17, 100, SNAP);
    const below = portAt(ports, 100, 100 + 4.5 + 17, SNAP);
    expect(right?.port).toBe("when");
    expect(below?.port).toBe("plus");
  });
});
