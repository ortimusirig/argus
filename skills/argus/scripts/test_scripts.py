#!/usr/bin/env python3
"""Small tests for check_notes.py and graph_plan.py. Run: python test_scripts.py"""
import json
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
CHECK = HERE / "check_notes.py"
PLAN = HERE / "graph_plan.py"
TOUR = HERE / "make_tour.py"
SETUP = HERE / "setup_tools.py"
LENS = ["In one sentence", "What we gain", "What we lose", "What was not possible without it", "Issues today",
        "What it makes possible", "Open source used", "Risks"]


def run(script, *args):
    args = [str(a) for a in args]
    if script == CHECK and "--graph" not in args and "--bare" not in args:
        args.append("--no-graph")
    args = [a for a in args if a != "--bare"]
    out = subprocess.run([sys.executable, str(script), *args], capture_output=True, text=True)
    return out.returncode, out.stdout + out.stderr


def file_note(src_rel, code_lines, depth="full", lang="py", explain=True, code_in_note=None, extra_props=""):
    """A File note with one block that covers the whole file."""
    n = len(code_lines)
    rng = f"line 1" if n == 1 else f"lines 1-{n}"
    shown = code_in_note if code_in_note is not None else code_lines
    t = [f"---\ntype: file\nwritten_by: argus\nproject: P\nsource: {src_rel}\ndepth: {depth}\n{extra_props}---", f"# P file - {Path(src_rel).name}",
         "", "## Level 1: purpose", "", "| Lens | Answer |", "| --- | --- |"]
    t += [f"| {label} | an answer |" for label in LENS]
    t += ["", "## Level 2: blocks", "", "| # | Lines | Purpose | Why this way | Concepts |", "| --- | --- | --- | --- | --- |"]
    if explain:
        t.append(f"| 1 | 1-{n} | does it | because | [[Concept - x]] |")
    t += ["", "## Code and explanation", "", f"### Block 1: does it ({rng})", "", f"```{lang}", *shown, "```", ""]
    if explain and depth == "map":
        t.append("This block does it, see [[Concept - x]].")
    if depth == "full":
        t += ["| Line | Code | What happens | Real value |", "| --- | --- | --- | --- |"]
        for i, line in enumerate(code_lines, 1):
            if line.strip():
                quoted = line.strip().replace("|", "\\|")
                t.append(f"| {i} | `` {quoted} `` | it happens, [[Concept - x]] | none |")
        t += ["", "## Trace: one run", "", "| Step | Line | Variable | Value |", "| --- | --- | --- | --- |", "| 1 | 1 | x | not run |",
              "", "## Check your understanding", "", "| Question | Answer |", "| --- | --- |", "| What? | That. |"]
    return "\n".join(t) + "\n"


def write_graph(tmp, nodes, links=()):
    graph = Path(tmp) / "graph.json"
    graph.write_text(json.dumps({"nodes": nodes, "links": list(links)}), encoding="utf-8")
    return graph


def project(tmp, sources, notes):
    """Write source files under tmp/src and notes under tmp/notes. Adds Start Here and one Concept note."""
    src, nd = Path(tmp) / "src", Path(tmp) / "notes"
    for rel, lines in sources.items():
        (src / rel).parent.mkdir(parents=True, exist_ok=True)
        (src / rel).write_text("\n".join(lines) + "\n", encoding="utf-8")
    nd.mkdir(parents=True, exist_ok=True)
    src.mkdir(parents=True, exist_ok=True)
    for name, text in notes.items():
        (nd / f"{name}.md").write_text(text, encoding="utf-8")
    links = " ".join(f"[[{name}]]" for name in notes)
    (nd / "P - Start Here.md").write_text(f"---\ntype: start\nwritten_by: argus\n---\n| Lens | Answer |\n| --- | --- |\n| In one sentence | a |\n| What we gain | a |\n| What we lose | a |\n| What was not possible without it | a |\n| Issues today | a |\n| What it makes possible | a |\n| Open source used | a |\n| Risks | a |\n\n# P\n{links} [[Concept - x]]\n", encoding="utf-8")
    (nd / "Concept - x.md").write_text("---\ntype: concept\nwritten_by: argus\n---\n# Concept - x\nA thing.\n", encoding="utf-8")
    return src, nd


