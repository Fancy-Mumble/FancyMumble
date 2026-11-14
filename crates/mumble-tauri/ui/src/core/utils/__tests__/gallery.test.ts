import { describe, it, expect, beforeEach } from "vitest";
import type { ChatMessage } from "../../types";
import {
  galleryMarker,
  parseGalleryMarker,
  stripGalleryMarker,
  rememberGalleryRefs,
  getGalleryRef,
  _resetGalleryRefs,
} from "../gallery";

function msg(body: string, id: string): ChatMessage {
  return { sender_session: 1, sender_name: "A", body, channel_id: 5, is_own: false, message_id: id };
}

const img = (n: number) => `<img src="data:image/jpeg;base64,${n}" alt="${n}" />`;

beforeEach(() => _resetGalleryRefs());

describe("gallery markers", () => {
  it("round-trips marker encode/parse", () => {
    expect(parseGalleryMarker(galleryMarker("abc123", 2, 5))).toEqual({
      groupId: "abc123",
      index: 2,
      total: 5,
    });
  });

  it("returns null when no marker present", () => {
    expect(parseGalleryMarker("just text")).toBeNull();
  });

  it("strips the marker and trims", () => {
    expect(stripGalleryMarker(`${galleryMarker("g", 0, 2)}${img(1)}`)).toBe(img(1));
  });

  it("leaves a non-gallery body untouched", () => {
    expect(stripGalleryMarker("hello")).toBe("hello");
  });
});

describe("gallery membership map", () => {
  it("records a ref from a marked message", () => {
    rememberGalleryRefs([msg(`${galleryMarker("g", 1, 3)}${img(1)}`, "m1")]);
    expect(getGalleryRef("m1")).toEqual({ groupId: "g", index: 1, total: 3 });
  });

  it("keeps a remembered ref after the marker is gone (offload)", () => {
    rememberGalleryRefs([msg(`${galleryMarker("g", 0, 2)}${img(0)}`, "m0")]);
    // Message body later becomes an offload placeholder (marker stripped).
    rememberGalleryRefs([msg("<!-- OFFLOADED:m0:123 -->", "m0")]);
    expect(getGalleryRef("m0")).toEqual({ groupId: "g", index: 0, total: 2 });
  });

  it("returns null for unknown / null ids", () => {
    expect(getGalleryRef("nope")).toBeNull();
    expect(getGalleryRef(null)).toBeNull();
    expect(getGalleryRef(undefined)).toBeNull();
  });

  it("does not record non-gallery messages", () => {
    rememberGalleryRefs([msg("plain", "p")]);
    expect(getGalleryRef("p")).toBeNull();
  });
});
