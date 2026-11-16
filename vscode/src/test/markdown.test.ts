import { test } from "node:test";
import * as assert from "node:assert/strict";
import { parseFileNote } from "../core/notes";
import { render } from "../core/markdown";

test("headings, paragraphs, bold, italic, inline code", () => {
  assert.equal(render("# Title\n\n### Sub *part*\n"), "<h1>Title</h1>\n<h3>Sub <em>part</em></h3>");
  assert.equal(render("One **bold** and *slanted* word,\nsecond line.\n\nNext `a < b` paragraph."),
    "<p>One <strong>bold</strong> and <em>slanted</em> word,<br>\nsecond line.</p>\n<p>Next <code>a &lt; b</code> paragraph.</p>");
  assert.equal(render("`` a ` b `` and `**not bold** [[not a link]]`"), "<p><code>a ` b</code> and <code>**not bold** [[not a link]]</code></p>");
  assert.equal(render("2 * 3 * 4 and a lone ** or ` stays"), "<p>2 * 3 * 4 and a lone ** or ` stays</p>");
  assert.equal(render("\\*not slanted\\* and a\\|b"), "<p>*not slanted* and a|b</p>");
  assert.equal(render("####### seven is text"), "<p>####### seven is text</p>");
  assert.equal(render(""), "");
});

test("fenced code; Mermaid is shown as code", () => {
  assert.equal(render("```py\nx = 1 < 2\n# not a heading\n| not | a table |\n```\nafter"),
    '<pre><code class="language-py">x = 1 &lt; 2\n# not a heading\n| not | a table |</code></pre>\n<p>after</p>');
  assert.equal(render("```mermaid\nflowchart LR\n    A --> B\n```"), '<pre><code class="language-mermaid">flowchart LR\n    A --&gt; B</code></pre>');
  assert.equal(render("````\n```\ninside\n```\n````"), "<pre><code>```\ninside\n```</code></pre>");
  assert.equal(render("```\nnever closed\n# still code"), "<pre><code>never closed\n# still code</code></pre>");
  assert.equal(render('```"><script>\nx\n```'), "<pre><code>x</code></pre>");   // a language name that is not a plain word is left out
});

test("tables, with an escaped | in a cell", () => {
  assert.equal(render("| Part | Meaning |\n| --- | :---: |\n| `a \\| b` | or, [[Concept - x]] |\n| c \\| d | **e** |"),
    "<table>\n<thead><tr><th>Part</th><th>Meaning</th></tr></thead>\n<tbody>\n"
    + '<tr><td><code>a | b</code></td><td>or, <a data-note="Concept - x">Concept - x</a></td></tr>\n'
    + "<tr><td>c | d</td><td><strong>e</strong></td></tr>\n</tbody>\n</table>");
  assert.equal(render("|1|2|\n|3|4|"), "<table>\n<tbody>\n<tr><td>1</td><td>2</td></tr>\n<tr><td>3</td><td>4</td></tr>\n</tbody>\n</table>");
  assert.equal(render("text\n| a |\n| --- |\n| b |\nmore"),
    "<p>text</p>\n<table>\n<thead><tr><th>a</th></tr></thead>\n<tbody>\n<tr><td>b</td></tr>\n</tbody>\n</table>\n<p>more</p>");
});

test("[[links]] become <a data-note>; linkTo decides what the link carries", () => {
  assert.equal(render("See [[Concept - x]], [[Name|shown *so*]], [[folder/Deep]] and [[Name#Part]]."),
    '<p>See <a data-note="Concept - x">Concept - x</a>, <a data-note="Name">shown <em>so</em></a>, '
    + '<a data-note="Deep">folder/Deep</a> and <a data-note="Name">Name#Part</a>.</p>');
  const ids = new Map([["Concept - x", "7"]]);
  assert.equal(render("[[Concept - x]] and [[Unknown \"note\"]]", (name) => ids.get(name)),
    '<p><a data-note="7">Concept - x</a> and <span class="no-note">Unknown &quot;note&quot;</span></p>');
  assert.equal(render("[[]] and [[#Part]] and [[open"), "<p>[[]] and [[#Part]] and [[open</p>");
});

