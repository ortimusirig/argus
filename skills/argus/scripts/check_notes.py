#!/usr/bin/env python3
"""Coverage check for argus notes. Python 3.10+, standard library only. Reads; never writes.

  python -B check_notes.py --notes <notes folder> --source <source root> [--scope <path under the source root>]

Exit code 0: no FAIL and no MISSING. Exit code 1 otherwise. STALE and WARN lines do not change the exit code.
"""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

sys.dont_write_bytecode = True  # never leave a __pycache__ folder beside the scripts
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import CODE_EXT, inventory, match_source, normalize_scopes  # noqa: E402

LENS = ["one sentence", "gain", "lose", "not possible", "issues", "makes possible", "open source", "risks"]
BLOCK = re.compile(r"^### Block (\w+)\b.*\(lines? (\d+)(?:-(\d+))?\)\s*$")
ROW = re.compile(r"^\| (\d+)(?:-(\d+))? \|")
FENCE = re.compile(r"^(`{3,})")
LINK = re.compile(r"\[\[([^\]|#]+)")
MASK = "[masked]"
MISSING_SHOWN = 30

fails, missing, stale, warns = [], [], [], []


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
        return []
    end = next((i for i in range(start + 1, len(lines)) if not mask[i] and lines[i].startswith("## ")), len(lines))
    return [lines[i] for i in range(start + 1, end) if not mask[i]]


def cells(row):
    """The cells of one table row. A | written as \\| stays inside its cell."""
    parts = re.split(r"(?<!\\)\|", row.strip())
    return [c.strip() for c in parts[1:-1]]


def code_excerpt(cell):
    """The code a line-table cell quotes, up to its first … ; None when the cell quotes no code."""
    m = re.match(r"``\s?(.*?)\s?``", cell) or re.match(r"`([^`]*)`", cell)
    if not m:
        return None
    return m.group(1).replace("\\|", "|").split("…")[0].strip()


def same_line(got, real, fully_masked=False):
    """A copied line equals the source line. With [masked] in it, everything around each mask must still match.
    A line that is nothing but the mask is accepted only when the note declares that line in 'masked_lines'."""
    if got == real:
        return True
    if MASK not in got:
        return False
    parts = got.split(MASK)
    if not "".join(parts).strip():
        return fully_masked and got.strip() == MASK
    return re.fullmatch(".+?".join(re.escape(p) for p in parts), real) is not None


def line_set(text):
    """'3, 7-9' -> {3, 7, 8, 9}. Anything that is not a number or a range is ignored."""
    result = set()
    for piece in str(text).split(","):
        m = re.fullmatch(r"\s*(\d+)(?:\s*-\s*(\d+))?\s*", piece)
        if m:
            result.update(range(int(m.group(1)), int(m.group(2) or m.group(1)) + 1))
    return result


def git(root, *args):
    try:
        out = subprocess.run(["git", "-C", str(root), *args], capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.SubprocessError):
        return None
    return out.stdout.strip() if out.returncode == 0 else None


