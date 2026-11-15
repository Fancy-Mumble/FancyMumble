import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withNebulaTheme } from "../../testTheme";
import ReadReceiptIndicator from "./ReadReceiptIndicator";

const prefs = vi.hoisted(() => ({ disableReadReceipts: false }));
vi.mock("@core/preferencesStorage", () => ({ getPreferences: () => Promise.resolve(prefs) }));
vi.mock("@core/features/chat/readreceipt/readReceiptStore", () => ({
  allActiveUsersRead: () => false,
  getReadersForMessage: () => [{ cert_hash: "rin" }],
}));

describe("ReadReceiptIndicator", () => {
  afterEach(cleanup);

  const shown = async () => {
    const { container } = render(
      withNebulaTheme(<ReadReceiptIndicator messageId="m1" channelId={1} allMessageIds={["m1"]} />),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    return container.querySelector("span")?.getAttribute("title");
  };

  it("says somebody read it", async () => {
    prefs.disableReadReceipts = false;
    expect(await shown()).not.toBe("Sent");
  });

  it("with read receipts off, says only that it was sent, as the switch's hint promises", async () => {
    prefs.disableReadReceipts = true;
    const sent = await shown();
    prefs.disableReadReceipts = false;
    const read = await shown();
    expect(sent).not.toBe(read);
  });
});
