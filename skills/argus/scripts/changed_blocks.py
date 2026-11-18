#!/usr/bin/env python3
"""Which blocks of a File note still equal the source. Python 3.10+, standard library only. No model, no git.

  python -B changed_blocks.py --notes <notes folder> --source <source root> [--scope <path>] [--json]
  python -B changed_blocks.py --notes <notes folder> --source <source root> [--scope <path>] --fix-moved
  python -B changed_blocks.py --source <source root> --hash <source file> [<source file> ...]

What the script claims, and what it never claims:
  It claims three things: this block's code is at these lines; this block's code as copied is not in the file;
  these lines are in no block.
  It never claims that code is gone, that lines are new code, or that an explanation is right. Whether a block
  that was not found was rewritten, moved and edited, or deleted is for a person to read in the file.

For each File note (written_by: argus) whose source file is in scope, it compares the code copied into each block
with the source file as it is on disk now and gives each block one state:

  same       the code is at the recorded lines
  moved      the code is the same, at other lines; the new lines are given
  changed    not found: the code as copied is not in the file. Given: the lines where the block was expected, and
             the lines no block covers, nearest first, as places to read. In --json 'gone' is kept for programs
             and is always false; 'no_claim' says why nothing more is claimed
  displaced  the code is unchanged and whole in the source, but past other blocks (two functions changed places),
             or only at lines another block holds: the lines are given. Nothing of it is rewritten
  ambiguous  the same code is at several places and the order of the blocks does not decide which
  undecided  the search was cut short (BOUNDED): the block's place is not sure, or none was found before the
             limit. Its code may be in the source as it was
  not compared  the block has no code of its own that the script can take: no code fence in its own section, a
             code fence with no line in it, or two code fences directly under each other (a PROBLEM line says
             what to repair in the note); or it is a block with masked lines whose code is at no place (see
             "Masked lines" below: a person reads the source). It is not a changed block, and the result is
             not CURRENT while one exists. The note's form is checked in every
             run, with or without --fix-moved, before any block is compared. Only what makes a block's code,
             heading or section unsure stops the comparison, and then every block of the note is not compared:
             a property that stands twice in the properties block (the script reads the last, so which source,
             depth, masked_lines or written_by counts is not sure; the PROBLEM names the key and both lines),
             code fences that two readings of the note take differently (a line that begins with ``` and holds
             another backtick, a fence never closed, a fence of ~, an indented fence, a fence in a quote or a
             list item) and a heading in any form but # marks at the beginning of a line, a space and text.
             A line of only = or only - is such a heading (an underlined one) only directly under a line of
             paragraph text. Under a blank line, a # heading, a table, a list item, a quote, a code fence or
             another rule, a line --- is a rule, and a rule stops nothing

It also gives the ranges of non-blank source lines that no placed block covers (UNEXPLAINED: "lines no block
covers"). With each range it names the blocks that were not found, nearest first, as possible owners, and the id
a new block there would get (the id of the block above plus a letter, never an id in use or in retired_blocks):
a new block only when the lines belong to none of those blocks. The lines of a block that is not compared are
not such lines: a range that holds its recorded lines (moved as the placed block before it moved) is given as
"lines of block N, which is not compared", with no id for a new block.

A note is listed, compared and written only when its real path lies under the real path of --notes. A note file
under a folder junction or folder link that leads out of the notes folder gets one PROBLEM line ("lies outside
the notes folder by its real path: not read") and is never opened or written; the result is then not CURRENT.
This is looked at when the notes are listed and again, under the note's lock, directly before the new text takes
the note's place.

The placing rule is the one the VS Code extension uses. Blocks keep the order of their recorded first lines. Among
all ways to put blocks, in that order and without overlap, at places where their whole code matches, the script
takes the one that places the most blocks, then the one with the smallest sum of distances from the recorded lines.
A block that an equally good way places elsewhere, or leaves out, is ambiguous. On a file where one block's code
is at very many places the work is bounded: the places nearest to the recorded line are looked at, and the report
says so in a BOUNDED line.

Masked lines. A note hides a secret by writing [masked] in a code line and listing that line's number in the
property masked_lines. The script reads this in one way only and guesses nothing: a code line that holds [masked]
is a redaction exactly when masked_lines lists its number, counted from the lines in the block's heading (the
first line plus the line's place in the code). Such a line matches a source line by the text around each mask,
and [masked] alone matches any one line (the rule of check_notes.py). A [masked] line that is not listed so is
plain text and must equal the source line. A block with [masked] in its code, or with a number of masked_lines
inside the lines of its heading, is a block with masked lines. It is placed like every other block, but the
script never writes it, and it never writes the property masked_lines:
  at the lines of its heading: same;
  only at other lines: moved (or displaced). A TODO line gives the new lines and the numbers masked_lines must
    hold for it. Write by hand: its heading, its Level 2 row, at depth full its line rows, and masked_lines;
  at no place: not compared, never changed. The script cannot tell whether its code changed. Read the source
    where the block was expected. Code as it was: set its lines and masked_lines by hand. Code changed: rewrite
    that block only, never the whole note for this reason.
The other blocks of the note are compared and written as usual. One case stops the writing of a note: a number
of masked_lines would lie in the new lines of a block that is to be written. A PROBLEM line says so; set the
blocks with masked lines by hand first, then run again.

Without --fix-moved nothing is written. With it, for each block without masked lines that only moved (also past
other blocks, when its whole code is at one free place no other block could take), the script writes that block's
new line numbers in exactly three places and nowhere else:
  (a) the block heading;
  (b) the Lines cell of the block's row in the Level 2 table: the table directly under the heading
      '## Level 2: blocks' (only blank lines between), with the template's exact heading row;
  (c) at depth full, the Line cell of the rows of the block's own line table: the table directly after the code
      fence of that block (only blank lines between), inside that block's section, with the template's exact
      heading row. Each row is placed by the code it quotes, with the rule check_notes.py has for line rows:
      a row that quotes the source line it names already is left (an earlier, unfinished update set it), one
      that quotes the line it names after the block's move gets the new number, and one that fits neither way,
      or both ways with nothing in the table to decide it, is not written and is named in a TODO line.
The heading rows are those of note-templates.md. A block's section ends at the next #, ## or ### heading. No other
table is written, whatever its headings: not the Trace table, and at depth map no table inside a block. Line
numbers that a move touches anywhere else (Trace rows, "Check your understanding", "Part of line N", a sentence)
are named in TODO lines for a person. A note that holds something the writer does not handle, but that leaves
the comparison as it is (an HTML block such as a line that is only <br>, '<?' or '<!', an Obsidian comment, a
table in another form than the templates'), is compared as usual and can be CURRENT. Only when it has moved
blocks it is not written at all: one PROBLEM line names the construct and its line, with or without --fix-moved,
the MOVED lines give the new lines, the moved line numbers of that note are set by hand, and the result is not
CURRENT until they are. The writer's result is checked twice before it reaches the disk. First by a second
reading of the note: only line numbers in the three places may differ. Then, last of all, by the comparison itself:
the new text is compared once more with the same source lines, in memory, and it is written only when every block
that was moved is 'same' at its new lines, every block that was 'same' still is, no other block has a worse
state, the note has no more PROBLEM lines than before, and every line row of a moved block quotes the line it
names (but for the rows a TODO names). Else nothing is written for the note, one PROBLEM line
says so ("the result of the move did not compare as expected (block N: was moved, would be changed)"), the blocks
stay reported as they were, and the line numbers are set by hand. This check knows no shapes of note: whatever
the writer and the reader take differently shows in it.
The script never renames or deletes a note and says what it wrote in WROTE lines. Two runs
cannot write one note at the same time. A note that changed after it was compared is not written: its bytes are
read again as the last thing before the new text takes its place. What remains is a save by another program in
the instant between that reading and the replace. The report shows the state after the writing.

--hash prints the value for the source_hash property: one line per file. A note with one source file (a File note,
or a Mechanism or Flow note with one file in its sources) takes that file's value. For several files there is one
more line, with the value for a Mechanism or Flow note that has all these files as its sources. It prints nothing
and ends with exit code 1 when a file cannot be read.

Mechanism and Flow notes whose 'sources' name a file in scope are looked at too (in --json: "dependent_notes"): one
whose source_hash no longer equals its sources, or that has none, gets a TODO line. The script can know only that
the hash of all its sources together differs, not which source changed: it lists the sources, and those outside
the scope of this run.

Blocks whose order changed get a TODO line too (in --json: "reordered"): a block found past other blocks, or
block sections that stand in the note in another order than their lines in the file. The line stays until the
sections of the note are in file order.

What is still to do for a note is said in TODO lines (in --json: "todo"). The last line says CURRENT only when no
note has a TODO line. A note without source_hash has one: it gets the property. CURRENT means: the code copied
into every block equals the source, and every source_hash equals its file.

A note whose 'source' names no file is told apart: GONE (the file is not there, but the sources of other notes
are: it was deleted or renamed) or PROBLEM (the path is no path of a file under the source root, or no note's
source is found there: the property or --source is wrong, and nothing is to be removed). A property that stands
twice is looked for before anything is taken from the properties, so such a note is never GONE: it gets its PROBLEM
line and every block is not compared.

Exit code 0: CURRENT, the script found nothing to do for any note. 1: no File note of this skill is in scope (NO
FILE NOTE IN SCOPE: check --notes and --scope), or at least one note has a TODO line. 2: wrong arguments, or a
folder that does not exist.
"""
import argparse
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
                     frontmatter, in_ranges, in_scope, is_row, lies_under, line_ranges, link_names,
                     missing_under_root,
                     normalize_scopes, note_blocks, on_disk, plain_relative, read_text, retired_ids, row_quote, same_line, source_lines, source_set,
                     utf8_output,
                     without_inline_code)