class CheckNotes(unittest.TestCase):
    def test_good_note_passes(self):
        with tempfile.TemporaryDirectory() as tmp:
            code = ["x = 1", "", "y = 2"]
            src, nd = project(tmp, {"a.py": code}, {"P file - a.py": file_note("a.py", code)})
            code_, out = run(CHECK, "--notes", nd, "--source", src)
            self.assertEqual(code_, 0, out)

    def test_scope_dot_and_absolute_still_report_missing(self):  # Codex round 1, finding 1
        with tempfile.TemporaryDirectory() as tmp:
            src, nd = project(tmp, {"a.py": ["x = 1"]}, {})
            for scope in (".", str(src), str(src / "a.py")):
                code_, out = run(CHECK, "--notes", nd, "--source", src, "--scope", scope)
                self.assertEqual(code_, 1, f"scope {scope}: {out}")
                self.assertIn("MISSING a.py", out)

    def test_scope_outside_source_is_refused(self):  # finding 1
        with tempfile.TemporaryDirectory() as tmp:
            src, nd = project(tmp, {"a.py": ["x = 1"]}, {})
            code_, out = run(CHECK, "--notes", nd, "--source", src, "--scope", Path(tmp) / "notes")
            self.assertNotEqual(code_, 0, out)

    def test_other_source_formats_count(self):  # finding 2
        with tempfile.TemporaryDirectory() as tmp:
            src, nd = project(tmp, {"App.vue": ["<template></template>"], "main.dart": ["void main() {}"]}, {})
            code_, out = run(CHECK, "--notes", nd, "--source", src)
            self.assertEqual(code_, 1, out)
            self.assertIn("MISSING App.vue", out)
            self.assertIn("MISSING main.dart", out)

    def test_unknown_file_kinds_are_reported(self):  # finding 2
        with tempfile.TemporaryDirectory() as tmp:
            src, nd = project(tmp, {"a.py": ["x = 1"], "rules.xyzlang": ["rule one"]},
                              {"P file - a.py": file_note("a.py", ["x = 1"])})
            code_, out = run(CHECK, "--notes", nd, "--source", src)
            self.assertIn(".xyzlang", out)

    def test_map_depth_needs_explanations(self):  # finding 3
        with tempfile.TemporaryDirectory() as tmp:
            code = ["x = 1"]
            src, nd = project(tmp, {"a.py": code}, {"P file - a.py": file_note("a.py", code, depth="map", explain=False)})
            code_, out = run(CHECK, "--notes", nd, "--source", src)
            self.assertEqual(code_, 1, out)
            self.assertIn("FAIL", out)

    def test_map_depth_with_explanations_passes(self):  # finding 3
        with tempfile.TemporaryDirectory() as tmp:
            code = ["x = 1"]
            src, nd = project(tmp, {"a.py": code}, {"P file - a.py": file_note("a.py", code, depth="map")})
            code_, out = run(CHECK, "--notes", nd, "--source", src)
            self.assertEqual(code_, 0, out)

    def test_heading_like_comment_in_code(self):  # finding 4
        with tempfile.TemporaryDirectory() as tmp:
            code = ["## Configuration", "x = 1", "### Block 9: not a block (lines 1-2)", "y = 2"]
            src, nd = project(tmp, {"a.py": code}, {"P file - a.py": file_note("a.py", code)})
            code_, out = run(CHECK, "--notes", nd, "--source", src)
            self.assertEqual(code_, 0, out)

    def test_masked_line_must_match_around_the_mask(self):  # finding 5
        with tempfile.TemporaryDirectory() as tmp:
            code = ['token = "abc123"']
            good = file_note("a.py", code, depth="map", code_in_note=['token = "[masked]"'], extra_props="masked_lines: 1\n")
            bad = file_note("a.py", code, depth="map", code_in_note=['other = 5  # [masked]'])
            src, nd = project(tmp, {"a.py": code}, {"P file - a.py": good})
            self.assertEqual(run(CHECK, "--notes", nd, "--source", src)[0], 0)
            (nd / "P file - a.py.md").write_text(bad, encoding="utf-8")
            code_, out = run(CHECK, "--notes", nd, "--source", src)
            self.assertEqual(code_, 1, out)
            self.assertIn("differs from the source", out)

    def test_graph_symbol_goes_to_the_right_file(self):  # finding 7
        with tempfile.TemporaryDirectory() as tmp:
            a, d= ["x = 1"], ["def load():", "    return 1"]
            note_d = file_note("data.py", d).replace("does it (lines", "defines load (lines")
            src, nd = project(tmp, {"a.py": a, "data.py": d},
                              {"P file - a.py": file_note("a.py", a), "P file - data.py": note_d})
            graph = Path(tmp) / "graph.json"
            graph.write_text(json.dumps({"nodes": [
                {"id": "f1", "label": "a.py", "source_file": "a.py"},
                {"id": "f2", "label": "data.py", "source_file": "data.py"},
                {"id": "l", "label": "load()", "source_file": "data.py", "_callable": True}], "links": []}))
            code_, out = run(CHECK, "--notes", nd, "--source", src, "--graph", graph)
            self.assertEqual(code_, 0, out)

    def test_unusable_graph_fails(self):  # finding 8
        with tempfile.TemporaryDirectory() as tmp:
            code = ["x = 1"]
            src, nd = project(tmp, {"a.py": code}, {"P file - a.py": file_note("a.py", code)})
            graph = Path(tmp) / "graph.json"
            graph.write_text(json.dumps({"something": "else"}))
            code_, out = run(CHECK, "--notes", nd, "--source", src, "--graph", graph)
            self.assertEqual(code_, 1, out)

    def test_mechanism_note_goes_stale_with_its_sources(self):  # finding 9
        with tempfile.TemporaryDirectory() as tmp:
            code = ["x = 1"]
            src, nd = project(tmp, {"a.py": code}, {})
            git = lambda *a: subprocess.run(["git", "-C", str(src), "-c", "user.name=t", "-c", "user.email=t@t", *a],
                                            capture_output=True, text=True)
            if git("init", "-q").returncode != 0:
                self.skipTest("git not available")
            git("add", "-A"); git("commit", "-q", "-m", "one")
            first = git("log", "-1", "--format=%h").stdout.strip()
            (nd / "P file - a.py.md").write_text(file_note("a.py", code, extra_props=f"commit: {first}\n"), encoding="utf-8")
            (nd / "P mechanism - m.md").write_text(
                f"---\ntype: mechanism\nwritten_by: argus\nsources: a.py\ncommit: {first}\n---\n# m\n[[P file - a.py]]\n```mermaid\nsequenceDiagram\n```\n",
                encoding="utf-8")
            (nd / "P - Start Here.md").write_text("---\ntype: start\nwritten_by: argus\n---\n| Lens | Answer |\n| --- | --- |\n| In one sentence | a |\n| What we gain | a |\n| What we lose | a |\n| What was not possible without it | a |\n| Issues today | a |\n| What it makes possible | a |\n| Open source used | a |\n| Risks | a |\n\n[[P file - a.py]] [[P mechanism - m]] [[Concept - x]]\n", encoding="utf-8")
            self.assertNotIn("STALE", run(CHECK, "--notes", nd, "--source", src)[1])
            (src / "a.py").write_text("x = 2\n", encoding="utf-8")
            git("add", "-A"); git("commit", "-q", "-m", "two")
            out = run(CHECK, "--notes", nd, "--source", src)[1]
            self.assertIn("STALE P mechanism - m", out)
            self.assertIn("STALE P file - a.py", out)


