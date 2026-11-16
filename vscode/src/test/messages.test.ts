import { test } from "node:test";
import * as assert from "node:assert/strict";
import { Context, handle, hrefsIn } from "../core/messages";
import { render } from "../core/markdown";
import { Resolved } from "../core/links";

interface N { id: number; name: string; path: string; }
const inside: N = { id: 1, name: "Concept - x", path: "/vault/P/Concept - x.md" };
const twin: N = { id: 2, name: "Concept - x", path: "/vault/Other/Concept - x.md" };
const moved: N = { id: 3, name: "Concept - m", path: "/elsewhere/Concept - m.md" };

const NOTE = "See [docs](https://example.com/a?b=1&c=2), [mail](mailto:a@example.com), [vault](obsidian://open?vault=v), "
  + "[disk](file:///C:/Users/x/secret.txt), [run](command:workbench.action.terminal.new), [js](javascript:alert(1)), "
  + "[data](data:text/html,x), [code](vscode://settings), [rel](docs/readme.md).";

function context(over: Partial<Context<N>> = {}): Context<N> {
  return {
    resolve: (name): Resolved<N> => name === "Concept - x" ? { kind: "several", places: [inside, twin] }
      : name === "One" ? { kind: "one", note: inside } : name === "Concept - m" ? { kind: "one", note: moved } : { kind: "none" },
    byId: (id) => [inside, twin, moved].find((n) => n.id === id),
    holds: (n) => n.path.startsWith("/vault/"),
    hrefs: hrefsIn(render(NOTE)),
    ...over,
  };
}

test("only the seven kinds of message are handled; anything else is dropped", () => {
  for (const message of [undefined, null, 7, "create", [], {}, { type: "eval", code: "x" }, { type: "openFile", path: "C:/x" },
    { type: ["create"] }, { type: "Create" }, { type: "__proto__" }, { type: "toString" }]) {
    assert.deepEqual(handle(message, context()), { do: "drop" });
  }
  assert.deepEqual(handle({ type: "create" }, context()), { do: "create" });
  assert.deepEqual(handle({ type: "check", extra: "ignored" }, context()), { do: "check" });
  assert.deepEqual(handle({ type: "setup" }, context()), { do: "setup" });
});

test("openNote: one note is shown, several are listed, an unknown name is refused in words", () => {
  assert.deepEqual(handle({ type: "openNote", name: "One" }, context()), { do: "show", note: inside });
  assert.deepEqual(handle({ type: "openNote", name: "Concept - x" }, context()), { do: "list", name: "Concept - x", places: [inside, twin] });
  assert.equal(handle({ type: "openNote", name: "Nothing" }, context()).do, "say");
  assert.equal(handle({ type: "openNote", name: "Concept - m" }, context()).do, "say", "a note outside the folders is not shown");
  assert.deepEqual(handle({ type: "openNote", name: 7 }, context()), { do: "drop" });
  assert.deepEqual(handle({ type: "openNote" }, context()), { do: "drop" });
});

test("pick and obsidian: an unknown id is dropped; a note moved outside the folders is not read or opened", () => {
  assert.deepEqual(handle({ type: "pick", id: 2 }, context()), { do: "pick", note: twin });
  assert.deepEqual(handle({ type: "obsidian", id: 1 }, context()), { do: "obsidian", note: inside });
  for (const type of ["pick", "obsidian"]) {
    assert.deepEqual(handle({ type, id: 99 }, context()), { do: "drop" });
    assert.deepEqual(handle({ type, id: "1" }, context()), { do: "drop" });
    assert.deepEqual(handle({ type, id: 1.5 }, context()), { do: "drop" });
    assert.deepEqual(handle({ type }, context()), { do: "drop" });
    assert.equal(handle({ type, id: 3 }, context()).do, "say");
    assert.equal(handle({ type, id: 1 }, context({ holds: () => false })).do, "say", "containment is tested again on use");
  }
});

test("external: only an address of the note shown, and then by scheme", () => {
  assert.deepEqual(handle({ type: "external", href: "https://evil.example/" }, context()), { do: "drop" });
  assert.deepEqual(handle({ type: "external", href: 3 }, context()), { do: "drop" });
  assert.deepEqual(handle({ type: "external", href: "https://example.com/a?b=1&c=2" }, context()), { do: "open", href: "https://example.com/a?b=1&c=2" });
  assert.deepEqual(handle({ type: "external", href: "mailto:a@example.com" }, context()), { do: "open", href: "mailto:a@example.com" });
  assert.deepEqual(handle({ type: "external", href: "obsidian://open?vault=v" }, context()), { do: "open", href: "obsidian://open?vault=v" });
  assert.deepEqual(handle({ type: "external", href: "file:///C:/Users/x/secret.txt" }, context()), { do: "ask", href: "file:///C:/Users/x/secret.txt" });
  for (const href of ["command:workbench.action.terminal.new", "javascript:alert(1)", "data:text/html,x", "vscode://settings", "docs/readme.md"]) {
    const refused = handle({ type: "external", href }, context());
    assert.equal(refused.do, "say", href);
    assert.ok(refused.do === "say" && refused.text.includes("this kind of address is not opened from a note") && refused.text.includes(href));
  }
  // A scheme is read whatever its letter case; white space or control characters in front make no scheme.
  const odd = context({ hrefs: new Set(["HTTPS://example.com/", " javascript:alert(1)", "JavaScript:alert(1)"]) });
  assert.equal(handle({ type: "external", href: "HTTPS://example.com/" }, odd).do, "open");
  assert.equal(handle({ type: "external", href: " javascript:alert(1)" }, odd).do, "say");
  assert.equal(handle({ type: "external", href: "JavaScript:alert(1)" }, odd).do, "say");
});

test("hrefsIn reads the addresses of rendered HTML as the page gives them back", () => {
  const hrefs = hrefsIn(render("[a](https://example.com/?q=\"x\"&r='y'<z>) and `[b](https://code.example/)` and text data-href=\"https://fake.example/\""));
  assert.deepEqual([...hrefs], ["https://example.com/?q=\"x\"&r='y'<z>"]);
});
