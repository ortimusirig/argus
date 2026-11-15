#!/usr/bin/env python3
"""Small tests for check_notes.py and graph_plan.py. Run: python test_scripts.py"""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
CHECK = HERE / "check_notes.py"
PLAN = HERE / "graph_plan.py"
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
    return "\n".join(t) + "\n"


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
    (nd / "P - Start Here.md").write_text(f"---\ntype: start\nwritten_by: argus\n---\n# P\n{links} [[Concept - x]]\n", encoding="utf-8")
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
            good = file_note("a.py", code, depth="map", code_in_note=['token = "[masked]"'])
            bad = file_note("a.py", code, depth="map", code_in_note=['other = 5  # [masked]'])
            src, nd = project(tmp, {"a.py": code}, {"P file - a.py": good})
            self.assertEqual(run(CHECK, "--notes", nd, "--source", src)[0], 0)
            (nd / "P file - a.py.md").write_text(bad, encoding="utf-8")
            code_, out = run(CHECK, "--notes", nd, "--source", src)
            self.assertEqual(code_, 1, out)
            self.assertIn("differs from the source", out)

    def test_graph_symbol_goes_to_the_right_file(self):  # finding 7
        with tempfile.TemporaryDirectory() as tmp:
            a, d = ["x = 1"], ["def load():", "    return 1"]
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
            (nd / "P - Start Here.md").write_text("---\ntype: start\nwritten_by: argus\n---\n[[P file - a.py]] [[P mechanism - m]] [[Concept - x]]\n", encoding="utf-8")
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
            note = file_note("a.py", code, code_in_note=['token = "[masked]"']).replace('`` token = "abc123" ``', '`` token = "[masked]" ``')
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
            self.assertIn("fully masked lines: 1", out)

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
            (nd / "P - Start Here.md").write_text("---\ntype: start\nwritten_by: argus\n---\n[[P file - init]] [[Concept - x]]\n", encoding="utf-8")
            code_, out = run(CHECK, "--notes", nd, "--source", src)
            self.assertEqual(code_, 0, out)


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
