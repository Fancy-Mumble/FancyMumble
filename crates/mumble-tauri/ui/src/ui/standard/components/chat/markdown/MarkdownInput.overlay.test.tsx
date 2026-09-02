/**
 * What the editor *draws* over the textarea.
 *
 * The textarea holds the draft verbatim and is transparent; everything the
 * author sees is the overlay rendered beside it. So "is a mention drawn as a
 * chip" is a question about this component rather than about either pack's
 * composer, and both packs mount the same one.
 */
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import MarkdownInput from "./MarkdownInput";

const NAMES = new Map([[7, "Lorelando"]]);

function draw(value: string) {
  const { container } = render(
    <MarkdownInput
      value={value}
      onChange={() => {}}
      onSubmit={() => {}}
      ariaLabel="Message"
      mentionResolver={(session) => NAMES.get(session)}
    />,
  );
  const field = container.querySelector("textarea")!;
  // The assertions are about the overlay alone: the textarea is a sibling of
  // it holding the raw draft, so reading the whole container would find every
  // marker whether it was drawn as one or not.
  const overlay = container.querySelector<HTMLElement>('[class*="overlay"]')!;
  return { overlay, field };
}

describe("MarkdownInput mention chips", () => {
  it("draws a role mention as a chip rather than as its marker", () => {
    // The author picked "admin" off the autocomplete; `<@&admin>` is the wire
    // marker, and showing it is the machine syntax leaking into the window.
    const { overlay } = draw("<@&admin> please look");

    expect(overlay.textContent).toContain("@admin");
    expect(overlay.textContent).not.toContain("<@&admin>");
  });

  it("leaves the draft itself untouched", () => {
    // The chip is a way of drawing the draft, not a rewrite of it: the
    // textarea is what gets sent, and it still holds the marker.
    const { field } = draw("<@&admin> please look");
    expect(field.value).toBe("<@&admin> please look");
  });

  it("still draws a user mention through the resolver", () => {
    const { overlay } = draw("morning <@7>");
    expect(overlay.textContent).toContain("@Lorelando");
    expect(overlay.textContent).not.toContain("<@7>");
  });

  it("falls back to the session id for somebody the resolver cannot name", () => {
    // A mention of someone who has left is still a mention; drawing it as
    // `<@99>` would be the marker leaking again.
    const { overlay } = draw("morning <@99>");
    expect(overlay.textContent).toContain("@99");
  });

  it("leaves an unclosed marker alone while it is being typed", () => {
    // Half a marker is text. Chipping it would make the characters vanish
    // from under the caret mid-word.
    const { overlay } = draw("<@&adm");
    expect(overlay.textContent).toContain("<@&adm");
  });

  it("leaves a marker with a space in it as text", () => {
    // `[^>\s]+` is what the wire regex accepts, so this is never a mention -
    // and drawing it as one would promise a chip that never arrives.
    const { overlay } = draw("<@&two words>");
    expect(overlay.textContent).toContain("<@&two words>");
  });

  it("keeps the caret walking through a chip one character at a time", () => {
    // The chip is drawn atomically but stands for eight characters, so the
    // overlay has to keep counting the marker's own length or every caret
    // after it lands in the wrong place.
    const { overlay, field } = draw("<@&admin> hi");
    field.selectionStart = 11;
    field.selectionEnd = 11;
    fireEvent.select(field);

    const caret = overlay.querySelector('[class*="caret"]');
    expect(caret).toBeTruthy();
    // One character short of the end: the caret sits before the last one.
    expect(caret?.nextSibling?.textContent).toBe("i");
  });
});