class CheckNotesRound2(unittest.TestCase):
    def test_scope_in_another_letter_case(self):  # Codex round 2, finding 1
        with tempfile.TemporaryDirectory() as tmp:
            src, nd = project(tmp, {"pkg/a.py": ["x = 1"]}, {})
            if not (src / "PKG").exists():
                self.skipTest("file names are case-sensitive here")
            code_, out = run(CHECK, "--notes", nd, "--source", src, "--scope", "PKG")
            self.assertEqual(code_, 1, out)
            self.assertIn("MISSING pkg/a.py", out)

    def test_files_without_extension(self):  # finding 2
        with tempfile.TemporaryDirectory() as tmp:
            src, nd = project(tmp, {"Makefile": ["all:", "\techo hi"], "run": ["#!/bin/sh", "echo hi"],
                                    "Dockerfile": ["FROM scratch"], "LICENSE": ["text"], "odd": ["data"]}, {})
            code_, out = run(CHECK, "--notes", nd, "--source", src)
            self.assertEqual(code_, 1, out)
            for name in ("Makefile", "run", "Dockerfile"):
                self.assertIn(f"MISSING {name}", out)
            self.assertNotIn("MISSING LICENSE", out)
            self.assertIn("odd", out)  # reported as a file of unknown kind

    def test_graph_symbol_with_same_file_name_in_two_folders(self):  # finding 5
        with tempfile.TemporaryDirectory() as tmp:
            root_a, pkg_a = ["x = 1"], ["def child_fn():", "    return 1"]
            note_root = file_note("a.py", root_a).replace("does it (line", "mentions child_fn here (line")
            # depth map: the pkg note's own words never name child_fn, so the check must fail for pkg/a.py
            note_pkg = file_note("pkg/a.py", pkg_a, depth="map").replace("# P file - a.py", "# P file - pkg - a.py")
            src, nd = project(tmp, {"a.py": root_a, "pkg/a.py": pkg_a},
                              {"P file - a.py": note_root, "P file - pkg - a.py": note_pkg})
            graph = Path(tmp) / "graph.json"
            graph.write_text(json.dumps({"nodes": [
                {"id": "f1", "label": "a.py", "source_file": "a.py"},
                {"id": "f2", "label": "a.py", "source_file": "pkg/a.py"},
                {"id": "c", "label": "child_fn()", "source_file": "pkg/a.py", "_callable": True}], "links": []}))
            code_, out = run(CHECK, "--notes", nd, "--source", src, "--graph", graph)
            self.assertEqual(code_, 1, out)
            self.assertIn("'child_fn' is in pkg/a.py", out)

    def test_graph_or_no_graph_must_be_said(self):  # finding 6
        with tempfile.TemporaryDirectory() as tmp:
            code = ["x = 1"]
            src, nd = project(tmp, {"a.py": code}, {"P file - a.py": file_note("a.py", code)})
            code_, out = run(CHECK, "--notes", nd, "--source", src, "--bare")
            self.assertEqual(code_, 2, out)
            code_, out = run(CHECK, "--notes", nd, "--source", src, "--no-graph")
            self.assertEqual(code_, 0, out)
            self.assertIn("WITHOUT THE GRAPH CHECK", out)

    def test_line_row_must_quote_real_code(self):  # finding 7
        with tempfile.TemporaryDirectory() as tmp:
            code = ["x = 1"]
            good = file_note("a.py", code)
            src, nd = project(tmp, {"a.py": code}, {"P file - a.py": good})
            for cell in ("``  ``", "`…`", "`[masked]`", "`y = [masked]`"):
                (nd / "P file - a.py.md").write_text(good.replace("`` x = 1 ``", cell), encoding="utf-8")
                code_, out = run(CHECK, "--notes", nd, "--source", src)
                self.assertEqual(code_, 1, f"cell {cell}: {out}")

    def test_masked_line_row(self):  # finding 7
        with tempfile.TemporaryDirectory() as tmp:
            code = ['token = "abc123"']
            note = file_note("a.py", code, code_in_note=['token = "[masked]"'], extra_props="masked_lines: 1\n").replace('`` token = "abc123" ``', '`` token = "[masked]" ``')
            src, nd = project(tmp, {"a.py": code}, {"P file - a.py": note})
            code_, out = run(CHECK, "--notes", nd, "--source", src)
            self.assertEqual(code_, 0, out)


class CheckNotesRound3(unittest.TestCase):
    def test_scripts_write_nothing_beside_themselves(self):  # Codex round 3, finding 1
        import shutil
        shutil.rmtree(HERE / "__pycache__", ignore_errors=True)
        with tempfile.TemporaryDirectory() as tmp:
            code = ["x = 1"]
            src, nd = project(tmp, {"a.py": code}, {"P file - a.py": file_note("a.py", code)})
            run(CHECK, "--notes", nd, "--source", src)
            run(PLAN, "--graph", HERE.parent.parent.parent / "docs" / "graph-sample.json")
        self.assertFalse((HERE / "__pycache__").exists())

    def test_fully_masked_line_must_be_declared(self):  # finding 2
        with tempfile.TemporaryDirectory() as tmp:
            code = ['key = """', "SECRETLINE", '"""']
            shown = ['key = """', "[masked]", '"""']
            undeclared = file_note("a.py", code, depth="map", code_in_note=shown)
            declared = file_note("a.py", code, depth="map", code_in_note=shown, extra_props="masked_lines: 2\n")
            src, nd = project(tmp, {"a.py": code}, {"P file - a.py": undeclared})
            self.assertEqual(run(CHECK, "--notes", nd, "--source", src)[0], 1)
            (nd / "P file - a.py.md").write_text(declared, encoding="utf-8")
            code_, out = run(CHECK, "--notes", nd, "--source", src)
            self.assertEqual(code_, 0, out)
            self.assertIn("masked lines: 1", out)
            self.assertIn("1 masked lines (2)", out)  # listed for a person to confirm

    def test_fully_masked_line_in_a_line_table(self):  # finding 2
        with tempfile.TemporaryDirectory() as tmp:
            code = ['key = """', "SECRETLINE", '"""']
            note = file_note("a.py", code, code_in_note=['key = """', "[masked]", '"""'], extra_props="masked_lines: 2\n")
            note = note.replace("`` SECRETLINE ``", "`` [masked] ``")
            src, nd = project(tmp, {"a.py": code}, {"P file - a.py": note})
            code_, out = run(CHECK, "--notes", nd, "--source", src)
            self.assertEqual(code_, 0, out)
            self.assertNotIn("SECRETLINE", note)

    def test_scope_into_a_folder_that_is_normally_left_out(self):  # finding 3
        with tempfile.TemporaryDirectory() as tmp:
            src, nd = project(tmp, {"build/compile.py": ["x = 1"], "a.py": ["y = 2"]},
                              {"P file - a.py": file_note("a.py", ["y = 2"])})
            code_, out = run(CHECK, "--notes", nd, "--source", src, "--scope", "build/compile.py")
            self.assertEqual(code_, 1, out)
            self.assertIn("MISSING build/compile.py", out)
            code_, out = run(CHECK, "--notes", nd, "--source", src)
            self.assertEqual(code_, 0, out)
            self.assertIn("build (1)", out)  # the left-out folder is reported

    def test_graph_file_without_a_note_is_not_mixed_up(self):  # finding 4
        with tempfile.TemporaryDirectory() as tmp:
            src, nd = project(tmp, {"a.py": ["x = 1"], "pkg/a.py": ["def child_fn():", "    return 1"]},
                              {"P file - a.py": file_note("a.py", ["x = 1"])})
            graph = Path(tmp) / "graph.json"
            graph.write_text(json.dumps({"nodes": [
                {"id": "f1", "label": "a.py", "source_file": "a.py"},
                {"id": "c", "label": "child_fn()", "source_file": "pkg/a.py", "_callable": True}], "links": []}))
            code_, out = run(CHECK, "--notes", nd, "--source", src, "--graph", graph, "--scope", "a.py")
            self.assertEqual(code_, 0, out)

    def test_graph_constants_need_not_be_named(self):  # finding 6
        with tempfile.TemporaryDirectory() as tmp:
            code = ["LIMIT = 5"]
            note = file_note("a.py", code, depth="map")
            src, nd = project(tmp, {"a.py": code}, {"P file - a.py": note})
            graph = Path(tmp) / "graph.json"
            graph.write_text(json.dumps({"nodes": [
                {"id": "f1", "label": "a.py", "source_file": "a.py"},
                {"id": "k", "label": "LIMIT", "source_file": "a.py"}], "links": []}))
            code_, out = run(CHECK, "--notes", nd, "--source", src, "--graph", graph)
            self.assertEqual(code_, 0, out)

    def test_notes_of_the_person_are_not_checked(self):  # finding 7
        with tempfile.TemporaryDirectory() as tmp:
            code = ["x = 1"]
            src, nd = project(tmp, {"a.py": code}, {"P file - a.py": file_note("a.py", code)})
            (nd / "My own note.md").write_text("", encoding="utf-8")
            (nd / "Another of mine.md").write_text("See [[Nowhere at all]].\n", encoding="utf-8")
            code_, out = run(CHECK, "--notes", nd, "--source", src)
            self.assertEqual(code_, 0, out)
            self.assertIn("2 notes without written_by: argus", out)

    def test_unowned_file_note_does_not_count(self):  # finding 7, the other side
        with tempfile.TemporaryDirectory() as tmp:
            code = ["x = 1"]
            note = file_note("a.py", code).replace("written_by: argus\n", "")
            src, nd = project(tmp, {"a.py": code}, {"P file - a.py": note})
            code_, out = run(CHECK, "--notes", nd, "--source", src)
            self.assertEqual(code_, 1, out)
            self.assertIn("MISSING a.py", out)

    def test_empty_source_file(self):  # finding 8
        with tempfile.TemporaryDirectory() as tmp:
            lens = "\n".join(f"| {label} | an answer |" for label in LENS)
            note = ("---\ntype: file\nwritten_by: argus\nproject: P\nsource: pkg/__init__.py\ndepth: map\n---\n# P file - init\n\n"
                    f"## Level 1: purpose\n\n| Lens | Answer |\n| --- | --- |\n{lens}\n\n## Level 2: blocks\n\nThe file is empty.\n")
            src, nd = project(tmp, {"pkg/__init__.py": []}, {})
            self.assertIn("MISSING pkg/__init__.py", run(CHECK, "--notes", nd, "--source", src)[1])
            (nd / "P file - init.md").write_text(note, encoding="utf-8")
            (nd / "P - Start Here.md").write_text("---\ntype: start\nwritten_by: argus\n---\n| Lens | Answer |\n| --- | --- |\n| In one sentence | a |\n| What we gain | a |\n| What we lose | a |\n| What was not possible without it | a |\n| Issues today | a |\n| What it makes possible | a |\n| Open source used | a |\n| Risks | a |\n\n[[P file - init]] [[Concept - x]]\n", encoding="utf-8")
            code_, out = run(CHECK, "--notes", nd, "--source", src)
            self.assertEqual(code_, 0, out)


