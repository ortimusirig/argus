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
when its whole code is at one free place that no other block without a sure place could take. 
The tables are the three of note-templates.md, each at the template's place and with the template's exact heading
row. The Level 2 table stands directly under the heading '## Level 2: blocks': only blank lines between. At depth
full, a block's line table stands directly after the block's code fence: only blank lines between; and the Trace
table is the first table of the Trace section, with only blank lines and sentences above it. A block's section
ends at the next #, ## or ### heading, a ## section at the next # or ## heading. A table anywhere else, or with
another heading row, is never written, and at depth map no table inside a block. Where a block at depth full has
no line table at that place, or the note no Level 2 table, a TODO line says so. Every 'line N' in the note's text that a move touches
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
from collections import Counter
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
# The only tables --fix-moved writes are the three that note-templates.md defines, found by the exact heading rows
# written there (section "File note"). A table with other headings is never written, whatever it looks like.
LEVEL2_SECTION = "## Level 2: blocks"
LEVEL2_HEADER = ["#", "Lines", "Purpose", "Why this way", "Concepts"]      # the Lines cell is written
LINE_HEADER = ["Line", "Code", "What happens", "Real value"]               # depth full: the Line cell is written
TRACE_HEADER = ["Step", "Line", "Variable", "Value"]                       # depth full: the Line cell is written


def pipe_cells(row):
    """(start, end) of the text of each cell of a table row: what stands between two | that are not escaped."""
    edges = [m.start() for m in re.finditer(r"(?<!\\)\|", row)]
    return [(a + 1, b) for a, b in zip(edges, edges[1:])]


def header_is(row, header):
    """Whether a table's heading row is this template heading, cell for cell."""
    return [row[a:b].strip() for a, b in pipe_cells(row)] == header


