#!/usr/bin/env python3
"""Coverage check for argus notes. Python 3.10+, standard library only. Reads; never writes.

  python -B check_notes.py --notes <notes folder> --source <source root> --scope <path> --graph <graph.json>

Exit code 0: no FAIL and no MISSING. 1: at least one. 2: wrong arguments. STALE and WARN lines do not change the
exit code, but the last line counts them, and every masked line is listed for a person to confirm.
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
from _common import (all_files, inventory, is_callable_node, normalize_scopes, on_disk, read_text,  # noqa: E402
                     resolve_graph_paths, source_lines, utf8_output)

LENS = ["one sentence", "gain", "lose", "not possible", "issues", "makes possible", "open source", "risks"]
LENS_BY_TYPE = {"file": LENS, "mechanism": LENS, "start": LENS, "library": LENS[1:]}
BLOCK = re.compile(r"^### Block (\w+)\b.*\(lines? (\d+)(?:\s*-\s*(\d+))?\)\s*$")
LINE_CELL = re.compile(r"(\d+)(?:\s*-\s*(\d+))?")
FENCE = re.compile(r"^(`{3,})")
LINK = re.compile(r"\[\[([^\]|#]+)")
MASK = "[masked]"
MASK_SHARE = 0.25   # at most this share of a file's non-blank lines may carry a mask ...
MASK_FLOOR = 2      # ... but two masked lines are always allowed
MISSING_SHOWN = 30

fails, missing, stale, warns, infos = [], [], [], [], []


# ---------------------------------------------------------------- reading notes

def frontmatter(text):
    """The properties at the top of a note, as a dict of strings."""
    if not text.startswith("---"):
        return {}
    end = text.find("\n---", 3)
    if end < 0:
        return {}
    props = {}
    for line in text[3:end].splitlines():
        if ":" in line:
            key, value = line.split(":", 1)
            props[key.strip()] = value.strip().strip("\"'")
    return props


def fence_mask(lines):
    """For each line: True when it is a fence line or inside a fence. A fence closes only on one at least as long."""
    mask, fence = [], None
    for line in lines:
        m = FENCE.match(line)
        if fence is None and m:
            fence = len(m.group(1))
            mask.append(True)
        elif fence is not None:
            mask.append(True)
            if m and len(m.group(1)) >= fence and line.strip("`").strip() == "":
                fence = None
        else:
            mask.append(False)
    return mask


def section(lines, mask, heading):
    """The lines under a '## <heading...>' line that is outside every fence, up to the next such '## ' line."""
    start = next((i for i, line in enumerate(lines) if not mask[i] and line.startswith("## " + heading)), None)
    if start is None:
        return None
    end = next((i for i in range(start + 1, len(lines)) if not mask[i] and lines[i].startswith("## ")), len(lines))
    return [lines[i] for i in range(start + 1, end) if not mask[i]]


def is_row(line):
    return line.lstrip().startswith("|")


def cells(row):
    """The cells of one table row, stripped. A | written as \\| stays inside its cell."""
    parts = re.split(r"(?<!\\)\|", row.strip())
    return [c.strip() for c in parts[1:-1]]


def without_inline_code(line):
    """The line with every `code span` removed, so that [[ inside code is not read as a link."""
    return re.sub(r"(`+)(?:(?!\1).)*?\1", " ", line)


def excerpt(cell):
    """(code quoted by a Code cell, whether it was cut short with …). (None, False) when the cell quotes no code."""
    m = re.match(r"``\s?(.*?)\s?``", cell) or re.match(r"`([^`]*)`", cell)
    if not m:
        return None, False
    text = m.group(1).replace("\\|", "|")
    cut = "…" in text or "..." in text[-3:] or "…" in cell[m.end():]
    return re.split(r"…", text)[0].strip(), cut


def mask_pattern(text, groups=False):
    """A regular expression for a line with [masked] in it: the text around each mask, anything in between."""
    joiner = "(.+?)" if groups else ".+?"
    return joiner.join(re.escape(part) for part in text.split(MASK))


def line_set(text, last):
    """'3, 7-9' -> {3, 7, 8, 9}, clipped to 1..last. Anything that is not a number or a range is ignored."""
    result = set()
    for piece in str(text).split(","):
        m = re.fullmatch(r"\s*(\d+)(?:\s*-\s*(\d+))?\s*", piece)
        if m:
            a, b = int(m.group(1)), int(m.group(2) or m.group(1))
            result.update(range(max(a, 1), min(b, last) + 1))
    return result


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
    try:
        out = subprocess.run(["git", "-C", str(root), *args], capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.SubprocessError):
        return None
    return out.stdout.strip() if out.returncode == 0 else None


# ---------------------------------------------------------------- one File note

def check_file_note(name, text, props, root):
    """Checks one File note against its source. Returns (source path on disk, masked line count) or (None, 0)."""
    given = props.get("source", "")
    src = on_disk(root, given) if given else None
    if not src:
        fails.append(f"{name}: property 'source' names no file under the source root: '{given}'")
        return None, 0
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

    starts = [i for i, line in enumerate(note) if not mask[i] and BLOCK.match(line)]
    if not nonblank:
        if starts:
            fails.append(f"{name}: {src} has no code, so its note must have no '### Block' section")
        infos.append(f"{src}: {len(lines)} lines, 0 non-blank, 0 blocks: an empty file, lens only")
        return src, 0
    if not starts:
        fails.append(f"{name}: no '### Block <id>: <purpose> (lines a-b)' heading found")
    block_ids = [BLOCK.match(note[i]).group(1) for i in starts]
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
    for n, start in enumerate(starts):
        m = BLOCK.match(note[start])
        block_id, a, b = m.group(1), int(m.group(2)), int(m.group(3) or m.group(2))
        end = starts[n + 1] if n + 1 < len(starts) else len(note)
        end = next((i for i in range(start + 1, end) if not mask[i] and note[i].startswith("## ")), end)
        if a < 1 or b > len(lines) or a > b:
            fails.append(f"{name}: block {block_id} range {a}-{b} is outside the file (1-{len(lines)})")
            continue
        for ln in range(a, b + 1):
            if ln in in_block:
                fails.append(f"{name}: line {ln} is in block {in_block[ln]} and block {block_id}")
            in_block[ln] = block_id
        # The first code fence of the block must hold exactly the source lines a..b.
        first = next((i for i in range(start + 1, end) if mask[i]), None)
        if first is None:
            fails.append(f"{name}: block {block_id} has no code fence")
            after = [note[i] for i in range(start + 1, end)]
        else:
            last = next((i for i in range(first, end) if not mask[i]), end)
            code, want = note[first + 1:last - 1], lines[a - 1:b]
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
            for ln in range(r1, r2 + 1):
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
            if quoted == MASK and all(k in declared for k in range(r1, r2 + 1) if k in nonblank):
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
    infos.append(f"{src}: {len(lines)} lines ({encoding}), {len(nonblank)} non-blank, {len(starts)} blocks, depth "
                 f"{depth}, in blocks {len(nonblank & set(in_block))}/{len(nonblank)}, rows {rows}"
                 + (f", masked lines: {len(masked_seen)}" if masked_seen else ""))
    return src, len(masked_seen)


def check_stale(name, props, root, kind, src=None):
    """A File note is stale when its source has a newer commit. A Mechanism or Flow note is stale when any of the
    files in its 'sources' property changed after the note's 'commit'."""
    noted = props.get("commit", "")
    if kind == "file":
        files = [src]
    else:
        files = [f.strip().replace("\\", "/") for f in props.get("sources", "").split(",") if f.strip()]
        if not files:
            warns.append(f"{name}: no 'sources' property, so a change to the code it describes cannot be detected")
            return
    if not noted:
        warns.append(f"{name}: no 'commit' property, so a change to the source cannot be detected")
        return
    if kind == "file":
        now = git(root, "log", "-1", "--format=%H", "--", files[0])
        if not now:
            warns.append(f"{name}: git has no history for {files[0]}, stale check skipped")
        elif not now.startswith(noted):
            stale.append(f"{name}: written at commit {noted}, source is now at {now[:8]}")
        return
    if git(root, "rev-parse", "--verify", "--quiet", noted + "^{commit}") is None:
        warns.append(f"{name}: commit {noted} is not in the source's history, stale check skipped")
        return
    newer = git(root, "rev-list", "-1", f"{noted}..HEAD", "--", *files)
    if newer:
        stale.append(f"{name}: written at commit {noted}; {', '.join(files)} changed since (now {newer[:8]})")


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
    """Every .md file under folder, leaving out folders whose name starts with a dot (.trash, .obsidian)."""
    folder = Path(folder)
    for p in sorted(folder.rglob("*.md")):
        if not any(part.startswith(".") for part in p.relative_to(folder).parts[:-1]):
            yield p


def fingerprint(notes_dir, notes, targets, root, graph, settings):
    """One hash over everything a run of this check reads or depends on. Two runs with the same fingerprint give
    the same result; any change to a note, a linked name, a source file, the file list, the graph, the git commit,
    the options or these scripts changes it. Notes and explained sources go in by content, other files by path,
    size and time of change."""
    h = hashlib.sha256()

    def add(*parts):
        h.update(("\x1f".join(str(p) for p in parts) + "\x1e").encode("utf-8", "backslashreplace"))

    def digest(path):
        try:
            return hashlib.sha256(Path(path).read_bytes()).hexdigest()
        except OSError:
            return "unreadable"

    for name, p in sorted(notes.items()):
        add("note", p.relative_to(notes_dir).as_posix(), digest(p))
        props = frontmatter(read_text(p)[0])
        if props.get("written_by", "").lower() == "argus" and props.get("type") == "file" and props.get("source"):
            src = on_disk(root, props["source"])
            add("source", props["source"], src or "none", digest(Path(root) / src) if src else "none")
    for name in sorted(targets):
        add("target", name)
    for rel in all_files(root):
        try:
            st = (Path(root) / rel).stat()
            add("file", rel, st.st_size, st.st_mtime_ns)
        except OSError:
            add("file", rel, "gone")
    add("graph", digest(graph) if graph else "none")
    add("head", git(root, "rev-parse", "HEAD") or "no git")
    add("settings", json.dumps(settings, sort_keys=True))
    for script in ("check_notes.py", "_common.py"):
        add("checker", script, digest(Path(__file__).resolve().parent / script))
    return h.hexdigest()


def main():
    utf8_output()
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--fingerprint", action="store_true",
                    help="check nothing: print {\"fingerprint\": ...} for the given options and stop. The same value "
                         "is in the --json result; while it stays the same, a new run would give the same result")
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
    # What a [[link]] may point at: any note in the vault by name, any other file by its full name.
    targets = set(notes)
    for p in vault.rglob("*"):
        if p.is_file() and not any(part.startswith(".") for part in p.relative_to(vault).parts[:-1]):
            targets.add(p.stem if p.suffix.lower() == ".md" else p.name)

    print_of_inputs = None
    if args.fingerprint or args.json:
        print_of_inputs = fingerprint(notes_dir, notes, targets, root, args.graph, {
            "scope": scopes, "include_tests": args.include_tests, "allow_missing": args.allow_missing,
            "graph": bool(args.graph)})
    if args.fingerprint:
        json.dump({"fingerprint": print_of_inputs}, sys.stdout)
        sys.exit(0)

    explained, own_words, kinds, linked_by, unowned, masked_total, masked_by_note = {}, {}, {}, {}, [], 0, {}
    for name, p in notes.items():
        text = read_text(p)[0].replace("\r\n", "\n").replace("\r", "\n")
        props = frontmatter(text)
        if props.get("written_by", "").lower() != "argus":
            unowned.append(name)  # someone's own note: kept for link resolution, never checked
            continue
        kind = kinds[name] = props.get("type", "")
        if not kind:
            warns.append(f"{name}: no 'type' property")
        lines = text.split("\n")
        mask = fence_mask(lines)
        prose = [(i + 1, line) for i, line in enumerate(lines) if not mask[i]]
        if kind == "file":
            src, masked = check_file_note(name, text, props, root)
            masked_total += masked
            if masked:
                masked_by_note[name] = masked
            if src:
                if src in explained:
                    fails.append(f"{name}: {src} is also explained by the note '{explained[src]}'")
                explained[src] = name
                # The note's own words: not the properties, the title or the Source line (they hold the file name).
                props_end = next((i for i in range(1, len(lines)) if lines[i].strip() == "---"), 0) if lines[0] == "---" else -1
                own_words[src] = "\n".join(line for number, line in prose
                                           if number - 1 > props_end
                                           and not line.startswith("# ") and not line.startswith("Source:"))
                check_stale(name, props, root, "file", src)
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
            check_stale(name, props, root, kind)
        for number, line in prose:
            if "%%" in line:
                fails.append(f"{name} line {number}: an Obsidian comment (%%) hides text from the reader")
            for target in LINK.findall(without_inline_code(line)):
                target = target.rstrip("\\").strip().split("/")[-1]
                target = target[:-3] if target.lower().endswith(".md") else target
                linked_by.setdefault(target, set()).add(name)
                if target not in targets:
                    fails.append(f"{name}: link to a note that does not exist: [[{target}]]")
            if is_row(line):
                bare = re.sub(r"``.*?``", "", line)
                for code in re.findall(r"`([^`]*)`", bare):
                    if re.search(r"(^|[^\\])\|", code):
                        fails.append(f"{name} line {number}: unescaped | inside code in a table: {code[:40]}")
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
