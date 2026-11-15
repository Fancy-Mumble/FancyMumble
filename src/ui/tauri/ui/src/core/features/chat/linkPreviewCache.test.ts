import { describe, it, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...(a as [])) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => undefined) }));

const { useAppStore, requestLinkPreview, clearPendingPreviewRequests } = await import("../../store");

const YOUTUBE = "https://www.youtube.com/watch?v=zc36tWQcXY";
const WIKI = "https://en.wikipedia.org/wiki/Jean-Baptiste_Auriol";

const card = (url: string, title: string) => ({ url, type: "link" as const, title });

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue([]);
  clearPendingPreviewRequests();
  useAppStore.setState({ linkEmbeds: new Map(), disableLinkPreviews: false });
});

describe("asking for a link preview", () => {
  it("does not ask twice for a link it already has a card for", async () => {
    // The shape of the original bug, in miniature: a card was filed under the
    // message that mentioned the link, so the same link in a second message -
    // or the same message drawn again after a scroll - was a second fetch of
    // the same page.
    useAppStore.setState({ linkEmbeds: new Map([[YOUTUBE, card(YOUTUBE, "Unbreakable")]]) });

    await requestLinkPreview([YOUTUBE], "message-one");
    await requestLinkPreview([YOUTUBE], "message-two");

    expect(invoke).not.toHaveBeenCalled();
  });

  it("asks only for the links it is missing", async () => {
    useAppStore.setState({ linkEmbeds: new Map([[YOUTUBE, card(YOUTUBE, "Unbreakable")]]) });

    await requestLinkPreview([YOUTUBE, WIKI], "message-one");

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("request_link_preview", {
      urls: [WIKI],
      requestId: "message-one",
    });
  });

  it("folds two messages mentioning the same link into one request", async () => {
    // Not awaited in turn: both rows of a channel render in the same tick, and
    // the second must see the first as already in flight.
    const both = Promise.all([
      requestLinkPreview([YOUTUBE], "message-one"),
      requestLinkPreview([YOUTUBE], "message-two"),
    ]);
    await both;

    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("takes the cards the backend already had from the call itself", async () => {
    // A hit on this machine's own cache should not arrive as an event a frame
    // later: it is already here.
    invoke.mockResolvedValue([{ requested_url: YOUTUBE, embed: card(YOUTUBE, "Unbreakable") }]);

    await requestLinkPreview([YOUTUBE], "message-one");

    expect(useAppStore.getState().linkEmbeds.get(YOUTUBE)?.title).toBe("Unbreakable");
  });

  it("files a backend hit under the URL that was asked for, not where it landed", async () => {
    // A shortener's card names the page behind it, and that is a string no
    // message contains. Filed under it, the card would never be found again.
    const short = "https://t.co/abc";
    invoke.mockResolvedValue([{ requested_url: short, embed: card(WIKI, "Jean-Baptiste Auriol") }]);

    await requestLinkPreview([short], "message-one");

    expect(useAppStore.getState().linkEmbeds.get(short)?.title).toBe("Jean-Baptiste Auriol");
  });

  it("lets a link be asked about again after the request failed", async () => {
    // Without releasing it, one failure means that link never gets a card
    // again for the life of the process.
    invoke.mockRejectedValueOnce(new Error("not connected"));
    await requestLinkPreview([YOUTUBE], "message-one");
    expect(invoke).toHaveBeenCalledTimes(1);

    invoke.mockResolvedValue([]);
    await requestLinkPreview([YOUTUBE], "message-one");
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});

describe("a reconnect", () => {
  it("keeps the cards it already has", async () => {
    // The bug this is here for: `linkEmbeds` was session state and was wiped
    // on reconnect, while the in-flight set was module state and was not. The
    // cards vanished and every re-request was suppressed as a duplicate, so
    // they did not come back until the app was restarted.
    useAppStore.setState({ linkEmbeds: new Map([[YOUTUBE, card(YOUTUBE, "Unbreakable")]]) });

    useAppStore.getState().reset();

    expect(useAppStore.getState().linkEmbeds.get(YOUTUBE)?.title).toBe("Unbreakable");
  });

  it("re-asks for a link whose answer never arrived", async () => {
    // The other half: a request that was in flight when the connection dropped
    // is never going to be answered, so it must not keep suppressing retries.
    await requestLinkPreview([YOUTUBE], "message-one");
    expect(invoke).toHaveBeenCalledTimes(1);

    useAppStore.getState().reset();
    await requestLinkPreview([YOUTUBE], "message-one");

    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
