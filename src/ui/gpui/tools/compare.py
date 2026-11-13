#!/usr/bin/env python3
"""How far two screenshots of the same screen are from each other.

    compare.py reference.png native.png [overlay.png]

Prints the mean absolute deviation over every channel of every pixel, split
into what comes from channels a level or two apart (rounding, and the
dithering a browser gives its gradients) and what comes from the rest, and
the share of pixels further apart than 8, 24 and 64 levels. With a third
path it writes an overlay: magenta where the reference is the lighter of
the two, green where the native picture is.

Needs Pillow.
"""
import sys

from PIL import Image, ImageChops


def main() -> None:
    reference = Image.open(sys.argv[1]).convert("RGB")
    native = Image.open(sys.argv[2]).convert("RGB")
    if reference.size != native.size:
        sys.exit(f"sizes differ: {reference.size} and {native.size}")
    difference = ImageChops.difference(reference, native)
    red, green, blue = difference.split()
    furthest = ImageChops.lighter(ImageChops.lighter(red, green), blue)
    scale = reference.size[0] * reference.size[1] * 3 * 255
    near = far = 0
    for band in (red, green, blue):
        for levels, count in enumerate(band.histogram()):
            if levels <= 2:
                near += levels * count
            else:
                far += levels * count
    print(f"mean absolute deviation: {100 * (near + far) / scale:.4f} %")
    print(f"  from channels 1-2 levels apart: {100 * near / scale:.4f} %")
    print(f"  from channels 3 or more apart:  {100 * far / scale:.4f} %")
    counts = furthest.histogram()
    pixels = sum(counts)
    for levels in (8, 24, 64):
        share = 100 * sum(counts[levels + 1 :]) / pixels
        print(f"pixels more than {levels:2} levels apart: {share:.4f} %")
    if len(sys.argv) > 3:
        ours, theirs = native.convert("L"), reference.convert("L")
        lighter_there = ImageChops.subtract(theirs, ours).point(lambda v: 255 if v > 12 else 0)
        lighter_here = ImageChops.subtract(ours, theirs).point(lambda v: 255 if v > 12 else 0)
        overlay = Image.new("RGB", reference.size, (255, 255, 255))
        overlay.paste((255, 0, 255), mask=lighter_there)
        overlay.paste((0, 150, 0), mask=lighter_here)
        overlay.save(sys.argv[3])


if __name__ == "__main__":
    main()
