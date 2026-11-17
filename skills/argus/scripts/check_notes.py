#!/usr/bin/env python3
"""Coverage check for argus notes. Python 3.10+, standard library only. Reads; never writes.

  python -B check_notes.py --notes <notes folder> --source <source root> --scope <path> --graph <graph.json>

Exit code 0: no FAIL and no MISSING. 1: at least one. 2: wrong arguments. STALE and WARN lines do not change the
exit code, but the last line counts them, and every masked line is listed for a person to confirm.

STALE: the code changed since the note was written. A note with the property source_hash is judged by that hash
alone: no git is needed, and uncommitted changes count. A note without it is judged by git and its commit property.
"""
import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

sys.dont_write_bytecode = True  # never leave a __pycache__ folder beside the scripts
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import (BLOCK, FENCE, LINE_CELL, MASK, all_files, cells, fence_mask, file_hash,  # noqa: E402,F401
                     files_hash, fingerprint, frontmatter, inventory, is_callable_node, is_row, line_set, link_names, mask_pattern,
                     normalize_scopes, note_blocks, on_disk, read_text, resolve_graph_paths, retired_ids, section,
                     SOURCE_HASH, source_lines, utf8_output, without_inline_code, witness)

LENS = ["one sentence", "gain", "lose", "not possible", "issues", "makes possible", "open source", "risks"]
LENS_BY_TYPE = {"file": LENS, "mechanism": LENS, "start": LENS, "library": LENS[1:]}
MASK_SHARE = 0.25   # at most this share of a file's non-blank lines may carry a mask ...
MASK_FLOOR = 2      # ... but two masked lines are always allowed
MISSING_SHOWN = 30

fails, missing, stale, warns, infos = [], [], [], [], []


# ---------------------------------------------------------------- reading notes

def excerpt(cell):
    """(code quoted by a Code cell, whether it was cut short with …). (None, False) when the cell quotes no code."""
    m = re.match(r"``\s?(.*?)\s?``", cell) or re.match(r"`([^`]*)`", cell)
    if not m:
        return None, False
    text = m.group(1).replace("\\|", "|")
    cut = "…" in text or "..." in text[-3:] or "…" in cell[m.end():]
    return re.split(r"…", text)[0].strip(), cut


# <word> or </word> outside code, which Obsidian takes for HTML. Not \<word>, not <br>, not a link <https://...>.
HTML_TAG = re.compile(r"(?<!\\)</?(?!br\b)[A-Za-z][\w-]*(?:\s[^<>]*)?/?>")


def props_end(lines):
    """The index of the line that closes the properties, 0 when they are not closed, -1 when there are none."""
    if not lines or lines[0] != "---":
        return -1
    return next((i for i in range(1, len(lines)) if lines[i].strip() == "---"), 0)


def lens_missing(rows, wanted):
    """The lens labels that have no table row of their own with an answer. One row can stand for one label."""
    used, missing_labels = set(), []
    for label in wanted:
        hit = next((i for i, c in enumerate(rows)
                    if i not in used and len(c) >= 2 and label in c[0].lower() and len(c[0]) <= 60 and c[1]), None)
        if hit is None:
            missing_labels.append(label)
        else:
            used.add(hit)
    return missing_labels


def git(root, *args):
    """What git answers, or None. The question and the answer go into the run's fingerprint."""
    try:
        out = subprocess.run(["git", "-C", str(root), *args], capture_output=True, text=True, timeout=30)
        answer = out.stdout.strip() if out.returncode == 0 else None
    except (OSError, subprocess.SubprocessError):
        answer = None
    witness("git", root, *args, answer)
    return answer


# ---------------------------------------------------------------- one File note