def check_file_note(name, text, props, root):
    src = props.get("source", "").replace("\\", "/")
    path = root / src
    if not src or not path.is_file():
        fails.append(f"{name}: property 'source' names no file under the source root: '{src}'")
        return None
    lines = path.read_text(encoding="utf-8", errors="replace").replace("\r", "").split("\n")
    if lines and lines[-1] == "":
        lines.pop()
    nonblank = {i + 1 for i, line in enumerate(lines) if line.strip()}
    depth = props.get("depth", "")
    if depth not in ("map", "full"):
        fails.append(f"{name}: property 'depth' must be map or full, is '{depth}'")
    masked_lines = line_set(props.get("masked_lines", ""))
    note = text.split("\n")
    mask = fence_mask(note)

    # Level 1: one table row per lens question, with an answer.
    lens_rows = [cells(r) for r in section(note, mask, "Level 1") if r.startswith("|")]
    for label in LENS:
        row = next((c for c in lens_rows if c and label in c[0].lower()), None)
        if row is None:
            fails.append(f"{name}: lens row missing in Level 1: '{label}'")
        elif len(row) < 2 or not row[1]:
            fails.append(f"{name}: lens row '{label}' has no answer")

    # Blocks: headings outside fences only.
    starts = [i for i, line in enumerate(note) if not mask[i] and BLOCK.match(line)]
    if not nonblank:
        # finding 8: an empty source file has a note with the lens and no blocks
        if starts:
            fails.append(f"{name}: {src} has no code, so its note must have no '### Block' section")
        print(f"INFO {src}: {len(lines)} lines, 0 non-blank, 0 blocks: an empty file, lens only")
        return src
    if not starts:
        fails.append(f"{name}: no '### Block <id>: <purpose> (lines a-b)' heading found")
    block_ids = [BLOCK.match(note[i]).group(1) for i in starts]

    # Level 2: one row per block, each naming its concepts in the last cell.
    level2 = {}
    for row in section(note, mask, "Level 2"):
        if re.match(r"^\| \w", row) and not row.startswith("| #") and not row.startswith("| ---"):
            c = cells(row)
            if c and re.fullmatch(r"\d\w*", c[0]):
                level2[c[0]] = c
    for block_id in block_ids:
        row = level2.get(block_id)
        if row is None:
            fails.append(f"{name}: block {block_id} has no row in the Level 2 table")
        elif "[[" not in row[-1]:
            fails.append(f"{name}: Level 2 row {block_id} names no concept in its last cell")
    for extra in sorted(set(level2) - set(block_ids)):
        fails.append(f"{name}: Level 2 row {extra} has no '### Block {extra}' section")

    in_block, in_row = {}, {}
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
        # The first code fence of the block, and the explanation after it.
        first = next((i for i in range(start + 1, end) if mask[i]), None)
        if first is None:
            fails.append(f"{name}: block {block_id} has no code fence")
            after = [note[i] for i in range(start + 1, end)]
        else:
            last = next((i for i in range(first, end) if not mask[i]), end)
            code = note[first + 1:last - 1]
            want = lines[a - 1:b]
            if len(code) != len(want):
                fails.append(f"{name}: block {block_id} code has {len(code)} lines, source lines {a}-{b} are {len(want)}")
            else:
                for offset, (got, real) in enumerate(zip(code, want)):
                    if not same_line(got, real, (a + offset) in masked_lines):
                        fails.append(f"{name}: block {block_id} code differs from the source at line {a + offset}")
                        break
            after = [note[i] for i in range(last, end) if not mask[i]]
        if depth == "map":
            if not any(row.strip() and not row.startswith(("|", "#")) for row in after):
                fails.append(f"{name}: block {block_id} has no explanation after its code")
        if depth == "full":
            for row in after:
                rm = ROW.match(row)
                if not rm:
                    continue
                r1, r2 = int(rm.group(1)), int(rm.group(2) or rm.group(1))
                label = f"{r1}" if r1 == r2 else f"{r1}-{r2}"
                for ln in range(r1, r2 + 1):
                    if ln < a or ln > b:
                        fails.append(f"{name}: block {block_id} has a row for line {ln}, outside {a}-{b}")
                    elif ln in in_row:
                        fails.append(f"{name}: line {ln} has two rows")
                    in_row[ln] = block_id
                c = cells(row)
                if len(c) < 4:
                    fails.append(f"{name}: row {label} needs four cells: Line, Code, What happens, Real value")
                    continue
                if not c[2]:
                    fails.append(f"{name}: row {label} has an empty 'What happens' cell")
                if not c[3]:
                    fails.append(f"{name}: row {label} has an empty 'Real value' cell (write a value, none, or not run)")
                quoted = code_excerpt(c[1])
                if quoted == MASK and all(k in masked_lines for k in range(r1, r2 + 1)):
                    pass  # a row for lines the note declares as fully masked
                elif not quoted or not quoted.replace(MASK, "").strip():
                    fails.append(f"{name}: row {label} quotes no code in its Code cell")
                elif r1 >= 1 and r2 <= len(lines):
                    # With [masked] in the excerpt, the text around each mask must still be on the line.
                    pattern = ".+?".join(re.escape(part) for part in quoted.split(MASK))
                    if not any(re.search(pattern, lines[k - 1]) for k in range(r1, r2 + 1)):
                        fails.append(f"{name}: row {label} quotes code that is not on that line: {quoted[:50]}")
    uncovered = sorted(nonblank - set(in_block))
    if uncovered:
        fails.append(f"{name}: non-blank lines in no block: {uncovered[:20]}{' ...' if len(uncovered) > 20 else ''}")
    rows = "-"
    if depth == "full":
        no_row = sorted(nonblank - set(in_row))
        blank_row = sorted(ln for ln in in_row if ln not in nonblank)
        if no_row:
            fails.append(f"{name}: non-blank lines with no row: {no_row[:20]}{' ...' if len(no_row) > 20 else ''}")
        if blank_row:
            fails.append(f"{name}: rows for blank lines: {blank_row[:20]}")
        rows = f"{len(nonblank & set(in_row))}/{len(nonblank)}"
    undeclared = sorted(k for k in masked_lines if k < 1 or k > len(lines))
    if undeclared:
        fails.append(f"{name}: masked_lines names lines outside the file: {undeclared[:10]}")
    print(f"INFO {src}: {len(lines)} lines, {len(nonblank)} non-blank, {len(starts)} blocks, depth {depth}, "
          f"in blocks {len(nonblank & set(in_block))}/{len(nonblank)}, rows {rows}"
          + (f", fully masked lines: {len(masked_lines)}" if masked_lines else ""))
    return src