def new_numbers(m, numbers):
    """The text of a line cell (a match of LINE_CELL_TEXT) with other numbers: one number, or a range that keeps
    the cell's own spacing around its hyphen."""
    middle = str(numbers[0]) if numbers[0] == numbers[-1] else f"{numbers[0]}{m.group(3) or '-'}{numbers[-1]}"
    return f"{m.group(1)}{middle}{m.group(5)}"


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
    for block_id, times in sorted(Counter(block["id"] for block in blocks).items()):
        if times > 1:
            problems.append(f"two '### Block {block_id}' sections: --fix-moved writes nothing for this note until "
                            f"each block has its own id")
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
        elif entry["state"] == "changed" and found[index]:
            # Its whole code is in the source too, but only at lines that another block holds. One of the two
            # blocks may be gone, or the blocks changed places. The code itself is there, so this is no changed
            # block either, and nobody is sent to rewrite it.
            entry["state"] = "displaced"
            entry["elsewhere"] = [[s + 1, s + length] for s in found[index][:SHOWN]]
            entry["held"] = True
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
    #
    # The blocks are taken in the order of their sections in the note, which is the order of the file. The
    # recorded line numbers are no good for this once --fix-moved has written some of them: a moved block then
    # carries its new line, a changed block beside it still its old one, and sorted by those numbers a changed
    # block could land between the wrong neighbours.
    order = list(range(len(blocks)))
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
        changed_here = [result[i]["id"] for i in group if result[i]["state"] == "changed"]
        for u in gap:
            u["changed_beside"] = changed_here[:SHOWN]
            u["beside"] = ids[:SHOWN]
            if len(ids) > SHOWN:
                u["beside_more"] = len(ids) - SHOWN
        ranges, gap_starts = [[u["from"], u["to"]] for u in gap], [u["from"] for u in gap]
        gap_size, gap_lines = sum(b - a + 1 for a, b in ranges), None
        # Several changed blocks before one gap lie together in its lines: the script does not divide the lines
        # between them and calls none of them gone. A block is gone only when its gap holds no unexplained line
        # at all. What it may add as a hint is sure: the lines of a block's old code that are still there.
        several = [result[i]["id"] for i in group if result[i]["state"] == "changed"]
        too_few = len(several) > 1 and gap_size < len(several)   # fewer lines than blocks: one of them must be gone
        low_line = max(1, min(low, max(total, 1)))
        high_line = max(low_line, min(high, max(total, 1)))
        for index in group:
            entry = result[index]
            # Where the block is expected: its recorded lines, moved as its placed neighbour moved, and never
            # outside the lines between its placed neighbours.
            first = min(max(entry["from"] + shift, low_line), high_line)
            entry["expected"] = [first, min(max(entry["to"] + shift, first), high_line)]
            if entry["state"] != "changed":
                continue
            # The ranges nearest to where the block was expected; how many more there are is said beside them.
            at = max(0, min(bisect_left(gap_starts, first) - 1, len(ranges) - SHOWN))
            entry["new_form"] = ranges[at:at + SHOWN]
            if len(ranges) > SHOWN:
                entry["new_form_more"] = len(ranges) - SHOWN
            entry["gone"] = not gap                  # only an empty gap says gone, never a comparison of likeness
            if gap and len(several) > 1:
                entry["together"] = [block_id for block_id in several if block_id != entry["id"]][:SHOWN]
                entry["fewer_lines_than_blocks"] = too_few
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
    ends = [end for end, _ in placed]
    for u in unexplained:
        k = bisect_left(ends, u["from"])             # the placed blocks that end above this range
        above = placed[k - 1][1] if k else "0"
        u["new_id"] = next_id(above, taken)
        taken.add(u["new_id"])
    for block_id in sorted({block["id"] for block in blocks} & set(retired)):
        problems.append(f"block {block_id} uses an id that retired_blocks lists")
    counts = {state: sum(1 for e in result if e["state"] == state) for state in STATES}
    cites = cited_lines(note_lines, mask, blocks, result, props.get("depth", ""))
    # Blocks whose order changed. Same code in another order can do another thing (what runs first), and no
    # comparison of code sees it. Two signs: a block whose whole code is found past other blocks, and block
    # sections that stand in the note in another order than their lines in the file. The second sign stays after
    # --fix-moved wrote the new lines, until the sections of the note are put in file order. A shift of all blocks
    # by the same number of lines is neither.
    reordered = [f"block {e['id']} is past other blocks now (lines {span(e['from'], e['to'])} before, "
                 + (f"lines {span(*e['moved_to'])} now)" if "moved_to" in e else f"lines {spans(e['elsewhere'])} now)")
                 for e in result if ("moved_to" in e or "elsewhere" in e) and not e.get("held")]
    placed = [e for e in result if "at" in e]        # in the order of their sections in the note
    for earlier, later in zip(placed, placed[1:]):
        if later["at"][0] < earlier["at"][0]:
            reordered.append(f"block {later['id']} (lines {span(*later['at'])}) stands before block {earlier['id']} "
                             f"(lines {span(*earlier['at'])}) in the file, and after it in the note")
    # For each changed block: the places of the same note that name it or its lines. What they say rests on the
    # old code, and no check can see whether it still holds, so they are named for the one who rewrites the block.
    level2_rows = {(cells(note_lines[i]) or [""])[0]: i + 1 for i in (level2_table(note_lines, mask) or [0])[1:]}
    for entry in result:
        if entry["state"] == "changed":
            mine = [c for c in cites if entry["id"] in c["blocks"]]
            entry["in_note"] = {"level2_row": level2_rows.get(entry["id"]),
                                "trace_rows": sorted({c["at"] + 1 for c in mine if c["trace"]}),
                                "cites": sorted({c["at"] + 1 for c in mine if not c["trace"]})}
    return {"blocks": result, "counts": counts, "unexplained": unexplained, "bounded": bounded, "problems": problems,
            "lines": total, "retired_blocks": retired, "reordered": reordered, "_blocks": blocks, "_mask": mask,
            "_declared": declared, "_cites": cites, "_depth": props.get("depth", "")}


CITE = re.compile(r"\b([Ll]ines?\s+)(\d{1,9})(?:(\s*(?:-|to|and)\s*)(\d{1,9}))?")


def cited_lines(note, mask, blocks, entries, depth):
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
    # The Line column of the Trace table: at depth full, the table at the template's place in the Trace section.
    for i in ((trace_table(note, mask) or [0])[1:] if depth == "full" else ()):
        spans_of_row = pipe_cells(note[i])
        if len(spans_of_row) > 1:
            a, b = spans_of_row[1]
            m = LINE_CELL_TEXT.fullmatch(note[i][a:b])
            if m:
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