def check_file_note(name, text, props, root):
    """Checks one File note against its source. Returns (source path on disk, masked line numbers) or (None, [])."""
    given = props.get("source", "")
    src = on_disk(root, given) if given else None
    if not src:
        fails.append(f"{name}: property 'source' names no file under the source root: '{given}'")
        return None, []
    lines, encoding = source_lines(Path(root) / src)
    nonblank = {i + 1 for i, line in enumerate(lines) if line.strip()}
    depth = props.get("depth", "")
    if depth not in ("map", "full"):
        fails.append(f"{name}: property 'depth' must be map or full, is '{depth}'")
    declared = line_set(props.get("masked_lines", ""), len(lines))
    note = text.split("\n")
    mask = fence_mask(note)

    level1 = section(note, mask, "Level 1")
    for label in lens_missing([cells(r) for r in (level1 or []) if is_row(r)], LENS):
        fails.append(f"{name}: Level 1 has no lens row of its own, with an answer, for '{label}'")

    blocks = note_blocks(note, mask)
    if not nonblank:
        if blocks:
            fails.append(f"{name}: {src} has no code, so its note must have no '### Block' section")
        infos.append(f"{src}: {len(lines)} lines, 0 non-blank, 0 blocks: an empty file, lens only")
        return src, []
    if not blocks:
        fails.append(f"{name}: no '### Block <id>: <purpose> (lines a-b)' heading found")
    block_ids = [block["id"] for block in blocks]
    for block_id in sorted(set(block_ids) & set(retired_ids(props))):
        fails.append(f"{name}: block {block_id} uses an id that the property retired_blocks lists; the id of a "
                     f"removed block is never used again")
    for block_id in sorted({b for b in block_ids if block_ids.count(b) > 1}):
        fails.append(f"{name}: two '### Block {block_id}' sections")

    # Level 2: one row per block, each naming its concepts in the last cell.
    level2 = {}
    for row in section(note, mask, "Level 2") or []:
        c = cells(row) if is_row(row) else []
        if c and re.fullmatch(r"\d\w*", c[0]):
            level2[c[0]] = c
    for block_id in block_ids:
        row = level2.get(block_id)
        if row is None:
            fails.append(f"{name}: block {block_id} has no row in the Level 2 table")
        elif "[[" not in without_inline_code(row[-1]):
            fails.append(f"{name}: Level 2 row {block_id} names no concept in its last cell")
    for extra in sorted(set(level2) - set(block_ids)):
        fails.append(f"{name}: Level 2 row {extra} has no '### Block {extra}' section")

    in_block, in_row, hidden, masked_seen = {}, {}, {}, set()
    for block in blocks:
        block_id, a, b, start, end = block["id"], block["a"], block["b"], block["start"], block["end"]
        if a < 1 or b > len(lines) or a > b:
            fails.append(f"{name}: block {block_id} range {a}-{b} is outside the file (1-{len(lines)})")
            continue
        for ln in range(a, b + 1):
            if ln in in_block:
                fails.append(f"{name}: line {ln} is in block {in_block[ln]} and block {block_id}")
            in_block[ln] = block_id
        # The first code fence of the block must hold exactly the source lines a..b.
        if block["first"] is None:
            fails.append(f"{name}: block {block_id} has no code fence")
            after = [note[i] for i in range(start + 1, end)]
        else:
            last = block["last"]
            code, want = block["code"], lines[a - 1:b]
            if len(code) != len(want):
                fails.append(f"{name}: block {block_id} code has {len(code)} lines, source lines {a}-{b} are {len(want)}")
            else:
                for offset, (got, real) in enumerate(zip(code, want)):
                    ln = a + offset
                    if got == real:
                        continue
                    if MASK not in got:
                        fails.append(f"{name}: block {block_id} code differs from the source at line {ln}")
                        break
                    masked_seen.add(ln)
                    if ln not in declared:
                        fails.append(f"{name}: line {ln} holds [masked] but is not listed in the property masked_lines")
                    if got.strip() == MASK:
                        hidden[ln] = [real.strip()]
                    else:
                        found = re.fullmatch(mask_pattern(got, groups=True), real)
                        if not found or not got.replace(MASK, "").strip():
                            fails.append(f"{name}: block {block_id} code differs from the source at line {ln} "
                                         f"(the text around [masked] must equal the source)")
                            break
                        hidden[ln] = list(found.groups())
            after = [note[i] for i in range(last, end) if not mask[i]]
        if depth == "map" and not any(row.strip() and not is_row(row) and not row.startswith("#") for row in after):
            fails.append(f"{name}: block {block_id} has no explanation after its code")
        if depth != "full":
            continue
        for row in after:
            c = cells(row) if is_row(row) else []
            rm = LINE_CELL.fullmatch(c[0]) if c else None
            if not rm:
                continue
            r1, r2 = int(rm.group(1)), int(rm.group(2) or rm.group(1))
            label = f"{r1}" if r1 == r2 else f"{r1}-{r2}"
            if r1 > r2:
                fails.append(f"{name}: row {label} runs backwards")
                continue
            # Lines beyond the end of the file are counted, not walked: a row may name any number.
            beyond = r2 - max(len(lines), r1 - 1)
            if beyond > 0:
                fails.append(f"{name}: block {block_id} has a row for line {max(len(lines) + 1, r1)}, outside {a}-{b}"
                             + (f" (and {beyond - 1} more lines beyond the end of the file)" if beyond > 1 else ""))
            for ln in range(r1, min(r2, len(lines)) + 1):
                if ln < a or ln > b:
                    fails.append(f"{name}: block {block_id} has a row for line {ln}, outside {a}-{b}")
                elif ln in in_row and ln in nonblank:
                    fails.append(f"{name}: line {ln} has two rows")
                in_row[ln] = block_id
            if r1 == r2 and a <= r1 <= b and r1 not in nonblank:
                fails.append(f"{name}: row {label} is for a blank line")
            if len(c) < 4:
                fails.append(f"{name}: row {label} needs four cells: Line, Code, What happens, Real value")
                continue
            if not c[2]:
                fails.append(f"{name}: row {label} has an empty 'What happens' cell")
            if not c[3]:
                fails.append(f"{name}: row {label} has an empty 'Real value' cell (write a value, none, or not run)")
            # The Code cell quotes the row's first non-blank line: all of it, or its start followed by …
            target = next((k for k in range(max(r1, 1), min(r2, len(lines)) + 1) if k in nonblank), None)
            quoted, cut = excerpt(c[1])
            if target is None:
                continue
            real = lines[target - 1].strip()
            if quoted == MASK and all(k in declared for k in range(r1, min(r2, len(lines)) + 1) if k in nonblank):
                continue  # a row for lines the note declares as masked
            if not quoted or not quoted.replace(MASK, "").strip():
                fails.append(f"{name}: row {label} quotes no code in its Code cell")
            elif MASK in quoted:
                found = re.match(mask_pattern(quoted), real)
                if not found or (not cut and found.end() != len(real)):
                    fails.append(f"{name}: row {label} quotes code that is not line {target}: {quoted[:50]}")
            elif not (quoted == real or (cut and real.startswith(quoted))):
                fails.append(f"{name}: row {label} must quote line {target} whole, or its start followed by …: "
                             f"{quoted[:50]}")

    uncovered = sorted(nonblank - set(in_block))
    if uncovered:
        fails.append(f"{name}: non-blank lines in no block: {uncovered[:20]}{' ...' if len(uncovered) > 20 else ''}")
    rows = "-"
    if depth == "full":
        no_row = sorted(nonblank - set(in_row))
        if no_row:
            fails.append(f"{name}: non-blank lines with no row: {no_row[:20]}{' ...' if len(no_row) > 20 else ''}")
        rows = f"{len(nonblank & set(in_row))}/{len(nonblank)}"
        for heading in ("Trace", "Check your understanding"):
            if section(note, mask, heading) is None:
                fails.append(f"{name}: depth full needs a '## {heading}' section")

    # Masks: declared, few, and the hidden text nowhere else in the note.
    for ln in sorted(declared - masked_seen):
        if ln in in_block:
            fails.append(f"{name}: masked_lines lists line {ln}, but the copied line has no [masked]")
    limit = max(MASK_FLOOR, int(len(nonblank) * MASK_SHARE))
    if len(masked_seen) > limit:
        fails.append(f"{name}: {len(masked_seen)} of {len(nonblank)} lines are masked (at most {limit}); a file that "
                     f"is mostly secrets is left out, not explained")
    for ln, texts in sorted(hidden.items()):
        for secret in texts:
            if len(secret.strip()) >= 4 and secret.strip() in text:
                fails.append(f"{name}: what [masked] hides on line {ln} appears elsewhere in the note")
                break
    if masked_seen:
        warns.append(f"{name}: {len(masked_seen)} masked lines ({', '.join(map(str, sorted(masked_seen)))}); a person "
                     f"must confirm each hides a secret and nothing else")
    infos.append(f"{src}: {len(lines)} lines ({encoding}), {len(nonblank)} non-blank, {len(blocks)} blocks, depth "
                 f"{depth}, in blocks {len(nonblank & set(in_block))}/{len(nonblank)}, rows {rows}"
                 + (f", masked lines: {len(masked_seen)}" if masked_seen else ""))
    return src, sorted(masked_seen)