PLACES = 200_000        # places all blocks of one note together may keep; each block keeps PLACES / blocks
SEARCH_WORK = 40_000_000    # line comparisons all blocks of one note together may make while looking for places
ORDER_WORK = 5_000_000      # steps of the proof that no equally good way leaves a block out
STATES = ("same", "moved", "changed", "displaced", "ambiguous", "undecided", "not compared")
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
    One reading only: a line of the code that holds [masked] is a redaction exactly when masked_lines lists its
    number counted from the block's recorded lines (first_line + its place in the code). Such a line matches a
    source line by the check's own rule (same_line): the text around each mask, and [masked] alone any one line.
    Every other line is plain text, and only an equal source line matches.
    Returns (starts, possible places, whether cut)."""
    total, length = len(text.lines), len(code)
    if length == 0 or length > total:
        return [], 0, False
    exact, masks = [], []                            # (place in the block, number); places of the redacted lines
    for k, line in enumerate(code):
        if MASK in line and in_ranges(declared, first_line + k):
            masks.append(k)
            continue
        n = text.ids.get(line)                       # plain text: only an equal line matches
        if n is None:
            return [], 0, False
        exact.append((k, n))
    if exact:
        anchor, number = min(exact, key=lambda kn: len(text.at[kn[1]]))
        positions = text.at[number]
        others = [kn for kn in exact if kn[0] != anchor]
    else:
        anchor, positions, others = 0, range(total - length + 1), []
    whole = [n for _, n in exact] if not masks else None
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
            if seq[start:start + length] == whole:
                found.append(start)
            continue
        ok = True
        for k, n in others:
            work += 1
            if seq[start + k] != n:
                ok = False
                break
        for k in masks if ok else ():
            work += 1
            line, n = code[k], seq[start + k]
            answer = text.fits.get((line, n))
            if answer is None:
                real = text.first[n]
                work += 1 + len(real) // 16
                answer = text.fits[(line, n)] = same_line(line, real, True)
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
    # The note's form comes first, in every run, whether anything is to be written or not. The guard's tests are
    # of two kinds (see STOPS_COMPARING and STOPS_WRITING). A note whose fences or headings can be read in two
    # ways can give a block code that is not its own: an unchanged block would be reported as changed. So nothing
    # is compared for such a note. Every block is 'not compared', no place and no unexplained line is stated, and
    # the one PROBLEM line says what to repair. A construct of the other kind (a line that is only <br>, a
    # comment, a table in another form) leaves the code, the headings and the sections as they are: the note is
    # compared as usual, and only the writer keeps out of it (see the end of this function).
    strange, writer_only = note_form(note_lines)
    if strange:
        result = [{"id": block["id"], "from": block["a"], "to": block["b"], "lines": 0, "no_code": True,
                   "note_form": True, "state": "not compared"} for block in blocks]
        for entry in result if len(strange) > 2 else ():
            entry["property_twice"] = True
        counts = {state: len(result) if state == "not compared" else 0 for state in STATES}
        why = strange[2] if len(strange) > 2 else "what is a block's code, heading or section is not sure there"
        problems.append(f"note line {strange[0]} holds {strange[1]}: {why}. No block of this note is compared and "
                        f"nothing is written for it: repair the note's form at that line, then run again. Rewrite "
                        f"no block for this reason")
        return {"blocks": result, "counts": counts, "unexplained": [], "bounded": bounded, "problems": problems,
                "lines": total, "retired_blocks": retired_ids(props), "reordered": [], "_blocks": blocks,
                "_mask": mask, "_declared": declared, "_cites": [], "_depth": props.get("depth", ""),
                "_form": strange}
    last_known = max([total] + [max(b["b"], b["a"] + len(b["code"]) - 1) for b in blocks])
    for a, b in declared:
        if b > last_known:
            problems.append(f"masked_lines names {'line' if a == b else 'lines'} {span(a, b)}, outside the file "
                            f"(1-{total}) and outside every block")
    for block_id, times in sorted(Counter(block["id"] for block in blocks).items()):
        if times > 1:
            problems.append(f"two '### Block {block_id}' sections: --fix-moved writes nothing for this note until "
                            f"each block has its own id")
    # The check's block reader ends a block at '##' or at the next block heading, not at '# Appendix' or at an
    # ordinary '###' heading, so it can take the first fence of a later section for the code of a block that has
    # none. The second reading: a block's section ends at the next #, ## or ### heading. A fence that the reader
    # took from beyond that is not the block's code. Nothing is compared for such a block, no place is stated for
    # it, and --fix-moved writes nothing for the note.
    for block in blocks:
        strict_end = next_heading(note_lines, mask, block["start"], 3)
        if block["first"] is not None and block["first"] >= strict_end:
            block.update(stray=strict_end + 1, code=[], first=None, last=block["end"])
            problems.append(f"block {block['id']} has no code fence in its own section; the fence that was read "
                            f"stands after the heading at note line {strict_end + 1}. Nothing is compared for this "
                            f"block, and --fix-moved writes nothing for this note")
    # The check's reader takes a run of fence lines as one fence: two code fences directly under each other (the
    # closing line of one followed at once by the opening line of the next) become one code with two fence lines
    # inside it. The second reading: the block's code is what stands between the opening line of its first fence
    # and that fence's own closing line, as CommonMark closes it. Where the two differ, nothing is compared for
    # the block, no place is stated for it, and --fix-moved writes nothing for the note.
    for block in blocks:
        if block["first"] is None:
            continue
        opener = note_lines[block["first"]]
        run = len(opener) - len(opener.lstrip("`"))
        close = next((i for i in range(block["first"] + 1, block["end"])
                      if len(note_lines[i]) - len(note_lines[i].lstrip("`")) >= run and not note_lines[i].strip("`").strip()),
                     block["end"])
        if note_lines[block["first"] + 1:close] != block["code"]:
            block.update(stray=block["first"] + 1, code=[], first=None, last=block["end"])
            problems.append(f"block {block['id']}: two code fences stand directly under each other (note line "
                            f"{close + 1}); put a line of text between them, then run again. Nothing is compared for "
                            f"this block, and --fix-moved writes nothing for this note")
    for block in blocks:
        if block["first"] is None and "stray" not in block:
            problems.append(f"block {block['id']} has no code fence")
        elif block["first"] is not None and not block["code"]:
            # The fence is there and holds no line: the code was never copied into it. Code of zero lines is in
            # no file, so a comparison would say 'changed' of a block whose source may be as it was. Nothing is
            # compared for this block. The note's form is sure, so its other blocks are compared and written as
            # usual.
            block["empty"] = True
            problems.append(f"block {block['id']}: its code fence is empty: copy the block's code into it, then "
                            f"run again")
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
    # A block with masked lines: [masked] in its code, or a number of masked_lines inside its recorded lines.
    # It is placed like every block, by the one reading of places(), and --fix-moved never writes it.
    masked = [any(MASK in line for line in b["code"])
              or bool(cut_ranges(declared, b["a"], max(b["b"], b["a"] + len(b["code"]) - 1))[0]) for b in blocks]
    best_starts, left_out, unproven = assign([(b["a"], len(b["code"])) for b in blocks], found, total)
    for index in unproven:
        bounded.append(f"block {blocks[index]['id']}: whether an equally good placing leaves it out was not worked "
                       f"out (too many equal places); it is reported as ambiguous")

    covered, result = [False] * total, []
    for index, block in enumerate(blocks):
        length, a, b = len(block["code"]), block["a"], block["b"]
        entry = {"id": block["id"], "from": a, "to": b, "lines": length}
        if masked[index]:
            entry["masked_block"] = True
        if block["first"] is None or block.get("empty"):
            entry["no_code"] = True                  # no code of its own to compare: no place is stated for it
        if block.get("empty"):
            entry["empty_fence"] = True
        best =best_starts[index]
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
        if entry.get("no_code"):
            # Nothing was compared: the note's form is at fault (see the PROBLEM line), not the block's code. Such
            # a block is no changed block and never a reason to rewrite anything.
            entry["state"] = "not compared"
        elif entry["state"] == "changed" and masked[index] and not found[index]:
            # A block with masked lines whose code is at no place. Whether a hidden value's line or the code
            # itself differs, the script cannot tell: it is never 'changed', and a person reads the source.
            entry["state"] = "not compared"
            entry["masked_not_found"] = True
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
            entry["elsewhere_count"] = len(free)     # all of them count in what follows; the list is for showing
            entry["_free"] = free
        elif entry["state"] == "changed" and found[index]:
            # Its whole code is in the source too, but only at lines that another block holds. One of the two
            # blocks may be gone, or the blocks changed places. The code itself is there, so this is no changed
            # block either, and nobody is sent to rewrite it.
            entry["state"] = "displaced"
            entry["elsewhere"] = [[s + 1, s + length] for s in found[index][:SHOWN]]
            entry["elsewhere_count"] = len(found[index])
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

    # Blocks with masked lines. For one that has a place: the lines of the block that are redactions, at their
    # numbers in that place (entry["masked_lines"]). One that is not at its recorded lines is never written: a
    # TODO line gives its new lines and the numbers masked_lines must hold for it. One with no place gets a
    # TODO line too: a person reads the source. The script changes no number of masked_lines.
    masked_todo, moved_masked, unread_masked = [], [], []
    for index, (block, entry) in enumerate(zip(blocks, result)):
        if not masked[index]:
            continue
        a, length = block["a"], len(block["code"])
        place = entry.get("at") or entry.get("moved_to")
        redacted = [place[0] + k for k, line in enumerate(block["code"])
                    if MASK in line and in_ranges(declared, a + k)] if place else []
        if redacted:
            entry["masked_lines"] = redacted
        was = f"block {entry['id']} (lines {span(a, entry['to'])})"
        if place and (entry["state"] == "moved" or "moved_to" in entry):
            old = cut_ranges(declared, a, max(entry["to"], a + length - 1))[0]
            new = ranges_of(redacted)
            moved_masked.append(f"{was} is at lines {span(*place)} now; masked_lines must hold "
                                f"{spans(new) if new else 'no number'} for it"
                                + (f", in place of {spans(old)}" if old and old != new else ""))
        elif entry.get("masked_not_found"):
            unread_masked.append(was)
    if moved_masked:
        masked_todo.append(
            "blocks with masked lines moved, and --fix-moved never writes such a block or masked_lines: "
            + "; ".join(moved_masked[:SHOWN])
            + (f"; and {len(moved_masked) - SHOWN} more blocks" if len(moved_masked) > SHOWN else "")
            + ". Write by hand, for each: the new lines in its heading and its Level 2 row, at depth full the Line "
              "cells of its line rows, and its numbers in masked_lines. Then run again (Later runs, step 3)")
    if unread_masked:
        masked_todo.append(
            "blocks with masked lines whose code is at no place, read with masked_lines as it stands: "
            + "; ".join(unread_masked[:SHOWN])
            + (f"; and {len(unread_masked) - SHOWN} more blocks" if len(unread_masked) > SHOWN else "")
            + ". The script cannot tell whether such a block's code changed. Read the source where each was expected (its NOT COMPARED line, in --json "
              "'expected', gives the lines) and decide. The code is as it was: set the block's lines and its numbers in masked_lines by hand. The "
              "code changed: rewrite this block only, never the whole note for this reason (Later runs, step 3)")


    # Unexplained: non-blank lines outside every block that has one sure place.
    # The lines of a displaced block whose one place is sure are that block's: they form ranges of their own, so
    # that the lines beside them stay "lines no block covers".
    bare = [i + 1 for i in range(total) if not covered[i] and lines[i].strip()]
    owned = {n: e["id"] for e in result if "moved_to" in e for n in range(e["moved_to"][0], e["moved_to"][1] + 1)}
    unexplained = []
    for n in bare:
        owner = owned.get(n)
        if unexplained and unexplained[-1]["to"] == n - 1 and unexplained[-1]["code_of"] == ([owner] if owner else []):
            unexplained[-1]["to"] = n
        else:
            unexplained.append({"from": n, "to": n, "beside": [], "code_of": [owner] if owner else []})

    # A block without a sure place gets no guess about where it went. The script says where it was expected (its
    # recorded lines, moved as the placed block before it in the note moved) and, for a block that was not found,
    # the lines no block covers, nearest first. Whether its code was rewritten, moved and edited, or deleted is
    # for a person to read. In the same way an unexplained range gets no "new code": it gets the blocks that were
    # not found, nearest first, as its possible owners.
    def nearest(keys, target, count):
        """The indices of the `count` keys nearest to target; `keys` are in rising order."""
        right = bisect_left(keys, target)
        left, picked = right - 1, []
        while len(picked) < count and (left >= 0 or right < len(keys)):
            if right >= len(keys) or (left >= 0 and target - keys[left] <= keys[right] - target):
                picked.append(left)
                left -= 1
            else:
                picked.append(right)
                right += 1
        return picked

    starts_of_ranges = [u["from"] for u in unexplained]
    loose, shift = None, 0
    for index, entry in enumerate(result):           # in the order of the note's sections
        if "at" in entry:
            shift = entry["at"][0] - entry["from"]
            continue
        first = min(max(entry["from"] + shift, 1), max(total, 1))
        entry["expected"] = [first, min(max(entry["to"] + shift, first), max(total, 1))]
        if entry["state"] != "changed":
            continue
        entry["gone"] = False                        # kept for programs; the script never says that code is gone
        entry["no_claim"] = ("the code as copied is not in the file; whether it was rewritten, moved and edited, or "
                             "deleted is not decided by the script")
        near = nearest(starts_of_ranges, first, SHOWN)
        entry["may_be_at"] = [[unexplained[k]["from"], unexplained[k]["to"]] for k in near]
        entry["new_form"] = entry["may_be_at"]       # the earlier name of this field
        if len(unexplained) > SHOWN:
            entry["may_be_at_more"] = len(unexplained) - SHOWN
        code = blocks[index]["code"]
        if not found[index] and code:
            # A fact, not a guess: the same code with other white space at the ends of lines.
            if loose is None:
                loose = Text([line.rstrip() for line in lines])
            nearly = places(loose, [line.rstrip() for line in code], blocks[index]["a"], declared, 1, budget)[0]
            if nearly:
                entry["spaces_only"] = True
                entry["likely"] = [nearly[0] + 1, nearly[0] + len(code)]
    not_found = sorted((e["expected"][0], e["id"]) for e in result
                       if e["state"] == "changed" or e.get("masked_not_found"))
    expected_lines = [line for line, _ in not_found]
    for u in unexplained:
        owners = [not_found[k][1] for k in nearest(expected_lines, u["from"], SHOWN)]
        u["possible_owners"] = u["beside"] = owners  # 'beside' is the earlier name of this field
        if len(not_found) > SHOWN:
            u["possible_owners_more"] = len(not_found) - SHOWN
    # Blocks without a sure place whose code is whole in the file: ambiguous ones, displaced ones with more than
    # one place, undecided ones. An unexplained range that holds one of their possible places may be theirs in
    # part. It names them, and no id for a new block is given until their place is chosen.
    def ranges_over(a, b):
        k = max(bisect_right(starts_of_ranges, a) - 1, 0)
        while k < len(unexplained) and unexplained[k]["from"] <= b:
            if unexplained[k]["to"] >= a:
                yield unexplained[k]
            k += 1

    # Every place where the whole code of such a block is found counts, also one that only partly lies in the
    # range and one that another block holds in part: all of them, not only the ones the report shows.
    for index, entry in enumerate(result):
        if "at" in entry or "moved_to" in entry or entry["state"] == "changed":
            continue
        length = entry["lines"]
        spots = [(start + 1, start + length) for start in found[index]]
        if entry["state"] == "undecided" and (not spots or index in cut_short):
            spots = [(1, total)]                     # its search was cut short: it may be anywhere
        for a, b in spots:
            for u in ranges_over(a, b):
                if u.get("_last_unplaced") != index:
                    u["_last_unplaced"] = index
                    u["unplaced_count"] = u.get("unplaced_count", 0) + 1
                    if len(u.setdefault("unplaced_here", [])) < SHOWN:
                        u["unplaced_here"].append(entry["id"])
    for u in unexplained:
        u.pop("_last_unplaced", None)
    # A block that is not compared (no code fence of its own, an empty one) has lines in the source all the same.
    # They are not "lines no block covers": they are that block's, and nobody is to write a new block for them.
    # Its recorded lines, moved as the placed block before it in the note moved, are all that is known of where
    # it is; with no placed block before it, the recorded lines as they are. Every range that holds one of those
    # lines names the block and gets no id for a new block until the note's form is repaired.
    for entry in result:
        if entry["state"] == "not compared":
            for u in ranges_over(*entry["expected"]):
                u.setdefault("not_compared", []).append(entry["id"])
    # The id a new block would get at each unexplained range: the id of the block above it plus a letter, never an
    # id the note uses or has retired.
    retired = retired_ids(props)
    taken = {block["id"] for block in blocks} | set(retired)
    placed = sorted((e["at"][1], e["id"]) for e in result if "at" in e)
    ends = [end for end, _ in placed]
    for u in unexplained:
        if u.get("unplaced_here") or u["code_of"] or u.get("not_compared"):
            continue                                 # not lines for a new block, or not yet
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
    # A construct that only the writer does not handle. The comparison above stands. It matters only when the
    # note has moves to write: then --fix-moved writes nothing for this note, and the line says so in every run
    # (without --fix-moved as a hint). A note with nothing to write gets no line and can be CURRENT.
    if writer_only and any(e["state"] == "moved" or "moved_to" in e for e in result):
        problems.append(f"note line {writer_only[0]} holds {writer_only[1]}, which the writer of --fix-moved does "
                        f"not handle. The comparison is not affected, but --fix-moved writes nothing for this note: "
                        f"set the moved line numbers of this note by hand, to the new lines that the MOVED and "
                        f"DISPLACED lines of this report give")
    return {"blocks": result, "counts": counts, "unexplained": unexplained, "bounded": bounded, "problems": problems,
            "lines": total, "retired_blocks": retired, "reordered": reordered, "masked_todo": masked_todo,
            "_blocks": blocks, "_mask": mask,
            "_declared": declared, "_cites": cites, "_depth": props.get("depth", ""), "_writer": writer_only}


CITE = re.compile(r"\b([Ll]ines?\s+)(\d{1,9})(?:(\s*(?:-|to|and)\s*)(\d{1,9}))?")


def cited_lines(note, mask, blocks, entries, depth):
    """The places where the File note cites a line number of its source outside the numbers of the blocks
    themselves: 'line 12' or 'lines 12-14' in its text, and the Line column of the Trace table. None of them is
    ever written: 'line N' in a sentence may stand in quoted code or mean a line of another file, and after a
    partial update the recorded lines of two blocks can overlap, so that a Trace row cannot be given to one block
    for sure. Each is given to a person to look at. Each is a dict: at (index of the note line), old (the
    numbers), new (the numbers after the blocks' moves, or None when that cannot be said: a block of them has no
    sure place, or more than one block's recorded lines hold a number), text, trace and blocks. Text inside code
    spans is not read. Citations of lines in blocks that are the same are left out."""
    spans = sorted((b["a"], b["a"] + max(len(b["code"]), 1) - 1, k) for k, b in enumerate(blocks))

    def owners_of(n):
        return [k for a, b, k in spans if a <= n <= b]

    def delta(k):
        entry = entries[k]
        if entry["state"] in ("same", "moved"):
            return entry["at"][0] - entry["from"]
        return entry["moved_to"][0] - entry["from"] if "moved_to" in entry else None

    props_end = next((i for i in range(1, len(note)) if note[i].strip() == "---"), 0) if note and note[0] == "---" else -1
    headings = {block["start"] for block in blocks}
    found = []

    def cite(i, start, end, numbers, joins, in_trace):
        holders = [owners_of(n) for n in numbers]
        if not any(holders):
            return                                   # lines of no block: blank lines, or not lines of this file
        one_each = all(len(h) == 1 for h in holders)
        deltas = [delta(h[0]) for h in holders] if one_each else [None]
        if one_each and all(d == 0 for d in deltas):
            return
        new = [n + d for n, d in zip(numbers, deltas)] if all(d is not None for d in deltas) else None
        text = None if new is None else joins[0].join(map(str, new)) if len(new) > 1 else str(new[0])
        found.append({"at": i, "start": start, "end": end, "old": numbers, "new": new, "sure": False, "text": text,
                      "trace": in_trace, "blocks": sorted({blocks[k]["id"] for h in holders for k in h})})

    for i, line in enumerate(note):
        if mask[i] or i <= props_end or i in headings:
            continue
        for m in CITE.finditer(without_inline_code(line)):       # places in this text are not used: never written
            numbers = [int(m.group(2))] + ([int(m.group(4))] if m.group(4) else [])
            cite(i, m.start(2), m.end(4) if m.group(4) else m.end(2), numbers, [m.group(3) or ""], False)
    # The Line column of the Trace table, at depth full: read here so that its rows can be named, never written.
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


OUTSIDE = "lies outside the notes folder by its real path"


def write_note(path, compared, new, notes_dir):
    """Puts `new` in place of the note, when the note's bytes are still `compared`, the bytes the report was made
    from. First the new text is written to a file of this run's own (a new name, made so that nothing existing is
    opened and no link is followed). Then, as the last thing before the replace, the note is read again: only when
    it still holds the compared bytes does the new file take its place, in one step. Else the new file is removed
    and nothing is written. What remains: a save by another program in the instant between that last reading and
    the replace. The note must lie under the notes folder by its real path (a folder junction or folder link
    inside the notes folder can lead out of it): that is looked at before this run's own file is made beside the
    note, and once more directly before the replace, because a folder can be pointed elsewhere in between.
    Returns an error text or None."""
    path = Path(path)
    if path.is_symlink():
        return "the note is a link; nothing written"
    if not lies_under(path, notes_dir):
        return f"the note {OUTSIDE}; nothing written"
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
        if path.is_symlink() or not lies_under(path, notes_dir) or not lies_under(temp, notes_dir):
            return f"the note {OUTSIDE} now, or became a link; nothing written"
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
# reading of the note with it: note_form() names what the note holds that the script was not made for, and
# own_check() looks at what the writer produced and lets only line numbers in known places through. A new shape
# of note is then refused or caught, not misread.
#
# What note_form() names is of two kinds, and every test of form_tests() is in exactly one of the two lists.
# The question that decides: can this construct change what the shared reader (fence_mask, note_blocks,
# next_heading) takes as a block's code, its heading or its section? Yes, or not sure: STOPS_COMPARING. No:
# STOPS_WRITING. A test whose name is in neither list fails the note (KeyError: nothing compared, nothing
# written), so a new test has to be put in one of them on purpose.

# Kind A. What is a block's code, heading or section cannot be trusted. No block of the note is compared.
STOPS_COMPARING = {
    # The reader of the properties (frontmatter()) takes the last line of a key, the writer of masked_lines and
    # other programs may take the first. The reader's choice decides what is compared: source, depth,
    # masked_lines, written_by. With any key twice, what the note means is not sure.
    "property twice": "a property that stands twice in the properties block",
    "fence two readings": "a line that is code by one reading of the note's fences and text by another",
    "fence inline": "a line that begins with ``` and holds another backtick (inline code that looks like a fence)",
    "fence of ~": "a code fence made of ~",
    "fence indented": "a code fence that does not start at the beginning of its line",
    "fence in quote or list": "a code fence inside a quote or a list item",
    "fence not closed": "a code fence that is opened and not closed",
    # A heading ends a section. The shared reader knows one form, so a heading in any other form leaves a block's
    # section longer than it is, and a fence after it can be taken for the code of a block that has none.
    "heading indented": "a heading that does not start at the beginning of its line",
    "heading tab or empty": "a heading with a tab after its # marks, or without text",
    # Only under paragraph text. A line --- under a blank line, a # heading, a table, a list item, a quote, a
    # fence or another rule is a rule: it ends no section, and no test names it.
    "heading underlined": "an underlined heading (a line of = or - directly under a line of paragraph text)",
    "heading in quote or list": "a heading inside a quote or a list item",
}
# Kind B. The writer does not handle it; code, headings and sections are read as without it. The note is compared
# as usual; only --fix-moved writes nothing for it.
STOPS_WRITING = {
    "html block": "an HTML block",
    "declaration": "a processing instruction, a declaration or an HTML comment (<? or <!)",
    "obsidian comment": "an Obsidian comment (%%)",
    "table without |": "a table whose rows do not start with |",
    "table in quote or list": "a table inside a quote or a list item",
    "table under quote or list": "a table directly under a quote or a list item",
    "table indented": "a table row that does not start at the beginning of its line",
    "table without separator": "a table without a separator row under its heading row",
    "table under table": "a table directly under another table, or one that starts with a separator row",
}
assert not set(STOPS_COMPARING) & set(STOPS_WRITING), "a test of the guard is in both lists"

SEPARATOR_ROW = re.compile(r"\|(\s*:?-+:?\s*\|)+\s*")
UNDERLINE = re.compile(r"[ \t]*(?:=+|-+)[ \t]*")                  # what can make the line above it a heading
RULE_LINE = re.compile(r"[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*")    # a rule: ---, ***, ___, also - - -
FAR = float("inf")                                               # the text column of a quote: no line reaches it
OWN_HEADING = re.compile(r"### Block \w+\b.*\(lines? \d+(\s*-\s*\d+)?\)\s*")
OWN_LINE_CELL = re.compile(r"\s*\d+(\s*-\s*\d+)?\s*")


def commonmark_fences(lines):
    """For each line: whether it is a fence line or inside a fence, by CommonMark's rule for backtick fences. A
    fence opens on a line of three or more backticks (after at most three spaces) with no backtick in the rest of
    the line; it closes on a line of at least as many backticks with nothing but spaces after them. This is a
    second reading of 'what is code', written apart from the check's fence_mask: the writer writes only where the
    two agree. ```example``` on one line is inline code here, and a fence opener for fence_mask."""
    inside, opener = [], None
    for line in lines:
        text = line.lstrip(" ")
        indent = len(line) - len(text)
        run = len(text) - len(text.lstrip("`"))
        if opener is None:
            opens = indent <= 3 and run >= 3 and "`" not in text[run:]
            opener = run if opens else None
            inside.append(opens)
        else:
            inside.append(True)
            if indent <= 3 and run >= opener and text[run:].strip() == "":
                opener = None
    return inside


def repeated_property(lines):
    """The first property that the properties block holds twice, as (key, note line of its first line, note line
    of its second), or None. The block and its keys are taken exactly as frontmatter() takes them, so that 'twice'
    means: the reader has two values for one key and keeps the last."""
    text = "\n".join(lines)
    end = text.find("\n---", 3) if text.startswith("---") else -1
    if end < 0:
        return None
    seen = {}
    for n in range(1, text.count("\n", 0, end) + 2):
        for piece in (lines[n - 1][3:] if n == 1 else lines[n - 1]).splitlines():
            if ":" in piece:
                key = piece.split(":", 1)[0].strip()
                if key in seen:
                    return key, seen[key], n
                seen[key] = n
    return None


def property_values(text):
    """Every value of every property, in the note's order: key -> list of values. The block and its lines are
    taken as frontmatter() takes them; that reader keeps only the last value of a key."""
    end = text.find("\n---", 3) if text.startswith("---") else -1
    values = {}
    for line in text[3:end].splitlines() if end >= 0 else ():
        if ":" in line:
            key, value = line.split(":", 1)
            values.setdefault(key.strip(), []).append(value.strip().strip("\"'"))
    return values


def form_tests(lines):
    """Every thing in a note that the script was not made for, in the order of the lines, as (line number, name
    of the test). The names are the keys of STOPS_COMPARING and STOPS_WRITING. The script handles: code fences of
    backticks that start at the beginning of a line, headings that are # marks at the beginning of a line
    followed by a space and text, and tables whose rows start at the beginning of a line, with one heading row
    and one separator row under it. Anything else that could hold or hide a table, a fence or a heading is named
    here: a fence of ~, a fence that is indented or stands in a quote or a list item, a fence that is never
    closed, an HTML block, an Obsidian comment, a table that is indented, has no separator row, or stands
    directly under another table or under a quote or list item, '<?' or '<!' outside code, and every other form
    of heading: an indented heading, an underlined heading, a heading in a quote or list item, one with a tab or
    without text. A line of only = or only - is an underlined heading only when the line directly above it is
    paragraph text and the line stands in that paragraph's container (see `above` below); in every other place
    a line --- is a rule and is not named. The properties block at the top is left out, but for one thing: a
    property that stands twice in it (repeated_property) is named first of all. Then the check's reading of the
    note's fences (fence_mask) and CommonMark's (commonmark_fences) must give the same lines as code.
    After a test of STOPS_COMPARING nothing more needs to be read; after one of STOPS_WRITING the reading goes
    on as if the line were plain text."""
    twice = repeated_property(lines)
    if twice:
        yield twice[2], "property twice"
    # First of all: the check's reading of the fences and CommonMark's must give the same lines as code. Where
    # they differ, the note holds a fence that can be read in two ways.
    for n, (one, other) in enumerate(zip(fence_mask(lines), commonmark_fences(lines)), 1):
        if one != other:
            yield n, "fence two readings"
            break
    fence, fence_at, rows = None, 0, 0
    props = bool(lines) and lines[0].strip() == "---"        # the properties block: its lines are no Markdown
    marker_above = False                             # the line before begins with a quote or list mark
    # For the underlined heading. Markdown makes a line of = or - a heading only under paragraph text, and only
    # in the paragraph's own container: under '- item' a line --- at the beginning of the line is a rule.
    #   above  None when the line before is no paragraph text (blank, a # heading, a rule, a row of a table, a
    #          fence, an empty list item, a quote); else the column from which a line under it is in the same
    #          container: 0 at the top level, the item's text column in a list item
    #   item   the text column of the list item that is open (FAR for a quote), or None
    #   lazy   the line before is paragraph text of that item: a line of text under it goes on with it, at any
    #          indent
    # Where the reading is not sure, the line counts as paragraph text at the top level: a heading is then
    # named that may be none, never the other way round.
    above, item, lazy = None, None, False
    table, header_cells = False, 0                   # inside a table with a separator row that fits its heading row
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
            marker_above = False
            above, item, lazy = None, None, False
            continue
        if ticks >= 3 and "`" in text[ticks:]:
            # Outside a fence, three or more backticks and another backtick after the whole run: inline code that
            # the check's fence reader takes for a fence.
            yield n, "fence inline"
        if indent == 0 and ticks >= 3:
            fence, fence_at, rows = ticks, n, 0
            marker_above = False
            above, item, lazy, table = None, None, False, False
            continue
        # Headings end sections. The readers know one form: # marks at the beginning of the line, then a space and
        # text. Every other form of heading is named, not read.
        if re.match(r"#{1,6}(?:[ \t]|$)", text):
            if indent:
                yield n, "heading indented"
            if "\t" in line[:8].lstrip("#")[:1] or not line.strip("# \t"):
                yield n, "heading tab or empty"
        wide = line.expandtabs(4)
        column = len(wide) - len(wide.lstrip(" "))
        if above is not None and column >= above and UNDERLINE.fullmatch(line):
            yield n, "heading underlined"
        if not text.startswith("|") and re.fullmatch(r":?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)+\|?[ \t]*", text):
            yield n, "table without |"
        was_marker = marker_above
        if text.startswith("~~~"):
            yield n, "fence of ~"
        if ticks >= 3:
            yield n, "fence indented"
        marker = re.match(r"(?:>\s?|[-*+]\s+|\d+[.)]\s+)+", text)
        inner = text[marker.end():] if marker else ""
        marker_above = bool(marker)
        # What this line is for a line of = or - directly under it.
        if not text.startswith("|"):
            table = False
        elif rows == 0:
            table, header_cells = False, len(pipe_cells(line))
        elif rows == 1:
            table = SEPARATOR_ROW.fullmatch(line.rstrip()) is not None and len(pipe_cells(line)) == header_cells
        if not text:
            above, lazy = None, False                # a blank line ends the paragraph; the list item stays open
        elif marker:
            lead = (line[:indent] + marker.group()).expandtabs(4)
            reach = FAR if ">" in marker.group() else len(lead)
            # Paragraph text after the mark opens a paragraph in the item. Not: nothing, a heading, a rule, a
            # fence, a table row, HTML, or text five or more columns after the mark (that is indented code).
            opens = (bool(inner.strip()) and len(lead) - len(lead.rstrip(" ")) <= 4
                     and not re.match(r"#{1,6}(?:[ \t]|$)|```|~~~|\||<", inner) and not RULE_LINE.fullmatch(inner))
            item = reach if inner.strip() else None
            above, lazy = (reach if opens and reach != FAR else None), opens
        elif (re.fullmatch(r"(?:[-*+]|\d+[.)])[ \t]*", text) or re.match(r"#{1,6}(?:[ \t]|$)", text)
              or RULE_LINE.fullmatch(line) or table):
            above, item, lazy = None, None, False    # an empty list item, a # heading, a rule, a row of a table
        elif item is not None and (lazy or column >= item) and not text.startswith("<"):
            above, lazy = (None if item == FAR else item), True      # text of the open list item or quote
        else:
            above, item, lazy = 0, None, False       # paragraph text at the top level
        if marker and (inner.startswith("```") or inner.startswith("~~~")):
            yield n, "fence in quote or list"
        if marker and inner.startswith("|"):
            yield n, "table in quote or list"
        if marker and re.match(r"#{1,6}(?:[ \t]|$)", inner):
            yield n, "heading in quote or list"
        if text.startswith("|") and rows == 0 and was_marker:
            yield n, "table under quote or list"
        if re.match(r"<[A-Za-z/]", text) and not re.match(r"<[A-Za-z][A-Za-z0-9+.-]*:", text):
            yield n, "html block"
        outside_code = without_inline_code(line)     # the shared reader of code spans: `` ${x%% *} `` is code
        if "<?" in outside_code or "<!" in outside_code:
            yield n, "declaration"
        if "%%" in outside_code:
            yield n, "obsidian comment"
        if not text.startswith("|"):
            rows = 0
            continue
        if indent:
            yield n, "table indented"
        rows += 1
        separator = SEPARATOR_ROW.fullmatch(line.rstrip()) is not None
        if rows == 2 and not separator:
            yield n, "table without separator"
        if rows != 2 and separator:
            yield n, "table under table"
    if fence is not None:
        yield fence_at, "fence not closed"


def note_form(lines):
    """What a note holds that the script was not made for, as two answers, each (line number, what it is) or None:
    the first thing that stops the comparison (STOPS_COMPARING), and the first thing above it that only stops
    the writer (STOPS_WRITING). With the first answer the second does not matter: nothing is compared and
    nothing is written."""
    writer_only = None
    for n, name in form_tests(lines):
        if name == "property twice":
            key, first, _ = repeated_property(lines)
            return (n, f"the property '{key}' a second time (the first is at note line {first})",
                    "the script reads the last of the two, another reader may take the first, so what the note is "
                    "compared with is not sure. Keep one of the two"), writer_only
        if name in STOPS_COMPARING:
            return (n, STOPS_COMPARING[name]), writer_only
        what = STOPS_WRITING[name]                   # KeyError: a test that was put in neither list
        writer_only = writer_only or (n, what)
    return None, writer_only


def unhandled(lines):
    """The thing in a note because of which --fix-moved writes nothing for it, as (line number, what it is), or
    None: what stops the comparison, else the first thing the writer does not handle."""
    stops, writer_only = note_form(lines)
    return stops or writer_only


def own_check(old, new):
    """Looks at what the writer made, by itself: `old` and `new` are the note's lines before and after. Returns
    None when every line that differs is one of the three places the writer may touch, and on such a line nothing
    differs but the numbers of the line range:
      (a) a block heading;
      (b) a row of the Level 2 table: the table directly under the heading '## Level 2: blocks' (only blank
          lines between), with the template's heading row, in its Lines cell;
      (c) at depth full, a row of a block's line table: the table directly after the block's code fence (only
          blank lines between), inside the block's section, with the template's heading row, in its Line cell.
    A row of the Trace table, or of any other table, is never one of them.
    A section ends at the next heading that is not deeper than its own: a block at any #, ## or ### line.
    Else the number of the first line that breaks this (0: the number of lines changed). It reads the note in its
    own way, with its own copy of the heading rows, and uses nothing of the writer's."""
    level2_header = ["#", "Lines", "Purpose", "Why this way", "Concepts"]
    line_header = ["Line", "Code", "What happens", "Real value"]
    if len(old) != len(new):
        return 0
    # The block headings of the new text, read here once more: id -> its lines. Every number the writer put into
    # a table must agree with them.
    heads, open_run = {}, 0
    for line in new:
        run = len(line) - len(line.lstrip("`"))
        if open_run:
            open_run = 0 if run >= open_run and not line.strip("`").strip() else open_run
        elif run >= 3 and "`" not in line[run:]:
            open_run = run
        else:
            found = re.fullmatch(r"### Block (\w+)\b.*\(lines? (\d+)(?:\s*-\s*(\d+))?\)\s*", line)
            if found:
                heads[found.group(1)] = (int(found.group(2)), int(found.group(3) or found.group(2)))
    block_id = ""                                    # the id of the block whose section we are in
    in_props = bool(old) and old[0].strip() == "---"
    depth_full = False
    fence = None                                     # the open fence, as (its character, its length)
    section, in_block = "", False                    # the last '## ' heading; inside a block's own section
    code_seen = False                                # the block's code fence is behind us
    place = ""                                       # which template table may begin on the next row: level2 or line
    moved_head = 0                                   # the line of a changed block heading whose code fence is not seen yet
    closed_at, watched = -1, 0                       # where a block's code fence closed; that block's changed heading
    # For an underlined heading, read here once more and with nothing of the guard's: a line of = or - is a
    # heading only directly under paragraph text, in that paragraph's own container.
    under = None                                     # the column from which a line is under paragraph text, or None
    in_item, runs_on = None, False                   # the open list item's text column; its paragraph goes on
    row_count, first_cells, real_table = 0, 0, False # the table we are in: rows, cells of row 1, a fitting separator
    kind, header = "", None                          # what the table we are in is; its heading cells
    for n, (was, now) in enumerate(zip(old, new), 1):
        props_line = in_props and n > 1
        if props_line and was.strip() == "---":
            in_props = props_line = False
        if props_line and was.split(":", 1)[0].strip() == "depth":
            depth_full = was.split(":", 1)[-1].strip().strip("\"'") == "full"
        # A fence here is a run of three or more ` or ~ at the start of a line, indented or not, also behind a
        # quote mark. For backticks CommonMark's rule holds: a line with another backtick after the run opens
        # nothing (it is inline code).
        text = was.lstrip(" \t>")
        mark = text[:1] if text[:3] in ("```", "~~~") else ""
        run = len(text) - len(text.lstrip(mark)) if mark else 0
        if fence is None and mark == "`" and "`" in text[run:]:
            mark, run = "", 0
        if watched and n == closed_at + 1 and fence is None and run >= 3 and not in_props:
            return watched                           # a second fence directly under the block's code fence
        if n > closed_at + 1:
            watched = 0
        inside = fence is not None
        if fence is None and run >= 3 and not in_props:
            fence, inside = (mark, run), True
        elif fence is not None and mark == fence[0] and run >= fence[1] and text.strip(mark).strip() == "":
            fence = None
            if in_block and not code_seen:
                code_seen, place = True, "line"      # the block's code fence has just closed: its line table may follow
                closed_at, watched, moved_head = n, moved_head, 0
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
            elif (under is not None and len(was.expandtabs(4)) - len(was.expandtabs(4).lstrip(" ")) >= under
                  and re.fullmatch(r"[ \t]*(?:=+|-+)[ \t]*", was)):
                level = 1 if "=" in was else 2
        # What this line is for a line of = or - directly under it. Paragraph text at the top level gives 0, in a
        # list item the item's text column. Nothing gives a column: a blank line, a line of or in a fence, the
        # properties, a # heading, a rule (---, ***, ___), an empty list item, a quote line, and a row of a
        # table that has a separator row with as many cells as its first row.
        stripped = was.lstrip(" \t")
        if inside or in_props:
            under, in_item, runs_on, row_count, real_table = None, None, False, 0, False
        else:
            if not stripped.startswith("|"):
                row_count, real_table = 0, False
            else:
                row_count += 1
                cell_count = len(re.split(r"(?<!\\)\|", was)) - 2
                if row_count == 1:
                    first_cells = cell_count
                elif row_count == 2:
                    real_table = (re.fullmatch(r"\|(?:\s*:?-+:?\s*\|)+\s*", was) is not None
                                  and cell_count == first_cells)
            mark = re.match(r"(?:>\s?|[-*+]\s+|\d+[.)]\s+)+", stripped)
            if not stripped:
                under, runs_on = None, False
            elif mark:
                before = (was[:len(was) - len(stripped)] + mark.group()).expandtabs(4)
                rest = stripped[mark.end():]
                quoted = ">" in mark.group()
                paragraph = (rest.strip() != "" and len(before) - len(before.rstrip(" ")) <= 4
                             and re.match(r"#{1,6}(?:[ \t]|$)|```|~~~|\||<", rest) is None
                             and re.fullmatch(r"[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*", rest) is None)
                in_item = None if not rest.strip() else float("inf") if quoted else len(before)
                under, runs_on = (len(before) if paragraph and not quoted else None), paragraph
            elif (level or re.fullmatch(r"(?:[-*+]|\d+[.)])[ \t]*", stripped) or real_table
                  or re.fullmatch(r"[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*", was)):
                under, in_item, runs_on = None, None, False
            elif (in_item is not None and not stripped.startswith("<")
                  and (runs_on or len(was.expandtabs(4)) - len(was.expandtabs(4).lstrip(" ")) >= in_item)):
                under, runs_on = (None if in_item == float("inf") else in_item), True
            else:
                under, in_item, runs_on = 0, None, False
        if level:
            # A heading ends what is not deeper than it: a ## section at # or ##, a block at #, ## or ###.
            if level <= 2:
                section = was.strip() if level == 2 and plain else ""
            if level <= 3:
                if moved_head:
                    return moved_head                # that block's section ended and held no code fence
                in_block, code_seen = level == 3 and plain and OWN_HEADING.fullmatch(was) is not None, False
                block_id = was.split()[2].rstrip(":") if in_block else ""
            place = "level2" if level == 2 and section == "## Level 2: blocks" else ""
        first_row = False
        if inside or not was.startswith("|"):
            header, kind = None, ""
            if not inside and not level and was.strip():
                place = ""                           # text before the table: no template table at this place
        elif header is None:
            header, first_row = [cell.strip() for cell in re.split(r"(?<!\\)\|", was)[1:-1]], True
            kind, place = place, ""                  # the table that begins here takes the place, or has none
        if was == now:
            continue
        if inside:
            return n
        if props_line:
            return n                                 # no property is written, masked_lines least of all
        if OWN_HEADING.fullmatch(was) and OWN_HEADING.fullmatch(now):
            if was[:was.rindex("(line")] == now[:now.rindex("(line")]:
                moved_head = n                       # allowed once this block's own code fence has been seen
                continue
            return n
        if header is None or first_row:
            return n
        if kind == "level2" and header == level2_header:
            column = 2                               # counted in the split below, where the first part is empty
        elif kind == "line" and depth_full and in_block and header == line_header:
            column = 1
        else:
            return n
        before, after = re.split(r"(?<!\\)\|", was), re.split(r"(?<!\\)\|", now)
        if (len(before) != len(after) or column >= len(before)
                or any(x != y for k, (x, y) in enumerate(zip(before, after)) if k != column)
                or not OWN_LINE_CELL.fullmatch(before[column]) or not OWN_LINE_CELL.fullmatch(after[column])
                or re.sub(r"\s*-\s*|\d", "", before[column]) != re.sub(r"\s*-\s*|\d", "", after[column])):
            return n
        # The numbers themselves, against the block headings of the new text: a Level 2 row holds exactly the
        # lines of the block it names; a line row lies inside the block whose section it stands in.
        numbers = [int(x) for x in re.findall(r"\d+", after[column])]
        first, last = numbers[0], numbers[-1]
        if kind == "level2":
            fits = heads.get(before[1].strip()) == (first, last)
        else:
            fits = block_id in heads and heads[block_id][0] <= first <= last <= heads[block_id][1]
        if not fits:
            return n
    return moved_head or None                        # a changed heading at the end of the note, with no code under it


