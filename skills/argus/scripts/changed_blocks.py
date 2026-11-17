#!/usr/bin/env python3
"""Which blocks of a File note still equal the source. Python 3.10+, standard library only. No model, no git.

  python -B changed_blocks.py --notes <notes folder> --source <source root> [--scope <path>] [--json]
  python -B changed_blocks.py --notes <notes folder> --source <source root> [--scope <path>] --fix-moved
  python -B changed_blocks.py --source <source root> --hash <source file> [<source file> ...]

For each File note (written_by: argus) whose source file is in scope, it compares the code copied into each block
with the source file as it is on disk now and gives each block one state:

  same       the code is at the recorded lines
  moved      the code is the same, at other lines; the new lines are given
  changed    the code is no longer in the source. Given: the lines where it was expected, the unexplained lines
             beside it that may be its new form, and whether it is gone. Or its whole code is in the source but
             past other blocks (two functions changed places): then the lines where it is now are given
  ambiguous  the same code is at several places and the order of the blocks does not decide which

It also gives the ranges of non-blank source lines that no placed block covers (unexplained), and whether the
note's source_hash still equals the file.

The placing rule is the one the VS Code extension uses. Blocks keep the order of their recorded first lines. Among
all ways to put blocks, in that order and without overlap, at places where their whole code matches, the script
takes the one that places the most blocks, then the one with the smallest sum of distances from the recorded lines.
A block that an equally good way places elsewhere, or leaves out, is ambiguous. Lines with [masked] match as in
check_notes.py. On a file where one block's code is at very many places the work is bounded: the places nearest to
the recorded line are looked at, and the report says so in a BOUNDED line.

Without --fix-moved nothing is written. With it, for each block that only moved (also past other blocks, when its
whole code is at one free place), the script writes the new line numbers of that block into the note: the block heading, the block's row in the Level 2 table, the line numbers of
its line-table rows, and its entries in masked_lines. It writes nothing else, never renames or deletes a note, and
says what it wrote in WROTE lines. The report that follows shows the state after the writing.

--hash prints the value for the source_hash property: one line per file, and for several files one more line with
the value for a Mechanism or Flow note that has these files as its sources.

Exit code 0: every block is same, no line is unexplained and no source_hash differs: nothing to update.
1: at least one block is moved, changed or ambiguous, a line is unexplained, a source_hash differs, a note's source
file is gone, or a note could not be read or written. 2: wrong arguments, or a folder that does not exist.
"""
import argparse
import difflib
import json
import os
import re
import sys
from bisect import bisect_left
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import (MASK, SOURCE_HASH, cells, fence_mask, file_hash, files_hash, frontmatter, in_scope,  # noqa: E402
                     is_row, line_set, mask_fits, normalize_scopes, note_blocks, on_disk, read_text, source_lines,
                     utf8_output)

PLACES = 200_000        # places all blocks of one note together may keep; each block keeps PLACES / blocks
SEARCH_WORK = 40_000_000    # line comparisons all blocks of one note together may make while looking for places
ORDER_WORK = 5_000_000      # steps of the proof that no equally good way leaves a block out
SHOWN = 12              # places or ranges written out in one line of the plain report
RANGE = re.compile(r"\(lines? \d+(?:\s*-\s*\d+)?\)(\s*)$")
ROW_NUMBER = re.compile(r"^(\s*\|\s*)(\d+)(?:(\s*-\s*)(\d+))?(\s*\|)")
LEVEL2_LINES = re.compile(r"^(\s*\|[^|]*\|\s*)\d+(?:\s*-\s*\d+)?(\s*\|)")


def span(a, b):
    return f"{a}" if a == b else f"{a}-{b}"


def spans(ranges):
    shown = ", ".join(span(a, b) for a, b in ranges[:SHOWN])
    return shown + (f" and {len(ranges) - SHOWN} more" if len(ranges) > SHOWN else "")


# ---------------------------------------------------------------- places where a block's code matches

class Text:
    """The source lines, each distinct line numbered once, so that comparing lines is comparing numbers."""

    def __init__(self, lines):
        self.lines = lines
        self.ids, self.first, self.at = {}, [], []   # line -> number; number -> the line; number -> where it is
        self.seq = []
        for i, line in enumerate(lines):
            n = self.ids.setdefault(line, len(self.first))
            if n == len(self.first):
                self.first.append(line)
                self.at.append([])
            self.at[n].append(i)
            self.seq.append(n)
        self.fits = {}                               # (copied line, number of a source line) -> bool