# ---------------------------------------------------------------- the guard of --fix-moved
#
# The writer understands a small Markdown and nothing else. Two functions stand around it, and neither shares any
# reading of the note with it: unhandled() refuses a note that holds something the writer was not made for, and
# own_check() looks at what the writer produced and lets only line numbers in known places through. A new shape
# of note is then refused or caught, not misread.

SEPARATOR_ROW = re.compile(r"\|(\s*:?-+:?\s*\|)+\s*")
OWN_HEADING = re.compile(r"### Block \w+\b.*\(lines? \d+(\s*-\s*\d+)?\)\s*")
OWN_LINE_CELL = re.compile(r"\s*\d+(\s*-\s*\d+)?\s*")


def unhandled(lines):
    """The first thing in a note that the writer of --fix-moved does not handle, as (line number, what it is), or
    None. The writer handles: code fences of backticks that start at the beginning of a line, and tables whose
    rows start at the beginning of a line, with one heading row and one separator row under it. Anything else
    that could hold or hide a table or a fence is named here: a fence of ~, a fence that is indented or stands in
    a quote or a list item, a fence that is never closed, an HTML block, an Obsidian comment, a table that is
    indented, has no separator row, or stands directly under another table or under a quote or list item, '<?' or
    '<!' outside code, and every heading that is not '#' marks at the beginning of a line followed by a space and
    text: an indented heading, an underlined heading, a heading in a quote or list item, one with a tab or
    without text. The properties block at the top is left out."""
    fence, fence_at, rows = None, 0, 0
    props = bool(lines) and lines[0].strip() == "---"        # the properties block: its lines are no Markdown
    text_above = marker_above = False                # the line before holds text; it begins with a quote or list mark
    for n, line in enumerate(lines, 1):
        if props:
            props = n == 1 or line.strip() != "---"
            continue
        text = line.lstrip(" \t")
        indent = len(line) - len(text)
        ticks = len(text) - len(text.lstrip("`"))
        if fence is not None:
            if indent == 0 and ticks >= fence and text.strip("`").strip() == "":
                fence = None
            text_above = marker_above = False
            continue
        if indent == 0 and ticks >= 3:
            fence, fence_at, rows = ticks, n, 0
            text_above = marker_above = False
            continue
        # Headings end sections. The readers know one form: # marks at the beginning of the line, then a space and
        # text. Every other form of heading is refused, not read.
        if re.match(r"#{1,6}(?:[ \t]|$)", text):
            if indent:
                return n, "a heading that does not start at the beginning of its line"
            if "\t" in line[:8].lstrip("#")[:1] or not line.strip("# \t"):
                return n, "a heading with a tab after its # marks, or without text"
        if text_above and re.fullmatch(r"[ \t]*(?:=+|-+)[ \t]*", line):
            return n, "an underlined heading (a line of = or - directly under a line of text)"
        if not text.startswith("|") and re.fullmatch(r":?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)+\|?[ \t]*", text):
            return n, "a table whose rows do not start with |"
        was_marker = marker_above
        text_above = bool(line.strip())
        if text.startswith("~~~"):
            return n, "a code fence made of ~"
        if ticks >= 3:
            return n, "a code fence that does not start at the beginning of its line"
        marker = re.match(r"(?:>\s?|[-*+]\s+|\d+[.)]\s+)+", text)
        inner = text[marker.end():] if marker else ""
        marker_above = bool(marker)
        if marker and (inner.startswith("|") or inner.startswith("```") or inner.startswith("~~~")):
            return n, "a table or a code fence inside a quote or a list item"
        if marker and re.match(r"#{1,6}(?:[ \t]|$)", inner):
            return n, "a heading inside a quote or a list item"
        if text.startswith("|") and rows == 0 and was_marker:
            return n, "a table directly under a quote or a list item"
        if re.match(r"<[A-Za-z/]", text) and not re.match(r"<[A-Za-z][A-Za-z0-9+.-]*:", text):
            return n, "an HTML block"
        outside_code = without_inline_code(line)     # the shared reader of code spans: `` ${x%% *} `` is code
        if "<?" in outside_code or "<!" in outside_code:
            return n, "a processing instruction, a declaration or an HTML comment (<? or <!)"
        if "%%" in outside_code:
            return n, "an Obsidian comment (%%)"
        if not text.startswith("|"):
            rows = 0
            continue
        if indent:
            return n, "a table row that does not start at the beginning of its line"
        rows += 1
        separator = SEPARATOR_ROW.fullmatch(line.rstrip()) is not None
        if rows == 2 and not separator:
            return n, "a table without a separator row under its heading row"
        if rows != 2 and separator:
            return n, "a table directly under another table, or one that starts with a separator row"
    if fence is not None:
        return fence_at, "a code fence that is opened and not closed"
    return None


