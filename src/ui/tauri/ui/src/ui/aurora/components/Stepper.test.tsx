import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Stepper from "./Stepper";

const steps = [
  { id: "account", label: "Account", description: "Choose an identity" },
  { id: "server", label: "Server", description: "Add a connection" },
  { id: "done", label: "Done" },
] as const;

describe("Stepper", () => {
  it("exposes active and completed progress semantically", () => {
    render(<Stepper steps={steps} activeStep={1} ariaLabel="Setup progress" />);
    expect(screen.getByRole("list", { name: "Setup progress" })).toBeTruthy();
    expect(screen.getByText("Server").closest("li")?.getAttribute("aria-current")).toBe("step");
    expect(screen.getByText("Account").closest("li")?.textContent).toContain("Account");
  });

  it("can act as navigation when a change handler is supplied", () => {
    const onStepChange = vi.fn();
    render(<Stepper steps={steps} activeStep={0} onStepChange={onStepChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Server/ }));
    expect(onStepChange).toHaveBeenCalledWith(1);
  });
});