def outward(positions, target):
    """The positions (in rising order), nearest to target first."""
    right = bisect_left(positions, target)
    left = right - 1
    while left >= 0 or right < len(positions):
        if right >= len(positions) or (left >= 0 and target - positions[left] <= positions[right] - target):
            yield positions[left]
            left -= 1
        else:
            yield positions[right]
            right += 1


def places(text, code, first_line, declared, keep, budget):
    """Every start (0-based) where the whole code matches, in rising order, the nearest to the recorded line first
    when there are more than `keep` or the work passes `budget`. Returns (starts, possible places, whether cut)."""
    total, length = len(text.lines), len(code)
    if length == 0 or length > total:
        return [], 0, False
    exact, patterns = [], []                         # (place in the block, number) and (place in the block, line)
    for k, line in enumerate(code):
        if MASK in line and (first_line + k) in declared:
            if line.strip() == MASK:
                continue                             # [masked] alone: any line
            if line.replace(MASK, "").strip():
                patterns.append((k, line))
                continue
        n = text.ids.get(line)                       # no mask it may use: only an equal line matches
        if n is None:
            return [], 0, False
        exact.append((k, n))
    if exact:
        anchor, number = min(exact, key=lambda kn: len(text.at[kn[1]]))
        positions = text.at[number]
        others = [kn for kn in exact if kn[0] != anchor]
    else:
        anchor, positions, others = 0, range(total - length + 1), []
    whole = [n for _, n in exact] if len(exact) == length else None
    found, work, cut, seq = [], 0, False, text.seq
    for position in outward(positions, first_line - 1 + anchor):
        start = position - anchor
        if start < 0 or start + length > total:
            continue
        if len(found) >= keep or work > budget:
            cut = True
            break
        if whole is not None:
            work += length
            ok = seq[start:start + length] == whole
        else:
            ok = True
            for k, n in others:
                work += 1
                if seq[start + k] != n:
                    ok = False
                    break
            for k, line in patterns if ok else ():
                key = (line, seq[start + k])
                answer = text.fits.get(key)
                if answer is None:
                    real = text.first[key[1]]
                    work += 1 + len(real) // 16
                    answer = text.fits[key] = mask_fits(line, real)
                work += 1
                if not answer:
                    ok = False
                    break
        if ok:
            found.append(start)
    return sorted(found), len(positions), cut


# ---------------------------------------------------------------- the best way to place the blocks

class Best:
    """The best (most blocks, then smallest sum of distances) among the entries at or below a position."""

    def __init__(self, size):
        self.size, self.count, self.cost = size, [0] * (size + 1), [0] * (size + 1)

    def add(self, at, count, cost):
        counts, costs = self.count, self.cost
        while at <= self.size:
            if count > counts[at] or (count == counts[at] and cost < costs[at]):
                counts[at], costs[at] = count, cost
            at += at & -at

    def find(self, at):
        count, cost, counts, costs = 0, 0, self.count, self.cost
        while at > 0:
            if counts[at] > count or (counts[at] == count and costs[at] < cost):
                count, cost = counts[at], costs[at]
            at -= at & -at
        return count, cost


