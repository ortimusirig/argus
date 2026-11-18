#!/usr/bin/env python3
"""Guided walk for the CodeTour extension, made from argus File notes. Python 3.10+, standard library only.

  python -B make_tour.py --notes <notes folder> --source <source root> --in-project [--plan <plan.json>]
  python -B make_tour.py --notes <notes folder> --source <source root> --out <file.tour>

Writes one tour file: a first step with the project's purpose, then for each explained file a step with its
purpose and one step per block, the block's lines selected and its explanation beside them.

--in-project writes <source>/.tours/<project>.tour: CodeTour lists it by itself when the source root is the open
workspace. It is the one file argus ever writes into a project, and git on this computer is told to ignore that
folder (.git/info/exclude; no tracked file changes). --out writes anywhere outside the source; the person then opens
the file with the command "CodeTour: Open Tour File...".

A block whose copied code no longer equals the source is left out and listed: run check_notes.py and refresh the
note first. Run this script again after every change to the code or the notes: the tour is made new each time.
"""
import argparse
import json
import re
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import check_notes as cn  # noqa: E402
from _common import (in_scope, normalize_scopes, note_blocks, on_disk, read_text, same_line, source_lines,  # noqa: E402
                     utf8_output)

SCHEMA = "https://aka.ms/codetour-schema"


def plain_links(text, vault):
    """[[Note]] becomes a link that opens the note in Obsidian when the vault's name is known, else italic text."""
    def one(m):
        name = m.group(1).strip().rstrip("\\")
        shown = (m.group(2) or name).strip()
        if vault:
            from urllib.parse import quote
            return f"[{shown}](obsidian://open?vault={quote(vault)}&file={quote(name)})"
        return f"*{shown}*"
    return re.sub(r"\[\[([^\]|#]+)(?:\\?\|([^\]]+))?\]\]", one, text)


def table_as_list(rows, vault):
    """Table rows as a Markdown list: CodeTour's step text is not known to render tables."""
    out = []
    for c in rows:
        if len(c) >= 2 and not set(c[0]) <= set("-: ") and c[0].lower() not in ("lens", "line", "#"):
            head, rest = c[0], [x for x in c[1:] if x]
            out.append(f"- **{head}**: " + " · ".join(rest))
    return plain_links("\n".join(out), vault)


def file_steps(name, text, props, root, prefix, vault, skipped):
    src = on_disk(root, props.get("source", ""))
    if not src:
        skipped.append(f"{name}: its 'source' names no file under the source root")
        return None, []
    lines, _ = source_lines(Path(root) / src)
    note = text.split("\n")
    mask = cn.fence_mask(note)
    declared = cn.line_set(props.get("masked_lines", ""), len(lines))
    path = (prefix.strip("/") + "/" if prefix.strip("/") else "") + src
    level1 = cn.section(note, mask, "Level 1") or []
    lens = table_as_list([cn.cells(r) for r in level1 if cn.is_row(r)], vault)
    steps = [{"file": path, "line": 1, "title": f"{src}: why this file exists",
              "description": f"### {src}\n\n{lens}\n\n_Explained by the note “{name}”._"}]
    # Purposes from the Level 2 table, for headings that give only "Block <id>".
    level2 = {}
    for row in cn.section(note, mask, "Level 2") or []:
        c = cn.cells(row) if cn.is_row(row) else []
        if len(c) >= 3 and re.fullmatch(r"\d\w*", c[0]):
            level2[c[0]] = c[2]
    for block in note_blocks(note, mask):
        block_id, a, b, start, end = block["id"], block["a"], block["b"], block["start"], block["end"]
        purpose = re.sub(r"\s*\(lines? [\d\s-]+\)\s*$", "", note[start][len("### "):]).strip()
        purpose = re.sub(r"^Block \w+:?\s*", "", purpose).strip() or level2.get(block_id, "") or f"Block {block_id}"
        if block["first"] is None or a < 1 or b > len(lines) or a > b:
            skipped.append(f"{name}: block {block_id} has no code or a range outside the file")
            continue
        last, code, want = block["last"], block["code"], lines[a - 1:b]
        same = len(code) == len(want) and all(same_line(got, real, (a + k) in declared)
                                              for k, (got, real) in enumerate(zip(code, want)))
        if not same:
            skipped.append(f"{name}: block {block_id} (lines {a}-{b}) no longer equals {src}; refresh the note")
            continue
        after = [note[i] for i in range(last, end) if not mask[i]]
        rows, prose, extra = [], [], []
        for row in after:
            c = cn.cells(row) if cn.is_row(row) else []
            if c and cn.LINE_CELL.fullmatch(c[0]) and len(c) >= 4:
                value = "" if c[3].lower() in ("none", "") else f" _(value: {c[3]})_"
                rows.append(f"- **Line {c[0]}** {c[1]}: {c[2]}{value}")
            elif c:
                extra.append(c)  # another table of the block (for example the parts of one rich line)
            elif row.strip() and not row.startswith("#"):
                prose.append(row.strip())
        body = "\n\n".join(part for part in ("\n".join(rows), "\n\n".join(prose), table_as_list(extra, None)) if part)
        steps.append({
            "file": path,
            "selection": {"start": {"line": a, "character": 1}, "end": {"line": b, "character": len(lines[b - 1]) + 1}},
            "title": f"{src} · {purpose}",
            "description": plain_links(f"**{purpose}** (lines {a}-{b})\n\n{body}", vault),
        })
    return src, steps