PAY = ["def pay(amount):", "    fee = amount * 0.03", "    return amount + fee"]


class ProbeFindings(unittest.TestCase):
    """The own adversarial probe of 2026-11-15 (version 2.5.0). One test per confirmed finding."""

    def check(self, sources, notes, *args, graph_nodes=None):
        with tempfile.TemporaryDirectory() as tmp:
            src, nd = project(tmp, sources, notes)
            extra = list(args)
            if graph_nodes is not None:
                extra += ["--graph", write_graph(tmp, graph_nodes)]
            return run(CHECK, "--notes", nd, "--source", src, *extra)

    def test_masks_cannot_hide_a_whole_file(self):  # 1
        note = file_note("a.py", PAY, depth="map", code_in_note=["[masked]"] * 3, extra_props="masked_lines: 1-3\n")
        code_, out = self.check({"a.py": PAY}, {"P file - a.py": note})
        self.assertEqual(code_, 1, out)
        self.assertIn("are masked (at most", out)

    def test_partial_mask_must_be_declared(self):  # 1
        note = file_note("a.py", PAY, depth="map", code_in_note=["d[masked]", "    f[masked]", "    r[masked]"])
        code_, out = self.check({"a.py": PAY}, {"P file - a.py": note})
        self.assertEqual(code_, 1, out)
        self.assertIn("not listed in the property masked_lines", out)

    def test_masked_value_must_not_appear_elsewhere(self):  # 2
        code = ['token = "abc123SECRET"']
        note = file_note("a.py", code, code_in_note=['token = "[masked]"'], extra_props="masked_lines: 1\n")
        self.assertIn("abc123SECRET", note)  # the line table still quotes it
        code_, out = self.check({"a.py": code}, {"P file - a.py": note})
        self.assertEqual(code_, 1, out)
        self.assertIn("appears elsewhere in the note", out)

    def test_source_encodings(self):  # 3
        for encoding, name in (("utf-16", "a.ps1"), ("utf-8-sig", "b.ps1"), ("cp1252", "c.py")):
            with tempfile.TemporaryDirectory() as tmp:
                code = ["$x = 1", "name = 'café'"]
                src, nd = project(tmp, {}, {f"P file - {name}": file_note(name, code)})
                (src / name).write_bytes("\r\n".join(code).encode(encoding))
                code_, out = run(CHECK, "--notes", nd, "--source", src)
                self.assertEqual(code_, 0, f"{encoding}: {out}")

    def test_graph_paths_with_a_leading_folder(self):  # 4
        top, hidden = ["def top():", "    return 1"], ["def hidden_fn():", "    return 2"]
        notes = {"P file - util.py": file_note("util.py", top, depth="map").replace("does it (lines", "defines top (lines"),
                 "P file - pkg - util.py": file_note("pkg/util.py", hidden, depth="map")}
        nodes = [{"id": "a", "label": "util.py", "source_file": "proj/util.py"},
                 {"id": "b", "label": "top()", "source_file": "proj/util.py", "_callable": True},
                 {"id": "c", "label": "util.py", "source_file": "proj/pkg/util.py"},
                 {"id": "d", "label": "hidden_fn()", "source_file": "proj/pkg/util.py", "_callable": True}]
        code_, out = self.check({"util.py": top, "pkg/util.py": hidden}, notes, graph_nodes=nodes)
        self.assertEqual(code_, 1, out)
        self.assertIn("'hidden_fn' is in pkg/util.py", out)
        self.assertIn("graph covers 2 of 2", out)

    def test_graph_of_other_code_does_not_pass(self):  # 5
        code = ["def secret_fn():", "    return 1"]
        nodes = [{"id": "z", "label": "other.js", "source_file": "app/other.js"}]
        code_, out = self.check({"a.py": code}, {"P file - a.py": file_note("a.py", code, depth="map")}, graph_nodes=nodes)
        self.assertEqual(code_, 1, out)
        self.assertIn("none of the explained files is in the graph", out)

    def test_one_letter_does_not_cover_a_block(self):  # 6
        note = file_note("a.py", PAY)
        rows = [line for line in note.split("\n") if re.match(r"\| \d \| ``", line)]
        note = note.replace("\n".join(rows), "| 1-3 | `a` | things happen | none |")
        code_, out = self.check({"a.py": PAY}, {"P file - a.py": note})
        self.assertEqual(code_, 1, out)
        self.assertIn("must quote line 1 whole, or its start followed by", out)

    def test_start_of_line_with_ellipsis_is_accepted(self):  # 6, the allowed form
        note = file_note("a.py", PAY).replace("`` def pay(amount): ``", "`def pay(…`")
        self.assertEqual(self.check({"a.py": PAY}, {"P file - a.py": note})[0], 0)

    def test_double_brackets_inside_code_are_not_links(self):  # 7
        for name, code in (("a.sh", ['if [[ -f "$1" ]]; then', "  echo yes", "fi"]), ("b.py", ["grid = [[1, 2], [3, 4]]"])):
            code_, out = self.check({name: code}, {f"P file - {name}": file_note(name, code)})
            self.assertEqual(code_, 0, out)

    def test_message_with_other_alphabets_does_not_crash(self):  # 9
        note = file_note("a.py", ["x = 1"]).replace("because | [[Concept - x]]", "because | [[Concept - λ]]")
        code_, out = self.check({"a.py": ["x = 1"]}, {"P file - a.py": note})
        self.assertEqual(code_, 1, out)
        self.assertIn("RESULT", out)

    def test_tests_and_dependencies_are_left_out_whatever_their_spelling(self):  # 10
        sources = {"a.go": ["package a"], "a_test.go": ["package a"], "foo.test.js": ["x"], "Tests/Unit.cs": ["x"],
                   "TEST/t.py": ["x"], "Node_Modules/m.js": ["x"], "Build/gen.js": ["x"]}
        code_, out = self.check(sources, {"P file - a.go": file_note("a.go", ["package a"], lang="go")})
        self.assertEqual(code_, 0, out)
        self.assertNotIn("MISSING", out)
        self.assertIn("test files by name (2)", out)

    def test_note_saved_with_a_byte_order_mark(self):  # 11
        with tempfile.TemporaryDirectory() as tmp:
            code = ["x = 1"]
            src, nd = project(tmp, {"a.py": code}, {})
            (nd / "P file - a.py.md").write_bytes(b"\xef\xbb\xbf" + file_note("a.py", code).encode("utf-8"))
            (nd / "P - Start Here.md").write_text("---\ntype: start\nwritten_by: argus\n---\n| Lens | Answer |\n| --- | --- |\n| In one sentence | a |\n| What we gain | a |\n| What we lose | a |\n| What was not possible without it | a |\n| Issues today | a |\n| What it makes possible | a |\n| Open source used | a |\n| Risks | a |\n\n[[P file - a.py]] [[Concept - x]]\n", encoding="utf-8")
            code_, out = run(CHECK, "--notes", nd, "--source", src)
            self.assertNotIn("MISSING", out)

    def test_source_property_in_another_spelling(self):  # 12
        note = file_note("./pkg/../a.py", ["x = 1"])
        code_, out = self.check({"a.py": ["x = 1"], "pkg/b.txt": ["t"]}, {"P file - a.py": note})
        self.assertEqual(code_, 0, out)

    def test_tables_with_other_spacing(self):  # 13
        code = ["x = 1", "y = 2"]
        note = file_note("a.py", code)
        padded = note.replace("| 1 | `` x = 1 ``", "| 1    | `` x = 1 ``").replace("| 2 | `` y = 2 ``", "|2|`` y = 2 ``")
        padded = padded.replace("| 1 | 1-2 | does it |", "|  1  | 1-2 | does it |")
        self.assertNotEqual(note, padded)
        code_, out = self.check({"a.py": code}, {"P file - a.py": padded})
        self.assertEqual(code_, 0, out)

    def test_full_depth_needs_trace_and_questions(self):  # 16
        note = file_note("a.py", ["x = 1"]).split("## Trace")[0]
        code_, out = self.check({"a.py": ["x = 1"]}, {"P file - a.py": note})
        self.assertEqual(code_, 1, out)
        self.assertIn("needs a '## Trace' section", out)

    def test_mechanism_note_needs_its_lens_and_a_real_diagram(self):  # 16
        mech = "---\ntype: mechanism\nwritten_by: argus\nsources: a.py\ncommit: abc\n---\n# m\n```mermaid\n```\n"
        code_, out = self.check({"a.py": ["x = 1"]}, {"P file - a.py": file_note("a.py", ["x = 1"]), "P mechanism - m": mech})
        self.assertEqual(code_, 1, out)
        self.assertIn("lens row", out)
        self.assertIn("mermaid diagram is empty", out)

    def test_one_row_for_a_statement_with_a_blank_line_inside(self):  # 18
        code = ['HELP = """', "Usage.", "", "More.", '"""']
        note = file_note("a.py", code)
        rows = [line for line in note.split("\n") if re.match(r"\| \d \| ``", line)]
        note = note.replace("\n".join(rows), '| 1-5 | `HELP = """` | the help text, [[Concept - x]] | by reading |')
        code_, out = self.check({"a.py": code}, {"P file - a.py": note})
        self.assertEqual(code_, 0, out)

    def test_file_name_does_not_count_as_naming_a_function(self):  # 19
        code = ["def load():", "    return 1"]
        nodes = [{"id": "f", "label": "load.py", "source_file": "load.py"},
                 {"id": "l", "label": "load()", "source_file": "load.py", "_callable": True}]
        note = file_note("load.py", code, depth="map")
        code_, out = self.check({"load.py": code}, {"P file - load.py": note}, graph_nodes=nodes)
        self.assertEqual(code_, 1, out)
        self.assertIn("'load' is in load.py", out)

    def test_scope_without_code_and_scripts_with_a_leading_dot(self):  # 20
        code_, out = self.check({"docs/readme.md": ["text"], "a.py": ["x = 1"]}, {}, "--scope", "docs")
        self.assertEqual(code_, 1, out)
        self.assertIn("holds no file this check counts as code", out)
        code_, out = self.check({".envrc": ["#!/bin/sh", "export A=1"], "deploy.yml": ["a: 1"]}, {})
        self.assertIn("MISSING .envrc", out)
        self.assertIn(".yml 1", out)

    def test_a_note_linked_only_by_itself_is_an_orphan(self):  # extra
        with tempfile.TemporaryDirectory() as tmp:
            src, nd = project(tmp, {"a.py": ["x = 1"]}, {"P file - a.py": file_note("a.py", ["x = 1"])})
            (nd / "Concept - lonely.md").write_text("---\ntype: concept\nwritten_by: argus\n---\nSee [[Concept - lonely]].\n", encoding="utf-8")
            code_, out = run(CHECK, "--notes", nd, "--source", src)
            self.assertIn("Concept - lonely: no other note links to it", out)

    def test_hidden_text_fails(self):  # extra
        note = file_note("a.py", ["x = 1"]) + "\n%% hidden from the reader %%\n"
        self.assertIn("hides text from the reader", self.check({"a.py": ["x = 1"]}, {"P file - a.py": note})[1])

    def test_links_to_other_files_and_with_folders(self):  # extra
        with tempfile.TemporaryDirectory() as tmp:
            src, nd = project(tmp, {"a.py": ["x = 1"]}, {"P file - a.py": file_note("a.py", ["x = 1"])})
            (nd / "P - Map.canvas").write_text("{}", encoding="utf-8")
            (nd / "P - Start Here.md").write_text("---\ntype: start\nwritten_by: argus\n---\n| Lens | Answer |\n| --- | --- |\n| In one sentence | a |\n| What we gain | a |\n| What we lose | a |\n| What was not possible without it | a |\n| Issues today | a |\n| What it makes possible | a |\n| Open source used | a |\n| Risks | a |\n\n[[notes/P file - a.py]] [[Concept - x]] [[P - Map.canvas]]\n", encoding="utf-8")
            code_, out = run(CHECK, "--notes", nd, "--source", src)
            self.assertNotIn("does not exist", out)