def assign(blocks, found, total):
    """For each block (in the order given) the list of its starts that are part of a best way, and whether an
    equally good way leaves the block out. `blocks` are (recorded first line, number of lines); `found` their
    starts. Returns (best starts per block, left out per block, blocks whose left-out proof was not finished)."""
    count = len(blocks)
    order = sorted(range(count), key=lambda i: blocks[i][0])     # stable: equal first lines keep the note's order
    forward, up = Best(total + 1), [None] * count
    for o in range(count):
        first, length = blocks[order[o]]
        values = []
        for start in found[order[o]]:
            c, k = forward.find(start)               # entries are kept at (end line + 1): those that end before
            values.append((c + 1, k + abs(start + 1 - first)))
        for start, (c, k) in zip(found[order[o]], values):
            forward.add(start + length, c, k)
        up[o] = values
    best = forward.find(total + 1)

    backward, down, in_best = Best(total + 1), [None] * count, [None] * count
    for o in range(count - 1, -1, -1):
        first, length = blocks[order[o]]
        values, mine = [], []
        for j, start in enumerate(found[order[o]]):
            c, k = backward.find(total - start - length + 1)     # those that start after this end
            values.append((c + 1, k + abs(start + 1 - first)))
            if (up[o][j][0] + c, up[o][j][1] + k) == best:
                mine.append(j)
        for start, (c, k) in zip(found[order[o]], values):
            backward.add(total - start + 1, c, k)
        down[o], in_best[o] = values, mine

    # A block that one best way places and another, equally good, leaves out. Possible only when more blocks have a
    # place in some best way than one way holds.
    left_out, unproven, work = [False] * count, [], 0
    if sum(1 for mine in in_best if mine) > best[0]:
        after = Best(total + 1)                      # the blocks after block o
        for o in range(count - 1, -1, -1):
            if in_best[o]:
                skipped = after.find(total + 1) == best          # nothing placed before it either
                for before in range(o):
                    if skipped or work > ORDER_WORK:
                        break
                    length, starts = blocks[order[before]][1], found[order[before]]
                    for j in in_best[before]:
                        work += 1
                        c, k = after.find(total - starts[j] - length + 1)
                        if (up[before][j][0] + c, up[before][j][1] + k) == best:
                            skipped = True
                            break
                if work > ORDER_WORK and not skipped:
                    skipped = True                   # not proven either way: reported as ambiguous, and named
                    unproven.append(order[o])
                left_out[o] = skipped
            for start, (c, k) in zip(found[order[o]], down[o]):
                after.add(total - start + 1, c, k)
    best_starts, out = [None] * count, [False] * count
    for o in range(count):
        best_starts[order[o]] = [found[order[o]][j] for j in in_best[o]]
        out[order[o]] = left_out[o]
    return best_starts, out, unproven


# ---------------------------------------------------------------- one note against its source

def ranges_of(numbers):
    """Sorted line numbers as [first, last] ranges of lines that follow each other."""
    result = []
    for n in numbers:
        if result and n == result[-1][1] + 1:
            result[-1][1] = n
        else:
            result.append([n, n])
    return result


