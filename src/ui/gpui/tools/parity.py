#!/usr/bin/env python3
"""Keep PARITY.md, the tracker of what the web UI has and this client does not.

    tools/parity.py tally
        Rows by area and by what this client has of them.

    tools/parity.py set "<start of a row's first cell>" <status> ["<what is still missing>"]
        Change one row's "Native" cell (present, partial, absent, different),
        and, when given, what its "Missing or different" cell says. The row is
        named by how its first cell starts; a start that names no row, or more
        than one, changes nothing and says so.

    tools/parity.py log "<a line>"
        Append a line to the Progress section of PARITY_PLAN.md, dated today.
"""
import collections
import datetime
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent.parent
PARITY = HERE / "PARITY.md"
PLAN = HERE / "PARITY_PLAN.md"


def cells(line):
    return [cell.strip() for cell in line.strip().strip("|").split("|")]


def rows(lines):
    """Every table row: (line number, area, header cells, cells)."""
    area, header = None, None
    for number, line in enumerate(lines):
        found = re.match(r"## (\d+\. .*)", line)
        if found:
            area = found.group(1)
        if not line.startswith("|") or area is None:
            header = None
            continue
        if header is None:
            header = cells(line)
            continue
        if set(cells(line)[0]) <= set("-: "):
            continue
        yield number, area, header, cells(line)


def tally():
    lines = PARITY.read_text(encoding="utf-8").splitlines()
    by_area = collections.defaultdict(collections.Counter)
    for _, area, header, row in rows(lines):
        if "Native" in header:
            native = row[header.index("Native")]
            status = native.split()[0].lower() if native else "?"
            if status == "see":
                continue
        else:
            status = "absent"
        by_area[area][status] += 1
    total = collections.Counter()
    for area, counts in by_area.items():
        total.update(counts)
        print(f"{area[:44]:44} {sum(counts.values()):4}  " + "  ".join(
            f"{name} {counts[name]}" for name in ("present", "partial", "absent") if counts[name]))
    print(f"{'All':44} {sum(total.values()):4}  " + "  ".join(
        f"{name} {total[name]}" for name in ("present", "partial", "absent", "different", "unverified") if total[name]))


def set_row(start, status, missing):
    lines = PARITY.read_text(encoding="utf-8").splitlines()
    found = [
        (number, header, row)
        for number, _, header, row in rows(lines)
        if "Native" in header and row[0].lower().startswith(start.lower())
    ]
    if len(found) != 1:
        names = "; ".join(row[0][:50] for _, _, row in found) or "none"
        sys.exit(f"`{start}` names {len(found)} rows ({names}); nothing changed")
    number, header, row = found[0]
    row[header.index("Native")] = status
    if missing is not None:
        row[header.index("Missing or different")] = missing
    if status == "present" and "Effort" in header:
        row[header.index("Effort")] = "-"
    lines[number] = "| " + " | ".join(row) + " |"
    PARITY.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    print(f"{row[0][:60]}: {status}")


def log(line):
    text = PLAN.read_text(encoding="utf-8").rstrip("\n")
    today = datetime.date.today().isoformat()
    PLAN.write_text(f"{text}\n- {today}: {line}\n", encoding="utf-8", newline="\n")


def main():
    if len(sys.argv) >= 2 and sys.argv[1] == "tally":
        tally()
    elif len(sys.argv) >= 4 and sys.argv[1] == "set":
        set_row(sys.argv[2], sys.argv[3], sys.argv[4] if len(sys.argv) > 4 else None)
    elif len(sys.argv) == 3 and sys.argv[1] == "log":
        log(sys.argv[2])
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
