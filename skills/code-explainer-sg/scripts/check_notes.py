#!/usr/bin/env python3
"""Coverage check for code-explainer-sg notes. Python 3.10+, standard library only. Reads; never writes.

  python check_notes.py --notes <notes folder> --source <source root>

Exit code 0: no FAIL and no MISSING. Exit code 1 otherwise. STALE and WARN lines do not change the exit code.
"""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

CODE_EXT = {
    ".js", ".cjs", ".mjs", ".ts", ".tsx", ".jsx", ".py", ".ps1", ".sh", ".go", ".rs", ".java", ".kt", ".cs",
    ".rb", ".php", ".c", ".h", ".cpp", ".hpp", ".swift", ".sql", ".lua", ".r", ".scala",
}
SKIP_DIRS = {
    "node_modules", ".git", "venv", ".venv", "__pycache__", "dist", "build", "out", "download", "graphify-out",
    ".pytest_cache", "coverage", "vendor", ".claude",
}
TEST_DIRS = {"test", "tests", "__tests__", "spec"}
LENS = ["one sentence", "gain", "lose", "not possible", "issues", "makes possible", "open source", "risks"]
BLOCK = re.compile(r"^### Block (\w+)\b.*\(lines? (\d+)(?:-(\d+))?\)\s*$")
ROW = re.compile(r"^\| (\d+)(?:-(\d+))? \|")
FENCE = re.compile(r"^(`{3,})")
LINK = re.compile(r"\[\[([^\]|#]+)")

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


def section(text, heading):
    """The text under a '## <heading...>' line, up to the next '## ' line. '' when absent."""
    m = re.search(r"^## " + re.escape(heading) + r".*$", text, re.M)
    if not m:
        return ""
    rest = text[m.end():]
    nxt = re.search(r"^## ", rest, re.M)
    return rest[: nxt.start()] if nxt else rest


def source_files(root, include_tests):
    for p in sorted(root.rglob("*")):
        if not p.is_file() or p.suffix.lower() not in CODE_EXT:
            continue
        parts = set(p.relative_to(root).parts[:-1])
        if parts & SKIP_DIRS or (not include_tests and parts & TEST_DIRS):
            continue
        yield p.relative_to(root).as_posix()


def check_file_note(name, text, props, root):
    src = props.get("source", "")
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

    # Lens rows and concept links.
    level1 = section(text, "Level 1").lower()
    for label in LENS:
        if label not in level1:
            fails.append(f"{name}: lens row missing in Level 1: '{label}'")
    for row in section(text, "Level 2").splitlines():
        if re.match(r"^\| \d", row) and "[[" not in row:
            fails.append(f"{name}: Level 2 row names no concept: {row[:60]}")

    # Blocks: heading, code fence, line rows.
    note_lines = text.split("\n")
    starts = [i for i, line in enumerate(note_lines) if BLOCK.match(line)]
    if not starts:
        fails.append(f"{name}: no '### Block <id>: <purpose> (lines a-b)' heading found")
    in_block, in_row = {}, {}
    for n, start in enumerate(starts):
        m = BLOCK.match(note_lines[start])
        block_id, a, b = m.group(1), int(m.group(2)), int(m.group(3) or m.group(2))
        end = starts[n + 1] if n + 1 < len(starts) else len(note_lines)
        for i in range(start + 1, end):
            if note_lines[i].startswith("## "):
                end = i
                break
        body = note_lines[start + 1:end]
        if a < 1 or b > len(lines) or a > b:
            fails.append(f"{name}: block {block_id} range {a}-{b} is outside the file (1-{len(lines)})")
            continue
        for ln in range(a, b + 1):
            if ln in in_block:
                fails.append(f"{name}: line {ln} is in block {in_block[ln]} and block {block_id}")
            in_block[ln] = block_id
        # The first code fence of the block.
        code, fence, i = None, None, 0
        while i < len(body):
            fm = FENCE.match(body[i])
            if fm and fence is None:
                fence, code = fm.group(1), []
            elif fence is not None and body[i].startswith(fence):
                break
            elif fence is not None:
                code.append(body[i])
            i += 1
        after = body[i + 1:] if code is not None else body
        if code is None:
            fails.append(f"{name}: block {block_id} has no code fence")
        else:
            want = lines[a - 1:b]
            if len(code) != len(want):
                fails.append(f"{name}: block {block_id} code has {len(code)} lines, source lines {a}-{b} are {len(want)}")
            else:
                for offset, (got, real) in enumerate(zip(code, want)):
                    if got != real and "[masked]" not in got:
                        fails.append(f"{name}: block {block_id} code differs from the source at line {a + offset}")
                        break
        if depth == "full":
            for row in after:
                rm = ROW.match(row)
                if not rm:
                    continue
                r1, r2 = int(rm.group(1)), int(rm.group(2) or rm.group(1))
                for ln in range(r1, r2 + 1):
                    if ln < a or ln > b:
                        fails.append(f"{name}: block {block_id} has a row for line {ln}, outside {a}-{b}")
                    elif ln in in_row:
                        fails.append(f"{name}: line {ln} has two rows")
                    in_row[ln] = block_id
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
    print(f"INFO {src}: {len(lines)} lines, {len(nonblank)} non-blank, {len(starts)} blocks, depth {depth}, "
          f"in blocks {len(nonblank & set(in_block))}/{len(nonblank)}, rows {rows}")
    return src