def compare(note_lines, props, lines):
    """The state of every block of one File note against the source lines. Returns a dict for the report."""
    mask = fence_mask(note_lines)
    blocks = note_blocks(note_lines, mask)
    total = len(lines)
    declared = line_set(props.get("masked_lines", ""), 10 ** 9)
    text = Text(lines)
    keep = max(1, PLACES // max(1, len(blocks)))
    budget = SEARCH_WORK // max(1, len(blocks))
    found, bounded, problems = [], [], []
    ids = [block["id"] for block in blocks]
    for block_id in sorted({i for i in ids if ids.count(i) > 1}):
        problems.append(f"two '### Block {block_id}' sections")
    for block in blocks:
        if block["first"] is None:
            problems.append(f"block {block['id']} has no code fence")
        starts, possible, cut = places(text, block["code"], block["a"], declared, keep, budget)
        if cut:
            bounded.append(f"block {block['id']}: its code may be at up to {possible} places; only the "
                           f"{len(starts)} found nearest to line {block['a']} were looked at")
        found.append(starts)
    best_starts, left_out, unproven = assign([(b["a"], len(b["code"])) for b in blocks], found, total)
    for index in unproven:
        bounded.append(f"block {blocks[index]['id']}: whether an equally good placing leaves it out was not worked "
                       f"out (too many equal places); it is reported as ambiguous")

    covered, result = [False] * total, []
    for index, block in enumerate(blocks):
        length, a, b = len(block["code"]), block["a"], block["b"]
        entry = {"id": block["id"], "from": a, "to": b, "lines": length}
        best = best_starts[index]
        if len(best) == 1 and not left_out[index]:
            start = best[0]
            covered[start:start + length] = [True] * length
            entry["at"] = [start + 1, start + length]
            entry["state"] = "same" if start + 1 == a and b == a + length - 1 else "moved"
            if any(got != real for got, real in zip(block["code"], lines[start:start + length])):
                entry["masked"] = True
        elif best:
            entry["state"] = "ambiguous"
            entry["candidates"] = [start + 1 for start in best]
        else:
            entry["state"] = "changed"
        result.append(entry)
    # A changed block whose whole code is in the source at lines no placed block holds: it moved past other blocks.
    # When there is one such place and no other block's code fits there too, --fix-moved may write it.
    for index, entry in enumerate(result):
        length = entry["lines"]
        free = [s for s in found[index] if not any(covered[s:s + length])] if entry["state"] == "changed" else []
        if free:
            entry["elsewhere"] = [[s + 1, s + length] for s in free[:SHOWN]]
    claims = [tuple(e["elsewhere"][0]) for e in result if len(e.get("elsewhere", ())) == 1]
    for entry in result:
        if len(entry.get("elsewhere", ())) == 1:
            a, b = entry["elsewhere"][0]
            if sum(1 for c, d in claims if c <= b and a <= d) == 1:
                entry["moved_to"] = [a, b]

    # Unexplained: non-blank lines outside every block that has one sure place.
    bare = [i + 1 for i in range(total) if not covered[i] and lines[i].strip()]
    unexplained = [{"from": a, "to": b, "beside": [], "code_of": []} for a, b in ranges_of(bare)]
    for entry in result:
        for a, b in entry.get("elsewhere", ()):
            for u in unexplained:
                if u["from"] <= b and a <= u["to"]:
                    u["code_of"].append(entry["id"])

    # For a block without a sure place: where it was expected, and the unexplained lines between the placed blocks
    # around it, which may hold its new form.
    order = sorted(range(len(blocks)), key=lambda i: blocks[i]["a"])
    loose = None
    for rank, index in enumerate(order):
        entry = result[index]
        if "at" in entry:
            continue
        before = next((result[i] for i in reversed(order[:rank]) if "at" in result[i]), None)
        after = next((result[i] for i in order[rank + 1:] if "at" in result[i]), None)
        low = before["at"][1] + 1 if before else 1
        high = after["at"][0] - 1 if after else total
        near = before or after
        shift = near["at"][0] - near["from"] if near else 0
        first = min(max(entry["from"] + shift, 1), max(total, 1))
        entry["expected"] = [first, min(max(entry["to"] + shift, first), max(total, 1))]
        gap = [u for u in unexplained if u["from"] >= low and u["to"] <= high]
        for u in gap:
            u["beside"].append(entry["id"])
        if entry["state"] != "changed":
            continue
        entry["new_form"] = [[u["from"], u["to"]] for u in gap]
        entry["gone"] = not gap
        entry["between"] = [before["id"] if before else None, after["id"] if after else None]
        code = blocks[index]["code"]
        gap_lines = [n for u in gap for n in range(u["from"], u["to"] + 1)]
        if code and gap_lines and len(code) * len(gap_lines) <= 400_000:
            # The lines of the old code that are still there, in order: they narrow down where the new form is.
            matcher = difflib.SequenceMatcher(None, code, [lines[n - 1] for n in gap_lines], autojunk=False)
            hits = [gap_lines[m.b + k] for m in matcher.get_matching_blocks() for k in range(m.size)
                    if lines[gap_lines[m.b + k] - 1].strip()]
            if hits:
                entry["likely"] = [hits[0], hits[-1]]
                entry["lines_still_there"] = [len(hits), sum(1 for line in code if line.strip())]
        if not found[index] and code:
            # The same code with other white space at the ends of lines.
            if loose is None:
                loose = Text([line.rstrip() for line in lines])
            nearly = places(loose, [line.rstrip() for line in code], blocks[index]["a"], declared, 1, budget)[0]
            if nearly:
                entry["spaces_only"] = True
                entry["likely"] = [nearly[0] + 1, nearly[0] + len(code)]
    counts = {state: sum(1 for e in result if e["state"] == state) for state in ("same", "moved", "changed", "ambiguous")}
    return {"blocks": result, "counts": counts, "unexplained": unexplained, "bounded": bounded, "problems": problems,
            "lines": total, "_blocks": blocks, "_mask": mask, "_declared": declared}


# ---------------------------------------------------------------- writing the new lines of moved blocks

def fix_moved(path, report):
    """Writes the new line numbers of every moved block into the note. Returns (what was written, error or None)."""
    data = Path(path).read_bytes()
    bom = b"\xef\xbb\xbf" if data.startswith(b"\xef\xbb\xbf") else b""
    try:
        text = data[len(bom):].decode("utf-8")
    except UnicodeDecodeError:
        return [], "the note is not UTF-8; nothing written"
    pieces = re.split(r"(\r\n|\r|\n)", text)
    lines, ends = pieces[0::2], pieces[1::2] + [""]
    mask, blocks, declared = report["_mask"], report["_blocks"], set(report["_declared"])
    if len(lines) != len(mask):
        return [], "the note changed while it was read; nothing written"
    wrote, masked_changed = [], False
    level2 = next((i for i, line in enumerate(lines) if not mask[i] and line.startswith("## Level 2")), None)
    level2_end = len(lines) if level2 is None else next(
        (i for i in range(level2 + 1, len(lines)) if not mask[i] and lines[i].startswith("## ")), len(lines))
    moved_from, moved_to = set(), set()
    for block, entry in zip(blocks, report["blocks"]):
        if entry["state"] != "moved" and "moved_to" not in entry:
            continue
        new_a, new_b = entry["at"] if entry["state"] == "moved" else entry["moved_to"]
        delta, new_range = new_a - block["a"], span(new_a, new_b)
        heading = lines[block["start"]]
        word = "line" if new_a == new_b else "lines"
        lines[block["start"]] = RANGE.sub(lambda m: f"({word} {new_range}){m.group(1)}", heading)
        done = [f"heading (lines {span(block['a'], block['b'])}) -> ({word} {new_range})"]
        if entry["state"] != "moved":
            done.append("its code was there whole, past other blocks")
        rows = 0
        for i in range(block["last"], block["end"]):
            m = None if mask[i] or not delta else ROW_NUMBER.match(lines[i])
            if m:
                second = f"{m.group(3)}{int(m.group(4)) + delta}" if m.group(4) else ""
                lines[i] = f"{m.group(1)}{int(m.group(2)) + delta}{second}{m.group(5)}" + lines[i][m.end():]
                rows += 1
        if rows:
            done.append(f"{rows} line-table rows moved by {delta:+d}")
        for i in range(level2 + 1, level2_end) if level2 is not None else ():
            if not mask[i] and is_row(lines[i]) and (cells(lines[i]) or [""])[0] == block["id"]:
                changed = LEVEL2_LINES.sub(lambda m: f"{m.group(1)}{new_range}{m.group(2)}", lines[i], count=1)
                if changed != lines[i]:
                    lines[i] = changed
                    done.append("Level 2 row")
                break
        old = {n for n in declared if block["a"] <= n < block["a"] + len(block["code"])}
        if old and delta:
            moved_from |= old
            moved_to |= {n + delta for n in old}
            masked_changed = True
        wrote.append(f"block {block['id']}: " + ", ".join(done))
    if masked_changed:
        value = ", ".join(span(a, b) for a, b in ranges_of(sorted((declared - moved_from) | moved_to)))
        for i in range(1, len(lines)):
            if lines[i].strip() == "---":
                break
            if lines[i].split(":", 1)[0].strip() == "masked_lines":
                lines[i] = f"masked_lines: {value}"
                wrote.append(f"masked_lines: {value}")
                break
    if not wrote:
        return [], None
    new = bom + "".join(line + end for line, end in zip(lines, ends)).encode("utf-8")
    temp = Path(str(path) + ".argus-tmp")
    try:
        temp.write_bytes(new)
        os.replace(temp, path)
    except OSError as error:
        try:
            temp.unlink()
        except OSError:
            pass
        return [], f"could not write the note: {error}"
    return wrote, None


# ---------------------------------------------------------------- main

def note_report(path, root, scopes, fix):
    """The report of one note, or None when it is not a File note of this skill or its source is out of scope."""
    text = read_text(path)[0].replace("\r\n", "\n").replace("\r", "\n")
    props = frontmatter(text)
    if props.get("written_by", "").lower() != "argus" or props.get("type") != "file":
        return None
    given = props.get("source", "").replace("\\", "/")
    src = on_disk(root, given) if given else None
    if not in_scope(src or given.strip("/"), scopes):
        return None
    report = {"note": path.stem, "path": str(path), "source": src or given, "depth": props.get("depth", ""),
              "wrote": []}
    if not src:
        report.update(source_gone=True, blocks=[], unexplained=[], bounded=[], lines=0,
                      counts={"same": 0, "moved": 0, "changed": 0, "ambiguous": 0},
                      problems=[f"property 'source' names no file under the source root: '{given}'. When the file "
                                f"was deleted, remove the note as the vault's rules say"])
        report["source_hash"] = {"recorded": props.get("source_hash") or None, "now": None, "state": "none"}
        return report
    lines, _ = source_lines(Path(root) / src)
    found = compare(text.split("\n"), props, lines)
    if fix and any(e["state"] == "moved" or "moved_to" in e for e in found["blocks"]):
        wrote, error = fix_moved(path, found)
        if error:
            found["problems"].append(error)
        elif wrote:
            text = read_text(path)[0].replace("\r\n", "\n").replace("\r", "\n")
            props = frontmatter(text)
            problems = found["problems"]
            found = compare(text.split("\n"), props, lines)
            found["problems"] = problems
            report["wrote"] = wrote
    recorded, now = props.get("source_hash", ""), file_hash(Path(root) / src)
    state = "none" if not recorded else "same" if recorded == now else "differs"
    if recorded and not SOURCE_HASH.fullmatch(recorded):
        found["problems"].append("property 'source_hash' is not 'sha256:' and 64 hex digits")
    report["source_hash"] = {"recorded": recorded or None, "now": now, "state": state}
    report.update({key: value for key, value in found.items() if not key.startswith("_")})
    return report


def needs_update(report):
    counts = report["counts"]
    return bool(counts["moved"] or counts["changed"] or counts["ambiguous"] or report["unexplained"]
                or report["problems"] or report["source_hash"]["state"] == "differs")


def print_report(report):
    counts, name = report["counts"], report["note"]
    hash_state = {"same": "source_hash same", "differs": f"source_hash differs, now {report['source_hash']['now']}",
                  "none": f"no source_hash, now {report['source_hash']['now']}"}[report["source_hash"]["state"]]
    for item in report["wrote"]:
        print(f"WROTE {name}: {item}")
    print(f"NOTE {name}: {report['source']}, {report['lines']} lines, {len(report['blocks'])} blocks: "
          f"{counts['same']} same, {counts['moved']} moved, {counts['changed']} changed, {counts['ambiguous']} "
          f"ambiguous; {len(report['unexplained'])} unexplained ranges; {hash_state}")
    for item in report["problems"]:
        print(f"PROBLEM {name}: {item}")
    for item in report["bounded"]:
        print(f"BOUNDED {name}: {item}")
    def at(a, b):
        return ("line " if a == b else "lines ") + span(a, b)

    for entry in report["blocks"]:
        was = f"block {entry['id']} ({at(entry['from'], entry['to'])})"
        if entry["state"] == "moved":
            print(f"MOVED {was}: now {at(*entry['at'])}")
        elif entry["state"] == "ambiguous":
            starts = entry["candidates"]
            more = f" and {len(starts) - SHOWN} more" if len(starts) > SHOWN else ""
            if len(starts) == 1:
                print(f"AMBIGUOUS {was}: its code is at line {starts[0]}, and another block with the same code "
                      f"fits there as well")
            else:
                print(f"AMBIGUOUS {was}: the same code starts at lines {', '.join(map(str, starts[:SHOWN]))}{more}")
        elif entry["state"] == "changed":
            if "moved_to" in entry:
                parts = [f"its whole code is at {at(*entry['moved_to'])}, past other blocks: no rewrite, --fix-moved "
                         f"writes the new lines"]
            elif "elsewhere" in entry:
                parts = [f"its whole code is at lines {spans(entry['elsewhere'])}, past other blocks: no rewrite, "
                         f"choose the place and set the block's line numbers by hand"]
            else:
                parts = [f"expected at {at(*entry['expected'])}"]
                if entry.get("spaces_only"):
                    parts.append(f"at {at(*entry['likely'])} only white space at line ends differs")
                elif entry["gone"]:
                    parts.append("its code is gone: no unexplained line between the placed blocks around it")
                else:
                    parts.append(f"its new form may be in lines {spans(entry['new_form'])}")
                    if "likely" in entry:
                        still, of = entry["lines_still_there"]
                        parts.append(f"{still} of its {of} non-blank lines are still there, in "
                                     f"{at(*entry['likely'])}")
            print(f"CHANGED {was}: " + "; ".join(parts))
    for u in report["unexplained"]:
        if u["code_of"]:
            why = f"holds the whole code of block {', '.join(u['code_of'])}, which moved past other blocks"
        elif u["beside"]:
            why = f"beside block {', '.join(u['beside'])}, which has no sure place: may be its new form"
        else:
            why = "new code: no changed block beside it"
        print(f"UNEXPLAINED {at(u['from'], u['to'])}: {why}")


def main():
    utf8_output()
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--notes", help="folder that holds the notes this skill wrote")
    ap.add_argument("--source", required=True, help="source root; each File note's 'source' property is relative to it")
    ap.add_argument("--scope", action="append", default=[],
                    help="a folder or file under the source root; repeatable. Only File notes of source files in "
                         "scope are compared. Default, and '.': the whole source root")
    ap.add_argument("--fix-moved", action="store_true",
                    help="write the new line numbers of blocks that only moved into their notes")
    ap.add_argument("--json", action="store_true", help="print one JSON object instead of lines")
    ap.add_argument("--hash", nargs="+", metavar="FILE",
                    help="print the source_hash value of these source files (paths under the source root) and stop")
    args = ap.parse_args()
    root = Path(args.source)
    if not root.is_dir():
        ap.error(f"not a folder: {root}")
    try:
        scopes = normalize_scopes(root, args.scope)
        names = normalize_scopes(root, args.hash or [])
    except SystemExit as error:
        ap.error(str(error.code))
    if args.hash:
        if len(names) != len(args.hash) or not all((root / name).is_file() for name in names):
            ap.error("--hash takes files under the source root")
        for name in names:
            print(f"{file_hash(root / name)}  {name}")
        if len(names) > 1:
            print(f"{files_hash(root, names)}  together, for a note with these files as its sources")
        sys.exit(0)
    if not args.notes or not Path(args.notes).is_dir():
        ap.error(f"--notes must name a folder: {args.notes}")
    notes_dir = Path(args.notes)
    reports = []
    for path in sorted(notes_dir.rglob("*.md")):
        if any(part.startswith(".") for part in path.relative_to(notes_dir).parts[:-1]):
            continue
        try:
            report = note_report(path, root, scopes, args.fix_moved)
        except OSError as error:
            report = {"note": path.stem, "path": str(path), "source": "", "depth": "", "wrote": [], "blocks": [],
                      "unexplained": [], "bounded": [], "lines": 0, "problems": [f"could not be read: {error}"],
                      "counts": {"same": 0, "moved": 0, "changed": 0, "ambiguous": 0},
                      "source_hash": {"recorded": None, "now": None, "state": "none"}}
        if report:
            reports.append(report)
    todo = [r for r in reports if needs_update(r)]
    totals = {state: sum(r["counts"][state] for r in reports) for state in ("same", "moved", "changed", "ambiguous")}
    verdict = "UPDATE NEEDED" if todo else "CURRENT"
    code = 1 if todo else 0
    if args.json:
        json.dump({"result": verdict, "exit_code": code, "scope": scopes, "totals": totals,
                   "unexplained_ranges": sum(len(r["unexplained"]) for r in reports),
                   "notes_to_update": [r["note"] for r in todo], "notes": reports},
                  sys.stdout, indent=2, ensure_ascii=False)
        sys.exit(code)
    for report in reports:
        print_report(report)
    where = ", ".join(scopes) if scopes else "whole source root"
    print(f"RESULT scope {where}: {len(reports)} File notes, {sum(len(r['blocks']) for r in reports)} blocks: "
          f"{totals['same']} same, {totals['moved']} moved, {totals['changed']} changed, {totals['ambiguous']} "
          f"ambiguous, {sum(len(r['unexplained']) for r in reports)} unexplained ranges, "
          f"{sum(len(r['wrote']) for r in reports)} written: {verdict}")
    sys.exit(code)


if __name__ == "__main__":
    main()