def own_check(old, new):
    """Looks at what the writer made, by itself: `old` and `new` are the note's lines before and after. Returns
    None when every line that differs is one of the five places the templates define, and on such a line nothing
    differs but the numbers of the line range:
      (a) a block heading;
      (b) the masked_lines property;
      (c) a row of the Level 2 table: the table directly under the heading '## Level 2: blocks' (only blank
          lines between), with the template's heading row, in its Lines cell;
      (d) at depth full, a row of a block's line table: the table directly after the block's code fence (only
          blank lines between), inside the block's section, with the template's heading row, in its Line cell;
      (e) at depth full, a row of the Trace table: the first table of the Trace section, with only blank lines
          and sentences above it, with the template's heading row, in its Line cell.
    A section ends at the next heading that is not deeper than its own: a block at any #, ## or ### line.
    Else the number of the first line that breaks this (0: the number of lines changed). It reads the note in its
    own way, with its own copy of the heading rows, and uses nothing of the writer's."""
    level2_header = ["#", "Lines", "Purpose", "Why this way", "Concepts"]
    line_header = ["Line", "Code", "What happens", "Real value"]
    trace_header = ["Step", "Line", "Variable", "Value"]
    if len(old) != len(new):
        return 0
    in_props = bool(old) and old[0].strip() == "---"
    depth_full = False
    fence = None                                     # the open fence, as (its character, its length)
    section, in_block = "", False                    # the last '## ' heading; inside a block's own section
    code_seen = False                                # the block's code fence is behind us
    place = ""                                       # which template table may begin on the next row: level2, line, trace
    text_above = False                               # the line before holds text (for an underlined heading)
    kind, header = "", None                          # what the table we are in is; its heading cells
    for n, (was, now) in enumerate(zip(old, new), 1):
        props_line = in_props and n > 1
        if props_line and was.strip() == "---":
            in_props = props_line = False
        if props_line and was.split(":", 1)[0].strip() == "depth":
            depth_full = was.split(":", 1)[-1].strip().strip("\"'") == "full"
        # A fence here is any run of three or more ` or ~ at the start of a line, indented or not: wider than what
        # the writer knows, so that a table inside any kind of fence is never let through.
        text = was.lstrip(" \t>")
        mark = text[:1] if text[:3] in ("```", "~~~") else ""
        run = len(text) - len(text.lstrip(mark)) if mark else 0
        inside = fence is not None
        if fence is None and run >= 3 and not in_props:
            fence, inside = (mark, run), True
        elif fence is not None and mark == fence[0] and run >= fence[1] and text.strip(mark).strip() == "":
            fence = None
            if in_block and not code_seen:
                code_seen, place = True, "line"      # the block's code fence has just closed: its line table may follow
            else:
                place = ""
        elif inside:
            place = ""                               # a fence between a heading and a table: no template table there
        # A heading in any form ends a section here: # marks behind spaces, quote marks or list marks, with a tab
        # or with nothing after them, and a line of = or - under a line of text. Only the plain form, # marks at
        # the beginning of the line and a space, can open a section that holds a template table.
        level, plain = 0, False
        if not inside and not in_props:
            bare = re.sub(r"^(?:[ \t]*(?:>|[-*+](?=[ \t])|\d+[.)](?=[ \t])))*[ \t]*", "", was)
            marks = re.match(r"(#{1,6})(?:[ \t]|$)", bare)
            if marks:
                level, plain = len(marks.group(1)), bare == was and was[len(marks.group(1)):][:1] == " "
            elif text_above and re.fullmatch(r"[ \t]*(?:=+|-+)[ \t]*", was):
                level = 1 if "=" in was else 2
        text_above = not inside and not in_props and bool(was.strip())
        if level:
            # A heading ends what is not deeper than it: a ## section at # or ##, a block at #, ## or ###.
            if level <= 2:
                section = was.strip() if level == 2 and plain else ""
            if level <= 3:
                in_block, code_seen = level == 3 and plain and OWN_HEADING.fullmatch(was) is not None, False
            place = ("level2" if section == "## Level 2: blocks" else "trace" if section.startswith("## Trace")
                     else "") if level == 2 else ""
        first_row = False
        if inside or not was.startswith("|"):
            header, kind = None, ""
            if not inside and not level and was.strip() and place != "trace":
                place = ""                           # text before the table: only the Trace section may have it
        elif header is None:
            header, first_row = [cell.strip() for cell in re.split(r"(?<!\\)\|", was)[1:-1]], True
            kind, place = place, ""                  # the table that begins here takes the place, or has none
        if was == now:
            continue
        if inside:
            return n
        if props_line:
            if (was.startswith("masked_lines:") and now.startswith("masked_lines:")
                    and re.fullmatch(r"[\d,\s-]*", now[len("masked_lines:"):])):
                continue
            return n
        if OWN_HEADING.fullmatch(was) and OWN_HEADING.fullmatch(now):
            if was[:was.rindex("(line")] == now[:now.rindex("(line")]:
                continue
            return n
        if header is None or first_row:
            return n
        if kind == "level2" and header == level2_header:
            column = 2                               # counted in the split below, where the first part is empty
        elif kind == "line" and depth_full and in_block and header == line_header:
            column = 1
        elif kind == "trace" and depth_full and header == trace_header:
            column = 2
        else:
            return n
        before, after = re.split(r"(?<!\\)\|", was), re.split(r"(?<!\\)\|", now)
        if (len(before) != len(after) or column >= len(before)
                or any(x != y for k, (x, y) in enumerate(zip(before, after)) if k != column)
                or not OWN_LINE_CELL.fullmatch(before[column]) or not OWN_LINE_CELL.fullmatch(after[column])
                or re.sub(r"\s*-\s*|\d", "", before[column]) != re.sub(r"\s*-\s*|\d", "", after[column])):
            return n
    return None