UPDATE = "run changed_blocks.py to see which blocks changed, then update only those"


def check_stale(name, props, root, kind, src=None):
    """Whether the code changed since the note was written. A note with a 'source_hash' property is judged by it
    alone, with no git: stale when the hash of its source (File note) or of its 'sources' (Mechanism or Flow note)
    differs now. That also holds for uncommitted changes. A note without it is judged by git: a File note is stale
    when its source has a newer commit, a Mechanism or Flow note when any of its 'sources' changed after the note's
    'commit'. Returns how it was judged: 'hash', 'commit' or None."""
    noted = props.get("commit", "")
    if kind == "file":
        files = [src]
    else:
        files = [f.strip().replace("\\", "/") for f in props.get("sources", "").split(",") if f.strip()]
        if not files:
            warns.append(f"{name}: no 'sources' property, so a change to the code it describes cannot be detected")
            return None
    recorded = props.get("source_hash", "")
    if recorded:
        if SOURCE_HASH.fullmatch(recorded):
            now, rejected = (file_hash(Path(root) / src), []) if kind == "file" else files_hash(root, files)
            for bad in rejected:
                warns.append(f"{name}: 'sources' names no file under the source root: '{bad}' (not opened)")
            if now != recorded:
                what = src if kind == "file" else ", ".join(files)
                tail = UPDATE if kind == "file" else "check the note against the code, then set its source_hash"
                stale.append(f"{name}: {what} changed since the note was written (source_hash differs, now "
                             f"{(now or 'unreadable')[:15]}); {tail}")
            return "hash"
        warns.append(f"{name}: property 'source_hash' is not 'sha256:' and 64 hex digits; judged by its commit")
    if not noted:
        warns.append(f"{name}: no 'source_hash' and no 'commit' property, so a change to the source cannot be "
                     f"detected")
        return None
    if kind == "file":
        now = git(root, "log", "-1", "--format=%H", "--", files[0])
        if not now:
            warns.append(f"{name}: git has no history for {files[0]}, stale check skipped (a 'source_hash' property "
                         f"works without git)")
        elif not now.startswith(noted):
            stale.append(f"{name}: written at commit {noted}, source is now at {now[:8]}; {UPDATE}")
        return "commit"
    if git(root, "rev-parse", "--verify", "--quiet", noted + "^{commit}") is None:
        warns.append(f"{name}: commit {noted} is not in the source's history, stale check skipped (a 'source_hash' "
                     f"property works without git)")
        return "commit"
    newer = git(root, "rev-list", "-1", f"{noted}..HEAD", "--", *files)
    if newer:
        stale.append(f"{name}: written at commit {noted}; {', '.join(files)} changed since (now {newer[:8]})")
    return "commit"


