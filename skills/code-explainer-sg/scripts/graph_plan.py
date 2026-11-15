#!/usr/bin/env python3
"""Reading plan from a graphify graph. Python 3.10+, standard library only. Reads; never writes.

  python graph_plan.py --graph <graphify-out/graph.json> [--source <source root>] [--scope <path>] [--json]

Prints, for the files in scope: the leaf-first order, what each file uses and is used by, the functions and classes
the graph found in it, the communities (candidates for Mechanism notes), and the source files the graph has no
symbols for. Paths in the graph are relative to the folder graphify was run on.
"""
import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

USES = {"imports", "imports_from", "calls", "dynamic_import", "indirect_call"}
CODE_EXT = {
    ".js", ".cjs", ".mjs", ".ts", ".tsx", ".jsx", ".py", ".ps1", ".sh", ".go", ".rs", ".java", ".kt", ".cs",
    ".rb", ".php", ".c", ".h", ".cpp", ".hpp", ".swift", ".sql", ".lua", ".r", ".scala",
}
SKIP_DIRS = {"node_modules", ".git", "venv", ".venv", "__pycache__", "dist", "build", "out", "graphify-out",
             "test", "tests", "__tests__", "spec"}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--graph", required=True, help="graph.json written by 'graphify update <folder>'")
    ap.add_argument("--source", help="the folder graphify was run on, to list code files the graph has no symbols for")
    ap.add_argument("--scope", action="append", default=[], help="folder or file to limit the plan to; repeatable")
    ap.add_argument("--json", action="store_true", help="print the plan as JSON")
    args = ap.parse_args()
    data = json.loads(Path(args.graph).read_text(encoding="utf-8"))
    nodes = {n["id"]: n for n in data.get("nodes", []) if isinstance(n, dict) and "id" in n}
    edges = data.get("links") or data.get("edges") or []
    scopes = [s.replace("\\", "/").strip("/") for s in args.scope]

    def in_scope(path):
        return not scopes or any(path == s or path.startswith(s + "/") for s in scopes)

    def file_of(node_id):
        node = nodes.get(node_id) or {}
        path = str(node.get("source_file") or "").replace("\\", "/")
        return path if path and not node.get("external") and Path(path).suffix.lower() in CODE_EXT else None

    files = sorted({f for f in map(file_of, nodes) if f})
    uses, used_by, symbols, groups = defaultdict(set), defaultdict(set), defaultdict(list), defaultdict(set)
    for node_id, node in nodes.items():
        f = file_of(node_id)
        if not f:
            continue
        label = str(node.get("label") or "")
        if node.get("_callable") or node.get("_callable_class") or label.endswith("()"):
            symbols[f].append(f"{label} {node.get('source_location') or ''}".strip())
        if node.get("community") is not None:
            groups[node["community"]].add(f)
    for e in edges:
        if e.get("relation") in USES:
            a, b = file_of(e.get("source")), file_of(e.get("target"))
            if a and b and a != b:
                uses[a].add(b)
                used_by[b].add(a)

    # Leaf-first: a file comes after every file it uses. Files in a cycle are placed together, fewest uses first.
    order, placed, left = [], set(), set(files)
    while left:
        ready = sorted(f for f in left if uses[f] <= placed | {f})
        if not ready:
            ready = sorted(left, key=lambda f: (len(uses[f] - placed), f))[:1]
        order.extend(ready)
        placed.update(ready)
        left.difference_update(ready)

    no_symbols = []
    if args.source:
        root = Path(args.source)
        for p in sorted(root.rglob("*")):
            if p.is_file() and p.suffix.lower() in CODE_EXT and not set(p.relative_to(root).parts[:-1]) & SKIP_DIRS:
                rel = p.relative_to(root).as_posix()
                if not symbols.get(rel):
                    no_symbols.append(rel)

    plan = {
        "files_in_graph": len(files),
        "order": [f for f in order if in_scope(f)],
        "files": {f: {"uses": sorted(uses[f]), "used_by": sorted(used_by[f]), "symbols": symbols[f]}
                  for f in order if in_scope(f)},
        "communities": [sorted(g) for _, g in sorted(groups.items(), key=lambda kv: str(kv[0]))
                        if len(g) > 1 and any(in_scope(f) for f in g)],
        "no_symbols": [f for f in no_symbols if in_scope(f)],
    }
    if args.json:
        json.dump(plan, sys.stdout, indent=2)
        return
    print(f"Files in graph: {plan['files_in_graph']}. In scope: {len(plan['order'])}. Leaf-first order:")
    for i, f in enumerate(plan["order"], 1):
        info = plan["files"][f]
        print(f"{i:3}. {f}")
        print(f"     uses: {', '.join(info['uses']) or 'nothing in the graph'}")
        print(f"     used by: {', '.join(info['used_by']) or 'nothing in the graph'}")
        print(f"     functions and classes: {', '.join(info['symbols']) or 'none found'}")
    print(f"\nCommunities that span files (candidates for Mechanism notes): {len(plan['communities'])}")
    for group in plan["communities"]:
        print("  - " + ", ".join(group))
    if args.source:
        print(f"\nCode files with no symbols in the graph (find callers by text search): {len(plan['no_symbols'])}")
        for f in plan["no_symbols"]:
            print("  - " + f)


if __name__ == "__main__":
    main()