def keep_out_of_git(root):
    """Makes git on this computer ignore <root>/.tours/, unless the project already tracks or ignores it. Uses
    .git/info/exclude, which is never committed, so no tracked file changes. Returns what was done, as a sentence."""
    if cn.git(root, "rev-parse", "--is-inside-work-tree") != "true":
        return "the source is not a git repository; nothing to keep out of git"
    if cn.git(root, "ls-files", "--", ".tours"):
        return "the project already tracks files in .tours; git settings left as they are"
    if cn.git(root, "check-ignore", "-q", ".tours/x.tour") is not None:
        return ".tours/ is already ignored by git"
    exclude = cn.git(root, "rev-parse", "--git-path", "info/exclude")
    prefix = cn.git(root, "rev-parse", "--show-prefix") or ""
    if not exclude:
        return "could not find .git/info/exclude; .tours/ will show as untracked in git"
    path = Path(exclude) if Path(exclude).is_absolute() else Path(root) / exclude
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "a", encoding="utf-8") as handle:
            handle.write(f"\n# argus: guided-walk files for the CodeTour extension, made on this computer\n/{prefix}.tours/\n")
    except OSError as error:
        return f"could not write {path} ({error}); .tours/ will show as untracked in git"
    return f"git on this computer now ignores {prefix}.tours/ (one line added to {path}; no tracked file changed)"


