import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withNebulaTheme } from "../../testTheme";
import { WelcomeDialog } from "./WelcomeDialog";

const GREETING = "<p>Rotation nights are <b>Tuesday</b>. Rules: <a href='https://x.test'>here</a>.</p>";

function show(onClose = vi.fn()) {
  render(withNebulaTheme(<WelcomeDialog body={GREETING} server="Fancy" onClose={onClose} />));
  return onClose;
}

describe("the greeting at full size", () => {
  afterEach(cleanup);

  it("shows the message as markup rather than as flattened text", () => {
    // The whole point of opening it: the pin row already had the words, and
    // what it could not carry was the way they were written.
    show();
    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelector("b")?.textContent).toBe("Tuesday");
    expect(dialog.querySelector("a")?.getAttribute("href")).toBe("https://x.test");
  });

  it("names the server whose greeting it is", () => {
    show();
    expect(screen.getByText("Fancy")).toBeTruthy();
    expect(screen.getByText("Welcome")).toBeTruthy();
  });

  it("closes on the ×", () => {
    const onClose = show();
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalled();
  });
});