def check_stale(name, props, root, kind):
    """A File note is stale when its source has a newer commit. A Mechanism or Flow note is stale when any of the
    files in its 'sources' property changed after the note's 'commit'."""
    noted = props.get("commit", "")
    if kind == "file":
        files = [props.get("source", "").replace("\\", "/")]
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


def check_graph(graph_path, noted, prose_by_source, all_code):
    """Every function or class the graph places in an explained file must be named in that file's note, outside the
    copied code. The graph's shape is read loosely (nodes with a file and a label): it differs between versions."""
    try:
        data = json.loads(Path(graph_path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        fails.append(f"graph: cannot read {graph_path}: {error}")
        return
    nodes = data.get("nodes") if isinstance(data, dict) else data
    if not isinstance(nodes, list) or not any(isinstance(n, dict) and n.get("source_file") for n in nodes):
        fails.append(f"graph: {graph_path} has no list of nodes with a source_file; the graph check could not run")
        return
    files_in_graph, compared = set(), 0
    for node in nodes:
        if not isinstance(node, dict):
            continue
        where = next((node[k] for k in ("source_file", "file", "path", "filepath") if isinstance(node.get(k), str)), None)
        label = next((node[k] for k in ("label", "name", "id") if isinstance(node.get(k), str)), None)
        if not where or not label:
            continue
        where = where.replace("\\", "/")
        files_in_graph.add(where)
        kind = str(node.get("type") or node.get("kind") or "").lower()
        if node.get("external") or kind in ("file", "module", "document", "external"):
            continue
        if Path(label).suffix.lower() in CODE_EXT:
            continue
        if not (node.get("_callable") or node.get("_callable_class") or label.endswith("()")):
            continue  # a constant or a variable: only functions, methods and classes must be named
        match = match_source(where, all_code)
        if match not in prose_by_source:
            continue  # the file is not explained (or cannot be told apart): nothing to compare
        short = re.split(r"[.:#/]", label.split("(")[0].strip())[-1]
        if not re.fullmatch(r"[A-Za-z_$][\w$-]*", short or ""):
            continue
        compared += 1
        if not re.search(r"(?<![\w$-])" + re.escape(short) + r"(?![\w$-])", prose_by_source[match]):
            fails.append(f"graph: '{short}' is in {match} but its note never names it outside the copied code")
    for s in noted:
        if match_source(s, sorted(files_in_graph)) is None:
            warns.append(f"graph: {s} is not in the graph (not parsed?); find its callers by text search and say so")
    print(f"INFO graph: {len(nodes)} nodes, {compared} functions or classes compared with notes")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
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
    ap.add_argument("--include-tests", action="store_true", help="test folders need File notes too")
    ap.add_argument("--allow-missing", action="store_true", help="source files without a note do not fail the check")
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
    for p in sorted(notes_dir.rglob("*.md")):
        if p.stem in notes:
            fails.append(f"note name used twice: {p.stem}")
        notes[p.stem] = p
    vault_names = {p.stem for p in vault.rglob("*.md")} | set(notes)

    noted, linked, prose_by_source, kinds = set(), set(), {}, {}
    unowned = []
    for name, p in notes.items():
        text = p.read_text(encoding="utf-8", errors="replace").replace("\r", "")
        props = frontmatter(text)
        if props.get("written_by", "").lower() != "argus":
            unowned.append(name)  # someone's own note: kept for link resolution, never checked
            continue
        kinds[name] = props.get("type", "")
        if not kinds[name]:
            warns.append(f"{name}: no 'type' property")
        lines = text.split("\n")
        mask = fence_mask(lines)
        prose = [(i + 1, line) for i, line in enumerate(lines) if not mask[i]]
        if kinds[name] == "file":
            src = check_file_note(name, text, props, root)
            if src:
                noted.add(src)
                prose_by_source[src] = "\n".join(line for _, line in prose)
                check_stale(name, props, root, "file")
        if kinds[name] in ("mechanism", "flow"):
            if not any(mask[i] and re.match(r"^`{3,}mermaid\s*$", line) for i, line in enumerate(lines)):
                fails.append(f"{name}: a {kinds[name].capitalize()} note needs a mermaid diagram")
            check_stale(name, props, root, kinds[name])
        for number, line in prose:
            for target in LINK.findall(line):
                target = target.rstrip("\\").strip()
                linked.add(target)
                if target not in vault_names:
                    fails.append(f"{name}: link to a note that does not exist: [[{target}]]")
            if line.startswith("|"):
                bare = re.sub(r"``.*?``", "", line)
                for code in re.findall(r"`([^`]*)`", bare):
                    if re.search(r"(^|[^\\])\|", code):
                        fails.append(f"{name} line {number}: unescaped | inside code in a table: {code[:40]}")
    for name in kinds:
        if name not in linked and kinds.get(name) != "start" and not name.endswith("Start Here"):
            fails.append(f"{name}: no note links to it")
    if unowned:
        print(f"INFO {len(unowned)} notes without written_by: argus were not checked (they are not this skill's notes)")

    code_files, unknown, left_out = inventory(root, args.include_tests, scopes)
    if left_out:
        folders = "; ".join(f"{folder} ({count})" for folder, count in sorted(left_out.items()))
        warns.append(f"folders left out as dependencies, build output, tool folders or tests, with their code files: "
                     f"{folders}. To have one explained, name it with --scope (tests: --include-tests)")
    missing.extend(src for src in code_files if src not in noted)
    if unknown:
        kinds_text = "; ".join(f"{kind} ({count})" for kind, count in sorted(unknown.items()))
        warns.append(f"files in scope of a kind this check does not know, not counted as code: {kinds_text}. "
                     f"If they hold code, they need File notes too; say so in the report")
    if args.graph:
        check_graph(args.graph, noted, prose_by_source, sorted(set(inventory(root, True, [])[0]) | noted))

    for item in fails:
        print(f"FAIL {item}")
    for item in missing[:MISSING_SHOWN]:
        print(f"MISSING {item}")
    if len(missing) > MISSING_SHOWN:
        print(f"MISSING ... and {len(missing) - MISSING_SHOWN} more; narrow with --scope")
    for label, items in (("STALE", stale), ("WARN", warns)):
        for item in items:
            print(f"{label} {item}")
    bad = len(fails) + (0 if args.allow_missing else len(missing))
    where = ", ".join(scopes) if scopes else "whole source root"
    print(f"RESULT scope {where}: {len(notes)} notes, {len(noted)} source files explained, {len(missing)} without a "
          f"note, {len(fails)} fail, {len(stale)} stale, {len(warns)} warn: "
          f"{'NOT PASSED' if bad else 'PASS' if args.graph else 'PASS WITHOUT THE GRAPH CHECK'}")
    sys.exit(0 if bad == 0 else 1)


if __name__ == "__main__":
    main()
