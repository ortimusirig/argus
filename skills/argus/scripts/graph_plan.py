#!/usr/bin/env python3
"""Reading plan from a graphify graph. Python 3.10+, standard library only. Reads; never writes.

  python graph_plan.py --graph <graphify-out/graph.json> [--source <source root>] [--scope <path>] [--json]

Prints, for the files in scope: the leaf-first order, what each file uses and is used by, the functions and classes
the graph found in it, the groups of files that use each other in a circle, the communities (candidates for
Mechanism notes), and the source files the graph has no symbols for. Paths in the graph are relative to the folder
graphify was run on.
"""
import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import CODE_EXT, in_scope, inventory, normalize_scopes  # noqa: E402

USES = {"imports", "imports_from", "calls", "dynamic_import", "indirect_call"}


def components(files, uses):
    """Strongly connected components (Tarjan, iterative), each a sorted list. A component is emitted only after
    every component it uses, so the result is already dependency-first."""
    index, low, on_stack, stack, result, counter = {}, {}, set(), [], [], 0
    for root in files:
        if root in index:
            continue
        work = [(root, iter(sorted(uses[root])))]
        index[root] = low[root] = counter
        counter += 1
        stack.append(root)
        on_stack.add(root)
        while work:
            node, it = work[-1]
            for nxt in it:
                if nxt not in index:
                    index[nxt] = low[nxt] = counter
                    counter += 1
                    stack.append(nxt)
                    on_stack.add(nxt)
                    work.append((nxt, iter(sorted(uses[nxt]))))
                    break
                if nxt in on_stack:
                    low[node] = min(low[node], index[nxt])
            else:
                work.pop()
                if work:
                    low[work[-1][0]] = min(low[work[-1][0]], low[node])
                if low[node] == index[node]:
                    group = []
                    while True:
                        member = stack.pop()
                        on_stack.discard(member)
                        group.append(member)
                        if member == node:
                            break
                    result.append(sorted(group))
    return result


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--graph", required=True, help="graph.json written by 'graphify update <folder>'")
    ap.add_argument("--source", help="the folder graphify was run on, to list code files the graph has no symbols for")
    ap.add_argument("--scope", action="append", default=[],
                    help="folder or file to limit the plan to, relative to the folder graphify was run on; repeatable")
    ap.add_argument("--include-tests", action="store_true", help="test folders count as code too")
    ap.add_argument("--json", action="store_true", help="print the plan as JSON")
    args = ap.parse_args()
    try:
        data = json.loads(Path(args.graph).read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        sys.exit(f"cannot read the graph {args.graph}: {error}")
    node_list = data.get("nodes") if isinstance(data, dict) else None
    if not isinstance(node_list, list) or not any(isinstance(n, dict) and n.get("source_file") for n in node_list):
        sys.exit(f"{args.graph} has no list of nodes with a source_file: not a graphify graph")
    nodes = {n["id"]: n for n in node_list if isinstance(n, dict) and "id" in n}
    edges = data.get("links") or data.get("edges") or []
    scopes = normalize_scopes(args.source, args.scope)

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
        if isinstance(e, dict) and e.get("relation") in USES:
            a, b = file_of(e.get("source")), file_of(e.get("target"))
            if a and b and a != b:
                uses[a].add(b)
                used_by[b].add(a)

    comps = components(files, uses)
    order = [f for group in comps for f in group]
    cycles = [group for group in comps if len(group) > 1]

    no_symbols = []
    if args.source:
        code_files, _ = inventory(args.source, args.include_tests, scopes)
        no_symbols = [f for f in code_files if not symbols.get(f)]

    plan = {
        "files_in_graph": len(files),
        "order": [f for f in order if in_scope(f, scopes)],
        "cycles": [g for g in cycles if any(in_scope(f, scopes) for f in g)],
        "files": {f: {"uses": sorted(uses[f]), "used_by": sorted(used_by[f]), "symbols": symbols[f]}
                  for f in order if in_scope(f, scopes)},
        "communities": [sorted(g) for _, g in sorted(groups.items(), key=lambda kv: str(kv[0]))
                        if len(g) > 1 and any(in_scope(f, scopes) for f in g)],
        "no_symbols": no_symbols,
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
    print(f"\nGroups of files that use each other in a circle (explain each group together): {len(plan['cycles'])}")
    for group in plan["cycles"]:
        print("  - " + ", ".join(group))
    print(f"\nCommunities that span files (candidates for Mechanism notes): {len(plan['communities'])}")
    for group in plan["communities"]:
        print("  - " + ", ".join(group))
    if args.source:
        print(f"\nCode files with no symbols in the graph (find callers by text search): {len(plan['no_symbols'])}")
        for f in plan["no_symbols"]:
            print("  - " + f)


if __name__ == "__main__":
    main()