class Refuse(Exception):
    """The writer met something it will not write around. Nothing is written for the note; the text is the reason."""


def table_at(lines, mask, start, stop, sentences=False):
    """The table that stands at the template's place after line index `start`: its rows, or None. Only blank lines
    may stand between `start` and the table's heading row, and with `sentences` also plain lines of text (the
    Trace section has a sentence there). A heading, a code fence or, without `sentences`, any text before the
    table means: there is no table at the template's place. `stop` is where the section ends."""
    i = start
    while i < stop and not mask[i] and not is_row(lines[i]):
        if lines[i].strip() and (not sentences or lines[i].startswith("#")):
            return None
        i += 1
    rows = []
    while i < stop and not mask[i] and is_row(lines[i]):
        rows.append(i)
        i += 1
    return rows or None


def next_heading(lines, mask, start, level):
    """The index of the next heading of this level or a higher one (fewer #) after `start`, outside code; else the
    end of the note. A block (###) ends at any #, ## or ### line; a ## section at any # or ## line."""
    mark = re.compile(r"#{1,%d} " % level)
    return next((i for i in range(start + 1, len(lines)) if not mask[i] and mark.match(lines[i])), len(lines))


def level2_table(lines, mask):
    """The Level 2 table of a note as the indices of its rows, or None: the table directly under the heading
    '## Level 2: blocks' (only blank lines between), when its heading row is the template's."""
    start = next((i for i, line in enumerate(lines) if not mask[i] and line.strip() == LEVEL2_SECTION), None)
    if start is None:
        return None
    rows = table_at(lines, mask, start + 1, next_heading(lines, mask, start, 2))
    return rows if rows and header_is(lines[rows[0]], LEVEL2_HEADER) else None


def trace_table(lines, mask):
    """The Trace table as the indices of its rows, or None: in the first section whose heading starts with
    '## Trace', the first table, with nothing but blank lines and sentences above it, when its heading row is the
    template's."""
    start = next((i for i, line in enumerate(lines) if not mask[i] and line.startswith("## Trace")), None)
    if start is None:
        return None
    rows = table_at(lines, mask, start + 1, next_heading(lines, mask, start, 2), sentences=True)
    return rows if rows and header_is(lines[rows[0]], TRACE_HEADER) else None


def line_cell(lines, i, column, table):
    """Where the cell of a row is, as (start, end). A row that lacks the cell is not written around: Refuse."""
    found = pipe_cells(lines[i])
    if column >= len(found):
        raise Refuse(f"note line {i + 1}: a row of the {table} lacks the cell that holds its lines. --fix-moved "
                     f"writes nothing for this note; complete the row")
    return found[column]


