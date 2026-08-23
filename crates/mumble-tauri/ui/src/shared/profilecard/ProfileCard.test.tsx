import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProfileCard } from "./ProfileCard";
import type { ProfileCardModel } from "./model";
import { PROFILE_CARD_TOKENS } from "./tokens";

const MODEL: ProfileCardModel = {
  name: "ZewiWin",
  tintKey: "zewiwin",
  profile: null,
  bio: "<p>one</p><p>two</p><p>three</p>",
  presence: { tone: "online", label: "In Gaming" },
  badges: [],
  shelves: [],
  roles: [],
  stats: [],
};

/**
 * jsdom lays nothing out, so a bio is never taller than its box there. These
 * are the two numbers the card reads to decide it has more text than room.
 */
function stubOverflow(scrollHeight: number, clientHeight: number) {
  for (const [name, value] of Object.entries({ scrollHeight, clientHeight })) {
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get: () => value });
  }
}

function renderCard() {
  return render(<ProfileCard model={MODEL} tokens={PROFILE_CARD_TOKENS.dark} />);
}

afterEach(() => {
  for (const name of ["scrollHeight", "clientHeight"]) {
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, value: 0 });
  }
});

/**
 * The fade itself is a mask, which jsdom does not implement and so cannot be
 * asserted here; what these cover is the height it is cut to and the way back
 * to the rest of the text.
 */
describe("ProfileCard bio", () => {
  it("fades and scrolls a bio with more text than room, and says what it is", () => {
    stubOverflow(900, 208);
    const box = renderCard().container.querySelector(".fpc-scroll") as HTMLElement;
    expect(box.style.maxHeight).toBe("208px");
    expect(box.getAttribute("role")).toBe("region");
    expect(box.getAttribute("aria-label")).toBe("About ZewiWin");
  });

  it("leaves a bio that fits unfaded, and off the way to the composer", () => {
    stubOverflow(120, 208);
    const box = renderCard().container.querySelector(".fpc-scroll") as HTMLElement;
    expect(box.getAttribute("tabindex")).toBeNull();
    expect(box.getAttribute("role")).toBeNull();
  });
});
