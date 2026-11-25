// The little Markdown renderer behind help.html. Run: node --test nodes/rov_sim/web/sim/tests/
import test from "node:test";
import assert from "node:assert/strict";
import { render, inline, slug, outline } from "../../mdrender.js";

test("headings get ids (automatic or {#custom}), duplicates are made unique", () => {
  const html = render("# Title\n## Micro:bit and Pico {#microcontrollers}\n## Same\n## Same\n");
  assert.match(html, /<h1 id="title">Title<\/h1>/);
  assert.match(html, /<h2 id="microcontrollers">Micro:bit and Pico<\/h2>/);
  assert.match(html, /<h2 id="same">Same<\/h2>/);
  assert.match(html, /<h2 id="same-2">Same<\/h2>/);
  assert.equal(slug("What *is* `this`?"), "what-is-this");
});

test("HTML in the text is escaped, never passed through", () => {
  assert.equal(inline("<script>alert(1)</script> & \"q\""), "&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;q&quot;");
  assert.ok(!render("<img src=x onerror=alert(1)>").includes("<img"));
  assert.ok(!render("```\n<b>bold</b>\n```").includes("<b>"));
});

test("inline: code, bold, italic, links; code is left alone", () => {
  assert.equal(inline("use `p:t1,0.5` now"), "use <code>p:t1,0.5</code> now");
  assert.equal(inline("**strong** and *soft*"), "<strong>strong</strong> and <em>soft</em>");
  assert.equal(inline("`*not italic* **nor bold**`"), "<code>*not italic* **nor bold**</code>");
  assert.equal(inline("[home](index.html)"), '<a href="index.html">home</a>');
  assert.equal(inline("[top](#top)"), '<a href="#top">top</a>');
  assert.equal(inline("[set up](index.html?config&rings=2)"), '<a href="index.html?config&amp;rings=2">set up</a>', "a relative link may carry a query string");
  assert.match(inline("[site](https://example.com/a?b=1&c=2)"), /href="https:\/\/example.com\/a\?b=1&amp;c=2" target="_blank" rel="noopener"/);
  const bad = inline("[bad](javascript:alert(1))");
  assert.ok(bad.startsWith("bad") && !bad.includes("<a") && !bad.includes("href"), "javascript: links are dropped: " + bad);
  assert.equal(inline("2 * 3 * 4"), "2 * 3 * 4", "lone asterisks are not italic");
});

test("code blocks keep every character, including pipes, hashes and angle brackets", () => {
  const html = render("```python\nif a | b:  # <hi>\n    print(\"p:t1,1\")\n```\nafter");
  assert.match(html, /<pre><code class="lang-python">if a \| b:  # &lt;hi&gt;\n    print\(&quot;p:t1,1&quot;\)<\/code><\/pre>/);
  assert.match(html, /<p>after<\/p>/);
});

test("tables", () => {
  const html = render("| You send | Meaning |\n|---|---|\n| `p:t1,0.5` | thruster **1** |\n| `s:depth` | send me depth |\n");
  assert.match(html, /<table><thead><tr><th>You send<\/th><th>Meaning<\/th><\/tr><\/thead>/);
  assert.match(html, /<td><code>p:t1,0.5<\/code><\/td><td>thruster <strong>1<\/strong><\/td>/);
  assert.equal((html.match(/<tr>/g) || []).length, 3);
});

test("lists (bulleted, numbered, wrapped lines), quotes, rules, paragraphs", () => {
  assert.equal(render("- one\n- two\n  continues\n"), "<ul><li>one</li><li>two continues</li></ul>");
  assert.equal(render("1. first\n2. second\n"), "<ol><li>first</li><li>second</li></ol>");
  assert.equal(render("> careful\n> now"), "<blockquote>careful now</blockquote>");
  assert.equal(render("---"), "<hr>");
  assert.equal(render("line one\nline two\n\nnext"), "<p>line one line two</p>\n<p>next</p>");
});

test("outline lists the h2 / h3 headings", () => {
  assert.deepEqual(outline("# T\n## A\ntext\n### B {#bee}\n#### C\n"), [{ level: 2, id: "a", text: "A" }, { level: 3, id: "bee", text: "B" }]);
});