# ---------------------------------------------------------------- Flow notes

BLOCK_ID = r"\d\w*"
ID_LIST = BLOCK_ID + r"(?:(?:\s*,\s*|\s+and\s+|\s+to\s+)" + BLOCK_ID + r")*"
IDS_IN_ROW = re.compile(r"\bblocks?\s+(" + ID_LIST + r")")           # in the Steps table: block 53a, blocks 3 and 4


def check_flow_note(name, lines, mask, file_blocks):
    """A Flow note has an 'Every outcome' table with a row, and every block id that the 'File, block' cell of
    its Steps table names is a block of a File note it links to. `file_blocks` is {File note name: its block ids}.
    The diagram is not read for block ids: its text is free text, for the reader. That it is there and not empty
    is checked elsewhere."""
    outcome = [cells(row) for row in section(lines, mask, "Every outcome") or [] if is_row(row)]
    if len([c for c in outcome if c and not set("".join(c)) <= set("-: ")]) < 2:   # the heading row and one more
        fails.append(f"{name}: a flow note needs an '## Every outcome' table with at least one row")

    def linked(text):
        found = []
        for target in link_names(text):
            if target in file_blocks and target not in found:
                found.append(target)
        return found

    all_linked = linked("\n".join(line for i, line in enumerate(lines) if not mask[i]))
    named = []                                       # (where, the ids as written, the File notes to look in)
    # In the Steps table only the cell that names the blocks is read (the column whose heading says "block",
    # else the second): "block 29" in the words of another cell is text.
    column = None
    for row in section(lines, mask, "Steps") or []:
        if not is_row(row):
            continue
        c = cells(row)
        if column is None:
            column = next((k for k, cell in enumerate(c) if "block" in cell.lower()), 1)
            continue
        if column < len(c):
            named += [("the Steps table", m.group(1), linked(row) or all_linked)
                      for m in IDS_IN_ROW.finditer(without_inline_code(c[column]))]
    if named and not all_linked:
        ids = sorted({block_id for _, written, _ in named for block_id in re.findall(BLOCK_ID, written)})
        fails.append(f"{name}: it names block {', '.join(ids[:10])}{' ...' if len(ids) > 10 else ''} but links no "
                     f"File note, so no named block can be checked: link the File note the blocks are in")
        return
    unknown = {}
    for where, written, notes in named:
        known = set().union(*(file_blocks[n] for n in notes))
        for block_id in re.findall(BLOCK_ID, written):
            if block_id not in known:
                unknown.setdefault((where, block_id), notes)
    for (where, block_id), notes in sorted(unknown.items()):
        fails.append(f"{name}: {where} names block {block_id}, which is no block of {', '.join(notes)}")