def check_stale(name, props, root):
    src, noted = props.get("source", ""), props.get("commit", "")
    if not noted:
        warns.append(f"{name}: no 'commit' property, so a change to the source cannot be detected")
        return
    try:
        out = subprocess.run(["git", "-C", str(root), "log", "-1", "--format=%H", "--", src],
                             capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.SubprocessError):
        return
    now = out.stdout.strip()
    if out.returncode == 0 and now and not now.startswith(noted):
        stale.append(f"{name}: written at commit {noted}, source is now at {now[:8]}")


def check_graph(graph_path, noted, texts_by_source):
    """Every named node the graph places in a file should be named in that file's note. The graph's shape is read
    loosely (nodes with a file and a label), because it differs between graph tools and versions."""
    try:
        data = json.loads(Path(graph_path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        fails.append(f"graph: cannot read {graph_path}: {error}")
        return
    nodes = data.get("nodes") if isinstance(data, dict) else data
    if not isinstance(nodes, list):
        warns.append("graph: no list of nodes found; graph check skipped")
        return
    files_in_graph, seen = set(), 0
    for node in nodes:
        if not isinstance(node, dict):
            continue
        where = next((node[k] for k in ("source_file", "file", "path", "filepath") if isinstance(node.get(k), str)), None)
        label = next((node[k] for k in ("label", "name", "id") if isinstance(node.get(k), str)), None)
        if not where or not label:
            continue
        where = where.replace("\\", "/")
        files_in_graph.add(where)
        match = next((s for s in texts_by_source if where.endswith(s) or s.endswith(where)), None)
        if not match:
            continue
        seen += 1
        short = re.split(r"[.:#/(]", label.strip())[-1] if not label.endswith(")") else label.split("(")[0].split(".")[-1]
        if short and short not in texts_by_source[match]:
            warns.append(f"graph: '{label}' in {match} is not named in its note")
    for s in noted:
        if not any(f.endswith(s) or s.endswith(f) for f in files_in_graph):
            warns.append(f"graph: {s} is not in the graph (not parsed?); its callers were found by text search")
    print(f"INFO graph: {len(nodes)} nodes, {seen} compared with notes")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--notes", required=True, help="folder that holds the notes this skill wrote")
    ap.add_argument("--source", required=True, help="source root; each File note's 'source' property is relative to it")
    ap.add_argument("--vault", help="vault root, to resolve [[links]] to notes outside --notes (default: --notes)")
    ap.add_argument("--graph", help="graph JSON from graphify, to compare its nodes with the notes")
    ap.add_argument("--include-tests", action="store_true", help="test folders need File notes too")
    ap.add_argument("--allow-missing", action="store_true", help="source files without a note do not fail the check")
    args = ap.parse_args()
    notes_dir, root = Path(args.notes), Path(args.source)
    vault = Path(args.vault) if args.vault else notes_dir
    for folder in (notes_dir, root, vault):
        if not folder.is_dir():
            sys.exit(f"not a folder: {folder}")

    notes = {}
    for p in sorted(notes_dir.rglob("*.md")):
        if p.stem in notes:
            fails.append(f"note name used twice: {p.stem}")
        notes[p.stem] = p
    vault_names = {p.stem for p in vault.rglob("*.md")} | set(notes)

    noted, linked, texts_by_source = set(), set(), {}
    for name, p in notes.items():
        text = p.read_text(encoding="utf-8", errors="replace").replace("\r", "")
        if not text.strip():
            fails.append(f"{name}: the note is empty")
            continue
        props = frontmatter(text)
        if not props.get("type"):
            warns.append(f"{name}: no 'type' property")
        if props.get("type") == "file":
            src = check_file_note(name, text, props, root)
            if src:
                noted.add(src)
                texts_by_source[src] = text
                check_stale(name, props, root)
        fenced = False
        for number, line in enumerate(text.split("\n"), 1):
            if FENCE.match(line):
                fenced = not fenced
            if fenced:
                continue
            for target in LINK.findall(line):
                target = target.strip()
                linked.add(target)
                if target not in vault_names:
                    fails.append(f"{name}: link to a note that does not exist: [[{target}]]")
            if line.startswith("|"):
                for code in re.findall(r"`([^`]*)`", line):
                    if re.search(r"(^|[^\\])\|", code):
                        fails.append(f"{name} line {number}: unescaped | inside code in a table: {code[:40]}")
    for name, p in notes.items():
        kind = frontmatter(p.read_text(encoding="utf-8", errors="replace")).get("type", "")
        if name not in linked and kind != "start" and not name.endswith("Start Here"):
            fails.append(f"{name}: no note links to it")

    for src in source_files(root, args.include_tests):
        if src not in noted:
            missing.append(src)
    if args.graph:
        check_graph(args.graph, noted, texts_by_source)

    for label, items in (("FAIL", fails), ("MISSING", missing), ("STALE", stale), ("WARN", warns)):
        for item in items:
            print(f"{label} {item}")
    bad = len(fails) + (0 if args.allow_missing else len(missing))
    print(f"RESULT {len(notes)} notes, {len(noted)} source files explained, {len(missing)} without a note, "
          f"{len(fails)} fail, {len(stale)} stale, {len(warns)} warn: {'PASS' if bad == 0 else 'NOT PASSED'}")
    sys.exit(0 if bad == 0 else 1)


if __name__ == "__main__":
    main()
