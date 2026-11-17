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
             beside it that may be its new form, and whether it is gone
  displaced  the code is unchanged and whole in the source, but past other blocks (two functions changed places):
             the lines where it is now are given. It is not a changed block and nothing of it is rewritten
  ambiguous  the same code is at several places and the order of the blocks does not decide which
  undecided  the search was cut short (BOUNDED): the block's place is not sure, or none was found before the
             limit. It is not a changed block: its code may be in the source as it was

It also gives the ranges of non-blank source lines that no placed block covers (unexplained), and whether the
note's source_hash still equals the file.

The placing rule is the one the VS Code extension uses. Blocks keep the order of their recorded first lines. Among
all ways to put blocks, in that order and without overlap, at places where their whole code matches, the script
takes the one that places the most blocks, then the one with the smallest sum of distances from the recorded lines.
A block that an equally good way places elsewhere, or leaves out, is ambiguous. Lines with [masked] match as in
check_notes.py. On a file where one block's code is at very many places the work is bounded: the places nearest to
the recorded line are looked at, and the report says so in a BOUNDED line.

Without --fix-moved nothing is written. With it, for each block that only moved, the script writes the new line
numbers of that block into the note: the block heading, the block's row in the Level 2 table, the line numbers of
its line-table rows, and its entries in masked_lines. A block that moved past other blocks counts too, but only
when its whole code is at one free place that no other block without a sure place could take. The Line column of the Trace table moves too. So --fix-moved writes a number only in a table column whose heading
is Line or Lines, never in another table, a code fence, inline code, a Code cell or a sentence. A row that looks
like a line row in a table without such a heading is named in a TODO line. Every 'line N' in the note's text that a move touches
("Check your understanding", "Part of line N", a sentence) is named in a TODO line, with its place and the likely
new number, for a person. The script writes nothing else, never renames or deletes a note, and says what it wrote in WROTE lines. Two runs cannot write one
note at the same time. A note that changed after it was compared is not written: its bytes are read again as the
last thing before the new text takes its place. What remains is a save by another program in the instant between
that reading and the replace. The report that follows
shows the state after the writing.

--hash prints the value for the source_hash property: one line per file. A note with one source file (a File note,
or a Mechanism or Flow note with one file in its sources) takes that file's value. For several files there is one
more line, with the value for a Mechanism or Flow note that has all these files as its sources.

Each UNEXPLAINED line also gives the id a new block at those lines would get: the id of the block above plus a
letter, never an id in use and never one the note's property retired_blocks lists.

Mechanism and Flow notes whose 'sources' name a file in scope are looked at too: one whose source_hash no longer
equals its sources, or that has none, gets a TODO line (in --json: "dependent_notes").

Blocks whose order changed get a TODO line too (in --json: "reordered"): a block found past other blocks, or
block sections that stand in the note in another order than their lines in the file. The same code in another
order can do another thing. The line stays until the sections of the note are in file order.

What is still to do for a note is said in TODO lines (in --json: "todo"): act on the blocks, close the note
(line count, commit, source_hash, written), correct line numbers that other notes cite. The last line says CURRENT
only when no note has a TODO line. A note without source_hash has one: it gets the property.

A note whose 'source' names no file is told apart: GONE (the file is not there, but the sources of other notes
are: it was deleted or renamed) or PROBLEM (the path is no path of a file under the source root, or no note's
source is found there: the property or --source is wrong, and nothing is to be removed).

--hash prints nothing and ends with exit code 1 when a file cannot be read.

CURRENT means: the code copied into every block equals the source, and every source_hash equals its file. The
script cannot know whether an explanation is right; it compares code and hashes only.

