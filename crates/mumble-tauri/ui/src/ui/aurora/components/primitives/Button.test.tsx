import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Button from "./Button";

describe("Button", () => {
  it("selects its variant through the data-variant attribute", () => {
    render(<><Button variant="primary">Try again</Button><Button variant="danger">Close session</Button></>);
    expect(screen.getByRole("button", { name: "Try again" }).getAttribute("data-variant")).toBe("primary");
    expect(screen.getByRole("button", { name: "Close session" }).getAttribute("data-variant")).toBe("danger");
  });

  it("defaults to the standard variant", () => {
    render(<Button>Choose a server</Button>);
    expect(screen.getByRole("button", { name: "Choose a server" }).getAttribute("data-variant")).toBe("secondary");
  });

  it("keeps a caller's class alongside the variant attribute", () => {
    render(<Button variant="bare" className="caller">Bare</Button>);
    const button = screen.getByRole("button", { name: "Bare" });
    expect(button.getAttribute("data-variant")).toBe("bare");
    expect(button.classList.contains("caller")).toBe(true);
  });
});
