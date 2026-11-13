"""Cut the static Inter faces this view bundles from the variable font the web UI ships.

    uv run --with fonttools python3 instances.py <web fonts dir> <this dir>

The text system here draws only the default instance of a variable font, so
each weight has to be a face of its own. Optical size is fixed at 14, which is
what a browser picks for everything this view sets below 15px.
"""
import sys
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.subset import Subsetter, Options
src, out = sys.argv[1], sys.argv[2]
# (face, weight, italic, optical size, family). The last is the display cut:
# what a browser draws a heading in, since it follows the size it is set at.
FACES = [
    ("Regular", 400, False, 14, "Inter"),
    ("Medium", 500, False, 14, "Inter"),
    ("SemiBold", 600, False, 14, "Inter"),
    ("Bold", 700, False, 14, "Inter"),
    ("Italic", 400, True, 14, "Inter"),
    ("DisplayBold", 700, False, 24, "Inter Display"),
]
for name, wght, italic, opsz, family in FACES:
    path = f"{src}/Inter-Italic-VariableFont_opsz,wght.ttf" if italic else f"{src}/Inter-VariableFont_opsz,wght.ttf"
    f = instantiateVariableFont(TTFont(path), {"wght": wght, "opsz": opsz}, inplace=False)
    o = Options()
    o.layout_features = ["kern", "liga", "calt", "ccmp", "locl", "mark", "mkmk", "tnum", "case"]
    o.name_IDs = ["*"]; o.notdef_outline = True; o.hinting = False; o.drop_tables += ["STAT", "MVAR", "HVAR", "avar", "fvar", "gvar"]
    s = Subsetter(o); s.populate(unicodes=list(f.getBestCmap().keys())); s.subset(f)
    f["OS/2"].usWeightClass = wght
    sub = name if not italic else "Italic"
    for rec in f["name"].names:
        if rec.nameID == 1: rec.string = family
        elif rec.nameID == 2: rec.string = {"Regular": "Regular", "Bold": "Bold", "Italic": "Italic", "DisplayBold": "Bold"}.get(name, "Regular")
        elif rec.nameID == 4: rec.string = f"Inter {name}"
        elif rec.nameID == 6: rec.string = f"Inter-{name}"
        elif rec.nameID == 16: rec.string = family
        elif rec.nameID == 17: rec.string = name
    have = {r.nameID for r in f["name"].names}
    if 16 not in have: f["name"].setName(family, 16, 3, 1, 0x409)
    if 17 not in have: f["name"].setName(name, 17, 3, 1, 0x409)
    fs = f["OS/2"].fsSelection & ~0b1100001
    if italic: fs |= 1
    elif wght == 700: fs |= 0b100000
    elif wght == 400: fs |= 0b1000000
    f["OS/2"].fsSelection = fs
    f["head"].macStyle = (1 if wght == 700 else 0) | (2 if italic else 0)
    f.save(f"{out}/Inter-{name}.ttf")
