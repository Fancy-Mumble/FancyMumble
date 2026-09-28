import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { encode } from "uqr";
import { QrCode } from "./QrCode";

const URI = "otpauth://totp/Fancy:ada?secret=JBSWY3DPEHPK3PXP&issuer=Fancy";

describe("QrCode", () => {
  it("is an image named for what it does, not what it contains", () => {
    render(<QrCode value={URI} label="Scan me" />);
    const svg = screen.getByRole("img", { name: "Scan me" });
    expect(svg.tagName.toLowerCase()).toBe("svg");
  });

  it("draws every dark module of the encoding, quiet zone included", () => {
    render(<QrCode value={URI} label="qr" />);
    const svg = screen.getByRole("img");
    const qr = encode(URI, { ecc: "M", border: 2 });
    expect(svg.getAttribute("viewBox")).toBe(`0 0 ${qr.size} ${qr.size}`);
    const dark = qr.data.flat().filter(Boolean).length;
    const d = svg.querySelector("path")?.getAttribute("d") ?? "";
    expect(d.match(/M\d+ \d+h1v1h-1z/g)?.length).toBe(dark);
  });

  it("paints black on white whatever the theme", () => {
    render(<QrCode value={URI} label="qr" />);
    const svg = screen.getByRole("img");
    expect(svg.querySelector("rect")?.getAttribute("fill")).toBe("#ffffff");
    expect(svg.querySelector("path")?.getAttribute("fill")).toBe("#000000");
  });
});