class ForPrograms(unittest.TestCase):
    """What the VS Code extension relies on (design review of 2026-11-15)."""

    def test_json_result(self):
        with tempfile.TemporaryDirectory() as tmp:
            a, b = ["def fa():", "    return 1"], ["def fb():", "    return 2"]
            notes = {"P file - a.py": file_note("a.py", a).replace("does it (lines", "defines fa (lines"),
                     "P file - b.py": file_note("b.py", b)}
            src, nd = project(tmp, {"a.py": a, "b.py": b}, notes)
            graph = write_graph(tmp, [{"id": "f", "label": "a.py", "source_file": "a.py"},
                                      {"id": "g", "label": "fa()", "source_file": "a.py", "_callable": True}])
            code_, out = run(CHECK, "--notes", nd, "--source", src, "--graph", graph, "--json")
            self.assertEqual(code_, 0, out)
            result = json.loads(out)
            self.assertEqual(result["result"], "PASS")
            self.assertEqual(result["graph"], {"used": True, "covered": ["a.py"], "not_covered": ["b.py"]})
            self.assertEqual(result["explained"]["b.py"], "P file - b.py")
            self.assertTrue(any(w["graph"] and "b.py" in w["text"] for w in result["warns"]))

    def test_json_failure_names_the_note(self):
        with tempfile.TemporaryDirectory() as tmp:
            code = ["x = 1"]
            bad = file_note("a.py", code, code_in_note=["x = 2"])
            src, nd = project(tmp, {"a.py": code}, {"P file - a.py": bad})
            code_, out = run(CHECK, "--notes", nd, "--source", src, "--json")
            self.assertEqual(code_, 1, out)
            result = json.loads(out)
            self.assertEqual(result["result"], "NOT PASSED")
            self.assertEqual(result["fails"][0]["note"], "P file - a.py")
            self.assertFalse(result["graph"]["used"])

    def test_source_outside_the_root_is_refused_unread(self):
        with tempfile.TemporaryDirectory() as tmp:
            src, nd = project(tmp, {"a.py": ["x = 1"]}, {"P file - a.py": file_note("a.py", ["x = 1"])})
            (Path(tmp) / "private.txt").write_text("SECRET OUTSIDE\n", encoding="utf-8")
            outside = file_note("../private.txt", ["SECRET OUTSIDE"]).replace("# P file - private.txt", "# P file - outside")
            (nd / "P file - outside.md").write_text(outside, encoding="utf-8")
            code_, out = run(CHECK, "--notes", nd, "--source", src)
            self.assertEqual(code_, 1, out)
            self.assertIn("names no file under the source root", out)
            self.assertNotIn("private.txt:", out)  # no INFO line: the file was not read

    def test_source_that_says_masked_itself(self):
        code = ['MASK = "[masked]"']
        with tempfile.TemporaryDirectory() as tmp:
            src, nd = project(tmp, {"a.py": code}, {"P file - a.py": file_note("a.py", code)})
            code_, out = run(CHECK, "--notes", nd, "--source", src)
            self.assertEqual(code_, 0, out)
            self.assertIn("0 masked lines", out)