def moved_text(data, report):
    """The note's bytes with the new line numbers of every moved block. `data` are the bytes `report` was made
    from. A number is written in exactly five places and nowhere else: (a) the block heading, (b) the
    property masked_lines, (c) the Lines cell of the Level 2 table, and at depth full (d) the Line cell of a
    block's line table and (e) the Line cell of the Trace table. The three tables are those of note-templates.md,
    found by their exact heading rows. Returns (new bytes or None when nothing changes, what changed, error or None, what was left for
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
    strange = unhandled(lines)
    if strange:
        return None, [], (f"--fix-moved writes nothing for this note: note line {strange[0]} holds {strange[1]}, "
                          f"which the writer does not handle. Set the line numbers of the moved blocks by hand"), left
    wrote, masked_changed = [], False
    # First the line numbers the note cites in its own text, where they are sure: from the right end of each line,
    # so that the places of the others in that line stay true.
    sure = [c for c in report["_cites"] if c["sure"]]
    for c in sorted(sure, key=lambda c: (c["at"], -c["start"])):
        lines[c["at"]] = lines[c["at"]][:c["start"]] + c["text"] + lines[c["at"]][c["end"]:]
    if sure:
        wrote.append(f"{len(sure)} line numbers in the Line column of the Trace table moved with their blocks")  # (e)
    masked_new = []                                  # the masked ranges of moved blocks, at their new lines
    full = report["_depth"] == "full"                # a line table and a Trace table exist at depth full only
    level2 = level2_table(lines, mask)               # (c): None when the note has no such table at the template's place
    rows_of = {}                                     # block id -> its rows in the Level 2 table, read once
    for i in (level2 or [0])[1:]:
        rows_of.setdefault((cells(lines[i]) or [""])[0], []).append(i)
    level2_missing = False
    for block, entry in zip(blocks, report["blocks"]):
        if entry["state"] != "moved" and "moved_to" not in entry:
            continue
        new_a, new_b = entry["at"] if entry["state"] == "moved" else entry["moved_to"]
        delta, new_range = new_a - block["a"], span(new_a, new_b)
        heading = lines[block["start"]]
        word = "line" if new_a == new_b else "lines"
        lines[block["start"]] = RANGE.sub(lambda m: f"({word} {new_range}){m.group(1)}", heading)      # (a)
        done = [f"heading (lines {span(block['a'], block['b'])}) -> ({word} {new_range})"]
        if entry["state"] != "moved":
            done.append("its code was there whole, past other blocks")
        # (d) The block's line table: at depth full only, the table directly after the block's code fence (only
        # blank lines between), inside the block's own section, and only when its heading row is the template's.
        # The section ends at the next #, ## or ### heading. No other table in a block is written, at any depth.
        rows = 0
        low, high = block["a"], block["a"] + len(block["code"]) - 1
        section_end = min(block["end"], next_heading(lines, mask, block["start"], 3))
        table = table_at(lines, mask, block["last"], section_end) if full and delta and block["first"] is not None else None
        if table and header_is(lines[table[0]], LINE_HEADER):
            for i in table[1:]:
                a, b = line_cell(lines, i, 0, "line table")
                m = LINE_CELL_TEXT.fullmatch(lines[i][a:b])
                if m and all(low <= n <= high for n in numbers_of(m)):       # a line of this block
                    lines[i] = lines[i][:a] + new_numbers(m, [n + delta for n in numbers_of(m)]) + lines[i][b:]
                    rows += 1
        elif full and delta:
            left.append(f"block {block['id']}: no line table at the template's place (directly after the block's "
                        f"code, with the heading row Line, Code, What happens, Real value), so no line row was "
                        f"written. Where the block has line rows, add {delta:+d}")
        if rows:
            done.append(f"{rows} line-table rows moved by {delta:+d}")
        # (c) The block's row of the Level 2 table: the row that starts with its id, in the Lines cell.
        for i in rows_of.get(block["id"], ()):
            a, b = line_cell(lines, i, 1, "Level 2 table")
            m = LINE_CELL_TEXT.fullmatch(lines[i][a:b])
            if m:
                lines[i] = lines[i][:a] + new_numbers(m, [new_a, new_b]) + lines[i][b:]
                done.append("Level 2 row")
        level2_missing = level2_missing or level2 is None
        old, rest = cut_ranges(declared, block["a"], block["a"] + len(block["code"]) - 1)
        if old and delta:
            declared = rest
            masked_new += [[a + delta, b + delta] for a, b in old]
            masked_changed = True
        wrote.append(f"block {block['id']}: " + ", ".join(done))
    if level2_missing:
        left.append("the note has no Level 2 table at the template's place (directly under '## Level 2: blocks', "
                    "with the heading row #, Lines, Purpose, Why this way, Concepts), so no Lines cell was written. "
                    "Set them by hand")
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
                    try:
                        new, wrote, error, left = moved_text(data, locked["_found"])
                    except Refuse as refusal:
                        new, wrote, error, left = None, [], str(refusal), []
                    to_check = check_lines([c for c in locked["_found"]["_cites"] if not c["sure"]]) + left
                    if new is not None and not error:
                        # The writer's result is looked at by a check of its own before it may reach the disk.
                        split = re.compile(r"\r\n|\r|\n").split
                        bad = own_check(split(decoded[1]), split(decode_note(new)[1]))
                        if bad is not None:
                            error = (f"the writer's own check failed at note line {bad}: a difference that is no "
                                     f"line number in a block heading, in masked_lines or in a Line column. Nothing "
                                     f"written; set the line numbers of the moved blocks by hand")
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
    by_line = [other["note"] for other in known["notes"] if other["note"] in cited_by and other["cites_lines"]]
    report["cited_by_line"] = by_line
    if (report["wrote"] or counts["moved"]) and by_line:
        # A note that names a place by its block needs nothing after a move. Only 'line N' goes stale.
        todo.append("blocks moved, and these notes cite source lines as 'line N': replace each by its block "
                    "('block 29 of [[the File note]]'), once; a block citation does not go stale (Later runs, step "
                    "6): " + ", ".join(by_line))
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
                      "cites_lines": any(CITE.search(without_inline_code(line))
                                         for i, line in enumerate(lines) if not fenced[i]),
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
    hash_state = {"same": "source_hash same",
                  "differs": f"its source_hash differs from the file; the value to write is {now}",
                  "none": f"the note has no source_hash; the value to write is {now}"}[report["source_hash"]["state"]]
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
            elif entry.get("held"):
                print(f"DISPLACED {was}: its code is unchanged in the source, but only at lines another block holds "
                      f"(lines {spans(entry['elsewhere'])}). Not a changed block. Look at the file: when one of the "
                      f"two blocks is gone, remove that one; else set the line numbers by hand")
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
                if entry.get("together"):
                    parts.append(f"it lies together with changed block {', '.join(entry['together'])} in these "
                                 f"lines: divide the lines between them by reading the code"
                                 + ("; there are fewer lines than blocks, so at least one of them is gone"
                                    if entry["fewer_lines_than_blocks"] else ""))
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
        if not u["code_of"] and len(u.get("changed_beside", ())) > 1:
            together = u["changed_beside"]
            print(f"UNEXPLAINED {at(u['from'], u['to'])}: blocks {', '.join(together[:-1])} and {together[-1]} changed "
                  f"and lie together in these lines: divide the lines between them by reading the code (lines none "
                  f"of them takes would be a new block with the id {u['new_id']})")
        elif not u["code_of"] and len(u.get("changed_beside", ())) == 1:
            # The lines lie where one changed block is expected: they are most likely that block, not a new one.
            block_id = u["changed_beside"][0]
            print(f"UNEXPLAINED {at(u['from'], u['to'])}: probably the new form of block {block_id}: take these "
                  f"lines into block {block_id} when you rewrite it (lines it does not take would be a new block "
                  f"with the id {u['new_id']})")
        else:
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
        except Exception as error:                   # noqa: BLE001  one note must not end the run or hide the others
            # Made new for each note: no list or dict of one note's report is shared with another's.
            report = {"note": path.stem, "path": str(path), "source": "", "depth": "", "wrote": [], "blocks": [],
                      "unexplained": [], "bounded": [], "lines": 0, "source_state": "not read",
                      "source_gone": False, "reordered": [],
                      "problems": [f"could not be read: {error}" if isinstance(error, OSError) else
                                   f"the script failed on this note ({type(error).__name__}: {error}); nothing was "
                                   f"written for it. The other notes are reported as usual"],
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