test("any other link becomes its text and its address in full, as <a data-href>: nothing opens by itself", () => {
  assert.equal(render("Read [the *docs*](https://example.com/a?b=1&c=2) now."),
    '<p>Read the <em>docs</em> <a data-href="https://example.com/a?b=1&amp;c=2">https://example.com/a?b=1&amp;c=2</a> now.</p>');
  assert.equal(render("[x](javascript:alert(1)) [y](obsidian://open?vault=V) [](file:///c:/a.txt)"),
    '<p>x <a data-href="javascript:alert(1)">javascript:alert(1)</a> y <a data-href="obsidian://open?vault=V">obsidian://open?vault=V</a> '
    + '<a data-href="file:///c:/a.txt">file:///c:/a.txt</a></p>');
  const html = render("[a](https://a.example) ![pic](https://b.example/p.png) <https://c.example> https://d.example");
  assert.doesNotMatch(html, /\shref=|\ssrc=|<img/);
});

test("<script> and <img onerror> in a note come out escaped; no raw HTML passes", () => {
  const hostile = [
    "# <script>alert(1)</script>",
    "",
    "A <img src=x onerror=alert(1)> and <b onclick=\"x()\">bold</b> & more.",
    "",
    "| <script>alert(2)</script> | `<img src=x onerror=alert(3)>` |",
    "| --- | --- |",
    "| [[<img src=x onerror=alert(4)>]] | [t](\"><script>alert(5)</script>) |",
    "",
    "```html",
    "</code></pre><script>alert(6)</script>",
    "```",
    "",
    "**<i>x</i>** *<u>y</u>* [[Name|<s>z</s>]] [<q>w</q>](https://e.example/\"onmouseover=\"alert(7))",
  ].join("\n");
  for (const html of [render(hostile), render(hostile, () => "\"><script>alert(8)</script>"), render(hostile, () => undefined)]) {
    // every < that the renderer writes starts one of its own tags; everything from the note is escaped
    const tags = html.match(/<[^>]*>/g) ?? [];
    for (const tag of tags) {
      assert.match(tag, /^<\/?(?:h[1-6]|p|br|table|thead|tbody|tr|th|td|pre|code|strong|em|a|span)(?: (?:data-note|data-href|class)="[^"<>]*")?>$/, tag);
    }
    assert.doesNotMatch(html, /<script|<img|<b |<i>|<u>|<s>|<q>|onerror=alert\(1\)>/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(html, /&lt;\/code&gt;&lt;\/pre&gt;&lt;script&gt;alert\(6\)/);
  }
  assert.equal(render("a & b < c > d \" e ' f"), "<p>a &amp; b &lt; c &gt; d &quot; e &#39; f</p>");
});

test("the 'Part of line' table kept in a block's prose comes out of render as a table", () => {
  const text = ["---", "type: file", "written_by: argus", "source: a.py", "depth: full", "---", "### Block 1: the call (line 6)", "",
    "```py", "x = run(2)", "```", "", "| Line | Code | What happens | Real value |", "| --- | --- | --- | --- |",
    "| 6 | `x = run(2)` | calls it | 3 |", "", "| Part of line 6 | Meaning |", "| --- | --- |", "| `run(2)` | the call |", ""].join("\n");
  const block = parseFileNote("n", "p", text).blocks[0];
  assert.equal(block.rows.length, 1);
  assert.equal(render(block.prose), "<table>\n<thead><tr><th>Part of line 6</th><th>Meaning</th></tr></thead>\n<tbody>\n"
    + "<tr><td><code>run(2)</code></td><td>the call</td></tr>\n</tbody>\n</table>");
});

test("a link's address may hold parentheses, balanced or written with a backslash", () => {
  const link = (address: string) => `<a data-href="${address}">${address}</a>`;
  assert.equal(render("[x](https://example.com/a_(b))"), `<p>x ${link("https://example.com/a_(b)")}</p>`);
  assert.equal(render("[x](https://example.com/a_(b)_(c(d))) after"), `<p>x ${link("https://example.com/a_(b)_(c(d))")} after</p>`);
  assert.equal(render("([x](https://e.example/y))"), `<p>(x ${link("https://e.example/y")})</p>`);
  assert.equal(render("[a](u(1)) and [b](v)"), `<p>a ${link("u(1)")} and b ${link("v")}</p>`);
  assert.equal(render("[x](https://example.com/a_\\(b) end"), `<p>x ${link("https://example.com/a_(b")} end</p>`);
  assert.equal(render("[x](https://example.com/a\\)b)"), `<p>x ${link("https://example.com/a)b")}</p>`);
  assert.equal(render("[x](()) [y]((a)(b))"), `<p>x ${link("()")} y ${link("(a)(b)")}</p>`);
  // No link: the address is never closed, holds white space, is empty, or does not follow the text at once.
  for (const text of ["[x](a(b)", "[x](https://e.example/a(b c)", "[x](a b)", "[x]()", "[x] (a)", "[x](a\\)", "[x(a)"]) {
    assert.equal(render(text), `<p>${text.replace(/\\\)/, ")")}</p>`, text);
  }
  // A parenthesis left open before a link does not take the link's own.
  assert.equal(render("(see [x](a(b)c)"), `<p>(see x ${link("a(b)c")}</p>`);
  assert.equal(render("[x](a(b [y](c)"), `<p>[x](a(b y ${link("c")}</p>`);
});

test("malformed links cost time in proportion to their length", () => {
  const time = (text: string): [number, string] => {
    const started = performance.now();
    const html = render(text);
    return [performance.now() - started, html];
  };
  const [took, html] = time("[".repeat(100000) + ")");
  console.log(`timing: 100,000 [ and one ) rendered in ${took.toFixed(1)} ms`);
  assert.ok(took < 200, `took ${took} ms`);
  assert.equal(html, `<p>${"[".repeat(100000)})</p>`);
  const others: [string, string][] = [
    ["100,000 [ and ]( at the end", "[".repeat(100000) + "](a)"],
    ["50,000 [](", "[](".repeat(50000)],
    ["50,000 []( and as many )", "[](".repeat(50000) + ")".repeat(50000)],
    ["40,000 [x](( a", "[x](( a".repeat(40000)],
    ["50,000 ]( then 50,000 [", "](".repeat(50000) + "[".repeat(50000) + "](x)"],
    ["30,000 [a](b\\", "[a](b\\".repeat(30000) + ")"],
  ];
  for (const [name, text] of others) {
    const [ms] = time(text);
    console.log(`timing: ${name} rendered in ${ms.toFixed(1)} ms`);
    assert.ok(ms < 200, `${name}: took ${ms} ms`);
  }
  // Openers closed in pairs: the first opener's parenthesis closes at the last closer; the address is all between.
  assert.equal(render("[](".repeat(3) + ")".repeat(3)), '<p><a data-href="[]([]())">[]([]())</a></p>');
});

test("a long line of openers that never close is rendered at once", () => {
  const started = performance.now();
  const html = render("[[ ".repeat(20000) + "** ".repeat(20000) + "` `` ".repeat(20000) + "[x](".repeat(20000));
  const took = performance.now() - started;
  console.log(`timing: 300,000 characters of unclosed openers rendered in ${took.toFixed(1)} ms`);
  assert.ok(took < 500, `took ${took} ms`);
  assert.doesNotMatch(html, /<a |<strong>/);
});

// ---------------------------------------------------------------- lists

test("a simple list: - and * at the start of a line give <ul><li>", () => {
  assert.equal(render("- one\n- two\n- three"), "<ul>\n<li>one</li>\n<li>two</li>\n<li>three</li>\n</ul>");
  assert.equal(render("* one\n* two"), "<ul>\n<li>one</li>\n<li>two</li>\n</ul>");
  assert.equal(render("-   spaced out  \n-\ttabbed\n* a star in the same list"),
    "<ul>\n<li>spaced out</li>\n<li>tabbed</li>\n<li>a star in the same list</li>\n</ul>");
  assert.equal(render("- one\r\n- two\r\n"), "<ul>\n<li>one</li>\n<li>two</li>\n</ul>");
});

test("list items go through the same inline rendering as paragraphs", () => {
  assert.equal(render("- **bold** and *slanted*\n- `a < b` and [[Concept - x]]\n- [docs](https://example.com/a_(b)) and a\\*star"),
    "<ul>\n<li><strong>bold</strong> and <em>slanted</em></li>\n"
    + '<li><code>a &lt; b</code> and <a data-note="Concept - x">Concept - x</a></li>\n'
    + '<li>docs <a data-href="https://example.com/a_(b)">https://example.com/a_(b)</a> and a*star</li>\n</ul>');
  assert.equal(render("* *slanted* first\n- - a hyphen first"), "<ul>\n<li><em>slanted</em> first</li>\n<li>- a hyphen first</li>\n</ul>");
});

test("an ordered list: 1. at the start of a line gives <ol><li>", () => {
  assert.equal(render("1. first\n2. second\n3. third"), "<ol>\n<li>first</li>\n<li>second</li>\n<li>third</li>\n</ol>");
  assert.equal(render("1. first\n1. second\n10. third"), "<ol>\n<li>first</li>\n<li>second</li>\n<li>third</li>\n</ol>");
  // A list that does not begin at 1 keeps its first number, so that a list cut in two by code still counts on.
  assert.equal(render("3. third\n4. fourth"), '<ol start="3">\n<li>third</li>\n<li>fourth</li>\n</ol>');
  assert.equal(render("1. one\n\n```\ncode\n```\n\n2. two"), '<ol>\n<li>one</li>\n</ol>\n<pre><code>code</code></pre>\n<ol start="2">\n<li>two</li>\n</ol>');
  // Another kind of item begins another list.
  assert.equal(render("- a\n1. b\n2. c\n- d"), "<ul>\n<li>a</li>\n</ul>\n<ol>\n<li>b</li>\n<li>c</li>\n</ol>\n<ul>\n<li>d</li>\n</ul>");
});

test("a nested list: items indented by two or more spaces belong to the item above", () => {
  assert.equal(render("- one\n  - inner a\n  - inner b\n- two"),
    "<ul>\n<li>one\n<ul>\n<li>inner a</li>\n<li>inner b</li>\n</ul>\n</li>\n<li>two</li>\n</ul>");
  assert.equal(render("1. step\n    - detail\n    - *more*\n2. next\n   1. sub one\n   2. sub two"),
    "<ol>\n<li>step\n<ul>\n<li>detail</li>\n<li><em>more</em></li>\n</ul>\n</li>\n<li>next\n<ol>\n<li>sub one</li>\n<li>sub two</li>\n</ol>\n</li>\n</ol>");
  // One level only: a deeper item stays in the inner list; one space is no indentation.
  assert.equal(render("- one\n  - inner\n      - deeper\n - two"),
    "<ul>\n<li>one\n<ul>\n<li>inner</li>\n<li>deeper</li>\n</ul>\n</li>\n<li>two</li>\n</ul>");
  assert.equal(render("- one\n\t- tabbed in\n- two"), "<ul>\n<li>one\n<ul>\n<li>tabbed in</li>\n</ul>\n</li>\n<li>two</li>\n</ul>");
  // The two kinds inside one item are two inner lists.
  assert.equal(render("- one\n  - a\n  1. b"), "<ul>\n<li>one\n<ul>\n<li>a</li>\n</ul>\n<ol>\n<li>b</li>\n</ol>\n</li>\n</ul>");
  // A list that starts indented: its first item sets the level.
  assert.equal(render("  - one\n  - two\n    - inner"), "<ul>\n<li>one</li>\n<li>two\n<ul>\n<li>inner</li>\n</ul>\n</li>\n</ul>");
});

test("a list item holding <script> comes out escaped; lists add only <ul>, <ol> and <li>", () => {
  const hostile = "- <script>alert(1)</script>\n  - <img src=x onerror=alert(2)> & \"more\"\n1. [t](\"><script>alert(3)</script>)\n"
    + "7. [[<b>x</b>]] `</li></ul><script>alert(4)</script>`";
  assert.equal(render("- <script>alert(1)</script>"), "<ul>\n<li>&lt;script&gt;alert(1)&lt;/script&gt;</li>\n</ul>");
  for (const html of [render(hostile), render(hostile, () => "\"><script>alert(5)</script>"), render(hostile, () => undefined)]) {
    for (const tag of html.match(/<[^>]*>/g) ?? []) {
      assert.match(tag, /^<\/?(?:ul|ol|li|code|a|span)(?: (?:data-note|data-href|class)="[^"<>]*")?>$/, tag);
    }
    assert.doesNotMatch(html, /<script|<img|<b>/);
    assert.match(html, /<li>&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(html, /<li>&lt;img src=x onerror=alert\(2\)&gt; &amp; &quot;more&quot;<\/li>/);
    assert.match(html, /&lt;\/li&gt;&lt;\/ul&gt;&lt;script&gt;alert\(4\)/);
  }
  // The only attribute a list gets is the number an ordered list starts at, digits only.
  assert.equal(render("007. <b>seven</b>"), '<ol start="7">\n<li>&lt;b&gt;seven&lt;/b&gt;</li>\n</ol>');
});

test("a list directly after a paragraph and directly before a table", () => {
  assert.equal(render("The steps:\n- one\n- two\n| a | b |\n| --- | --- |\n| 1 | 2 |\nafter"),
    "<p>The steps:</p>\n<ul>\n<li>one</li>\n<li>two</li>\n</ul>\n"
    + "<table>\n<thead><tr><th>a</th><th>b</th></tr></thead>\n<tbody>\n<tr><td>1</td><td>2</td></tr>\n</tbody>\n</table>\n<p>after</p>");
  assert.equal(render("Two lines,\nthen:\n1. one\n\n## Heading\n- a\n```\ncode\n```\n- b\ntext"),
    "<p>Two lines,<br>\nthen:</p>\n<ol>\n<li>one</li>\n</ol>\n<h2>Heading</h2>\n<ul>\n<li>a</li>\n</ul>\n<pre><code>code</code></pre>\n"
    + "<ul>\n<li>b</li>\n</ul>\n<p>text</p>");
  // A blank line ends a list; the next item begins a new one.
  assert.equal(render("- a\n\n- b"), "<ul>\n<li>a</li>\n</ul>\n<ul>\n<li>b</li>\n</ul>");
});

test("lines that are not list items stay as they were", () => {
  for (const line of ["-no space", "*slanted* words", "**bold** words", "1.5 is a number", "1) one", "a - b", "2 * 3 * 4",
    "---", "-", "1.", "1234567890. too long a number", "x. y"]) {
    const html = render(`before\n${line}\nafter`);
    assert.doesNotMatch(html, /<ul>|<ol|<li>/, line);
    assert.match(html, /^<p>before<br>\n.*<br>\nafter<\/p>$/, line);
  }
  assert.equal(render("- \n1. \n*  "), "<p>-<br>\n1.<br>\n*</p>");                     // a marker with nothing after it
  assert.equal(render("```\n- code\n1. code\n```"), "<pre><code>- code\n1. code</code></pre>");
  assert.equal(render("| - a | 1. b |"), "<table>\n<tbody>\n<tr><td>- a</td><td>1. b</td></tr>\n</tbody>\n</table>");
  assert.equal(render("# - a heading"), "<h1>- a heading</h1>");
});

test("a very long list is rendered at once", () => {
  const started = performance.now();
  const html = render(Array.from({ length: 50000 }, (_, i) => (i % 3 === 2 ? `  ${i}. inner ${i}` : `- item ${i}`)).join("\n"));
  const took = performance.now() - started;
  console.log(`timing: a list of 50,000 items rendered in ${took.toFixed(1)} ms`);
  assert.ok(took < 500, `took ${took} ms`);
  assert.equal((html.match(/<li>/g) ?? []).length, 50000);
});
