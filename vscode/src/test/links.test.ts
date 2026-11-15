import { test } from "node:test";
import * as assert from "node:assert/strict";
import { findLinks, resolveLink } from "../core/links";

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
