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

test("a line of many backticks inside a fence is checked for the closing fence in one scan", () => {
  const line = "```x" + "`".repeat(50000) + "y";
  const started = performance.now();
  const html = render("```\n" + line + "\n```\nafter");
  const took = performance.now() - started;
  console.log(`timing: a fence holding \`\`\`x, 50,000 backticks and y rendered in ${took.toFixed(1)} ms`);
  assert.ok(took < 50, `took ${took} ms`);
  assert.equal(html, `<pre><code>${line}</code></pre>\n<p>after</p>`);
  // What closes a fence is unchanged: a fence at least as long, then nothing but spaces and then backticks.
  assert.equal(render("````\n```\n```` x\n```` `` x\n```` \t``\nafter"), "<pre><code>```\n```` x\n```` `` x</code></pre>\n<p>after</p>");
  assert.equal(render("```\na\n```  ```\nafter"), "<pre><code>a</code></pre>\n<p>after</p>");
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

// ---------------------------------------------------------------- backtick runs

test("code spans: a run of backticks closes on the next run of exactly as many", () => {
  assert.equal(render("`a`"), "<p><code>a</code></p>");
  assert.equal(render("``a ` b``"), "<p><code>a ` b</code></p>");
  assert.equal(render("`` a ` b ``"), "<p><code>a ` b</code></p>");
  assert.equal(render("a ` b"), "<p>a ` b</p>");                                   // no closer: the backtick is text
  assert.equal(render("a `` b ` c"), "<p>a `` b ` c</p>");                         // runs of other lengths close nothing
  assert.equal(render("`a`` b` c"), "<p><code>a`` b</code> c</p>");                // a longer run inside is code
  assert.equal(render("``a` b`` `c`"), "<p><code>a` b</code> <code>c</code></p>");
  assert.equal(render("`a` ``b`` ```c``` `d"), "<p><code>a</code> <code>b</code> <code>c</code> `d</p>");
  assert.equal(render("\\`a` b`"), "<p>`a<code> b</code></p>");                    // \` is the sign; the next backtick opens
  assert.equal(render("\\``a` b``"), "<p>`<code>a</code> b``</p>");               // the rest of the run opens, one backtick long
  assert.equal(render("`a\\` b`"), "<p><code>a\\</code> b`</p>");                  // inside code a backslash is a backslash
  assert.equal(render("`<b>` and *`x`* `*y*`"), "<p><code>&lt;b&gt;</code> and <em><code>x</code></em> <code>*y*</code></p>");
  assert.equal(render("- `a` and ``b` ``\n\n| `c` | `d |\n"),
    "<ul>\n<li><code>a</code> and <code>b` </code></li>\n</ul>\n<table>\n<tbody>\n<tr><td><code>c</code></td><td>`d</td></tr>\n</tbody>\n</table>");
});

test("backtick runs of many lengths cost time in proportion to the text", () => {
  const runs = (lengths: number[], between = "x") => lengths.map((n) => "`".repeat(n)).join(between);
  const upTo = (n: number) => Array.from({ length: n }, (_, k) => k + 1);
  const shapes: [string, string][] = [
    ["runs of every length from 1 to 1,600", runs(upTo(1600))],
    ["runs of every length from 1,600 down to 1", runs(upTo(1600).reverse())],
    ["runs of 1 to 1,000, each after a backslash", "\\" + runs(upTo(1000), "x\\")],
    ["runs of 1 to 600 and of 601 to 1,200, by turns", runs(upTo(600).flatMap((n) => [n, n + 600]))],
    ["runs of 2 to 1,200, then 20,000 single backticks", runs(upTo(1200).slice(1)) + " ` x".repeat(20000)],
    ["40,000 runs of 2 and of 3 by turns, then one of 1", "`` x ``` y ".repeat(20000).replace(/^``/, "`````") + "`"],
  ];
  for (const [name, text] of shapes) {
    const started = performance.now();
    const html = render("x" + text);                // the x: a line that begins with ``` would be a fence
    const took = performance.now() - started;
    console.log(`timing: ${name} (${text.length} characters) rendered in ${took.toFixed(1)} ms`);
    assert.ok(took < 200, `${name}: took ${took} ms`);
    assert.ok(html.startsWith("<p>") && html.endsWith("</p>"));
  }
  // What the first shape is: no run has a partner, so every backtick is text.
  assert.equal(render(runs(upTo(60))), `<p>${runs(upTo(60))}</p>`);
  assert.equal(render(runs([1, 2, 3, 2, 1])), "<p><code>x``x```x``x</code></p>");
});

// ---------------------------------------------------------------- one reading of the line

test("emphasis closes on an asterisk outside code spans and escapes", () => {
  assert.equal(render("*The `a*b` expression*"), "<p><em>The <code>a*b</code> expression</em></p>");
  assert.equal(render("**bold `a**b` end** and *`*`*"), "<p><strong>bold <code>a**b</code> end</strong> and <em><code>*</code></em></p>");
  assert.equal(render("*a \\* b* and **c \\** d**"), "<p><em>a * b</em> and <strong>c ** d</strong></p>");
  assert.equal(render("*a\\* and **b\\*\\*"), "<p>*a* and **b**</p>");                    // the only closer is written with a backslash
  assert.equal(render("*a `b*` c"), "<p>*a <code>b*</code> c</p>");                       // the only closer is code
  assert.equal(render("**a *b `*` c* d**"), "<p><strong>a <em>b <code>*</code> c</em> d</strong></p>");
  assert.equal(render("*a [[Name|b]] `c`* d"), '<p><em>a <a data-note="Name">b</a> <code>c</code></em> d</p>');
  assert.equal(render("**a *b***"), "<p><strong>a *b</strong>*</p>");
  assert.equal(render("| *x `a \\| b*` y* |"), "<table>\n<tbody>\n<tr><td><em>x <code>a | b*</code> y</em></td></tr>\n</tbody>\n</table>");
});

test("a backslash before a punctuation character makes it plain text: \\*, \\[, \\`", () => {
  assert.equal(render("\\*a\\* \\**b** \\[x](y) \\[[Name]] \\`c`"), "<p>*a* *<em>b</em>* [x](y) [[Name]] `c`</p>");
  assert.equal(render("[a\\]b](u) and [[Name|c\\]\\]d]]"), '<p>a]b <a data-href="u">u</a> and <a data-note="Name">c]]d</a></p>');
  assert.equal(render("[x\\](y) and [[Name\\]]"), "<p>[x](y) and [[Name]]</p>");          // the closer itself is written with a backslash
  assert.equal(render("a\\\\*b*"), "<p>a\\<em>b</em></p>");                               // \\ is a backslash; the asterisk after it opens
  assert.equal(render("a\\b \\ c\\"), "<p>a\\b \\ c\\</p>");                              // before anything else a backslash is a backslash
  assert.equal(render("`a\\`*b*"), "<p><code>a\\</code><em>b</em></p>");                  // inside code too
});

test("nothing inside a code span is read as a link, a bracket or a parenthesis", () => {
  assert.equal(render("`[[x]]` and [[Name|`a]]b`]] and [[Name `]]` two]]"),
    '<p><code>[[x]]</code> and <a data-note="Name"><code>a]]b</code></a> and <a data-note="Name   two">Name <code>]]</code> two</a></p>');
  // An address holds no code span: the backtick in it is a character of the address, and its first ")" closes it.
  assert.equal(render("[`a]`](u) and [b](v`)`)"), '<p><code>a]</code> <a data-href="u">u</a> and b <a data-href="v`">v`</a>`)</p>');
  assert.equal(render("[`x](y)`](z)"), '<p><code>x](y)</code> <a data-href="z">z</a></p>');
  assert.equal(render("`[a](` b `)`"), "<p><code>[a](</code> b <code>)</code></p>");
});

test("a link's address is literal text: backticks, asterisks and brackets in it are not signs", () => {
  const link = (address: string) => `<a data-href="${address}">${address}</a>`;
  assert.equal(render("[docs](file:///repo/`name`.ts)"), `<p>docs ${link("file:///repo/`name`.ts")}</p>`);
  assert.equal(render("see [docs](file:///repo/`name`.ts) and `code`"), `<p>see docs ${link("file:///repo/`name`.ts")} and <code>code</code></p>`);
  // Asterisks and brackets.
  assert.equal(render("[a](x*y*z[1]) and *b*"), `<p>a ${link("x*y*z[1]")} and <em>b</em></p>`);
  assert.equal(render("*[a](u*v) w* [b](c[[Name]]d**e)"), `<p><em>a ${link("u*v")} w</em> b ${link("c[[Name]]d**e")}</p>`);
  assert.equal(render("[a](b`\\)`c(`)) d"), `<p>a ${link("b`)`c(`)")} d</p>`);        // parentheses pair as before
  // A code span before the link, on the same line.
  assert.equal(render("`c` then [d](u`v)"), `<p><code>c</code> then d ${link("u`v")}</p>`);
  assert.equal(render("`c` then [d](u`v`w) and `e`"), `<p><code>c</code> then d ${link("u`v`w")} and <code>e</code></p>`);
  // A code span that begins before the link's text, or in it, and takes the "](": no link.
  assert.equal(render("a `x [d](u` v)"), "<p>a <code>x [d](u</code> v)</p>");
  assert.equal(render("[d `x](u)` y"), "<p>[d <code>x](u)</code> y</p>");
  // Without a "[" before it, "](" opens no address: the code span stays.
  assert.equal(render("a](`b`)"), "<p>a](<code>b</code>)</p>");
});

test("links with backticks in their addresses cost time in proportion to the line", () => {
  const nested = "`x`[a](".repeat(19999) + "`x`" + ")".repeat(19999);
  const shapes: [string, string, (html: string) => void][] = [
    ["20,000 [a](`", "[a](`".repeat(20000), (html) => assert.doesNotMatch(html, /<a /)],
    ["20,000 [a](`x` and as many )", "[a](`x`".repeat(20000) + ")".repeat(20000),
      (html) => assert.equal(html, `<p>a <a data-href="${nested}">${nested}</a></p>`)],
  ];
  for (const [name, text, check] of shapes) {
    const started = performance.now();
    const html = render(text);
    const took = performance.now() - started;
    console.log(`timing: ${name} (${text.length} characters) rendered in ${took.toFixed(1)} ms`);
    assert.ok(took < 200, `${name}: took ${took} ms`);
    check(html);
  }
});

test("a [[ that opens no link is passed over; the next one is read for itself", () => {
  assert.equal(render("[[#[[b]] and [[a/[[c/|d]]"), '<p>[[#<a data-note="b">b</a> and [[a/[[c/|d]]</p>');
  assert.equal(render("[[ x.md ]] [[.md]] [[a/]] [[\\]]"), '<p><a data-note="x">x.md</a> [[.md]] [[a/]] [[]]</p>');
  assert.equal(render("[[Name|]] [[Name| ]] [[a/*b*.md|]]"),
    '<p><a data-note="Name">Name</a> <a data-note="Name">Name</a> <a data-note="*b*"><em>b</em></a></p>');
});

test("one line of any shape is rendered in time in proportion to its length", () => {
  const unit = "**[*x*](y)**";
  const shapes: [string, string, ((html: string) => void)?][] = [
    ["32,000 [[# and one ]]", "[[#".repeat(32000) + "]]", (html) => assert.equal(html, `<p>${"[[#".repeat(32000)}]]</p>`)],
    ["64,000 [[# and one ]]", "[[#".repeat(64000) + "]]"],
    ["20,000 [[x and one /]]", "[[x".repeat(20000) + "/]]", (html) => assert.equal(html, `<p>${"[[x".repeat(20000)}/]]</p>`)],
    ["20,000 [[x, 20,000 spaces and one /]]", "[[x".repeat(20000) + " ".repeat(20000) + "/]]"],
    ["30,000 [[a| and one ]]", "[[a|".repeat(30000) + "]]"],
    ["30,000 [[ and as many ]]", "[[".repeat(30000) + "]]".repeat(30000)],
    ["20,000 [[a]] links", "[[a]] ".repeat(20000), (html) => assert.equal((html.match(/<a data-note="a">a<\/a>/g) ?? []).length, 20000)],
    ["100,000 asterisks", "x" + "*".repeat(100000), (html) => assert.equal(html, `<p>x${"*".repeat(100000)}</p>`)],
    ["50,000 *a ", "x" + "*a ".repeat(50000), (html) => assert.equal(html, `<p>x${"*a ".repeat(50000).trimEnd()}</p>`)],
    ["50,000 **a ", "x" + "**a ".repeat(50000)],
    ["50,000 *a and one closer", "x" + "*a".repeat(50000) + "*"],
    ["50,000 \\* and 50,000 *", "x" + "\\*".repeat(50000) + "*".repeat(50000)],
    ["50,000 [a](", "[a](".repeat(50000), (html) => assert.equal(html, `<p>${"[a](".repeat(50000)}</p>`)],
    ["50,000 [a](b", "[a](b".repeat(50000) + ")".repeat(50000)],
    [`20,000 ${unit}`, unit.repeat(20000),
      (html) => assert.equal(html, `<p>${'<strong><em>x</em> <a data-href="y">y</a></strong>'.repeat(20000)}</p>`)],
    ["20,000 **[*x*](y) inside one another", "**[*x*](y)".repeat(20000) + "**".repeat(20000)],
    ["20,000 *[[a|**b `c*` inside one another", "*[[a|**b `c*` ".repeat(20000) + "**]]*".repeat(20000)],
    ["30,000 \\[ then 30,000 ](a)", "\\[".repeat(30000) + "](a)".repeat(30000)],
    ["30,000 `*` code spans in one emphasis", "*a " + "`*` ".repeat(30000) + "b*",
      (html) => assert.equal(html, `<p><em>a ${"<code>*</code> ".repeat(30000)}b</em></p>`)],
    ["50,000 \\* in one emphasis", "*a" + "\\*".repeat(50000) + "b*", (html) => assert.equal(html, `<p><em>a${"*".repeat(50000)}b</em></p>`)],
    ["50,000 \\` then as many `", "x" + "\\`".repeat(50000) + "` ".repeat(50000)],
    ["50,000 backslashes in a [[link]]", "[[" + "\\".repeat(50001) + "x]] [[y" + "\\".repeat(50001) + "]]"],
  ];
  for (const [name, text, check] of shapes) {
    const started = performance.now();
    const html = render(text);
    const took = performance.now() - started;
    console.log(`timing: ${name} (${text.length} characters) rendered in ${took.toFixed(1)} ms`);
    assert.ok(took < 200, `${name}: took ${took} ms`);
    assert.ok(html.startsWith("<p>") && html.endsWith("</p>"), name);
    if (check) { check(html); }
  }
});

test("four times the line costs about four times the time, not sixteen times", () => {
  const time = (text: string): number => {
    let best = Infinity;
    for (let n = 0; n < 3; n++) {
      const started = performance.now();
      render(text);
      best = Math.min(best, performance.now() - started);
    }
    return best;
  };
  for (const unit of ["[[#", "[[x/ ", "*a ", "**[*x*](y)**", "[a](", "`*` [[b|"]) {
    const small = time(unit.repeat(10000) + "]]"), large = time(unit.repeat(40000) + "]]");
    console.log(`timing: '${unit}' 10,000 times in ${small.toFixed(1)} ms, 40,000 times in ${large.toFixed(1)} ms`);
    assert.ok(large < 8 * small + 40, `'${unit}': four times the text took ${(large / small).toFixed(1)} times as long`);
  }
});
