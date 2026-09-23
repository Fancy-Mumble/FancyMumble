import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import PasswordDialog from "./PasswordDialog";

describe("PasswordDialog", () => {
  it("prints a name with markup in it as text, never as markup", () => {
    // The message is a translation with <strong> in it, set as HTML; the name
    // and host are dropped into it, and i18next does not escape by default.
    const { container } = render(
      <PasswordDialog
        open
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        username={'<img src="x" onerror="alert(1)">'}
        serverHost="example.org"
      />,
    );

    expect(container.ownerDocument.querySelector("img")).toBeNull();
    expect(container.ownerDocument.body.textContent).toContain('<img src="x" onerror="alert(1)">');
  });
});
