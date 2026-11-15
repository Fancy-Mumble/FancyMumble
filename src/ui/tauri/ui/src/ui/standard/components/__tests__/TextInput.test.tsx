/**
 * Shared form controls: a `Field` must label and describe whatever control it
 * wraps without the caller plumbing ids, errors must propagate to the control
 * as `aria-invalid`, and every native prop must still pass through (the whole
 * point of the primitive is that call sites don't lose capability).
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Field, TextInput, TextArea, SelectInput, SearchInput } from "../elements/TextInput";
import { SidebarSearch, ToolbarSearch, PickerSearch, PaletteSearch } from "../elements/SearchFields";

describe("TextInput", () => {
  it("passes native props straight through", () => {
    render(<TextInput type="password" placeholder="secret" disabled data-testid="pw" />);
    const el = screen.getByTestId("pw") as HTMLInputElement;
    expect(el.type).toBe("password");
    expect(el.placeholder).toBe("secret");
    expect(el.disabled).toBe(true);
  });

  it("is controllable", () => {
    const onChange = vi.fn();
    render(<TextInput value="abc" onChange={onChange} data-testid="i" />);
    fireEvent.change(screen.getByTestId("i"), { target: { value: "abcd" } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("marks itself invalid on request", () => {
    render(<TextInput invalid data-testid="i" />);
    expect(screen.getByTestId("i").getAttribute("aria-invalid")).toBe("true");
  });

  it("is not aria-invalid by default", () => {
    render(<TextInput data-testid="i" />);
    expect(screen.getByTestId("i").getAttribute("aria-invalid")).toBeNull();
  });
});

describe("SearchInput", () => {
  it("renders a search input carrying the icon-clearance class", () => {
    render(<SearchInput value="" onChange={() => {}} data-testid="s" />);
    const el = screen.getByTestId("s") as HTMLInputElement;
    expect(el.type).toBe("search");
    // The left padding that keeps text off the magnifier must be applied by
    // the component - that pairing breaking is what regressed before.
    expect(el.className).toMatch(/search/);
  });

  it("shows a clear button only when there is a value and a handler", () => {
    const onClear = vi.fn();
    const { rerender } = render(<SearchInput value="" onChange={() => {}} onClear={onClear} />);
    expect(screen.queryByRole("button")).toBeNull();

    rerender(<SearchInput value="abc" onChange={() => {}} onClear={onClear} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("omits the clear button when no handler is supplied", () => {
    render(<SearchInput value="abc" onChange={() => {}} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("forwards a ref to the underlying input", () => {
    const ref = { current: null as HTMLInputElement | null };
    render(<SearchInput ref={ref} value="" onChange={() => {}} data-testid="s" />);
    expect(ref.current).toBe(screen.getByTestId("s"));
  });
});

describe("search variants / positional presets", () => {
  it("draws its own chrome in the default `field` variant", () => {
    render(<SearchInput value="" onChange={() => {}} data-testid="s" />);
    // No bare modifier: the input itself is the field.
    expect(screen.getByTestId("s").className).not.toMatch(/searchBare/);
  });

  it("goes bare in the `bar` variant so it doesn't box inside a box", () => {
    render(<SearchInput variant="bar" value="" onChange={() => {}} data-testid="s" />);
    expect(screen.getByTestId("s").className).toMatch(/searchBare/);
  });

  it("palette is bare and larger", () => {
    render(<SearchInput variant="palette" value="" onChange={() => {}} data-testid="s" />);
    const cls = screen.getByTestId("s").className;
    expect(cls).toMatch(/searchBare/);
    expect(cls).toMatch(/searchPalette/);
  });

  it("each preset applies its position's variant", () => {
    render(<PickerSearch value="" onChange={() => {}} data-testid="pick" />);
    expect(screen.getByTestId("pick").className).toMatch(/searchBare/);

    render(<PaletteSearch value="" onChange={() => {}} data-testid="pal" />);
    expect(screen.getByTestId("pal").className).toMatch(/searchPalette/);
  });

  /**
   * Only `PickerSearch` may be bare, and only because a picker's own bar draws
   * the field. The sidebar/settings/menu rows are layout-only and the admin
   * toolbars have no wrapper at all, so those presets must draw their own
   * border - shipping them bare renders a search with no chrome, which is
   * exactly what happened once.
   */
  it("every self-drawing preset keeps its border", () => {
    render(<SidebarSearch value="" onChange={() => {}} data-testid="side" />);
    expect(screen.getByTestId("side").className).not.toMatch(/searchBare/);

    render(<ToolbarSearch value="" onChange={() => {}} data-testid="tool" />);
    expect(screen.getByTestId("tool").className).not.toMatch(/searchBare/);
  });
});

describe("Field", () => {
  it("associates its label with the wrapped control automatically", () => {
    render(
      <Field label="Actor">
        <TextInput data-testid="i" />
      </Field>,
    );
    // getByLabelText only resolves when htmlFor/id are correctly paired.
    expect(screen.getByLabelText("Actor")).toBe(screen.getByTestId("i"));
  });

  it("describes the control with its hint", () => {
    render(
      <Field label="Actor" hint="name or id">
        <TextInput data-testid="i" />
      </Field>,
    );
    const describedBy = screen.getByTestId("i").getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toBe("name or id");
  });

  it("propagates an error to the control and announces it", () => {
    render(
      <Field label="Actor" error="Unknown user">
        <TextInput data-testid="i" />
      </Field>,
    );
    const input = screen.getByTestId("i");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toBe("Unknown user");
  });

  it("prefers the error over the hint so stale help isn't announced", () => {
    render(
      <Field label="Actor" hint="name or id" error="Unknown user">
        <TextInput data-testid="i" />
      </Field>,
    );
    expect(screen.queryByText("name or id")).toBeNull();
    const describedBy = screen.getByTestId("i").getAttribute("aria-describedby");
    expect(document.getElementById(describedBy!)?.textContent).toBe("Unknown user");
  });

  it("labels a textarea and a select the same way", () => {
    render(
      <>
        <Field label="Notes">
          <TextArea data-testid="ta" />
        </Field>
        <Field label="Source">
          <SelectInput data-testid="sel">
            <option value="server">server</option>
          </SelectInput>
        </Field>
      </>,
    );
    expect(screen.getByLabelText("Notes")).toBe(screen.getByTestId("ta"));
    expect(screen.getByLabelText("Source")).toBe(screen.getByTestId("sel"));
  });

  it("lets an explicit id win over the generated one", () => {
    render(
      <Field label="Actor">
        <TextInput id="my-own-id" data-testid="i" />
      </Field>,
    );
    expect(screen.getByTestId("i").id).toBe("my-own-id");
  });
});
