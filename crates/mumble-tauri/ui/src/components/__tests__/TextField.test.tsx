/**
 * TextField follows Material UI's shape: one component covers input, textarea
 * and select, with label / helperText / error / adornments as props. These
 * pin the contract call sites rely on when they are migrated one at a time.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TextField } from "../elements/TextField";

describe("TextField", () => {
  it("labels the control without any id plumbing", () => {
    render(<TextField label="Actor" data-testid="f" />);
    expect(screen.getByLabelText("Actor")).toBe(screen.getByTestId("f"));
  });

  it("renders helper text and describes the control with it", () => {
    render(<TextField label="Actor" helperText="name or id" data-testid="f" />);
    const id = screen.getByTestId("f").getAttribute("aria-describedby");
    expect(document.getElementById(id!)?.textContent).toBe("name or id");
  });

  it("treats a string error as the message and marks the field invalid", () => {
    render(<TextField label="Actor" helperText="name or id" error="Unknown user" data-testid="f" />);
    expect(screen.getByTestId("f").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toBe("Unknown user");
    // The error supersedes the hint rather than stacking with it.
    expect(screen.queryByText("name or id")).toBeNull();
  });

  it("accepts a boolean error without a message", () => {
    render(<TextField error data-testid="f" />);
    expect(screen.getByTestId("f").getAttribute("aria-invalid")).toBe("true");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders a textarea when multiline", () => {
    render(<TextField label="Reason" multiline rows={4} data-testid="f" />);
    const el = screen.getByTestId("f");
    expect(el.tagName).toBe("TEXTAREA");
    expect(el.getAttribute("rows")).toBe("4");
  });

  it("renders a select and keeps its options", () => {
    render(
      <TextField label="Source" select defaultValue="server" data-testid="f">
        <option value="server">server</option>
        <option value="client">client</option>
      </TextField>,
    );
    const el = screen.getByTestId("f") as HTMLSelectElement;
    expect(el.tagName).toBe("SELECT");
    expect(el.value).toBe("server");
  });

  it("reserves padding for a leading adornment so text can't sit under it", () => {
    render(<TextField startAdornment={<span>i</span>} data-testid="f" />);
    expect(screen.getByTestId("f").className).toMatch(/hasStart/);
  });

  it("reserves padding for a trailing adornment", () => {
    render(<TextField endAdornment={<span>K</span>} data-testid="f" />);
    expect(screen.getByTestId("f").className).toMatch(/hasTrailing/);
  });

  it("passes native props through and stays controllable", () => {
    const onChange = vi.fn();
    render(<TextField type="password" value="x" onChange={onChange} disabled data-testid="f" />);
    const el = screen.getByTestId("f") as HTMLInputElement;
    expect(el.type).toBe("password");
    expect(el.disabled).toBe(true);
    el.disabled = false;
    fireEvent.change(el, { target: { value: "xy" } });
    expect(onChange).toHaveBeenCalled();
  });

  it("marks required fields", () => {
    render(<TextField label="Name" required data-testid="f" />);
    expect(screen.getByText("Name").textContent).toContain("*");
  });
});