class Fingerprint(unittest.TestCase):
    """The fingerprint changes with everything a run depends on (extension design review, round 4)."""

    def test_fingerprint_follows_every_input(self):
        with tempfile.TemporaryDirectory() as tmp:
            code = ["def fa():", "    return 1"]
            note = file_note("a.py", code).replace("does it (lines", "defines fa (lines")
            src, nd = project(tmp, {"a.py": code}, {"P file - a.py": note})
            vault = Path(tmp) / "vault"
            (vault / "shared").mkdir(parents=True)
            (vault / "shared" / "Concept - shared.md").write_text("---\ntype: concept\nwritten_by: argus\n---\nShared.\n", encoding="utf-8")
            import shutil
            shutil.move(str(nd), str(vault / "notes"))
            nd = vault / "notes"
            graph = write_graph(tmp, [{"id": "f", "label": "a.py", "source_file": "a.py"},
                                      {"id": "g", "label": "fa()", "source_file": "a.py", "_callable": True}])
            base = ["--notes", nd, "--source", src, "--vault", vault, "--graph", graph]

            def fp(*more):
                code_, out = run(CHECK, *base, "--fingerprint", *more)
                self.assertEqual(code_, 0, out)
                return json.loads(out)["fingerprint"]

            first = fp()
            self.assertEqual(first, fp())  # the same inputs, the same fingerprint
            code_, out = run(CHECK, *base, "--json")
            self.assertEqual(json.loads(out)["fingerprint"], first)  # the check reports the same value

            seen = {first}

            def changed(what):
                value = fp()
                self.assertNotIn(value, seen, what)
                seen.add(value)

            (nd / "Concept - x.md").write_text("---\ntype: concept\nwritten_by: argus\n---\nOther words.\n", encoding="utf-8")
            changed("another note of the folder changed")
            (nd / "Extra.md").write_text("mine\n", encoding="utf-8")
            changed("a note was added")
            (vault / "shared" / "Concept - shared.md").unlink()
            changed("a linked name in the vault went away")
            (src / "new_unnoted.py").write_text("y = 2\n", encoding="utf-8")
            changed("a source file without a note was added")
            (src / "a.py").write_text("def fa():\n    return 2\n", encoding="utf-8")
            changed("an explained source changed")
            graph.write_text(graph.read_text(encoding="utf-8") + " ", encoding="utf-8")
            changed("the graph changed")
            (nd / "Deeper").mkdir()
            (nd / "Deeper" / "Concept - x.md").write_text((nd / "Concept - x.md").read_text(encoding="utf-8"), encoding="utf-8")
            changed("a second note with an existing name was added (the check then fails: name used twice)")
            self.assertIn("note name used twice", run(CHECK, *base)[1])
            self.assertNotIn(fp("--include-tests"), seen, "an option changed")


