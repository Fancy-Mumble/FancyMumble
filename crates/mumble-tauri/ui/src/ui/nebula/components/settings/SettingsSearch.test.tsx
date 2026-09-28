/**
 * The settings search, from typing to the heading that lights up.
 *
 * Two halves worth holding to: the field has to report pages rather than a
 * list of hits, and what it hands back has to be enough for the page to find
 * the control again - including for a query that the page never spells out.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { withNebulaTheme } from "../../testTheme";
import { SettingsSearch, type SettingsSearchTarget } from "./SettingsSearch";
import { highlightTargets } from "./SettingsScreen";
import { GroupTitle, ToggleRow } from "./controls";

const PAGES = [
  { id: "voice" as const, label: "Voice" },
  { id: "advanced" as const, label: "Advanced" },
  { id: "shortcuts" as const, label: "Shortcuts" },
];

function search(onSelect: (target: SettingsSearchTarget) => void = () => {}) {
  render(withNebulaTheme(<SettingsSearch pages={PAGES} onSelect={onSelect} />));
  return screen.getByLabelText("Search settings");
}

describe("SettingsSearch", () => {
  it("shows nothing until something is typed", () => {
    search();
    expect(screen.queryByText("Voice")).toBeNull();
  });

  it("reports the pages that match, with how much of each did", () => {
    const field = search();
    fireEvent.change(field, { target: { value: "log" } });

    const advanced = screen.getByText("Advanced").parentElement!;
    expect(Number(advanced.textContent?.replace("Advanced", ""))).toBeGreaterThan(4);
    // The page is the result; the individual switches are not listed.
    expect(screen.queryByText("Log to file")).toBeNull();
  });

  it("says so rather than showing an empty list", () => {
    const field = search();
    fireEvent.change(field, { target: { value: "kubernetes" } });
    expect(screen.getByText("Nothing matches that.")).toBeTruthy();
  });

  it("hands over the page, the query and the headings that matched", () => {
    const onSelect = vi.fn();
    const field = search(onSelect);
    fireEvent.change(field, { target: { value: "ptt" } });
    fireEvent.click(screen.getByText("Voice"));

    expect(onSelect).toHaveBeenCalledWith({
      page: "voice",
      term: "ptt",
      titles: ["Activation mode"],
    });
  });

  it("takes the first result on Enter, and clears on Escape", () => {
    const onSelect = vi.fn();
    const field = search(onSelect);

    fireEvent.change(field, { target: { value: "bitrate" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onSelect.mock.calls[0][0].page).toBe("voice");
    // The query goes with the result: coming back to this field later should
    // not find yesterday's search still in it.
    expect((field as HTMLInputElement).value).toBe("");

    fireEvent.change(field, { target: { value: "log" } });
    fireEvent.keyDown(field, { key: "Escape" });
    expect((field as HTMLInputElement).value).toBe("");
  });
});

describe("what the chosen result lights up", () => {
  /** A page's worth of headings, drawn by the same controls the pages use. */
  function page() {
    const { container } = render(
      withNebulaTheme(
        <>
          <GroupTitle>Activation mode</GroupTitle>
          <ToggleRow title="Force TCP audio" checked={false} onChange={() => {}} />
        </>,
      ),
    );
    return container;
  }

  it("lights the heading the query is written on", () => {
    const found = highlightTargets(page(), { term: "tcp", titles: ["Force TCP audio"], nonce: 1 });
    expect(found.map((element) => element.dataset.settingsAnchor)).toEqual(["Force TCP audio"]);
  });

  it("falls back to the matched heading when the query is a synonym", () => {
    // "ptt" is written nowhere on the page; the result knew which heading it
    // meant, and without that the flash would land on nothing.
    const found = highlightTargets(page(), { term: "ptt", titles: ["Activation mode"], nonce: 1 });
    expect(found.map((element) => element.dataset.settingsAnchor)).toEqual(["Activation mode"]);
  });

  it("finds nothing rather than everything when neither is there", () => {
    expect(highlightTargets(page(), { term: "gain", titles: ["Auto gain"], nonce: 1 })).toEqual([]);
  });
});