def move_check(before, note_lines, props, lines):
    """The last check before a note is written, and the general one: the script's own comparison, run once more
    on the new text of the note (`note_lines`, `props`) against the same source lines, in memory. `before` is
    the comparison the writer worked from. A move is right only when the result says so:
      every block that this run moved is 'same', at the lines that were written, and is no block with masked
      lines (no number of masked_lines lies in its new lines);
      every block that was 'same' is 'same', at the same lines, and every moved block with masked lines, which
      is not written, is 'moved' to the same lines as before;
      no other block has a worse state than before (the order of STATES);
      the note has no more PROBLEM lines than before;
      at depth full, every row of a line table the writer went through quotes the code of the line it names
      (the check's rule for line rows, row_quote), but for the rows a TODO leaves to a person.
    Returns None, or what did not hold. The guards before this one name shapes of note that are known to go
    wrong; this one asks nothing about shapes. Whatever the writer and the reader take differently, in a way
    that matters, shows here as a block that would not be 'same' after the write."""
    after = compare(note_lines, props, lines)
    was, now = before["blocks"], after["blocks"]
    if [e["id"] for e in was] != [e["id"] for e in now]:
        return f"the note had {len(was)} blocks and would have {len(now)}, or other ids"

    def state(e):
        return e["state"] + (f" at {'line' if e['at'][0] == e['at'][1] else 'lines'} {span(*e['at'])}" if "at" in e else "")

    for old, new in zip(was, now):
        if to_write(old):
            target = old["at"] if old["state"] == "moved" else old["moved_to"]
            if new["state"] != "same" or new["at"] != target:
                return f"block {old['id']}: was moved, would be {state(new)}"
            if new.get("masked_block"):
                return f"block {old['id']}: a number of masked_lines would lie in its new lines"
        elif old["state"] in ("same", "moved"):      # 'moved' here: a block with masked lines, which is not written
            if new["state"] != old["state"] or new["at"] != old["at"]:
                return f"block {old['id']}: was {state(old)}, would be {state(new)}"
        elif STATES.index(new["state"]) > STATES.index(old["state"]):
            return f"block {old['id']}: was {old['state']}, would be {new['state']}"
    if len(after["problems"]) > before["_own_problems"]:
        return (f"the note had {before['_own_problems']} PROBLEM lines of its own and would have "
                f"{len(after['problems'])}")
    # The line rows, by the code they quote: in every block whose line table the writer went through, each row
    # must fit the source at the line it names now, by the check's own rule. Only the rows that the writer left
    # for a person (they fit neither at their lines nor after the move, and a TODO names them) are passed over.
    for block in after["_blocks"]:
        unfit = before.get("_rows", {}).get(block["id"])
        if unfit is None or block["first"] is None:
            continue
        section_end = min(block["end"], next_heading(note_lines, after["_mask"], block["start"], 3))
        table = table_at(note_lines, after["_mask"], block["last"], section_end)
        for i in table[1:] if table and header_is(note_lines[table[0]], LINE_HEADER) else ():
            found = pipe_cells(note_lines[i])
            m = LINE_CELL_TEXT.fullmatch(note_lines[i][found[0][0]:found[0][1]]) if found else None
            if not m or i in unfit:
                continue
            first, last = numbers_of(m)[0], numbers_of(m)[-1]
            if (not block["a"] <= first <= last <= block["b"]
                    or row_quote((cells(note_lines[i]) + ["", ""])[1], first, last, lines,
                                 lambda n: in_ranges(after["_declared"], n))[0] is not None):
                return (f"block {block['id']}: the line row {span(first, last)} at note line {i + 1} would not "
                        f"quote the code of the line it names")
    return None


