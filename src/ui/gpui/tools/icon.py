#!/usr/bin/env python3
"""Write a Lucide icon into assets/icons, from the package the web UI has installed.

    tools/icon.py zap [text-quote ...]         write assets/icons/<name>.svg
    tools/icon.py --check                      compare every bundled icon with the package

The shapes are read from `src/ui/tauri/ui/node_modules/lucide-react`,
so an icon here is the icon the web UI draws and not one written from memory.
An icon filled in this client (`star`) keeps its fill; the rest are stroked.
After adding one, name it in `src/assets.rs`.
"""
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent.parent
ICONS = HERE / "assets" / "icons"
PACKAGE = HERE.parents[2] / "src" / "ui" / "tauri" / "ui" / "node_modules" / "lucide-react" / "dist" / "esm" / "icons"
HEAD = ('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" '
        'fill="{fill}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">')


def shapes(name):
    """The icon's elements, as SVG, in the order the package lists them."""
    source = (PACKAGE / f"{name}.mjs").read_text(encoding="utf-8")
    out = []
    for tag, attributes in re.findall(r'\[\s*"(\w+)",\s*\{([^}]*)\}\s*\]', source):
        pairs = re.findall(r'(\w+):\s*"([^"]*)"', attributes)
        written = " ".join(f'{key}="{value}"' for key, value in pairs if key != "key")
        out.append(f"<{tag} {written}/>")
    if not out:
        raise SystemExit(f"{name}: no shapes found in the package")
    return "".join(out)


def svg(name, fill="none"):
    return HEAD.format(fill=fill) + shapes(name) + "</svg>\n"


def body(text):
    """An icon's shapes alone, spacing aside: what makes two icons the same."""
    inner = re.sub(r"^<svg[^>]*>|</svg>\s*$", "", text.strip())
    return re.sub(r"\s+", "", inner)


def check():
    differing = 0
    for path in sorted(ICONS.glob("*.svg")):
        if not (PACKAGE / f"{path.stem}.mjs").exists():
            print(f"{path.stem:20} not a Lucide icon of that name")
            continue
        ours, theirs = body(path.read_text(encoding="utf-8")), body(svg(path.stem))
        if ours != theirs:
            differing += 1
            print(f"{path.stem:20} DIFFERS from the package")
    print(f"{differing} differ")


def main():
    if sys.argv[1:] == ["--check"]:
        check()
        return
    if not sys.argv[1:]:
        raise SystemExit(__doc__)
    for name in sys.argv[1:]:
        (ICONS / f"{name}.svg").write_text(svg(name), encoding="utf-8", newline="\n")
        print(f"wrote {name}.svg")


if __name__ == "__main__":
    main()
