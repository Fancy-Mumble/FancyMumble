import { useMemo } from "react";
import { encode } from "uqr";

/**
 * A QR code, drawn inline as SVG.
 *
 * Black modules on a white ground regardless of theme: a phone camera has to
 * read this, and the dark-theme "inverted" look that would fit the page is the
 * one arrangement many authenticator scanners refuse. The quiet zone is part of
 * the drawing for the same reason - a caller who paints the code edge to edge
 * against a dark panel would otherwise lose it.
 */
export function QrCode({
  value,
  label,
  size = 176,
  testId,
}: Readonly<{
  /** The payload; for 2FA enrolment the `otpauth://` provisioning URI. */
  value: string;
  /** Accessible name - what the code is *for*, since its content is opaque. */
  label: string;
  /** Rendered edge length in CSS pixels. */
  size?: number;
  testId?: string;
}>) {
  const { d, modules } = useMemo(() => {
    // Medium error correction: a slightly smudged screen or an off-angle
    // camera still scans, and the URI is short enough that the extra modules
    // do not push the code past what a phone reads at this size.
    const qr = encode(value, { ecc: "M", border: 2 });
    let path = "";
    qr.data.forEach((row, y) => {
      row.forEach((dark, x) => {
        if (dark) path += `M${x} ${y}h1v1h-1z`;
      });
    });
    return { d: path, modules: qr.size };
  }, [value]);

  return (
    <svg
      role="img"
      aria-label={label}
      data-testid={testId}
      width={size}
      height={size}
      viewBox={`0 0 ${modules} ${modules}`}
      shapeRendering="crispEdges"
      style={{ display: "block", borderRadius: 6 }}
    >
      <rect width={modules} height={modules} fill="#ffffff" />
      <path d={d} fill="#000000" />
    </svg>
  );
}
