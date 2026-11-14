import { describe, it, expect, beforeEach } from "vitest";
import { usePromptDialogStore, openPrompt } from "../elements/promptDialogStore";

function reset() {
  usePromptDialogStore.setState({ open: false, options: null, resolve: null });
}

describe("promptDialogStore", () => {
  beforeEach(reset);

  it("opens with the supplied options", () => {
    void openPrompt({ title: "New section", label: "Name" });
    const state = usePromptDialogStore.getState();
    expect(state.open).toBe(true);
    expect(state.options?.title).toBe("New section");
    expect(state.options?.label).toBe("Name");
  });

  it("resolves with the confirmed value and closes", async () => {
    const promise = openPrompt({ title: "Rename" });
    usePromptDialogStore.getState().confirm("Hello");
    await expect(promise).resolves.toBe("Hello");
    expect(usePromptDialogStore.getState().open).toBe(false);
  });

  it("resolves with null when cancelled", async () => {
    const promise = openPrompt({ title: "Rename" });
    usePromptDialogStore.getState().cancel();
    await expect(promise).resolves.toBeNull();
    expect(usePromptDialogStore.getState().open).toBe(false);
  });

  it("resolves a superseded prompt with null when a new one opens", async () => {
    const first = openPrompt({ title: "First" });
    const second = openPrompt({ title: "Second" });
    await expect(first).resolves.toBeNull();
    usePromptDialogStore.getState().confirm("done");
    await expect(second).resolves.toBe("done");
  });
});
