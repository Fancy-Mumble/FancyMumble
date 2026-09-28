import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { withNebulaTheme } from "../../testTheme";
import { SearchBox } from "./SearchBox";

describe("SearchBox", () => {
  it("prints the keyboard hint it is given", () => {
    render(
      withNebulaTheme(
        <SearchBox value="" onChange={() => undefined} placeholder="Search channels" hint="Ctrl+F" />,
      ),
    );
    expect(screen.getByText("Ctrl+F")).toBeTruthy();
  });

  it("omits the hint when no shortcut is given", () => {
    render(withNebulaTheme(<SearchBox value="" onChange={() => undefined} placeholder="Search people" />));
    expect(screen.queryByText(/Ctrl/)).toBeNull();
  });
});
