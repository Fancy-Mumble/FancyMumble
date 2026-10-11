/**
 * Message bodies exactly as a stock Mumble 1.5 client writes them.
 *
 * Built byte for byte the way the stock source does it rather than typed out
 * by hand, so a test that passes here passes against what really arrives.
 */

/** `QUrl::toPercentEncoding` with its defaults: everything but `A-Za-z0-9-._~` is escaped. */
export function qtPercentEncode(text: string): string {
  return text.replace(
    /[^A-Za-z0-9\-._~]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
  );
}

/**
 * `Log::imageToImg(format, image)`: base64, cut into 72-character lines, each
 * line percent-encoded on its own, joined by a literal newline.
 */
export function stockImageSrc(bytes: readonly number[], format = "JPEG"): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const base = btoa(bin);
  const lines: string[] = [];
  for (let at = 0; at < base.length; at += 72) lines.push(qtPercentEncode(base.slice(at, at + 72)));
  return `data:image/${format};base64,${lines.join("\n")}`;
}

/** `<img src="…" />` as `imageToImg` returns it. */
export function stockImg(bytes: readonly number[]): string {
  return `<img src="${stockImageSrc(bytes)}" />`;
}

/**
 * A minimal baseline JPEG: SOI, a JFIF APP0, a comment carrying filler, and the
 * SOF0 frame header the size is read from.
 *
 * The filler is chosen so the base64 holds `+`, `/` and `=` padding - the three
 * characters `toPercentEncoding` turns into escapes - and is long enough to
 * wrap over several 72-character lines.
 */
export function stockJpeg(width: number, height: number): number[] {
  const filler: number[] = [];
  for (let i = 0; i < 40; i++) filler.push(0xfb, 0xef, 0xbe, 0xff, 0xff, 0xff);
  const com = [0xff, 0xfe, ((filler.length + 2) >> 8) & 0xff, (filler.length + 2) & 0xff, ...filler];
  const bytes = [
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x10,
    0x4a,
    0x46,
    0x49,
    0x46,
    0x00,
    0x01,
    0x01,
    0x00,
    0x00,
    0x01,
    0x00,
    0x01,
    0x00,
    0x00,
    ...com,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03,
    0x01,
    0x22,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01,
    0xff,
    0xd9,
  ];
  // One byte past a multiple of three, so the base64 ends in `==`.
  while (bytes.length % 3 !== 1) bytes.push(0x00);
  return bytes;
}
