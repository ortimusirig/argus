import { test } from "node:test";
import * as assert from "node:assert/strict";
import { findLinks, linkMap, resolveLink } from "../core/links";

test("findLinks: [[Name]], [[Name|shown]] and [[folder/Name]] give names", () => {
  assert.deepEqual(findLinks("See [[Concept - x]], [[Name|shown]] and [[folder/sub/Deep Name]]."), ["Concept - x", "Name", "Deep Name"]);
  assert.deepEqual(findLinks("[[Name#Heading]] [[ Spaced ]] [[note.md]] [[Name]] again"), ["Name", "Spaced", "note"]);
  assert.deepEqual(findLinks("| 1 | [[Name\\|shown]] | [[Other]] |"), ["Name", "Other"]);
  assert.deepEqual(findLinks("no links here, [not one], [[]]"), []);
});

test("a link inside a code span or a code fence is not a link", () => {
  assert.deepEqual(findLinks("`[[not a link]]` but [[a link]] and ``x ` [[still code]]`` end"), ["a link"]);
  assert.deepEqual(findLinks("before [[one]]\n```js\nconst a = [[1]];\n[[in a fence]]\n```\nafter [[two]]\r\n````\n```\n[[deep]]\n````\n[[three]]"),
    ["one", "two", "three"]);
});

test("resolveLink: the project's own note first, else the vault's when exactly one, else the list of places", () => {
  const mine = [{ name: "Concept - x", path: "/v/P/Concepts/Concept - x.md" }, { name: "P - Start Here", path: "/v/P/P - Start Here.md" }];
  const vault = [{ name: "Concept - x", path: "/v/Shared/Concept - x.md" }, { name: "Concept - y", path: "/v/Shared/Concept - y.md" },
    { name: "Library - z", path: "/v/A/Library - z.md" }, { name: "Library - z", path: "/v/B/Library - z.md" }];
  assert.deepEqual(resolveLink("Concept - x", mine, vault), { kind: "one", note: mine[0] });
  assert.deepEqual(resolveLink("Concept - y", mine, vault), { kind: "one", note: vault[1] });
  assert.deepEqual(resolveLink("Library - z", mine, vault), { kind: "several", places: [vault[2], vault[3]] });
  assert.deepEqual(resolveLink("Nothing", mine, vault), { kind: "none" });
  assert.deepEqual(resolveLink("concept - x", mine, vault), { kind: "none" });   // names are compared as written, as the checker does
  // two notes of one name in the project itself: nothing is chosen for the person
  const twice = [...mine, { name: "Concept - x", path: "/v/P/Old/Concept - x.md" }];
  assert.deepEqual(resolveLink("Concept - x", twice, vault), { kind: "several", places: [twice[0], twice[2]] });
  // a vault that holds the project's folder lists the same file twice: it is one place
  assert.deepEqual(resolveLink("Concept - y", [], [vault[1], { ...vault[1] }]), { kind: "one", note: vault[1] });
});

test("linkMap gives the answers of resolveLink, and 4,000 links against 20,000 notes resolve in well under 50 ms", () => {
  // A small mixed sample: own before vault, one in the vault, several, none, one file listed twice, odd names.
  const mine = [{ name: "Concept - x", path: "/v/P/Concepts/Concept - x.md" }, { name: "P - Start Here", path: "/v/P/P - Start Here.md" },
    { name: "Twice", path: "/v/P/Twice.md" }, { name: "Twice", path: "/v/P/Old/Twice.md" }, { name: "Twice", path: "/v/P/Twice.md" },
    { name: "__proto__", path: "/v/P/__proto__.md" }];
  const vault = [{ name: "Concept - x", path: "/v/Shared/Concept - x.md" }, { name: "Concept - y", path: "/v/Shared/Concept - y.md" },
    { name: "Library - z", path: "/v/A/Library - z.md" }, { name: "Library - z", path: "/v/B/Library - z.md" },
    { name: "Same file", path: "/v/Shared/Same file.md" }, { name: "Same file", path: "/v/Shared/Same file.md" },
    { name: "Twice", path: "/v/Shared/Twice.md" }, { name: "constructor", path: "/v/Shared/constructor.md" }];
  const asked = ["Concept - x", "P - Start Here", "Twice", "__proto__", "Concept - y", "Library - z", "Same file", "constructor",
    "Nothing", "concept - x", "CONCEPT - Y", "toString", "hasOwnProperty", "", " Concept - x"];
  for (const [own, shared] of [[mine, vault], [[], vault], [mine, []], [[], []]] as const) {
    const map = linkMap(own, shared);
    for (const name of [...asked, ...asked]) {      // asked twice: an answer that is kept is the same answer
      assert.deepEqual(map.resolve(name), resolveLink(name, own, shared), `'${name}'`);
    }
  }
  assert.equal(linkMap(mine, vault).resolve("Concept - x").kind, "one");
  assert.equal(linkMap(mine, vault).resolve("Twice").kind, "several");

  // 20,000 notes: 2,000 of the project, 18,000 of the vault; every 500th name is there twice.
  const own: { name: string; path: string }[] = [], shared: { name: string; path: string }[] = [];
  for (let i = 0; i < 20000; i++) {
    const name = `Concept - ${i % 500 === 499 ? i - 1 : i}`;
    (i < 2000 ? own : shared).push({ name, path: `/v/${i < 2000 ? "P" : "Shared"}/${i}/${name}.md` });
  }
  const links: string[] = [];
  for (let i = 0; i < 4000; i++) { links.push(i % 4 === 3 ? `No note ${i}` : `Concept - ${(i * 7919) % 20000}`); }
  let best = Infinity, kinds: string[] = [];
  for (let run = 0; run < 3; run++) {
    const start = performance.now();
    const map = linkMap(own, shared);                // built once for the notes, then one lookup for each link
    kinds = links.map((name) => map.resolve(name).kind);
    best = Math.min(best, performance.now() - start);
  }
  console.log(`timing: 4,000 links against 20,000 notes resolved in ${best.toFixed(1)} ms`);
  assert.ok(best < 50, `took ${best.toFixed(1)} ms`);
  assert.equal(kinds.filter((kind) => kind === "none").length, links.filter((name) => name.startsWith("No note") || Number(name.slice(10)) % 500 === 499).length);
  const map = linkMap(own, shared);
  for (let i = 0; i < links.length; i += 97) { assert.deepEqual(map.resolve(links[i]), resolveLink(links[i], own, shared)); }
});