# ---------------------------------------------------------------- the graph

def check_graph(graph_path, own_words, files):
    """Every function, method or class the graph places in an explained file must be named in that file's note, in
    the note's own words. Returns the explained files the graph covers."""
    try:
        data = json.loads(read_text(graph_path)[0])
    except (OSError, ValueError) as error:
        fails.append(f"graph: cannot read {graph_path}: {error}")
        return set()
    nodes = data.get("nodes") if isinstance(data, dict) else data
    if not isinstance(nodes, list) or not any(isinstance(n, dict) and n.get("source_file") for n in nodes):
        fails.append(f"graph: {graph_path} has no list of nodes with a source_file; the graph check could not run")
        return set()
    nodes = [n for n in nodes if isinstance(n, dict) and isinstance(n.get("source_file"), str)]
    where = resolve_graph_paths([n["source_file"] for n in nodes], files)
    covered, compared = set(), 0
    for node in nodes:
        src = where.get(node["source_file"].replace("\\", "/").strip("/"))
        if src not in own_words:
            continue
        covered.add(src)
        label = str(node.get("label") or node.get("name") or "")
        kind = str(node.get("type") or node.get("kind") or "").lower()
        if node.get("external") or kind in ("file", "module", "document", "external") or not is_callable_node(node):
            continue
        short = re.split(r"[.:#/]", label.split("(")[0].strip())[-1]
        if not re.fullmatch(r"[A-Za-z_$][\w$-]*", short or ""):
            continue
        compared += 1
        if not re.search(r"(?<![\w$-])" + re.escape(short) + r"(?![\w$-])", own_words[src]):
            fails.append(f"graph: '{short}' is in {src} but its note never names it outside the copied code")
    for src in sorted(set(own_words) - covered):
        warns.append(f"graph: {src} is not in the graph (not parsed?); find its callers by text search and say so")
    if own_words and not covered:
        fails.append("graph: none of the explained files is in the graph; it was made from other code, or its paths "
                     "do not match the source root")
    infos.append(f"graph: {len(nodes)} nodes, {len(covered)} of {len(own_words)} explained files in it, "
                 f"{compared} functions or classes compared with notes")
    return covered