Exit code 0: CURRENT, the script found nothing to do for any note. 1: no File note of this skill is in scope (NO FILE NOTE IN
SCOPE: check --notes and --scope), or at least one note has a TODO line (a block is moved,
changed, ambiguous or undecided, a line is unexplained, a source_hash differs or is missing, something was just
written, a source file is gone, or there is a PROBLEM). 2: wrong arguments, or a folder that does not exist.
"""
import argparse
import difflib
import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
import time
from bisect import bisect_left, bisect_right
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import (MASK, SOURCE_HASH, cells, cut_ranges, fence_mask, file_hash, files_hash,  # noqa: E402
                     frontmatter, in_ranges, in_scope, is_row, line_ranges, link_names, mask_fits, merge_ranges,
                     missing_under_root,
                     normalize_scopes, note_blocks, on_disk, plain_relative, read_text, retired_ids, source_lines, source_set, utf8_output,
                     without_inline_code)

PLACES = 200_000        # places all blocks of one note together may keep; each block keeps PLACES / blocks
SEARCH_WORK = 40_000_000    # line comparisons all blocks of one note together may make while looking for places
HINT_WORK = 3_000_000       # lines of old code times lines beside it, for the "lines still there" hints of one note
ORDER_WORK = 5_000_000      # steps of the proof that no equally good way leaves a block out
STATES = ("same", "moved", "changed", "displaced", "ambiguous", "undecided")
SHOWN = 12              # places or ranges written out in one line of the plain report
LOCK_WAIT = 30          # seconds --fix-moved waits for another run that holds the same note
RANGE = re.compile(r"\(lines? \d+(?:\s*-\s*\d+)?\)(\s*)$")
LINE_CELL_TEXT = re.compile(r"(\s*)(\d{1,9})(?:(\s*-\s*)(\d{1,9}))?(\s*)")
LINE_HEADINGS = ("line", "lines")   # the headings of a line column in note-templates.md: the Level 2 table has
#                                     "Lines", the line table and the Trace table have "Line"


def pipe_cells(row):
    """(start, end) of the text of each cell of a table row: what stands between two | that are not escaped."""
    edges = [m.start() for m in re.finditer(r"(?<!\\)\|", row)]
    return [(a + 1, b) for a, b in zip(edges, edges[1:])]


def line_column(heading_row):
    """Which column of a table is a line column: the one whose heading is Line or Lines, else None. --fix-moved
    writes a number only in such a column, so a table of examples (| Input | Output |) is never touched."""
    return next((k for k, (a, b) in enumerate(pipe_cells(heading_row))
                 if heading_row[a:b].strip().lower() in LINE_HEADINGS), None)


def tables(lines, mask, start, end):
    """The tables between two places of a note, each as the list of the indices of its rows. A table is rows that
    follow each other; any line that is no table row, or is inside a code fence, ends it."""
    found, rows = [], []
    for i in range(start, end):
        if not mask[i] and is_row(lines[i]):
            rows.append(i)
        elif rows:
            found.append(rows)
            rows = []
    return found + ([rows] if rows else [])


def line_cells(lines, table):
    """The line-number cells of ONE table: for each row under the heading row whose cell in the column headed Line
    or Lines holds nothing but a line number or a range, (index of the row, start of the cell, end of the cell, the
    match of LINE_CELL_TEXT). The second value says whether the table has such a column at all. Everything this
    function knows it takes from the table it is given, so nothing of one table can reach the next."""
    column = line_column(lines[table[0]])
    if column is None:
        return [], False
    found = []
    for i in table[1:]:
        cells_at = pipe_cells(lines[i])
        if column < len(cells_at):
            a, b = cells_at[column]
            m = LINE_CELL_TEXT.fullmatch(lines[i][a:b])
            if m:
                found.append((i, a, b, m))
    return found, True


def numbers_of(m):
    return [int(m.group(2))] + ([int(m.group(4))] if m.group(4) else [])


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
    when there are more than `keep` or the work passes `budget`. `declared` are the ranges of masked_lines.
    Returns (starts, possible places, whether cut)."""
    total, length = len(text.lines), len(code)
    if length == 0 or length > total:
        return [], 0, False
    exact, patterns = [], []                         # (place in the block, number) and (place in the block, line)
    for k, line in enumerate(code):
        if MASK in line and in_ranges(declared, first_line + k):
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
    declared = line_ranges(props.get("masked_lines", ""))
    text = Text(lines)
    keep = max(1, PLACES // max(1, len(blocks)))
    budget = SEARCH_WORK // max(1, len(blocks))
    found, bounded, problems, cut_short = [], [], [], set()
    last_known = max([total] + [max(b["b"], b["a"] + len(b["code"]) - 1) for b in blocks])
    for a, b in declared:
        if b > last_known:
            problems.append(f"masked_lines names {'line' if a == b else 'lines'} {span(a, b)}, outside the file "
                            f"(1-{total}) and outside every block")
    ids = [block["id"] for block in blocks]
    for block_id in sorted({i for i in ids if ids.count(i) > 1}):
        problems.append(f"two '### Block {block_id}' sections: --fix-moved writes nothing for this note until each "
                        f"block has its own id")
    for block in blocks:
        if block["first"] is None:
            problems.append(f"block {block['id']} has no code fence")
        starts, possible, cut = places(text, block["code"], block["a"], declared, keep, budget)
        if cut:
            cut_short.add(len(found))
            bounded.append(f"block {block['id']}: its code may be at up to {possible} places; only the "
                           f"{len(starts)} found nearest to line {block['a']} were looked at")
        found.append(starts)
    if cut_short:
        bounded.append("the search was cut short for this note, so --fix-moved writes no move for it. A block "
                       "that is not at its recorded lines, or whose own search stopped at its limit, is undecided: "
                       "it is not a changed block and does not count towards rewriting the note. Look at it in the "
                       "file")
    best_starts, left_out, unproven = assign([(b["a"], len(b["code"])) for b in blocks], found, total)
    for index in unproven:
        bounded.append(f"block {blocks[index]['id']}: whether an equally good placing leaves it out was not worked "
                       f"out (too many equal places); it is reported as ambiguous")

    covered, result = [False] * total, []
    for index, block in enumerate(blocks):
        length, a, b = len(block["code"]), block["a"], block["b"]
        entry = {"id": block["id"], "from": a, "to": b, "lines": length}
        best = best_starts[index]
        if len(best) == 1 and not left_out[index] and cut_short and not (best[0] + 1 == a and b == a + length - 1):
            # The block is not at its recorded lines, and places of some block of this note were left out of the
            # search. The best way to place the blocks could be another one with those places, also for a block
            # that has one place only. So no move of this note is sure, and none is written.
            entry["state"] = "undecided"
            entry["proposed"] = [best[0] + 1, best[0] + length]
        elif len(best) == 1 and not left_out[index]:
            start = best[0]
            covered[start:start + length] = [True] * length
            entry["at"] = [start + 1, start + length]
            entry["state"] = "same" if start + 1 == a and b == a + length - 1 else "moved"
            if any(got != real for got, real in zip(block["code"], lines[start:start + length])):
                entry["masked"] = True
        elif best:
            entry["state"] = "ambiguous"
            entry["candidates"] = [start + 1 for start in best]
        elif index in cut_short or (cut_short and found[index]):
            # No place in the best way, but the search stopped at its limit for this block, or it has places and
            # another block's search stopped. Its code may well be in the source unchanged. Only a search that ran
            # to its end and found the code nowhere says "changed".
            entry["state"] = "undecided"
        else:
            entry["state"] = "changed"
        result.append(entry)
    # A block without a place whose whole code is in the source at lines no placed block holds: it moved past
    # other blocks. It becomes 'displaced'.
    # --fix-moved may write such a move only when it is the block's one free place and no other block without a
    # sure place could take any of those lines: not a changed block, not an ambiguous one, at none of its places.
    # When the search for places was cut short somewhere, places may be unseen, and no such move is offered.
    for index, entry in enumerate(result):
        length = entry["lines"]
        free = [s for s in found[index] if not any(covered[s:s + length])] if entry["state"] == "changed" else []
        if free:
            # Its code is not changed: it is whole in the source, at lines no placed block holds, only not where
            # the order of the blocks allows it. That is a block out of place, not a block to rewrite.
            entry["state"] = "displaced"
            entry["elsewhere"] = [[s + 1, s + length] for s in free[:SHOWN]]
            entry["_free"] = free
    for index, entry in enumerate(result):
        if len(entry.get("_free", ())) != 1 or bounded:
            continue
        a, b = entry["_free"][0], entry["_free"][0] + entry["lines"] - 1       # 0-based, both ends in
        rivals = (s for other, e in enumerate(result) if other != index and "at" not in e
                  for s in found[other] if s <= b and a <= s + e["lines"] - 1)
        if next(rivals, None) is None:
            entry["moved_to"] = [a + 1, b + 1]
    for entry in result:
        entry.pop("_free", None)

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
    # Blocks without a sure place that follow each other share the same two placed neighbours and so the same gap:
    # it is worked out once for the group, not once for each block. The hints of all blocks of the note share one
    # budget of work, and one line says when hints were left out.
    order = sorted(range(len(blocks)), key=lambda i: blocks[i]["a"])
    starts_of_ranges = [u["from"] for u in unexplained]
    loose, hint_work, hints_left_out = None, HINT_WORK, 0
    rank, before = 0, None
    while rank < len(order):
        if "at" in result[order[rank]]:
            before = result[order[rank]]
            rank += 1
            continue
        stop = rank
        while stop < len(order) and "at" not in result[order[stop]]:
            stop += 1
        group, after = order[rank:stop], (result[order[stop]] if stop < len(order) else None)
        rank = stop
        low = before["at"][1] + 1 if before else 1
        high = after["at"][0] - 1 if after else total
        near = before or after
        shift = near["at"][0] - near["from"] if near else 0
        # An unexplained range never crosses a placed block, so the ranges that start in the gap lie in it.
        gap = unexplained[bisect_left(starts_of_ranges, low):bisect_right(starts_of_ranges, high)]
        ids = [result[i]["id"] for i in group]
        for u in gap:
            u["beside"] = ids[:SHOWN]
            if len(ids) > SHOWN:
                u["beside_more"] = len(ids) - SHOWN
        ranges, gap_starts = [[u["from"], u["to"]] for u in gap], [u["from"] for u in gap]
        gap_size, gap_lines = sum(b - a + 1 for a, b in ranges), None
        for index in group:
            entry = result[index]
            first = min(max(entry["from"] + shift, 1), max(total, 1))
            entry["expected"] = [first, min(max(entry["to"] + shift, first), max(total, 1))]
            if entry["state"] != "changed":
                continue
            # The ranges nearest to where the block was expected; how many more there are is said beside them.
            at = max(0, min(bisect_left(gap_starts, first) - 1, len(ranges) - SHOWN))
            entry["new_form"] = ranges[at:at + SHOWN]
            if len(ranges) > SHOWN:
                entry["new_form_more"] = len(ranges) - SHOWN
            entry["gone"] = not gap
            entry["between"] = [before["id"] if before else None, after["id"] if after else None]
            code = blocks[index]["code"]
            cost = len(code) * gap_size
            if code and gap_size and cost <= 400_000:
                if cost > hint_work:
                    hints_left_out += 1
                else:
                    hint_work -= cost
                    if gap_lines is None:
                        gap_lines = [n for a, b in ranges for n in range(a, b + 1)]
                    # The lines of the old code that are still there, in order: they narrow down where the new
                    # form is.
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
    if hints_left_out:
        bounded.append(f"the hint 'lines still there' was left out for {hints_left_out} changed blocks: the note has "
                       f"more changed code than the script allows itself work for. Read the lines named for them")
    # The id a new block would get at each unexplained range: the id of the block above it plus a letter, never an
    # id the note uses or has retired.
    retired = retired_ids(props)
    taken = {block["id"] for block in blocks} | set(retired)
    placed = sorted((e["at"][1], e["id"]) for e in result if "at" in e)
    for u in unexplained:
        above = next((block_id for end, block_id in reversed(placed) if end < u["from"]), "0")
        u["new_id"] = next_id(above, taken)
        taken.add(u["new_id"])
    for block_id in sorted({block["id"] for block in blocks} & set(retired)):
        problems.append(f"block {block_id} uses an id that retired_blocks lists")
    counts = {state: sum(1 for e in result if e["state"] == state) for state in STATES}
    cites = cited_lines(note_lines, mask, blocks, result)
    # Blocks whose order changed. Same code in another order can do another thing (what runs first), and no
    # comparison of code sees it. Two signs: a block whose whole code is found past other blocks, and block
    # sections that stand in the note in another order than their lines in the file. The second sign stays after
    # --fix-moved wrote the new lines, until the sections of the note are put in file order. A shift of all blocks
    # by the same number of lines is neither.
    reordered = [f"block {e['id']} is past other blocks now (lines {span(e['from'], e['to'])} before, "
                 + (f"lines {span(*e['moved_to'])} now)" if "moved_to" in e else f"lines {spans(e['elsewhere'])} now)")
                 for e in result if "moved_to" in e or "elsewhere" in e]
    placed = [e for e in result if "at" in e]        # in the order of their sections in the note
    for earlier, later in zip(placed, placed[1:]):
        if later["at"][0] < earlier["at"][0]:
            reordered.append(f"block {later['id']} (lines {span(*later['at'])}) stands before block {earlier['id']} "
                             f"(lines {span(*earlier['at'])}) in the file, and after it in the note")
    # For each changed block: the places of the same note that name it or its lines. What they say rests on the
    # old code, and no check can see whether it still holds, so they are named for the one who rewrites the block.
    level2 = next((i for i, line in enumerate(note_lines) if not mask[i] and line.startswith("## Level 2")), None)
    level2_end = len(note_lines) if level2 is None else next(
        (i for i in range(level2 + 1, len(note_lines)) if not mask[i] and note_lines[i].startswith("## ")), len(note_lines))
    level2_rows = {(cells(note_lines[i]) or [""])[0]: i + 1
                   for table in (tables(note_lines, mask, level2 + 1, level2_end)[:1] if level2 is not None else ())
                   for i in table[1:]}
    for entry in result:
        if entry["state"] == "changed":
            mine = [c for c in cites if entry["id"] in c["blocks"]]
            entry["in_note"] = {"level2_row": level2_rows.get(entry["id"]),
                                "trace_rows": sorted({c["at"] + 1 for c in mine if c["trace"]}),
                                "cites": sorted({c["at"] + 1 for c in mine if not c["trace"]})}
    return {"blocks": result, "counts": counts, "unexplained": unexplained, "bounded": bounded, "problems": problems,
            "lines": total, "retired_blocks": retired, "reordered": reordered, "_blocks": blocks, "_mask": mask,
            "_declared": declared, "_cites": cites}


CITE = re.compile(r"\b([Ll]ines?\s+)(\d{1,9})(?:(\s*(?:-|to|and)\s*)(\d{1,9}))?")


def cited_lines(note, mask, blocks, entries):
    """The places where the File note cites a line number of its source outside the numbers of the blocks
    themselves: 'line 12' or 'lines 12-14' in its text, and the Line column of the Trace table. Each is a dict:
    at (index of the note line), start and end (where the numbers stand in that line), old (the numbers), new (the
    numbers after the blocks' moves, or None when a block of them has no sure place) and sure. A citation is sure,
    and --fix-moved writes it, only when it is a cell of the Trace table's Line column: a cell that holds nothing
    but a line number. 'line N' in a sentence is never written: it may stand in quoted code, or mean a line of
    another file. It is given to a person to look at, with the likely new number. Text inside code spans is not
    read at all. Citations of lines in blocks that are the same are left out."""
    spans = sorted((b["a"], b["a"] + max(len(b["code"]), 1) - 1, k) for k, b in enumerate(blocks))

    def owner(n):
        return next((k for a, b, k in spans if a <= n <= b), None)

    def delta(k):
        entry = entries[k]
        if entry["state"] in ("same", "moved"):
            return entry["at"][0] - entry["from"]
        return entry["moved_to"][0] - entry["from"] if "moved_to" in entry else None

    props_end = next((i for i in range(1, len(note)) if note[i].strip() == "---"), 0) if note and note[0] == "---" else -1
    headings = {block["start"] for block in blocks}
    found = []

    def cite(i, start, end, numbers, joins, in_trace):
        owners = [owner(n) for n in numbers]
        if all(k is None for k in owners):
            return                                   # lines of no block: blank lines, or not lines of this file
        deltas = [None if k is None else delta(k) for k in owners]
        if all(d == 0 for d in deltas):
            return
        known = all(d is not None for d in deltas)
        new = [n + d for n, d in zip(numbers, deltas)] if known else None
        sure = known and len(set(owners)) == 1 and in_trace
        text = None if new is None else joins[0].join(map(str, new)) if len(new) > 1 else str(new[0])
        found.append({"at": i, "start": start, "end": end, "old": numbers, "new": new, "sure": sure, "text": text,
                      "trace": in_trace,
                      "blocks": [blocks[k]["id"] for k in owners if k is not None]})

    for i, line in enumerate(note):
        if mask[i] or i <= props_end or i in headings:
            continue
        for m in CITE.finditer(without_inline_code(line)):       # places in this text are not used: never written
            numbers = [int(m.group(2))] + ([int(m.group(4))] if m.group(4) else [])
            cite(i, m.start(2), m.end(4) if m.group(4) else m.end(2), numbers, [m.group(3) or ""], False)
    # The Line column of each table of each Trace section, one table at a time.
    for start in (i for i, line in enumerate(note) if not mask[i] and line.startswith("## Trace")):
        end = next((i for i in range(start + 1, len(note)) if not mask[i] and note[i].startswith("## ")), len(note))
        for table in tables(note, mask, start + 1, end):
            for i, a, b, m in line_cells(note, table)[0]:
                cite(i, a + m.start(2), a + (m.end(4) if m.group(4) else m.end(2)), numbers_of(m),
                     [m.group(3) or ""], True)
    return found


def next_id(above, taken):
    """The id of a new block under the block `above`: its id plus the first of a, b ... z, za, zb ... that gives an
    id not in `taken` (the ids in use and the retired ones)."""
    prefix = ""
    while True:
        for letter in "abcdefghijklmnopqrstuvwxyz":
            if above + prefix + letter not in taken:
                return above + prefix + letter
        prefix += "z"


# ---------------------------------------------------------------- writing the new lines of moved blocks

class NoteLock:
    """One run at a time may read, compare and write a note. The lock is a file in ~/.argus/locks named after the
    note's path, locked through the operating system, so it is free again when the run ends, however it ends."""

    def __init__(self, path):
        home = Path(os.environ.get("ARGUS_HOME") or Path.home() / ".argus") / "locks"
        key = hashlib.sha256(os.path.normcase(str(Path(path).resolve())).encode("utf-8")).hexdigest()[:32]
        self.file, self.handle = home / f"{key}.lock", None

    def _try(self):
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(self.handle, msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(self.handle, fcntl.LOCK_EX | fcntl.LOCK_NB)

    def __enter__(self):
        self.file.parent.mkdir(parents=True, exist_ok=True)
        self.handle = os.open(self.file, os.O_RDWR | os.O_CREAT)
        stop = time.monotonic() + LOCK_WAIT
        while True:
            try:
                self._try()
                return self
            except OSError:
                if time.monotonic() > stop:
                    os.close(self.handle)
                    self.handle = None
                    raise TimeoutError(f"another run holds this note (waited {LOCK_WAIT} s)")
                time.sleep(0.2)

    def __exit__(self, *_):
        if self.handle is not None:
            try:
                if os.name == "nt":
                    import msvcrt
                    os.lseek(self.handle, 0, os.SEEK_SET)
                    msvcrt.locking(self.handle, msvcrt.LK_UNLCK, 1)
            except OSError:
                pass
            os.close(self.handle)


def decode_note(data):
    """(byte order mark, text) of a note that --fix-moved may write, or None when it is not UTF-8."""
    bom = b"\xef\xbb\xbf" if data.startswith(b"\xef\xbb\xbf") else b""
    try:
        return bom, data[len(bom):].decode("utf-8")
    except UnicodeDecodeError:
        return None


def write_note(path, compared, new):
    """Puts `new` in place of the note, when the note's bytes are still `compared`, the bytes the report was made
    from. First the new text is written to a file of this run's own (a new name, made so that nothing existing is
    opened and no link is followed). Then, as the last thing before the replace, the note is read again: only when
    it still holds the compared bytes does the new file take its place, in one step. Else the new file is removed
    and nothing is written. What remains: a save by another program in the instant between that last reading and
    the replace. Returns an error text or None."""
    path = Path(path)
    if path.is_symlink():
        return "the note is a link; nothing written"
    temp = None
    try:
        handle, temp = tempfile.mkstemp(dir=path.parent, prefix=".argus-", suffix=".tmp")
        with os.fdopen(handle, "wb") as out:
            out.write(new)
        try:
            shutil.copymode(path, temp)
        except OSError:
            pass
        if path.read_bytes() != compared:
            return "the note changed since it was compared; nothing written. Run again"
        os.replace(temp, path)
        temp = None
    except OSError as error:
        return f"could not write the note: {error}"
    finally:
        if temp is not None:                         # this run's own file, and only that one
            try:
                os.unlink(temp)
            except OSError:
                pass
    return None


def moved_text(data, report):
    """The note's bytes with the new line numbers of every moved block. `data` are the bytes `report` was made
    from. A number is written only where the place is known to hold a line number: the block heading, a table
    column headed Line or Lines (the Level 2 table, the line table of a block, the Trace table) and the property
    masked_lines. Returns (new bytes or None when nothing changes, what changed, error or None, what was left for
    a person: rows that look like line rows in a table without such a heading)."""
    left = []
    decoded = decode_note(data)
    if decoded is None:
        return None, [], "the note is not UTF-8; nothing written", left
    bom, text = decoded
    pieces = re.split(r"(\r\n|\r|\n)", text)
    lines, ends = pieces[0::2], pieces[1::2] + [""]
    mask, blocks, declared = report["_mask"], report["_blocks"], report["_declared"]
    if len(lines) != len(mask):
        return None, [], "the note does not have the lines that were compared; nothing written", left
    ids = [block["id"] for block in blocks]
    if len(set(ids)) != len(ids):
        # A row of a table is found by the block's id; with one id for two blocks a row would get the wrong lines.
        return None, [], None, left                  # the PROBLEM line of the comparison says why
    wrote, masked_changed = [], False
    # First the line numbers the note cites in its own text, where they are sure: from the right end of each line,
    # so that the places of the others in that line stay true.
    sure = [c for c in report["_cites"] if c["sure"]]
    for c in sorted(sure, key=lambda c: (c["at"], -c["start"])):
        lines[c["at"]] = lines[c["at"]][:c["start"]] + c["text"] + lines[c["at"]][c["end"]:]
    if sure:
        wrote.append(f"{len(sure)} line numbers in the Line column of the Trace table moved with their blocks")
    level2 = next((i for i, line in enumerate(lines) if not mask[i] and line.startswith("## Level 2")), None)
    level2_end = len(lines) if level2 is None else next(
        (i for i in range(level2 + 1, len(lines)) if not mask[i] and lines[i].startswith("## ")), len(lines))
    masked_new = []                                  # the masked ranges of moved blocks, at their new lines
    # The tables of the Level 2 section and their line cells, read once, before this run writes anything: each cell
    # keeps the numbers it held then. A row that starts with the id of a block this run writes is that block's row.
    level2_tables = [(table, line_cells(lines, table)) for table in
                     (tables(lines, mask, level2 + 1, level2_end) if level2 is not None else ())]
    written_ids = {block["id"] for block, entry in zip(blocks, report["blocks"])
                   if entry["state"] == "moved" or "moved_to" in entry}
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
        low, high = block["a"], block["a"] + len(block["code"]) - 1
        for table in tables(lines, mask, block["last"], block["end"]) if delta else ():
            found, has_column = line_cells(lines, table)
            if not has_column:
                # No column headed Line: nothing of this table is written. A row that starts with a line number
                # of this block may be a line row all the same, so it is named for a person.
                for i in table[1:]:
                    first = pipe_cells(lines[i])[:1]
                    m = LINE_CELL_TEXT.fullmatch(lines[i][first[0][0]:first[0][1]]) if first else None
                    if m and all(low <= n <= high for n in numbers_of(m)):
                        left.append(f"note line {i + 1}: a table row in block {block['id']} starts with "
                                    f"{m.group(0).strip()}, but its table has no column headed Line, so it was "
                                    f"not written. If it is a line row, add {delta:+d}")
                continue
            for i, a, b, m in found:
                if all(low <= n <= high for n in numbers_of(m)):     # a line of this block
                    second = f"{m.group(3)}{int(m.group(4)) + delta}" if m.group(4) else ""
                    lines[i] = f"{lines[i][:a]}{m.group(1)}{int(m.group(2)) + delta}{second}{m.group(5)}{lines[i][b:]}"
                    rows += 1
        if rows:
            done.append(f"{rows} line-table rows moved by {delta:+d}")
        # Every table of the Level 2 section, each by itself: a row that starts with the block's id gets the new
        # range in the column headed Lines. A row that holds the block's old range but does not start with its id
        # is not written: it is named for a person.
        old_range = [block["a"], block["a"] + len(block["code"]) - 1]
        level2_rows = 0
        for table, (found, has_column) in level2_tables:
            mine = [i for i in table[1:] if (cells(lines[i]) or [""])[0] == block["id"]]
            if mine and not has_column:
                left.append(f"note line {mine[0] + 1}: this table of Level 2 has no column headed Lines, so the row "
                            f"of block {block['id']} was not written. Its lines are now {new_range}")
            for i, a, b, m in found:
                if i in mine:
                    lines[i] = f"{lines[i][:a]}{m.group(1)}{new_range}{m.group(5)}{lines[i][b:]}"
                    level2_rows += 1
                elif (delta and [numbers_of(m)[0], numbers_of(m)[-1]] == old_range
                      and (cells(lines[i]) or [""])[0] not in written_ids):
                    left.append(f"note line {i + 1}: a row of Level 2 holds lines {m.group(0).strip()}, the old lines "
                                f"of block {block['id']}, but does not start with its id, so it was not written. If "
                                f"it is that block's row, its lines are now {new_range}")
        if level2_rows:
            done.append("Level 2 row" if level2_rows == 1 else f"{level2_rows} Level 2 rows")
        old, rest = cut_ranges(declared, block["a"], block["a"] + len(block["code"]) - 1)
        if old and delta:
            declared = rest
            masked_new += [[a + delta, b + delta] for a, b in old]
            masked_changed = True
        wrote.append(f"block {block['id']}: " + ", ".join(done))
    if masked_changed:
        value = ", ".join(span(a, b) for a, b in merge_ranges(declared + masked_new))
        for i in range(1, len(lines)):
            if lines[i].strip() == "---":
                break
            if lines[i].split(":", 1)[0].strip() == "masked_lines":
                lines[i] = f"masked_lines: {value}"
                wrote.append(f"masked_lines: {value}")
                break
    if not wrote:
        return None, [], None, left
    return bom + "".join(line + end for line, end in zip(lines, ends)).encode("utf-8"), wrote, None, left


# ---------------------------------------------------------------- main

def build(path, text, root, scopes, known):
    """Everything about one note, decided from its text alone: whether it is a File note of this skill, whether its
    source is in scope, where the source is, and the state of its blocks against the source as it is on disk now.
    Returns None when the note is not to be looked at, else the report (its '_found' is the comparison, or None
    when there is no source file to compare with)."""
    props = frontmatter(text)
    if props.get("written_by", "").lower() != "argus" or props.get("type") != "file":
        return None
    given = props.get("source", "").replace("\\", "/")
    src = on_disk(root, given) if given else None
    if not in_scope(src or "/".join(part for part in given.split("/") if part not in ("", ".")), scopes):
        return None
    report = {"note": path.stem, "path": str(path), "source": src or given, "depth": props.get("depth", ""),
              "wrote": [], "source_state": "found", "source_gone": False, "_found": None}
    if not src:
        report.update(blocks=[], unexplained=[], bounded=[], lines=0, problems=[],
                      counts={state: 0 for state in STATES},
                      source_hash={"recorded": props.get("source_hash") or None, "now": None, "state": "none"})
        target = Path(root) / given
        others = sum(1 for other in known["notes"] if other["path"] != str(path) and other["source"])
        if not given:
            report["source_state"] = "rejected"
            report["problems"].append("the note has no 'source' property. Remove nothing; correct the property")
        elif (plain_relative(given) is None or os.path.lexists(target)
              or not missing_under_root(root, plain_relative(given))):
            # Not a missing file. Its form is no plain path under the root (a drive, a network start, a leading
            # slash, a '..' part), or something is there that on_disk() refused (a folder, a link that leads out),
            # or the folder it would lie in is itself not under the root (a folder link that leads out). A mistake
            # in the property or in the source root.
            report["source_state"] = "rejected"
            report["problems"].append(f"property 'source' is '{given}': not the path of a file under the source root "
                                      f"(a drive or an absolute path, a path leading out of it, or no plain file). This is a mistake in the "
                                      f"property or in --source, not a deleted file. Remove nothing; tell the person")
        elif others == 0:
            report["source_state"] = "root in doubt"
            report["problems"].append(f"source '{given}' is not under the source root, and no other File note's "
                                      f"source is found there either: --source may be the wrong folder. Remove "
                                      f"nothing; tell the person")
        else:
            report["source_state"], report["source_gone"] = "gone", True
            report["gone"] = (f"source file '{given}' is not under the source root, where the sources of {others} "
                              f"other File notes are: the file was deleted or renamed")
        return report
    lines, _ = source_lines(Path(root) / src)
    found = compare(text.split("\n"), props, lines)
    recorded, now = props.get("source_hash", ""), file_hash(Path(root) / src)
    state = "none" if not recorded else "same" if recorded == now else "differs"
    if recorded and not SOURCE_HASH.fullmatch(recorded):
        found["problems"].append("property 'source_hash' is not 'sha256:' and 64 hex digits")
    report["source_hash"] = {"recorded": recorded or None, "now": now, "state": state}
    report.update({key: value for key, value in found.items() if not key.startswith("_")})
    report["_found"] = found
    report["check_lines"] = check_lines([c for c in found["_cites"] if not c["sure"]])
    return report


def check_lines(cites):
    """The line numbers a File note cites that --fix-moved does not write, as texts for a person."""
    out = []
    for c in cites:
        old = "-".join(map(str, c["old"]))
        what = (f"{c['text']} now, if it means this source file" if c["new"] is not None
                else "its block has no sure place yet")
        out.append(f"note line {c['at'] + 1} cites line {old} (block {', '.join(c['blocks'])}): {what}")
    return out


def note_text(data):
    return data.replace("\r\n", "\n").replace("\r", "\n")


def note_report(path, root, scopes, fix, known):
    """The report of one note, or None when it is not a File note of this skill or its source is out of scope."""
    report = build(path, note_text(read_text(path)[0]), root, scopes, known)
    if report is None:
        return None
    found = report["_found"]
    if fix and found and any(e["state"] == "moved" or "moved_to" in e for e in found["blocks"]):
        # Read, decide, compare and write as one step, under the note's lock. Nothing decided before the lock is
        # used: whether the note is this skill's File note, its scope, its source path, the source text and the
        # blocks are all taken again from the bytes read under the lock, and those bytes are the ones written over.
        error = None
        try:
            with NoteLock(path):
                data = Path(path).read_bytes()
                decoded = decode_note(data)
                locked = build(path, note_text(decoded[1]), root, scopes, known) if decoded else None
                if decoded is None:
                    error = "the note is not UTF-8; nothing written"
                elif locked is None or locked["_found"] is None:
                    error = ("read again under the lock, the note is no longer a File note of this skill with a "
                             "source file in scope; nothing written")
                else:
                    report = locked
                    new, wrote, error, left = moved_text(data, locked["_found"])
                    to_check = check_lines([c for c in locked["_found"]["_cites"] if not c["sure"]]) + left
                    if new is not None and not error:
                        error = write_note(path, data, new)
                    if new is not None and not error:
                        report = build(path, note_text(decode_note(new)[1]), root, scopes, known)
                        report["wrote"] = wrote
                        report["check_lines"] = to_check
        except (OSError, TimeoutError) as failure:
            error = f"nothing written: {failure}"
        if error:
            report["problems"].append(error)
    return report


def finish(report, known):
    """Adds what is still to do for the note ('todo') and drops the working parts. The run's result is CURRENT only
    when no note has anything to do, so nobody has to judge whether a step may be left out."""
    report.pop("_found", None)
    counts, todo = report["counts"], []
    hash_state = report["source_hash"]["state"]
    if report["source_state"] == "gone":
        todo.append("the source file is gone: say which file, then move or remove the note as the vault's rules "
                    "say (Later runs, step 3)")
    if (counts["changed"] or counts["displaced"] or counts["ambiguous"] or counts["undecided"] or counts["moved"]
            or report["unexplained"]
            or report["problems"]):
        todo.append("blocks: act on the lines above (Later runs, step 3)")
    if hash_state == "differs" or (report["wrote"] and hash_state != "none"):
        todo.append("close the note: the source changed. Check the line numbers it cites in its own text "
                    "(Trace, Check your understanding), set the line count in its Source line, commit, "
                    "source_hash and written, then look at the notes that cite this file (Later runs, steps 5 "
                    "and 6)")
    elif hash_state == "none" and report["source_state"] == "found":
        todo.append("close the note: it has no source_hash. Check the line numbers it cites in its own text "
                    "and the line count in its Source line, and set commit, source_hash and written (Later runs, "
                    "step 5)")
    cited_by = [other["note"] for other in known["notes"] if other["path"] != report["path"] and (
        (report["source_state"] == "found" and report["source"] in other["sources"])
        or (other["type"] in ("mechanism", "flow", "concept") and report["note"] in other["links"]))]
    report["cited_by"] = cited_by
    if (report["wrote"] or counts["moved"]) and cited_by:
        todo.append("blocks moved: correct the line numbers of this file that these notes cite (Later runs, step "
                    "6): " + ", ".join(cited_by))
    if report.get("reordered"):
        todo.append("the order of blocks changed: " + "; ".join(report["reordered"][:8])
                    + (f"; and {len(report['reordered']) - 8} more" if len(report["reordered"]) > 8 else "")
                    + ". What runs first may have changed. Re-read what rests on these blocks: the Trace, 'Check your "
                    "understanding', and the Flow and Mechanism notes; then put the block sections and the Level 2 "
                    "rows of the note in file order, which ends this line (Later runs, steps 3 and 6)")
    rewritten = [e for e in report["blocks"] if e["state"] == "changed" and "in_note" in e]
    for entry in rewritten[:10]:
        here = entry["in_note"]
        parts = [f"its Level 2 row (note line {here['level2_row']})" if here["level2_row"] else "its Level 2 row",
                 "the Level 1 lens table",
                 "the Trace" + (f" (rows at note lines {', '.join(map(str, here['trace_rows']))} name its lines)"
                                if here["trace_rows"] else ""),
                 "'Check your understanding' with its answers"]
        if here["cites"]:
            parts.append(f"the sentences at note lines {', '.join(map(str, here['cites']))}, which cite its lines")
        todo.append(f"after block {entry['id']} is rewritten, re-read in this note what rests on it and correct "
                    f"every statement and value that the changed code makes wrong: " + "; ".join(parts)
                    + ". Leave the rest (Later runs, step 3)")
    if len(rewritten) > 10:
        todo.append(f"the same for the other {len(rewritten) - 10} changed blocks")
    cites = report.get("check_lines", [])
    if cites:
        todo.append("line numbers the note cites in its own text, to correct by hand: " + "; ".join(cites[:15])
                    + (f"; and {len(cites) - 15} more" if len(cites) > 15 else ""))
    report["todo"] = todo
    return report


def survey(notes_dir, root):
    """What the notes folder holds, read once before any note is judged: for each note of this skill its type, the
    source files it names that are under the source root, and the notes it links to. From this a missing source
    file can be told from a wrong source root, and the notes that cite a file are known."""
    notes = []
    for path in note_paths(notes_dir):
        try:
            text = note_text(read_text(path)[0])
        except OSError:
            continue
        props = frontmatter(text)
        if props.get("written_by", "").lower() != "argus":
            continue
        kind = props.get("type", "")
        given = [props.get("source", "")] if kind == "file" else props.get("sources", "").split(",")
        sources = [s for s in (on_disk(root, g.strip()) for g in given if g.strip()) if s]
        lines = text.split("\n")
        fenced = fence_mask(lines)                   # links are read as the check reads them: outside code
        links = {name for i, line in enumerate(lines) if not fenced[i] for name in link_names(line)}
        notes.append({"note": path.stem, "path": str(path), "type": kind, "sources": sources, "links": links,
                      "given": [g.strip() for g in given if g.strip()], "source_hash": props.get("source_hash", ""),
                      "source": sources[0] if kind == "file" and sources else None})
    return {"notes": notes}


def dependent_notes(known, root, scopes):
    """The Mechanism and Flow notes that rest on a source file in scope, each with what is still to do for it. Such
    a note is out of date when the hash of its sources is no longer its source_hash. Without a source_hash the
    script cannot know, so the note gets one. Until then the run is not CURRENT: a run that stopped after the File
    notes must not look finished."""
    out = []
    for note in known["notes"]:
        if note["type"] not in ("mechanism", "flow") or not note["given"]:
            continue
        # Chosen by the sources the note declares, whether the files are there or not: a note whose only source
        # was deleted must not drop out.
        declared = [(given, on_disk(root, given), plain_relative(given)) for given in note["given"]]
        if scopes and not any(in_scope(found or plain, scopes) for _, found, plain in declared if found or plain):
            continue
        entry = {"note": note["note"], "path": note["path"], "type": note["type"], "state": "current", "todo": []}
        missing = [given for given, found, plain in declared if not found and plain
                   and not os.path.lexists(Path(root) / plain) and missing_under_root(root, plain)]
        if missing:
            entry["state"] = "source missing"
            entry["todo"].append(f"its source {', '.join(missing)} is not under the source root (deleted or renamed, "
                                 f"or --source is wrong): re-read the note against the code and correct it and its "
                                 f"'sources'; remove nothing without asking (Later runs, step 6)")
            out.append(entry)
            continue
        if not note["source_hash"]:
            entry["state"] = "no source_hash"
            entry["todo"].append("it has no source_hash: check the note against the code, then set its commit and "
                                 "source_hash (Later runs, step 6)")
        else:
            now, rejected = files_hash(root, note["given"])
            if rejected:
                entry["state"] = "problem"
                entry["todo"].append(f"'sources' names no file under the source root: {', '.join(rejected)}. Correct "
                                     f"the property; remove nothing")
            elif now != note["source_hash"]:
                entry["state"] = "stale"
                entry["todo"].append("its sources changed since it was written: re-read it against the code, correct "
                                     "what no longer holds, then set its commit and source_hash (Later runs, step 6)")
        out.append(entry)
    return out


def note_paths(notes_dir):
    return [path for path in sorted(Path(notes_dir).rglob("*.md"))
            if not any(part.startswith(".") for part in path.relative_to(notes_dir).parts[:-1])]


def print_report(report):
    counts, name = report["counts"], report["note"]
    now = report["source_hash"]["now"] or "not read"
    hash_state = {"same": "source_hash same", "differs": f"source_hash differs, now {now}",
                  "none": f"no source_hash, now {now}"}[report["source_hash"]["state"]]
    for item in report["wrote"]:
        print(f"WROTE {name}: {item}")
    print(f"NOTE {name}: {report['source']}, {report['lines']} lines, {len(report['blocks'])} blocks: "
          f"{counts['same']} same, {counts['moved']} moved, {counts['changed']} changed, {counts['displaced']} "
          f"displaced, {counts['ambiguous']} ambiguous, {counts['undecided']} undecided; {len(report['unexplained'])} unexplained ranges; {hash_state}")
    if report["source_state"] == "gone":
        print(f"GONE {name}: {report['gone']}")
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
        elif entry["state"] == "undecided":
            where = (f"its code is at {at(*entry['proposed'])}, but the search for places was cut short (see "
                     f"BOUNDED), so a full search could place it elsewhere" if "proposed" in entry else
                     "the search stopped at its limit before a place for it was found (see BOUNDED); its code may "
                     "be in the source unchanged")
            print(f"UNDECIDED {was}: {where}. Not a changed block. Nothing is written for it: look at the file "
                  f"and set its line numbers by hand")
        elif entry["state"] == "ambiguous":
            starts = entry["candidates"]
            more = f" and {len(starts) - SHOWN} more" if len(starts) > SHOWN else ""
            if len(starts) == 1:
                print(f"AMBIGUOUS {was}: its code is at line {starts[0]}, and another block with the same code "
                      f"fits there as well")
            else:
                print(f"AMBIGUOUS {was}: the same code starts at lines {', '.join(map(str, starts[:SHOWN]))}{more}")
        elif entry["state"] == "displaced":
            if "moved_to" in entry:
                print(f"DISPLACED {was}: its code is unchanged at {at(*entry['moved_to'])}, but the order of the "
                      f"blocks does not allow it there: it is past other blocks now. Not a changed block. "
                      f"--fix-moved writes the new lines")
            else:
                print(f"DISPLACED {was}: its code is unchanged at lines {spans(entry['elsewhere'])}, but the order "
                      f"of the blocks does not allow it there; there is more than one such place, or another block "
                      f"could be there too, or the search was cut short (BOUNDED). Not a changed block. Choose "
                      f"the place and set the block's line numbers by hand")
        elif entry["state"] == "changed":
            parts = [f"expected at {at(*entry['expected'])}"]
            if entry.get("spaces_only"):
                parts.append(f"at {at(*entry['likely'])} it differs only in spaces at line ends: check that "
                             f"no explanation or value rests on them, then copy the code again")
            elif entry["gone"]:
                parts.append("its code is gone: no unexplained line between the placed blocks around it. "
                             "When you remove the block, add its id to retired_blocks")
            else:
                more = f" (and {entry['new_form_more']} more ranges beside it)" if "new_form_more" in entry else ""
                parts.append(f"its new form may be in lines {spans(entry['new_form'])}{more}")
                if "likely" in entry:
                    still, of = entry["lines_still_there"]
                    parts.append(f"{still} of its {of} non-blank lines are still there, in "
                                 f"{at(*entry['likely'])}")
            print(f"CHANGED {was}: " + "; ".join(parts))
    for u in report["unexplained"]:
        if u["code_of"]:
            why = f"holds the whole code of block {', '.join(u['code_of'])}, which moved past other blocks"
        elif u["beside"]:
            more = f" and {u['beside_more']} more" if "beside_more" in u else ""
            why = f"beside block {', '.join(u['beside'])}{more}, which has no sure place: may be its new form"
        else:
            why = "new code: no changed block beside it"
        print(f"UNEXPLAINED {at(u['from'], u['to'])}: {why}; a new block here gets the id {u['new_id']}")
    for item in report["todo"]:
        print(f"TODO {name}: {item}")


def scope_of(root, raw):
    """A scope as a path under the source root, with /. It must lie under the root, but need not exist: the
    scope of a file that was deleted is how its GONE line is reached. A scope that exists gets its spelling on
    disk. Exits (as normalize_scopes does) when the scope leads out of the root."""
    base = os.path.abspath(root)
    full = os.path.abspath(os.path.join(base, str(raw)))
    if os.path.exists(full):
        return (normalize_scopes(root, [raw]) or [""])[0]
    try:
        inside = os.path.commonpath([os.path.normcase(base), os.path.normcase(full)]) == os.path.normcase(base)
    except ValueError:
        inside = False
    if not inside:
        sys.exit(f"--scope is not under the source root: {raw}")
    return "/".join(Path(os.path.relpath(full, base)).parts) if full != base else ""


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
        scopes = [scope_of(root, raw) for raw in args.scope]
        scopes = [] if "" in scopes else scopes
    except SystemExit as error:
        ap.error(str(error.code))
    try:
        names = normalize_scopes(root, args.hash or [])
    except SystemExit as error:
        ap.error(str(error.code).replace("--scope", "--hash"))
    if args.hash:
        if len(names) != len(args.hash) or not all((root / name).is_file() for name in names):
            ap.error("--hash takes files under the source root")
        names = source_set(root, names)[0]           # each file once, as the check counts the sources of a note
        values = [(file_hash(root / name), name) for name in names]
        unread = [name for value, name in values if value is None]
        if unread:                                   # no value is printed: a part of a hash is no hash
            sys.exit(f"changed_blocks.py: cannot read {', '.join(unread)}; no source_hash printed")
        for value, name in values:
            print(f"{value}  {name}")
        if len(names) > 1:
            print(f"{files_hash(root, names)[0]}  together, for a note with these files as its sources")
        sys.exit(0)
    if not args.notes or not Path(args.notes).is_dir():
        ap.error(f"--notes must name a folder: {args.notes}")
    notes_dir = Path(args.notes)
    known = survey(notes_dir, root)
    reports = []
    for path in note_paths(notes_dir):
        try:
            report = note_report(path, root, scopes, args.fix_moved, known)
        except OSError as error:
            # Made new for each note: no list or dict of one note's report is shared with another's.
            report = {"note": path.stem, "path": str(path), "source": "", "depth": "", "wrote": [], "blocks": [],
                      "unexplained": [], "bounded": [], "lines": 0, "source_state": "not read",
                      "source_gone": False, "problems": [f"could not be read: {error}"], "reordered": [],
                      "counts": {state: 0 for state in STATES},
                      "source_hash": {"recorded": None, "now": None, "state": "none"}}
        if report:
            reports.append(finish(report, known))
    dependents = dependent_notes(known, root, scopes)
    todo = [r for r in reports if r["todo"]] + [d for d in dependents if d["todo"]]
    totals = {state: sum(r["counts"][state] for r in reports) for state in STATES}
    # No File note in scope: nothing was compared, and that is not "current" (a wrong --notes or --scope gives it).
    verdict = "UPDATE NEEDED" if todo else "CURRENT" if reports else "NO FILE NOTE IN SCOPE"
    stale_dependents = sum(1 for d in dependents if d["todo"])
    code = 0 if verdict == "CURRENT" else 1
    if args.json:
        json.dump({"result": verdict, "exit_code": code, "scope": scopes, "totals": totals,
                   "unexplained_ranges": sum(len(r["unexplained"]) for r in reports),
                   "notes_to_update": [r["note"] for r in todo], "notes": reports,
                   "dependent_notes": dependents},
                  sys.stdout, indent=2, ensure_ascii=False)
        sys.exit(code)
    for report in reports:
        print_report(report)
    for dependent in dependents:
        for item in dependent["todo"]:
            print(f"TODO {dependent['note']}: {item}")
    where = ", ".join(scopes) if scopes else "whole source root"
    print(f"RESULT scope {where}: {len(reports)} File notes, {sum(len(r['blocks']) for r in reports)} blocks: "
          f"{totals['same']} same, {totals['moved']} moved, {totals['changed']} changed, {totals['displaced']} "
          f"displaced, {totals['ambiguous']} ambiguous, {totals['undecided']} undecided, {sum(len(r['unexplained']) for r in reports)} unexplained ranges, "
          f"{sum(len(r['wrote']) for r in reports)} written, {stale_dependents} of {len(dependents)} Mechanism "
          f"and Flow notes to look at: {verdict}")
    sys.exit(code)


if __name__ == "__main__":
    main()