class Tour(unittest.TestCase):
    """make_tour.py: a guided walk for the CodeTour extension."""

    def test_tour_has_a_step_per_block_with_its_lines_selected(self):
        with tempfile.TemporaryDirectory() as tmp:
            a, b = ["x = 1", "y = 22"], ["def f():", "    return 1"]
            src, nd = project(tmp, {"a.py": a, "pkg/b.py": b},
                              {"P file - a.py": file_note("a.py", a), "P file - b.py": file_note("pkg/b.py", b, depth="map")})
            out = Path(tmp) / "walk.tour"
            plan = Path(tmp) / "plan.json"
            plan.write_text(json.dumps({"order": ["pkg/b.py", "a.py"]}), encoding="utf-8")
            code_, text = run(TOUR, "--notes", nd, "--source", src, "--out", out, "--plan", plan)
            self.assertEqual(code_, 0, text)
            tour = json.loads(out.read_text(encoding="utf-8"))
            self.assertEqual(tour["$schema"], "https://aka.ms/codetour-schema")
            self.assertTrue(tour["title"])
            steps = tour["steps"]
            self.assertEqual([s.get("file") for s in steps], [None, "pkg/b.py", "pkg/b.py", "a.py", "a.py"])  # plan order
            for s in steps:
                self.assertTrue(s["description"])  # the one field CodeTour requires
            block = steps[4]
            self.assertEqual(block["selection"], {"start": {"line": 1, "character": 1}, "end": {"line": 2, "character": 7}})
            self.assertIn("**Line 1**", block["description"])
            self.assertIn("gain", steps[3]["description"].lower())  # the file step carries the lens
            self.assertNotIn("[[", json.dumps(tour))  # wikilinks mean nothing to CodeTour
            self.assertIn("*Concept - x*", block["description"])

    def test_tour_is_never_written_into_the_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            src, nd = project(tmp, {"a.py": ["x = 1"]}, {"P file - a.py": file_note("a.py", ["x = 1"])})
            code_, text = run(TOUR, "--notes", nd, "--source", src, "--out", src / ".tours" / "walk.tour")
            self.assertNotEqual(code_, 0, text)
            self.assertFalse((src / ".tours").exists())

    def test_block_that_no_longer_matches_is_left_out_and_named(self):
        with tempfile.TemporaryDirectory() as tmp:
            src, nd = project(tmp, {"a.py": ["x = 1"]}, {"P file - a.py": file_note("a.py", ["x = 1"])})
            (src / "a.py").write_text("x = 2\n", encoding="utf-8")
            out = Path(tmp) / "walk.tour"
            code_, text = run(TOUR, "--notes", nd, "--source", src, "--out", out)
            self.assertEqual(code_, 0, text)
            self.assertIn("SKIPPED P file - a.py: block 1", text)
            self.assertEqual(len(json.loads(out.read_text(encoding="utf-8"))["steps"]), 2)  # start and the file step
            self.assertEqual(run(TOUR, "--notes", nd, "--source", src, "--out", out, "--strict")[0], 1)

    def test_links_can_open_obsidian(self):
        with tempfile.TemporaryDirectory() as tmp:
            src, nd = project(tmp, {"a.py": ["x = 1"]}, {"P file - a.py": file_note("a.py", ["x = 1"])})
            out = Path(tmp) / "walk.tour"
            run(TOUR, "--notes", nd, "--source", src, "--out", out, "--obsidian-vault", "My Vault")
            self.assertIn("obsidian://open?vault=My%20Vault&file=Concept%20-%20x", out.read_text(encoding="utf-8"))


class TourInProject(unittest.TestCase):
    def test_tour_in_the_project_is_kept_out_of_git(self):
        with tempfile.TemporaryDirectory() as tmp:
            src, nd = project(tmp, {"a.py": ["x = 1"]}, {"P file - a.py": file_note("a.py", ["x = 1"])})
            git = lambda *a: subprocess.run(["git", "-C", str(src), "-c", "user.name=t", "-c", "user.email=t@t", *a],
                                            capture_output=True, text=True)
            if git("init", "-q").returncode != 0:
                self.skipTest("git not available")
            git("add", "-A"); git("commit", "-q", "-m", "one")
            code_, text = run(TOUR, "--notes", nd, "--source", src, "--in-project")
            self.assertEqual(code_, 0, text)
            tour = src / ".tours" / "P.tour"
            self.assertTrue(tour.is_file(), text)
            self.assertIn("at commit", json.loads(tour.read_text(encoding="utf-8"))["description"])
            self.assertEqual(git("status", "--short").stdout.strip(), "")  # git sees no change
            code_, text = run(TOUR, "--notes", nd, "--source", src, "--in-project")  # a second run adds nothing
            self.assertIn("already ignored", text)

    def test_one_of_out_and_in_project(self):
        with tempfile.TemporaryDirectory() as tmp:
            src, nd = project(tmp, {"a.py": ["x = 1"]}, {"P file - a.py": file_note("a.py", ["x = 1"])})
            self.assertEqual(run(TOUR, "--notes", nd, "--source", src)[0], 2)


class Setup(unittest.TestCase):
    def test_report_without_installing(self):
        import os
        with tempfile.TemporaryDirectory() as tmp:
            env = dict(os.environ, ARGUS_HOME=str(Path(tmp) / "argus-home"))
            out = subprocess.run([sys.executable, "-B", str(SETUP), "--json"], capture_output=True, text=True, env=env)
            report = json.loads(out.stdout)
            self.assertEqual(sorted(report["tools"]), ["codetour", "git", "graphify", "python", "vscode"])
            self.assertTrue(report["tools"]["python"]["ok"])
            for item in report["tools"].values():
                self.assertTrue(item["ok"] or item["fix"])  # everything missing comes with what to do
            self.assertEqual(out.returncode, 0 if report["ready"] else 1)
            self.assertEqual(report["actions"], [])  # nothing is installed without --install


