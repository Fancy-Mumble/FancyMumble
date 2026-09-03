"""Lift one glyph's outline out of a TrueType file and emit it as a module.

The app's monogram is a single letter from a script face. Shipping the whole
font to draw one glyph costs 457 KB, an `@font-face`, and a race - canvas draws
with whatever face is loaded at the time and neither waits nor complains, so a
cold start could quietly substitute a different letterform. An outline has none
of those: it is data in the bundle and cannot fail to load.

    python tools/extract-glyph.py GreatVibes-Regular.ttf F src/core/brandGlyph.ts

Committed because the alternative is archaeology: changing the letter or the
face otherwise means working out how the existing path was made.

No third-party dependency - `fonttools` is the usual answer and is a large one
to add for a build step run about once. Reads `cmap`, `loca` and `glyf`
directly, which for a simple glyph is a short read.

Emits the path in a y-down space with the ink box at the origin, which is the
space SVG and canvas both want: a consumer sets `viewBox="0 0 width height"`,
or scales into a box, and never has to know that TrueType draws y-up.
"""

import io
import struct
import sys


def parse(path, char):
    data = io.open(path, "rb").read()

    def u16(o):
        return struct.unpack(">H", data[o : o + 2])[0]

    def s16(o):
        return struct.unpack(">h", data[o : o + 2])[0]

    def u32(o):
        return struct.unpack(">I", data[o : o + 4])[0]

    tables = {}
    for i in range(u16(4)):
        rec = 12 + i * 16
        tables[data[rec : rec + 4].decode("latin-1")] = (u32(rec + 8), u32(rec + 12))

    head = tables["head"][0]
    long_loca = s16(head + 50)

    # -- cmap: the glyph id for `char`, preferring the Windows Unicode table.
    cmap = tables["cmap"][0]
    sub = None
    for i in range(u16(cmap + 2)):
        rec = cmap + 4 + i * 8
        plat, enc, off = u16(rec), u16(rec + 2), u32(rec + 4)
        if u16(cmap + off) == 4:
            sub = cmap + off
            if (plat, enc) == (3, 1):
                break
    if sub is None:
        raise SystemExit("no format-4 cmap subtable")

    seg_x2 = u16(sub + 6)
    ends, starts = sub + 14, sub + 14 + seg_x2 + 2
    deltas, ranges = starts + seg_x2, starts + seg_x2 * 2

    code = ord(char)
    gid = 0
    for s in range(seg_x2 // 2):
        if u16(ends + s * 2) >= code >= u16(starts + s * 2):
            offset = u16(ranges + s * 2)
            if offset == 0:
                gid = (code + s16(deltas + s * 2)) & 0xFFFF
            else:
                gid = u16(ranges + s * 2 + offset + (code - u16(starts + s * 2)) * 2)
                if gid:
                    gid = (gid + s16(deltas + s * 2)) & 0xFFFF
            break
    if gid == 0:
        raise SystemExit(f"{char!r} is not in this font")

    loca = tables["loca"][0]
    if long_loca:
        start, end = u32(loca + gid * 4), u32(loca + gid * 4 + 4)
    else:
        start, end = u16(loca + gid * 2) * 2, u16(loca + gid * 2 + 2) * 2
    if start == end:
        raise SystemExit(f"{char!r} has no outline")

    g = tables["glyf"][0] + start
    contours = s16(g)
    if contours < 0:
        raise SystemExit("composite glyph - this tool only reads simple ones")
    box = (s16(g + 2), s16(g + 4), s16(g + 6), s16(g + 8))

    o = g + 10
    end_pts = [u16(o + i * 2) for i in range(contours)]
    o += contours * 2
    count = end_pts[-1] + 1
    o += 2 + u16(o)  # skip the hinting programme

    flags = []
    while len(flags) < count:
        f = data[o]
        o += 1
        flags.append(f)
        if f & 8:  # repeat
            run = data[o]
            o += 1
            flags.extend([f] * run)
    flags = flags[:count]

    def coords(short_bit, same_bit):
        nonlocal o
        out, value = [], 0
        for f in flags:
            if f & short_bit:
                delta = data[o]
                o += 1
                value += delta if f & same_bit else -delta
            elif not f & same_bit:
                value += s16(o)
                o += 2
            out.append(value)
        return out

    xs = coords(2, 16)
    ys = coords(4, 32)
    return gid, box, end_pts, flags, xs, ys, (end - start)


def to_path(box, end_pts, flags, xs, ys):
    """Contours to an SVG path, in a y-down space with the box at the origin.

    TrueType curves are quadratic, and two consecutive off-curve points imply
    an on-curve point at their midpoint - the format's way of not storing what
    it can work out.
    """
    xmin, _, _, ymax = box[0], box[1], box[2], box[3]

    def fmt(v):
        r = round(v, 1)
        return str(int(r)) if r == int(r) else str(r)

    out, first = [], 0
    for last in end_pts:
        pts = [(xs[i] - xmin, ymax - ys[i], bool(flags[i] & 1)) for i in range(first, last + 1)]
        first = last + 1
        if not pts:
            continue

        # Start on an on-curve point; a contour with none starts at an implied
        # midpoint, which is legal and does occur in script faces.
        on = next((i for i, p in enumerate(pts) if p[2]), None)
        if on is None:
            pts.insert(0, ((pts[0][0] + pts[-1][0]) / 2, (pts[0][1] + pts[-1][1]) / 2, True))
            on = 0
        pts = pts[on:] + pts[:on]

        out.append(f"M{fmt(pts[0][0])} {fmt(pts[0][1])}")
        i, n = 1, len(pts)
        while i <= n:
            cur = pts[i % n]
            if cur[2]:
                out.append(f"L{fmt(cur[0])} {fmt(cur[1])}")
                i += 1
                continue
            nxt = pts[(i + 1) % n]
            if nxt[2]:
                end, i = nxt, i + 2
            else:
                end, i = ((cur[0] + nxt[0]) / 2, (cur[1] + nxt[1]) / 2, True), i + 1
            out.append(f"Q{fmt(cur[0])} {fmt(cur[1])} {fmt(end[0])} {fmt(end[1])}")
        out.append("Z")
    return "".join(out)


def main():
    if len(sys.argv) != 4:
        raise SystemExit(__doc__)
    font, char, target = sys.argv[1], sys.argv[2], sys.argv[3]
    gid, box, end_pts, flags, xs, ys, raw = parse(font, char)
    path = to_path(box, end_pts, flags, xs, ys)
    width, height = box[2] - box[0], box[3] - box[1]

    name = font.replace("\\", "/").rsplit("/", 1)[-1]
    module = f'''/**
 * The app's monogram, as an outline.
 *
 * GENERATED - do not edit by hand. Remake it with:
 *
 *     python tools/extract-glyph.py <font.ttf> {char} src/core/brandGlyph.ts
 *
 * The capital {char} of {name}, lifted out of the font so that the font itself does
 * not have to ship. Drawing one glyph is not worth half a megabyte, an
 * `@font-face` and a loading race - canvas draws with whatever face happens to
 * be ready and says nothing when that is the wrong one. An outline is data in
 * the bundle: it cannot arrive late and it cannot be substituted.
 *
 * Great Vibes is under the SIL Open Font Licence 1.1 and declares no Reserved
 * Font Name, so this derivative is permitted; the licence travels beside this
 * file as `brandGlyph-OFL.txt`.
 *
 * The path is plain geometry - no colour, no background, no size. It is drawn
 * in a y-down space with the ink box at the origin, so a consumer either sets
 * `viewBox="0 0 {width} {height}"` or scales it into whatever box it has.
 */

/** The outline, as SVG path data. */
export const BRAND_GLYPH_PATH =
  "{path}";

/** The ink box the path is drawn in. Nothing falls outside it. */
export const BRAND_GLYPH_WIDTH = {width};
export const BRAND_GLYPH_HEIGHT = {height};
'''
    io.open(target, "w", encoding="utf-8", newline="\n").write(module)
    print(f"glyph {gid} ({char!r}): {raw} bytes of outline -> {len(path)} chars of path")
    print(f"box {width}x{height}; wrote {target}")


if __name__ == "__main__":
    main()