# ---------------------------------------------------------------- main

def note_files(folder):
    """Every .md file under folder, as a list, leaving out folders whose name starts with a dot (.trash,
    .obsidian). The list adds itself to the run's fingerprint: call this once and use the one list for everything,
    so what is checked and what is fingerprinted cannot differ."""
    folder = Path(folder)
    found = [p for p in sorted(folder.rglob("*.md"))
             if not any(part.startswith(".") for part in p.relative_to(folder).parts[:-1])]
    witness("note files", folder, *[p.relative_to(folder).as_posix() for p in found])
    return found


def link_targets(vault, notes):
    """What a [[link]] may point at: any note by name, any other file by its full name. One listing of the vault,
    which adds itself to the run's fingerprint."""
    vault = Path(vault)
    targets = set(notes)
    for p in vault.rglob("*"):
        if p.is_file() and not any(part.startswith(".") for part in p.relative_to(vault).parts[:-1]):
            targets.add(p.stem if p.suffix.lower() == ".md" else p.name)
    witness("link targets", vault, *sorted(targets))
    return targets


def main():
    utf8_output()
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--fingerprint", action="store_true",
                    help="print only {\"fingerprint\": ...}: one hash over everything the run read, listed and asked "
                         "git, taken while it ran. The same value is in the --json result; while it stays the same, "
                         "a new run gives the same result. Costs one full run")
    ap.add_argument("--notes", required=True, help="folder that holds the notes this skill wrote")
    ap.add_argument("--source", required=True, help="source root; each File note's 'source' property is relative to it")
    ap.add_argument("--scope", action="append", default=[],
                    help="a folder or file under the source root that is in scope; repeatable. Only source files "
                         "in scope count as MISSING. Default, and '.': the whole source root")
    ap.add_argument("--vault", help="vault root, to resolve [[links]] to notes outside --notes. Default: --notes, so "
                                    "give it whenever Concept or Library notes are shared with other folders")
    ap.add_argument("--graph", help="graph JSON from graphify, to compare its functions with the notes")
    ap.add_argument("--no-graph", action="store_true",
                    help="run without the graph check; the result line then says so. One of --graph and --no-graph "
                         "must be given")
    ap.add_argument("--include-tests", action="store_true", help="tests need File notes too")
    ap.add_argument("--allow-missing", action="store_true", help="source files without a note do not fail the check")
    ap.add_argument("--json", action="store_true",
                    help="print one JSON object instead of lines, for a program that reads the result")
    args = ap.parse_args()
    if bool(args.graph) == bool(args.no_graph):
        ap.error("give exactly one of --graph <graph.json> and --no-graph")
    notes_dir, root = Path(args.notes), Path(args.source)
    vault = Path(args.vault) if args.vault else notes_dir
    for folder in (notes_dir, root, vault):
        if not folder.is_dir():
            sys.exit(f"not a folder: {folder}")
    scopes = normalize_scopes(root, args.scope)

    notes = {}
    for p in note_files(notes_dir):
        if p.stem in notes:
            fails.append(f"note name used twice: {p.stem}")
        notes[p.stem] = p
    targets = link_targets(vault, notes)

    # What the run was told and what it found in the folders goes into its fingerprint; file contents and git
    # answers are added where they are read.
    witness("options", json.dumps({"scope": scopes, "include_tests": args.include_tests,
                                   "allow_missing": args.allow_missing, "graph": args.graph or None,
                                   "notes": str(notes_dir), "source": str(root), "vault": str(vault)}, sort_keys=True))
    # The Python that runs the check: its version and the settings that can change how a file is parsed.
    witness("runtime", sys.version, sys.platform, sys.getdefaultencoding(),
            getattr(sys, "get_int_max_str_digits", lambda: "no limit")(), tuple(sys.flags))
    for script in ("check_notes.py", "_common.py"):
        witness("checker", script, hashlib.sha256((Path(__file__).resolve().parent / script).read_bytes()).hexdigest())

    explained, own_words, kinds, linked_by, unowned, masked_total, masked_by_note = {}, {}, {}, {}, [], 0, {}
    judged_by = {}  # note name: 'hash' or 'commit', how its stale check was made
    file_blocks, flows, projects = {}, {}, {}  # block ids of each File note; Flow notes to check; kinds per project
    for name, p in notes.items():
        text = read_text(p)[0].replace("\r\n", "\n").replace("\r", "\n")
        props = frontmatter(text)
        if props.get("written_by", "").lower() != "argus":
            unowned.append(name)  # someone's own note: kept for link resolution, never checked
            continue
        kind = kinds[name] = props.get("type", "")
        projects.setdefault(props.get("project", ""), []).append(kind)
        if not kind:
            warns.append(f"{name}: no 'type' property")
        lines = text.split("\n")
        mask = fence_mask(lines)
        prose = [(i + 1, line) for i, line in enumerate(lines) if not mask[i]]
        if kind == "file":
            src, masked = check_file_note(name, text, props, root)
            masked_total += len(masked)
            if masked:
                masked_by_note[name] = masked  # the line numbers
            if src:
                if src in explained:
                    fails.append(f"{name}: {src} is also explained by the note '{explained[src]}'")
                explained[src] = name
                file_blocks[name] = {block["id"] for block in note_blocks(lines, mask)}
                # The note's own words: not the properties, the title or the Source line (they hold the file name).
                own_words[src] = "\n".join(line for number, line in prose
                                           if number - 1 > props_end(lines)
                                           and not line.startswith("# ") and not line.startswith("Source:"))
                judged_by[name] = check_stale(name, props, root, "file", src)
        elif kind in LENS_BY_TYPE:
            rows = [cells(line) for _, line in prose if is_row(line)]
            for label in lens_missing(rows, LENS_BY_TYPE[kind]):
                fails.append(f"{name}: a {kind} note needs a lens row of its own, with an answer, for '{label}'")
        if kind in ("mechanism", "flow"):
            opens = [i for i, line in enumerate(lines) if mask[i] and re.match(r"^`{3,}mermaid\s*$", line)]
            if not opens:
                fails.append(f"{name}: a {kind} note needs a mermaid diagram")
            elif not any(lines[i].strip() and not FENCE.match(lines[i])
                         for i in range(opens[0] + 2, min(opens[0] + 200, len(lines))) if mask[i]):
                fails.append(f"{name}: the mermaid diagram is empty")
            judged_by[name] = check_stale(name, props, root, kind)
            if kind == "flow":
                flows[name] = (lines, mask)
        body_from = props_end(lines) + 1  # the first line after the properties, counted from 1
        tags = []
        for number, line in prose:
            bare_line = without_inline_code(line)
            if "%%" in bare_line:
                fails.append(f"{name} line {number}: an Obsidian comment (%%) hides text from the reader")
            if number > body_from and HTML_TAG.search(bare_line):
                tags.append(number)
            for target in link_names(line):
                linked_by.setdefault(target, set()).add(name)
                if target not in targets:
                    fails.append(f"{name}: link to a note that does not exist: [[{target}]]")
            if is_row(line):
                bare = re.sub(r"``.*?``", "", line)
                for code in re.findall(r"`([^`]*)`", bare):
                    if re.search(r"(^|[^\\])\|", code):
                        fails.append(f"{name} line {number}: unescaped | inside code in a table: {code[:40]}")
        if tags:
            shown = ", ".join(map(str, tags[:10])) + (" ..." if len(tags) > 10 else "")
            warns.append(f"{name}: <word> outside code on line {shown}: Obsidian reads it as HTML and does not show "
                         f"it; put it in backticks")
    for name, (lines, mask) in flows.items():
        check_flow_note(name, lines, mask, file_blocks)
    for project, found_kinds in sorted(projects.items()):
        if "file" in found_kinds and "flow" not in found_kinds:
            warns.append(f"project '{project}' has {found_kinds.count('file')} File notes and no End-to-End Flow "
                         f"note: write one for the main path through the code")
    for name in kinds:
        if kinds[name] != "start" and not name.endswith("Start Here") and not (linked_by.get(name, set()) - {name}):
            fails.append(f"{name}: no other note links to it")
    if unowned:
        infos.append(f"{len(unowned)} notes without written_by: argus were not checked (they are not this skill's notes)")

    found = inventory(root, args.include_tests, scopes)
    missing.extend(src for src in found["code"] if src not in explained)
    if not found["code"]:
        fails.append("the scope holds no file this check counts as code; nothing was verified. Check --source and "
                     "--scope, and the WARN lines about file kinds")
    if found["left_out"]:
        folders = "; ".join(f"{folder} ({count})" for folder, count in sorted(found["left_out"].items()))
        warns.append(f"folders left out as dependencies, build output, tool folders or tests, with their code files: "
                     f"{folders}. To have one explained, name it with --scope (tests: --include-tests)")
    if found["unknown"]:
        kinds_text = "; ".join(f"{kind} ({count})" for kind, count in sorted(found["unknown"].items()))
        warns.append(f"files in scope of a kind this check does not know, not counted as code: {kinds_text}. "
                     f"If they hold code, they need File notes too; say so in the report")
    if found["other"]:
        other_text = ", ".join(f"{ext} {count}" for ext, count in sorted(found["other"].items(), key=lambda kv: -kv[1])[:15])
        infos.append(f"in scope but not code (documents, data, settings, media): {other_text}")
    graph_note, covered = "graph check not run", set()
    if args.graph:
        covered = check_graph(args.graph, own_words, all_files(root))
        graph_note = f"graph covers {len(covered)} of {len(own_words)} explained files"

    bad = len(fails) + (0 if args.allow_missing else len(missing))
    where = ", ".join(scopes) if scopes else "whole source root"
    verdict = "NOT PASSED" if bad else "PASS" if args.graph else "PASS WITHOUT THE GRAPH CHECK"
    print_of_inputs = fingerprint()  # everything this run read, listed or asked git
    if args.fingerprint:
        json.dump({"fingerprint": print_of_inputs}, sys.stdout)
        sys.exit(0)
    if args.json:
        def about(line):
            """The note a line is about (its text starts with '<note name>: ' or '<note name> line N: '), or None."""
            return next((n for n in sorted(kinds, key=len, reverse=True)
                         if line.startswith(n + ": ") or line.startswith(n + " line ")), None)

        json.dump({
            "result": verdict, "exit_code": 0 if bad == 0 else 1, "scope": scopes, "fingerprint": print_of_inputs,
            "notes_checked": sorted(kinds), "notes_not_checked": sorted(unowned),
            "explained": {src: note for src, note in sorted(explained.items())},
            "missing": missing,
            "fails": [{"note": about(line), "graph": line.startswith("graph: "), "text": line} for line in fails],
            "stale": [{"note": about(line), "text": line} for line in stale],
            "stale_judged_by": {note: how for note, how in sorted(judged_by.items()) if how},
            "warns": [{"note": about(line), "graph": line.startswith("graph: "), "text": line} for line in warns],
            "infos": infos,
            "masked_lines": masked_by_note,
            "graph": {"used": bool(args.graph), "covered": sorted(covered),
                      "not_covered": sorted(set(own_words) - covered) if args.graph else []},
        }, sys.stdout, indent=2, ensure_ascii=False)
        sys.exit(0 if bad == 0 else 1)

    for item in infos:
        print(f"INFO {item}")
    for item in fails:
        print(f"FAIL {item}")
    for item in missing[:MISSING_SHOWN]:
        print(f"MISSING {item}")
    if len(missing) > MISSING_SHOWN:
        print(f"MISSING ... and {len(missing) - MISSING_SHOWN} more; narrow with --scope")
    for label, items in (("STALE", stale), ("WARN", warns)):
        for item in items:
            print(f"{label} {item}")
    print(f"RESULT scope {where}: {len(kinds)} notes checked, {len(explained)} source files explained, "
          f"{len(missing)} without a note, {len(fails)} fail, {len(stale)} stale, {len(warns)} warn, "
          f"{masked_total} masked lines, {graph_note}: {verdict}")
    sys.exit(0 if bad == 0 else 1)


if __name__ == "__main__":
    main()
