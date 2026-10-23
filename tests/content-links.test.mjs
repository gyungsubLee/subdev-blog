import assert from "node:assert/strict";
import test from "node:test";
import { rewriteContentLinks } from "../src/shared/content-links.mjs";

test("rewrites only Markdown destinations and reference definitions", () => {
  const source = '![alt](./a.png "title") [label](<./b&amp;c.pdf#part> "keep")\r\n\r\n![ref][pic] [doc][ref]\r\n\r\n[pic]: ./c.webp\r\n[ref]: <./d.pdf> "title"\r\n';
  const seen = [];
  const result = rewriteContentLinks(source, (url, context) => {
    seen.push([url, context.kind]);
    return "/new/" + url.slice(2);
  });
  assert.equal(result, '![alt](/new/a.png "title") [label](</new/b&amp;c.pdf#part> "keep")\r\n\r\n![ref][pic] [doc][ref]\r\n\r\n[pic]: /new/c.webp\r\n[ref]: </new/d.pdf> "title"\r\n');
  assert.ok(seen.some(([url, kind]) => url === "./a.png" && kind === "image"));
  assert.ok(seen.some(([url]) => url === "./b&c.pdf#part"));
});

test("rewrites HTML src href and each srcset candidate while preserving syntax", () => {
  const source = '<div><a HREF = \'./a&#46;pdf#part\'>go</a><img src=./a.png srcset="./a.png 1x, ./b%20c.webp 2x"><img srcset="data:image/png;base64,AAA 1x, ./c.png 2x"></div>';
  const contexts = [];
  assert.equal(rewriteContentLinks(source, (url, context) => {
    contexts.push(context.attribute);
    return url.startsWith("./") ? "/new/" + url.slice(2) : url;
  }), '<div><a HREF = \'/new/a.pdf#part\'>go</a><img src=/new/a.png srcset="/new/a.png 1x, /new/b%20c.webp 2x"><img srcset="data:image/png;base64,AAA 1x, /new/c.png 2x"></div>');
  assert.deepEqual(new Set(contexts), new Set(["href", "src", "srcset"]));
});

test("leaves code samples byte identical including nested HTML code and pre", () => {
  const protectedText = [
    '````md\n![x](./a.png)\n```\n<img src="./b.png">\n````',
    '~~~html\n<img src="./b.png">\n~~~',
    '    ![x](./a.png)',
    '`![x](./a.png)` ``<img src="./b.png">``',
    '<pre><code><img src="./a.png">\n![x](./b.png)</code></pre>',
    '<code>![x](./a.png) <img src="./b.png"></code>',
  ].join("\n\n");
  const source = protectedText + '\n\n![real](./real.png) <img src="./real.png">';
  assert.equal(rewriteContentLinks(source, () => "/changed"), protectedText + '\n\n![real](/changed) <img src="/changed">');
});

test("identity resolution preserves every body byte including entities and escapes", () => {
  const source = '[escaped](./a\\(1\\).pdf)\n\n<a href="./a&amp;b.pdf">&nbsp;</a>\n\n$x$ ~~text~~\n';
  assert.equal(rewriteContentLinks(source, (url) => url), source);
});

test("preserves escaped HTML and HTML-looking Markdown link titles", () => {
  const source = '\\<img src="./literal.png">\n\n[label](./real.pdf \'<img src="./literal.png">\')\n\n<code>![sample](./literal.png)</code> <img src="./actual.png">';
  const seen = [];
  const result = rewriteContentLinks(source, (url) => {
    seen.push(url);
    return "/changed/" + url.slice(2);
  });
  assert.equal(result, '\\<img src="./literal.png">\n\n[label](/changed/real.pdf \'<img src="./literal.png">\')\n\n<code>![sample](./literal.png)</code> <img src="/changed/actual.png">');
  assert.deepEqual(seen.sort(), ["./actual.png", "./real.pdf"]);
});

test("splits srcset on decoded separators while preserving source entity spellings", () => {
  const source = '<img srcset="./a&amp;b.png&#32;1x,&#32;./b.png&#x20;2x">';
  const seen = [];
  const result = rewriteContentLinks(source, (url) => {
    seen.push(url);
    return "/changed/" + url.slice(2);
  });
  assert.deepEqual(seen, ["./a&b.png", "./b.png"]);
  assert.equal(result, '<img srcset="/changed/a&amp;b.png&#32;1x,&#32;/changed/b.png&#x20;2x">');
});