def main():
    utf8_output()
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--notes", required=True, help="folder that holds the argus notes")
    ap.add_argument("--source", required=True, help="source root; the notes' 'source' paths are relative to it")
    ap.add_argument("--out", help="the tour file to write (name it <something>.tour), somewhere outside --source")
    ap.add_argument("--in-project", action="store_true",
                    help="write the tour to <source>/.tours/<project>.tour, where CodeTour finds it by itself, and "
                         "keep that folder out of git on this computer (.git/info/exclude). This is the one file "
                         "argus writes into the project. Give exactly one of --out and --in-project")
    ap.add_argument("--scope", action="append", default=[], help="only files under this path; repeatable")
    ap.add_argument("--plan", help="JSON written by 'graph_plan.py --json': its order becomes the order of the walk")
    ap.add_argument("--title", help="the tour's title. Default: '<project>: guided walk'")
    ap.add_argument("--path-prefix", default="",
                    help="put in front of every file path, when the VS Code workspace is a folder above --source")
    ap.add_argument("--obsidian-vault", help="the vault's name: concept links then open in Obsidian")
    ap.add_argument("--strict", action="store_true", help="exit with 1 when any note or block had to be left out")
    args = ap.parse_args()
    if bool(args.out) == bool(args.in_project):
        ap.error("give exactly one of --out <file.tour> and --in-project")
    notes_dir, root = Path(args.notes), Path(args.source)
    for folder in (notes_dir, root):
        if not folder.is_dir():
            sys.exit(f"not a folder: {folder}")
    out = Path(args.out) if args.out else None
    if out is not None:
        if out.suffix != ".tour":
            sys.exit("--out must end in .tour")
        try:
            out.resolve().relative_to(root.resolve())
            sys.exit("--out is inside the source root. To put the tour where CodeTour finds it by itself, use "
                     "--in-project, which writes only <source>/.tours/ and keeps it out of git")
        except ValueError:
            pass
    scopes = normalize_scopes(root, args.scope)

    skipped, by_source, project, intro = [], {}, "", ""
    for p in cn.note_files(notes_dir):
        text = read_text(p)[0].replace("\r\n", "\n").replace("\r", "\n")
        props = cn.frontmatter(text)
        if props.get("written_by", "").lower() != "argus":
            continue
        project = project or props.get("project", "")
        if props.get("type") == "start":
            lines = text.split("\n")
            mask = cn.fence_mask(lines)
            intro = table_as_list([cn.cells(line) for i, line in enumerate(lines) if not mask[i] and cn.is_row(line)
                                   and any(label in line.lower() for label in cn.LENS)], args.obsidian_vault)
        if props.get("type") == "file":
            src, steps = file_steps(p.stem, text, props, root, args.path_prefix, args.obsidian_vault, skipped)
            if src and in_scope(src, scopes):
                by_source[src] = steps

    order = sorted(by_source)
    if args.plan:
        try:
            planned = json.loads(read_text(args.plan)[0]).get("order", [])
        except (OSError, ValueError) as error:
            sys.exit(f"cannot read the plan {args.plan}: {error}")
        order = [f for f in planned if f in by_source] + [f for f in order if f not in planned]
    if not order:
        sys.exit("no File note with written_by: argus explains a file in scope; there is nothing to walk through")

    title = args.title or f"{project or root.name}: guided walk"
    steps = [{"title": "Start", "description":
              f"## {title}\n\nA walk through {len(order)} explained file(s), in reading order: files that others "
              f"depend on come first. Each step selects a block of code and explains it.\n\n{intro}".rstrip()}]
    for src in order:
        steps.extend(by_source[src])
    commit = cn.git(root, "rev-parse", "--short", "HEAD")
    made = f"Made by argus from {len(order)} File note(s)" + (f", for the code at commit {commit}" if commit else "")
    tour = {"$schema": SCHEMA, "title": title,
            "description": f"{made}. Regenerate after the code or the notes change.", "steps": steps}
    steps[0]["description"] += f"\n\n_{made}. If the code has changed since, make the tour again._"
    how = "command 'CodeTour: Open Tour File...'"
    if args.in_project:
        slug = re.sub(r"[^A-Za-z0-9._-]+", "-", project or root.name).strip("-") or "argus"
        out = root / ".tours" / f"{slug}.tour"
        how = "it is listed in the CodeTour view of the side bar"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(tour, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"INFO wrote {out}: {len(steps)} steps for {len(order)} files")
    if args.in_project:
        print(f"INFO {keep_out_of_git(root)}")
    for item in skipped:
        print(f"SKIPPED {item}")
    print(f"RESULT {len(steps)} steps, {len(skipped)} left out. To play it in VS Code with the CodeTour extension, "
          f"open {root} as the workspace: {how}")
    sys.exit(1 if skipped and args.strict else 0)


if __name__ == "__main__":
    main()