class FingerprintByWitness(unittest.TestCase):
    """The fingerprint is built from what the run reads (extension design review, round 6)."""

    def test_note_with_cr_only_line_endings_and_a_source_change_of_the_same_size(self):
        import os
        with tempfile.TemporaryDirectory() as tmp:
            code = ["x = 1"]
            src, nd = project(tmp, {"a.py": code}, {})
            note = nd / "P file - a.py.md"
            note.write_bytes(file_note("a.py", code).replace("\n", "\r").encode("utf-8"))
            (nd / "P - Start Here.md").write_text((nd / "P - Start Here.md").read_text(encoding="utf-8") + "[[P file - a.py]]\n", encoding="utf-8")
            base = ["--notes", nd, "--source", src]
            self.assertEqual(run(CHECK, *base)[0], 0)
            first = json.loads(run(CHECK, *base, "--fingerprint")[1])["fingerprint"]
            stat = (src / "a.py").stat()
            (src / "a.py").write_text("x = 2\n", encoding="utf-8")       # same size
            os.utime(src / "a.py", ns=(stat.st_atime_ns, stat.st_mtime_ns))  # same time of change
            self.assertEqual(run(CHECK, *base)[0], 1)                      # the check now fails ...
            second = json.loads(run(CHECK, *base, "--fingerprint")[1])["fingerprint"]
            self.assertNotEqual(first, second)                             # ... and the fingerprint moved with it

    def test_git_history_of_a_file_changes_the_fingerprint(self):
        with tempfile.TemporaryDirectory() as tmp:
            code = ["x = 1"]
            src, nd = project(tmp, {"a.py": code, "other.txt": ["one"]}, {})
            git = lambda *a: subprocess.run(["git", "-C", str(src), "-c", "user.name=t", "-c", "user.email=t@t", *a],
                                            capture_output=True, text=True)
            if git("init", "-q").returncode != 0:
                self.skipTest("git not available")
            git("add", "-A"); git("commit", "-q", "-m", "one")
            commit = git("log", "-1", "--format=%h").stdout.strip()
            (nd / "P file - a.py.md").write_text(file_note("a.py", code, extra_props=f"commit: {commit}\n"), encoding="utf-8")
            (nd / "P - Start Here.md").write_text((nd / "P - Start Here.md").read_text(encoding="utf-8") + "[[P file - a.py]]\n", encoding="utf-8")
            base = ["--notes", nd, "--source", src]
            first = json.loads(run(CHECK, *base, "--fingerprint")[1])["fingerprint"]
            self.assertEqual(first, json.loads(run(CHECK, *base, "--fingerprint")[1])["fingerprint"])
            # A commit that touches nothing the run asks about changes no answer, so the fingerprint stays.
            git("commit", "-q", "--allow-empty", "-m", "two")
            self.assertEqual(first, json.loads(run(CHECK, *base, "--fingerprint")[1])["fingerprint"])
            # The file is changed and changed back in two commits: its content and the folder are as before, but
            # git now names a newer commit for it, the note is stale, and the fingerprint moves.
            (src / "a.py").write_text("x = 2\n", encoding="utf-8"); git("commit", "-q", "-am", "three")
            (src / "a.py").write_text("x = 1\n", encoding="utf-8"); git("commit", "-q", "-am", "four")
            code_, out = run(CHECK, *base)
            self.assertIn("STALE P file - a.py", out)
            self.assertNotEqual(first, json.loads(run(CHECK, *base, "--fingerprint")[1])["fingerprint"])


class GraphPlanProbe(unittest.TestCase):
    def test_graph_paths_with_a_leading_folder_and_scope(self):  # 14
        with tempfile.TemporaryDirectory() as tmp:
            src, _ = project(tmp, {"util.py": ["x"], "pkg/util.py": ["y"]}, {})
            graph = write_graph(tmp, [{"id": "a", "label": "util.py", "source_file": "proj/util.py"},
                                      {"id": "b", "label": "hidden_fn()", "source_file": "proj/pkg/util.py", "_callable": True}])
            code_, out = run(PLAN, "--graph", graph, "--source", src, "--scope", "pkg", "--json")
            self.assertEqual(code_, 0, out)
            plan = json.loads(out)
            self.assertEqual(plan["order"], ["pkg/util.py"])
            self.assertEqual(plan["no_symbols"], [])

    def test_scope_that_matches_nothing_is_an_error(self):  # 14
        with tempfile.TemporaryDirectory() as tmp:
            graph = write_graph(tmp, [{"id": "a", "label": "a.py", "source_file": "Pkg/a.py"}])
            self.assertNotEqual(run(PLAN, "--graph", graph, "--scope", "nosuchfolder")[0], 0)

    def test_re_exports_count_and_ambiguous_edges_do_not(self):  # 15 and the extra
        with tempfile.TemporaryDirectory() as tmp:
            nodes = [{"id": n, "label": f"{n}.js", "source_file": f"{n}.js"} for n in ("a", "b", "c")]
            links = [{"source": "a", "target": "b", "relation": "re_exports", "confidence": "EXTRACTED", "source_location": "L1"},
                     {"source": "b", "target": "a", "relation": "calls", "confidence": "AMBIGUOUS"},
                     {"source": "c", "target": "a", "relation": "inherits", "confidence": "EXTRACTED"}]
            code_, out = run(PLAN, "--graph", write_graph(tmp, nodes, links), "--json")
            plan = json.loads(out)
            self.assertEqual([u["file"] for u in plan["files"]["a.js"]["uses"]], ["b.js"])
            self.assertEqual(plan["cycles"], [])
            self.assertEqual(plan["order"], ["b.js", "a.js", "c.js"])


class GraphPlanRound3(unittest.TestCase):
    def test_inferred_edge_is_not_a_dependency(self):  # finding 5
        sample = HERE.parent.parent.parent / "docs" / "graph-sample.json"
        code_, out = run(PLAN, "--graph", sample, "--json")
        self.assertEqual(code_, 0, out)
        plan = json.loads(out)
        self.assertEqual(plan["cycles"], [])
        self.assertLess(plan["order"].index("app/src/store.js"), plan["order"].index("app/src/main.js"))
        store = plan["files"]["app/src/store.js"]
        self.assertEqual(store["uses"], [])
        self.assertEqual([u["file"] for u in store["inferred_uses"]], ["app/src/main.js"])
        self.assertEqual(plan["files"]["app/src/main.js"]["uses"][0]["file"], "app/src/store.js")
        self.assertIn("L2", plan["files"]["app/src/main.js"]["uses"][0]["at"])


class GraphPlan(unittest.TestCase):
    def plan(self, tmp, nodes, links, *args):
        graph = Path(tmp) / "graph.json"
        graph.write_text(json.dumps({"nodes": nodes, "links": links}))
        code_, out = run(PLAN, "--graph", graph, "--json", *args)
        self.assertEqual(code_, 0, out)
        return json.loads(out)

    def test_cycle_comes_before_its_caller(self):  # finding 6
        with tempfile.TemporaryDirectory() as tmp:
            nodes = [{"id": n, "label": f"{n}.py", "source_file": f"{n}.py"} for n in ("a_entry", "b", "c")]
            links = [{"source": "a_entry", "target": "b", "relation": "imports"},
                     {"source": "b", "target": "c", "relation": "imports"},
                     {"source": "c", "target": "b", "relation": "imports"}]
            plan = self.plan(tmp, nodes, links)
            self.assertEqual(plan["order"][-1], "a_entry.py", plan["order"])
            self.assertIn(["b.py", "c.py"], plan["cycles"])

    def test_scope_dot_is_everything(self):  # finding 1
        with tempfile.TemporaryDirectory() as tmp:
            nodes = [{"id": "a", "label": "a.py", "source_file": "a.py"}]
            self.assertEqual(self.plan(tmp, nodes, [], "--scope", ".")["order"], ["a.py"])


if __name__ == "__main__":
    unittest.main()
