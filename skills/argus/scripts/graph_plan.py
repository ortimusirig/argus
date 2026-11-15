#!/usr/bin/env python3
"""Reading plan from a graphify graph. Python 3.10+, standard library only. Reads; never writes.

  python -B graph_plan.py --graph <graphify-out/graph.json> --source <folder graphify was run on> [--scope <path>]

Prints, for the files in scope: the leaf-first order, what each file uses and is used by (with the line where the
graph saw it), the uses the graph only inferred (to be confirmed in the code), the functions and classes the graph
found, the groups of files that use each other in a circle, the communities (candidates for Mechanism notes), and
the source files the graph has no symbols for.

The order and the circles are built from confirmed uses only. An inferred or ambiguous use never moves a file or
makes a circle. With --source, graph paths are matched to the files on disk (graphify sometimes writes them with
leading folders); without it they are used as written.
"""
import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

sys.dont_write_bytecode = True  # never leave a __pycache__ folder beside the scripts
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import (CODE_EXT, CODE_NAMES, all_files, in_scope, inventory, is_callable_node,  # noqa: E402
                     kind_of, normalize_scopes, read_text, resolve_graph_paths, utf8_output)

# Relations by which one file depends on another.
USES = {"imports", "imports_from", "calls", "dynamic_import", "indirect_call", "re_exports", "inherits", "includes",
        "extends", "implements", "instantiates", "uses"}
GUESSED = {"INFERRED", "AMBIGUOUS"}


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
    utf8_output()
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--graph", required=True, help="graph.json written by 'graphify update <folder>'")
    ap.add_argument("--source", help="the folder graphify was run on: matches graph paths to files on disk and lists "
                                     "code files the graph has no symbols for")
    ap.add_argument("--scope", action="append", default=[],
                    help="folder or file to limit the plan to, relative to --source; repeatable")
    ap.add_argument("--include-tests", action="store_true", help="tests count as code too")
    ap.add_argument("--json", action="store_true", help="print the plan as JSON")
    ap.add_argument("--out", help="write the plan as JSON to this file (for make_tour.py --plan) and print the text as usual")
    args = ap.parse_args()
    try:
        data = json.loads(read_text(args.graph)[0])
    except (OSError, ValueError) as error:
        sys.exit(f"cannot read the graph {args.graph}: {error}")
    node_list = data.get("nodes") if isinstance(data, dict) else None
    if not isinstance(node_list, list) or not any(isinstance(n, dict) and n.get("source_file") for n in node_list):
        sys.exit(f"{args.graph} has no list of nodes with a source_file: not a graphify graph")
    nodes = {n["id"]: n for n in node_list if isinstance(n, dict) and "id" in n}
    edges = data.get("links") or data.get("edges") or []
    scopes = normalize_scopes(args.source, args.scope)

    # Graph path -> the path used in the plan. With --source: the file on disk, or dropped when there is none.
    raw_paths = {str(n.get("source_file") or "").replace("\\", "/").strip("/") for n in nodes.values()} - {""}
    if args.source:
        on_disk = resolve_graph_paths(raw_paths, all_files(args.source))
        unresolved = sorted(p for p, hit in on_disk.items() if hit is None)
    else:
        on_disk, unresolved = {p: p for p in raw_paths}, []

    def is_code(path):
        if args.source:
            return kind_of(Path(args.source) / path) == "code"
        name = path.rsplit("/", 1)[-1].lower()
        return Path(name).suffix in CODE_EXT or name in CODE_NAMES or "." not in name

    def file_of(node_id):
        node = nodes.get(node_id) or {}
        path = on_disk.get(str(node.get("source_file") or "").replace("\\", "/").strip("/"))
        return path if path and not node.get("external") and is_code(path) else None

    files = sorted({f for f in map(file_of, nodes) if f})
    symbols, groups = defaultdict(list), defaultdict(set)
    for node_id, node in nodes.items():
        f = file_of(node_id)
        if not f:
            continue
        if is_callable_node(node):
            symbols[f].append(f"{node.get('label')} {node.get('source_location') or ''}".strip())
        if node.get("community") is not None:
            groups[node["community"]].add(f)

    # confirmed[a][b] and guessed[a][b]: the places (lines of a) where a uses b.
    confirmed, guessed = defaultdict(lambda: defaultdict(list)), defaultdict(lambda: defaultdict(list))
    for e in edges:
        if not isinstance(e, dict) or e.get("relation") not in USES:
            continue
        a, b = file_of(e.get("source")), file_of(e.get("target"))
        if not a or not b or a == b:
            continue
        unsure = str(e.get("confidence") or "").upper() in GUESSED or e.get("relation") == "indirect_call"
        table = guessed if unsure else confirmed
        where = str(e.get("source_location") or "")
        places = table[a][b]
        if where and where not in places:
            places.append(where)
    uses = defaultdict(set, {a: set(bs) for a, bs in confirmed.items()})
    used_by = defaultdict(set)
    for a, bs in uses.items():
        for b in bs:
            used_by[b].add(a)

    comps = components(files, uses)
    order = [f for group in comps for f in group]
    cycles = [group for group in comps if len(group) > 1]
    for scope in scopes:
        if not any(in_scope(f, [scope]) for f in files):
            sys.exit(f"--scope {scope} matches no code file in the graph")
    if args.scope and not args.source:
        for scope in [s.replace("\\", "/").strip("/") for s in args.scope]:
            if scope not in ("", ".") and not any(in_scope(f, [scope]) for f in files):
                sys.exit(f"--scope {scope} matches no code file in the graph")

    def listed(table, f, skip=()):
        return [{"file": b, "at": ", ".join(table[f][b])} for b in sorted(table[f]) if b not in skip]

    no_symbols = []
    if args.source:
        no_symbols = [f for f in inventory(args.source, args.include_tests, scopes)["code"] if not symbols.get(f)]

    plan = {
        "files_in_graph": len(files),
        "order": [f for f in order if in_scope(f, scopes)],
        "cycles": [g for g in cycles if any(in_scope(f, scopes) for f in g)],
        "files": {f: {"uses": listed(confirmed, f), "inferred_uses": listed(guessed, f, skip=confirmed[f]),
                      "used_by": sorted(used_by[f]), "symbols": symbols[f]}
                  for f in order if in_scope(f, scopes)},
        "communities": [sorted(g) for _, g in sorted(groups.items(), key=lambda kv: str(kv[0]))
                        if len(g) > 1 and any(in_scope(f, scopes) for f in g)],
        "no_symbols": no_symbols,
        "graph_paths_not_on_disk": unresolved,
    }
    if args.out:
        Path(args.out).write_text(json.dumps(plan, indent=2), encoding="utf-8")
    if args.json:
        json.dump(plan, sys.stdout, indent=2)
        return

    def shown(items):
        return ", ".join(f"{u['file']} ({u['at']})" if u["at"] else u["file"] for u in items)

    print(f"Files in graph: {plan['files_in_graph']}. In scope: {len(plan['order'])}. Leaf-first order:")
    for i, f in enumerate(plan["order"], 1):
        info = plan["files"][f]
        print(f"{i:3}. {f}")
        print(f"     uses: {shown(info['uses']) or 'nothing in the graph'}")
        if info["inferred_uses"]:
            print(f"     may use (inferred by the graph; confirm in the code): {shown(info['inferred_uses'])}")
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
        if unresolved:
            print(f"\nGraph paths that name no file under --source (ignored): {len(unresolved)}")
            for f in unresolved[:20]:
                print("  - " + f)


if __name__ == "__main__":
    main()