def to_write(entry):
    """Whether --fix-moved writes this block's new lines: it only moved (also past other blocks, to its one free
    place), and it is no block with masked lines. Those are set by hand, from their TODO line."""
    return (entry["state"] == "moved" or "moved_to" in entry) and not entry.get("masked_block")


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
    from. A block with masked lines is never one of them, and the property masked_lines is never written. A number
    is written in exactly three places and nowhere else: (a) the block heading, (b) the Lines cell of the Level 2
    table, and at depth full (c) the Line cell of the block's own line table. The two tables are those of note-templates.md, found by their exact heading rows and
    places. The Trace table is not written. Returns (new bytes or None when nothing changes, what changed, error or None, what was left for
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
    if any("stray" in block for block in blocks):
        return None, [], None, left                  # the PROBLEM line of the comparison names the block
    # The comparison ran this test on the same text already. It stays here, under the lock and directly before
    # the writing, so that the writer never rests on a test made elsewhere. Both kinds refuse the writing: what
    # stops the comparison, and what only the writer does not handle.
    named = report.get("_form") or report.get("_writer")
    strange = unhandled(lines)
    if strange and named:
        return None, [], None, left                  # the PROBLEM line of the comparison names the construct
    if strange or named:
        strange = strange or named
        return None, [], (f"--fix-moved writes nothing for this note: note line {strange[0]} holds {strange[1]}, "
                          f"which the writer does not handle. Set the line numbers of the moved blocks by hand"), left
    wrote = []
    full = report["_depth"] == "full"                # a line table and a Trace table exist at depth full only
    level2 = level2_table(lines, mask)               # (b): None when the note has no such table at the template's place
    rows_of = {}                                     # block id -> its rows in the Level 2 table, read once
    for i in (level2 or [0])[1:]:
        rows_of.setdefault((cells(lines[i]) or [""])[0], []).append(i)
    level2_missing = False
    source = report["_source"]                       # the source lines the comparison was made with
    moves = [(block, entry["at"] if entry["state"] == "moved" else entry["moved_to"], entry)
             for block, entry in zip(blocks, report["blocks"]) if to_write(entry)]
    # masked_lines is never written. A number of it inside the new lines of a block that is to be written would
    # make that block one with masked lines for every reader of the note, the checker too. Nothing is written
    # for such a note.
    for block, (new_a, new_b), _ in moves:
        inside = cut_ranges(declared, new_a, new_b)[0]
        if inside:
            return None, [], (f"--fix-moved writes nothing for this note: masked_lines {spans(inside)} would lie in "
                              f"the new lines {span(new_a, new_b)} of block {block['id']}, which has no masked line, "
                              f"and the script never changes masked_lines. First set the blocks with masked lines "
                              f"by hand (their TODO line gives the lines and the numbers), or correct masked_lines, "
                              f"then run again"), left
    by_hand = report["_rows"] = {}                   # for move_check(): block id -> its line rows left for a person
    for block, (new_a, new_b), entry in moves:
        delta, new_range = new_a - block["a"], span(new_a, new_b)
        heading = lines[block["start"]]
        word = "line" if new_a == new_b else "lines"
        lines[block["start"]] = RANGE.sub(lambda m: f"({word} {new_range}){m.group(1)}", heading)      # (a)
        done = [f"heading (lines {span(block['a'], block['b'])}) -> ({word} {new_range})"]
        if entry["state"] != "moved":
            done.append("its code was there whole, past other blocks")
        # (c) The block's line table: at depth full only, the table directly after the block's code fence (only
        # blank lines between), inside the block's own section, and only when its heading row is the template's.
        # The section ends at the next #, ## or ### heading. No other table in a block is written, at any depth.
        # Each row is decided by the code it quotes, with the check's own rule (row_quote), not by where it
        # stands: after a partial update the rows can be right already while the heading is not, and a shift
        # would make them wrong. A row that fits the source at the line it names is left. One that fits after
        # the block's shift gets the shifted number. One that fits neither way is not written. One that fits
        # both ways (the same code at both lines) is decided only by the rows around it, since a line has one
        # row: it takes the one of its two places where no decided row of the table is, when the other place
        # is taken. Else it is not decided and not written.
        rows, kept, neither, both = 0, 0, [], []
        section_end = min(block["end"], next_heading(lines, mask, block["start"], 3))
        table = table_at(lines, mask, block["last"], section_end) if full and delta and block["first"] is not None else None
        if table and header_is(lines[table[0]], LINE_HEADER):
            unfit = by_hand[block["id"]] = set()
            taken, open_rows = set(), []             # non-blank lines that a decided row names; rows fitting both ways

            def fits(first, last):
                return (new_a <= first <= last <= new_b
                        and row_quote(code_cell, first, last, source, lambda n: in_ranges(declared, n))[0] is None)

            def named(first, last):
                return {n for n in range(first, last + 1) if source[n - 1].strip()}

            def shift(i, a, b, m):
                lines[i] = lines[i][:a] + new_numbers(m, [n + delta for n in numbers_of(m)]) + lines[i][b:]

            for i in table[1:]:
                a, b = line_cell(lines, i, 0, "line table")
                m = LINE_CELL_TEXT.fullmatch(lines[i][a:b])
                if not m:
                    continue
                first, last = numbers_of(m)[0], numbers_of(m)[-1]
                code_cell = (cells(lines[i]) + ["", ""])[1]
                stays, shifts = fits(first, last), fits(first + delta, last + delta)
                if stays and shifts:
                    open_rows.append((i, a, b, m, first, last))
                elif stays:
                    kept += 1
                    taken |= named(first, last)
                elif shifts:
                    shift(i, a, b, m)
                    rows += 1
                    taken |= named(first + delta, last + delta)
                else:
                    neither.append([first, last])
                    unfit.add(i)
            while open_rows:
                still = []
                for i, a, b, m, first, last in open_rows:
                    here, there = named(first, last) & taken, named(first + delta, last + delta) & taken
                    if here and not there:
                        shift(i, a, b, m)
                        rows += 1
                        taken |= named(first + delta, last + delta)
                    elif there and not here:
                        kept += 1
                        taken |= named(first, last)
                    else:
                        still.append((i, a, b, m, first, last))
                if len(still) == len(open_rows):
                    break
                open_rows = still
            both = [[first, last] for _, _, _, _, first, last in open_rows]
        elif full and delta:
            left.append(f"block {block['id']}: no line table at the template's place (directly after the block's "
                        f"code, with the heading row Line, Code, What happens, Real value), so no line row was "
                        f"written. Where the block has line rows, add {delta:+d}")
        if rows:
            done.append(f"{rows} line-table rows moved by {delta:+d}")
        if kept:
            done.append(f"{kept} line-table rows left as they are (their code is at the lines they name)")
        if neither:
            left.append(f"line rows of block {block['id']} fit the source neither at their lines nor after the move "
                        f"({delta:+d}): set them by hand: rows {spans(neither)}"
                        + (f". Not decided, and left as they are (the same code is at both lines): rows {spans(both)}"
                           if both else ""))
        elif both:
            left.append(f"line rows of block {block['id']} are not decided: the code they quote is at their lines "
                        f"and at their lines after the move ({delta:+d}) as well. They were left as they are; look "
                        f"at them: rows {spans(both)}")
        # (b) The block's row of the Level 2 table: the row that starts with its id, in the Lines cell. The
        # block's new lines are written as they are, never a shift of what stands there.
        for i in rows_of.get(block["id"], ()):
            a, b = line_cell(lines, i, 1, "Level 2 table")
            m = LINE_CELL_TEXT.fullmatch(lines[i][a:b])
            if m:
                lines[i] = lines[i][:a] + new_numbers(m, [new_a, new_b]) + lines[i][b:]
                done.append("Level 2 row")
        level2_missing = level2_missing or level2 is None
        wrote.append(f"block {block['id']}: " + ", ".join(done))
    if level2_missing:
        left.append("the note has no Level 2 table at the template's place (directly under '## Level 2: blocks', "
                    "with the heading row #, Lines, Purpose, Why this way, Concepts), so no Lines cell was written. "
                    "Set them by hand")
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
    # First of all, before anything is decided from the properties: a property that stands twice. The reader keeps
    # the last value, so with 'source' twice (an existing file, then a missing one) the note of a file that is
    # there would be reported as the note of a deleted file. With any key twice, nothing is taken from the
    # properties but this: the note is looked at when any of its values makes it a File note of this skill with a
    # source in scope. It gets the PROBLEM line, every block is 'not compared', and no source state is decided:
    # never GONE, no hash, nothing to remove.
    if repeated_property(text.split("\n")):
        values = property_values(text)
        sources = [value.replace("\\", "/") for value in values.get("source", [])]
        if (not any(value.lower() == "argus" for value in values.get("written_by", []))
                or "file" not in values.get("type", [])
                or not any(in_scope(on_disk(root, given) or "/".join(p for p in given.split("/") if p not in ("", ".")),
                                    scopes) for given in sources or [""])):
            return None
        found = compare(text.split("\n"), props, [])     # the note's form stops it: every block 'not compared'
        found["_source"], found["_own_problems"] = [], len(found["problems"])
        report = {"note": path.stem, "path": str(path), "source": " or ".join(dict.fromkeys(sources)),
                  "depth": props.get("depth", ""), "wrote": [], "source_state": "not decided", "source_gone": False,
                  "source_hash": {"recorded": None, "now": None, "state": "none"}, "_found": found, "check_lines": []}
        report.update({key: value for key, value in found.items() if not key.startswith("_")})
        return report
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
            # slash, a '..' part, a name no Windows file can have such as 'a?.py' or 'NUL', on every system, or
            # white space at an end of the value, such as "missing.py " inside quotes), or
            # something is there that on_disk() refused (a folder, a link that leads out),
            # or the folder it would lie in is itself not under the root (a folder link that leads out). A mistake
            # in the property or in the source root.
            report["source_state"] = "rejected"
            report["problems"].append(f"property 'source' is '{given}': not the path of a file under the source root "
                                      f"(a drive or an absolute path, a path leading out of it, a name that is not a "
                                      f"file path, such as one with ? | * < > \" or a device name, a value with a "
                                      f"space or tab at its beginning or end, or no plain file). "
                                      f"This is a mistake in the "
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
    found["_source"], found["_own_problems"] = lines, len(found["problems"])     # for move_check()
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
    """The line numbers a File note cites, which --fix-moved never writes, as texts for a person: one for each
    sentence, and one for all rows of the Trace table together."""
    def what(c):
        old = "-".join(map(str, c["old"]))
        new = f"{c['text']} now" if c["new"] is not None else "cannot be said (its block has no one sure place)"
        return old, new

    out, rows = [], []
    for c in cites:
        old, new = what(c)
        if c["trace"]:
            rows.append(f"note line {c['at'] + 1}: line {old}, {new}")
        else:
            out.append(f"note line {c['at'] + 1} cites line {old} (block {', '.join(c['blocks'])}): {new}, if it "
                       f"means this source file")
    if rows:
        out.append("the Trace table names lines that moved; the script does not write the Trace: " + "; ".join(rows[:SHOWN])
                   + (f"; and {len(rows) - SHOWN} more rows" if len(rows) > SHOWN else ""))
    return out


def note_text(data):
    return data.replace("\r\n", "\n").replace("\r", "\n")


def note_report(path, root, scopes, fix, known, notes_dir):
    """The report of one note, or None when it is not a File note of this skill or its source is out of scope."""
    report = build(path, note_text(read_text(path)[0]), root, scopes, known)
    if report is None:
        return None
    found = report["_found"]
    if fix and found and any(to_write(e) for e in found["blocks"]):
        # Read, decide, compare and write as one step, under the note's lock. Nothing decided before the lock is
        # used: whether the note is this skill's File note, its scope, its source path, the source text and the
        # blocks are all taken again from the bytes read under the lock, and those bytes are the ones written over.
        error = None
        try:
            with NoteLock(path):
                inside = lies_under(path, notes_dir)             # a folder on its way may lead elsewhere by now
                data = Path(path).read_bytes() if inside else b""
                decoded = decode_note(data)
                locked = build(path, note_text(decoded[1]), root, scopes, known) if decoded and inside else None
                if not inside:
                    error = f"the note {OUTSIDE} now: not read again, nothing written"
                elif decoded is None:
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
                                     f"line number in a block heading or in a Lines or Line column. Nothing "
                                     f"written; set the line numbers of the moved blocks by hand")
                    if new is not None and not error:
                        # The general check, last of all: the new text is compared once more, in memory, with
                        # the same source lines. Nothing is written unless the moved blocks are 'same' in it.
                        text = note_text(decode_note(new)[1])
                        bad = move_check(locked["_found"], text.split("\n"), frontmatter(text),
                                         locked["_found"]["_source"])
                        if bad:
                            error = (f"the result of the move did not compare as expected ({bad}); nothing "
                                     f"written; set the line numbers by hand")
                    if new is not None and not error:
                        error = write_note(path, data, new, notes_dir)
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
            or counts["not compared"]
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
    todo += report.get("masked_todo", [])
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


def survey(paths, root):
    """What the notes folder holds (`paths`: its notes), read once before any note is judged: for each note of
    this skill its type, the
    source files it names that are under the source root, and the notes it links to. From this a missing source
    file can be told from a wrong source root, and the notes that cite a file are known."""
    notes = []
    for path in paths:
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
                names = [found or given for given, found, _ in declared]
                outside = [name for name in names if scopes and not in_scope(name, scopes)]
                entry["sources"], entry["sources_out_of_scope"] = names, outside
                which = names[0] if len(names) == 1 else "one or more of: " + ", ".join(names)
                entry["todo"].append(
                    f"its sources changed since it was written ({which}; the script knows only that their hash "
                    f"differs). Re-read the note against every source that changed, and set its commit and "
                    f"source_hash only when each of them was re-read in this run (Later runs, step 6)"
                    + (f". Not in this run's scope: {', '.join(outside)}. When one of these changed, leave the hash "
                       f"as it is and name the note in the report as 'out of date, outside what was asked'"
                       if outside else ""))
        out.append(entry)
    return out


def note_paths(notes_dir):
    """(the notes of the folder, the .md files that are listed in it and lie outside it). A note is read,
    compared and written only when its real path lies under the real path of the notes folder: a file under a
    folder junction or a folder link that leads out of the notes folder is none of its notes."""
    inside, outside = [], []
    for path in sorted(Path(notes_dir).rglob("*.md")):
        if not any(part.startswith(".") for part in path.relative_to(notes_dir).parts[:-1]):
            (inside if lies_under(path, notes_dir) else outside).append(path)
    return inside, outside


def unread_report(path, problem):
    """The report of a note that was not read, or on which the script failed. Made new for each note: no list or
    dict of one note's report is shared with another's."""
    return {"note": path.stem, "path": str(path), "source": "", "depth": "", "wrote": [], "blocks": [],
            "unexplained": [], "bounded": [], "lines": 0, "source_state": "not read", "source_gone": False,
            "reordered": [], "problems": [problem], "counts": {state: 0 for state in STATES},
            "source_hash": {"recorded": None, "now": None, "state": "none"}}


def print_report(report):
    counts, name = report["counts"], report["note"]
    now = report["source_hash"]["now"] or "not read"
    hash_state = {"same": "source_hash same",
                  "differs": f"its source_hash differs from the file; the value to write is {now}",
                  "none": f"the note has no source_hash; the value to write is {now}"}[report["source_hash"]["state"]]
    if report["source_state"] == "not decided":
        hash_state = "its source is not decided (see PROBLEM), so nothing is said about its source_hash"
    for item in report["wrote"]:
        print(f"WROTE {name}: {item}")
    if report["source_state"] == "not read":
        print(f"NOTE {name}: not read")                # nothing is known of it: no source, no blocks, no hash
    else:
        print(f"NOTE {name}: {report['source']}, {report['lines']} lines, {len(report['blocks'])} blocks: "
              f"{counts['same']} same, {counts['moved']} moved, {counts['changed']} changed, {counts['displaced']} "
              f"displaced, {counts['ambiguous']} ambiguous, {counts['undecided']} undecided, {counts['not compared']} "
              f"not compared; {len(report['unexplained'])} unexplained ranges; {hash_state}")
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
            print(f"MOVED {was}: now {at(*entry['at'])}"
                  + ("; it has masked lines, so --fix-moved does not write it: set it by hand (see TODO)"
                     if entry.get("masked_block") else ""))
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
            more = (f" and {entry['elsewhere_count'] - len(entry['elsewhere'])} more places"
                    if entry["elsewhere_count"] > len(entry["elsewhere"]) else "")
            if "moved_to" in entry:
                print(f"DISPLACED {was}: its code is unchanged at {at(*entry['moved_to'])}, but the order of the "
                      f"blocks does not allow it there: it is past other blocks now. Not a changed block. "
                      + ("It has masked lines, so --fix-moved does not write it: set it by hand (see TODO)"
                         if entry.get("masked_block") else "--fix-moved writes the new lines"))
            elif entry.get("held"):
                print(f"DISPLACED {was}: its code is unchanged in the source, but only at lines another block holds "
                      f"(lines {spans(entry['elsewhere'])}{more}). Not a changed block. Read the file before you "
                      f"remove either block; else set the line numbers by hand")
            else:
                print(f"DISPLACED {was}: its code is unchanged at lines {spans(entry['elsewhere'])}{more}, but the order "
                      f"of the blocks does not allow it there; there is more than one such place, or another block "
                      f"could be there too, or the search was cut short (BOUNDED). Not a changed block. Choose "
                      f"the place and set the block's line numbers by hand")
        elif entry.get("masked_not_found"):
            print(f"NOT COMPARED {was}: it has masked lines, and its code is at no place in the file; it was "
                  f"expected at {at(*entry['expected'])}. The script cannot tell whether its code changed. Not a "
                  f"changed block for the script: read the source there and decide (see TODO)")
        elif entry["state"] == "not compared":
            why = ("a property of the note stands twice in its properties block" if entry.get("property_twice") else
                   "the note's code fences or headings can be read in two ways" if entry.get("note_form") else
                   "its code fence is empty" if entry.get("empty_fence") else
                   "it has no code fence of its own to compare")
            print(f"NOT COMPARED {was}: {why} (see PROBLEM). Not a changed "
                  f"block, and nothing is said about its place: repair the note's form, then run again")
        elif entry["state"] == "changed":
            if entry.get("spaces_only"):
                print(f"CHANGED {was}: not found as copied, but at {at(*entry['likely'])} it differs only in spaces "
                      f"at line ends: check that no explanation or value rests on them, then copy the code again")
                continue
            places_to_read = (f"Lines no block covers, nearest first: {spans(entry['may_be_at'])}"
                              + (f" (and {entry['may_be_at_more']} more ranges)" if "may_be_at_more" in entry else "")
                              if entry["may_be_at"] else "There are no lines that no block covers")
            print(f"CHANGED {was}: not found: its code as copied is not in the file. It was expected at "
                  f"{at(*entry['expected'])}. {places_to_read}. Read the file: when the block's code is there in a "
                  f"new form, keep the block's id and rewrite it; only when it is nowhere, remove the block and add "
                  f"its id to retired_blocks")
    for u in report["unexplained"]:
        here = f"UNEXPLAINED {at(u['from'], u['to'])}"
        if u["code_of"]:
            print(f"{here}: holds the whole code of block {', '.join(u['code_of'])}, which moved past other blocks: "
                  f"these lines are that block's, no new block")
        elif u.get("not_compared"):
            print(f"{here}: lines of block {', '.join(u['not_compared'][:SHOWN])}, which is not compared: act on "
                  f"its NOT COMPARED line first, then run again. No id for a new block until then")
        elif u.get("unplaced_here"):
            more = (f" and {u['unplaced_count'] - len(u['unplaced_here'])} more"
                    if u["unplaced_count"] > len(u["unplaced_here"]) else "")
            print(f"{here}: lines no block covers. They hold a possible place of block "
                  f"{', '.join(u['unplaced_here'])}{more}, whose place is not chosen yet: choose that block's place first, "
                  f"then divide the lines that are left. No id for a new block until then")
        elif u["possible_owners"]:
            more = f" and {u['possible_owners_more']} more" if "possible_owners_more" in u else ""
            print(f"{here}: lines no block covers. Blocks that were not found and may be here, nearest first: "
                  f"{', '.join(u['possible_owners'])}{more}. A new block, with the id {u['new_id']}, only when the "
                  f"lines belong to none of them")
        else:
            print(f"{here}: lines no block covers, and every block of the note has its place: a new block here gets "
                  f"the id {u['new_id']}")
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
    inside, outside = note_paths(notes_dir)
    known = survey(inside, root)
    reports = []
    for path in sorted(inside + outside):
        if path in outside:
            # Not opened, so it is not known whether it is a File note or in scope: it is named in every run.
            reports.append(finish(unread_report(path, f"{OUTSIDE}: not read"), known))
            continue
        try:
            report = note_report(path, root, scopes, args.fix_moved, known, notes_dir)
        except Exception as error:                   # noqa: BLE001  one note must not end the run or hide the others
            report = unread_report(path, f"could not be read: {error}" if isinstance(error, OSError) else
                                   f"the script failed on this note ({type(error).__name__}: {error}); nothing was "
                                   f"written for it. The other notes are reported as usual")
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
          f"displaced, {totals['ambiguous']} ambiguous, {totals['undecided']} undecided, {totals['not compared']} "
          f"not compared, {sum(len(r['unexplained']) for r in reports)} unexplained ranges, "
          f"{sum(len(r['wrote']) for r in reports)} written, {stale_dependents} of {len(dependents)} Mechanism "
          f"and Flow notes to look at: {verdict}")
    sys.exit(code)


if __name__ == "__main__":
    main()
