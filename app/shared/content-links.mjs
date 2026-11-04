import { parse, postprocess, preprocess } from "micromark";
import { decodeString } from "micromark-util-decode-string";
import { parseFragment } from "parse5";
import { DecodingMode, EntityDecoder, htmlDecodeTree } from "entities/decode";

function decodeAttributeSource(source) {
  let value = "";
  let cursor = 0;
  const starts = [];
  const ends = [];
  const decoder = new EntityDecoder(htmlDecodeTree, (codePoint, consumed) => {
    const decoded = String.fromCodePoint(codePoint);
    value += decoded;
    for (let index = 0; index < decoded.length; index++) {
      starts.push(cursor);
      ends.push(cursor + consumed);
    }
  });
  while (cursor < source.length) {
    if (source[cursor] === "&") {
      decoder.startEntity(DecodingMode.Attribute);
      let consumed = decoder.write(source, cursor + 1);
      if (consumed < 0) consumed = decoder.end();
      if (consumed > 0) {
        cursor += consumed;
        continue;
      }
    }
    value += source[cursor];
    starts.push(cursor);
    ends.push(cursor + 1);
    cursor++;
  }
  return { value, starts, ends };
}

/** Rewrite destination source ranges, retaining all other Markdown/HTML bytes. */
export function rewriteContentLinks(markdown, resolve) {
  const events = postprocess(
    parse().document().write(preprocess()(markdown, undefined, true)),
  );
  const protectedRanges = [];
  const htmlRanges = [];
  for (const [event, token] of events) {
    if (event !== "enter") continue;
    const range = [token.start.offset, token.end.offset];
    if (["codeFenced", "codeIndented", "codeText"].includes(token.type))
      protectedRanges.push(range);
    if (["htmlFlow", "htmlText"].includes(token.type)) htmlRanges.push(range);
  }
  const inside = (offset, ranges) =>
    ranges.some(([start, end]) => offset >= start && offset < end);
  // Retain HTML tokens in one positional document so inline code/pre pairs still nest.
  let htmlSource = markdown.replace(/[^\r\n]/g, " ");
  for (const [start, end] of htmlRanges)
    htmlSource = htmlSource.slice(0, start) +
      markdown.slice(start, end) +
      htmlSource.slice(end);

  const replacements = [];
  const replace = (start, end, destination, context, encode) => {
    const next = resolve(destination, context);
    if (typeof next !== "string")
      throw new TypeError("A link resolver must return a string.");
    if (next !== destination) replacements.push({ start, end, value: encode(next) });
  };
  const visitHtml = (node, protectedParent = false) => {
    const location = node.sourceCodeLocation;
    const protectedNode = protectedParent || node.tagName === "code" || node.tagName === "pre";
    if (protectedNode && location)
      protectedRanges.push([location.startOffset, location.endOffset]);
    if (!protectedNode && location) {
      for (const attr of node.attrs ?? []) {
        if (!["src", "href", "srcset"].includes(attr.name)) continue;
        const attrLocation = location.attrs?.[attr.name];
        if (!attrLocation) continue;
        const raw = markdown.slice(attrLocation.startOffset, attrLocation.endOffset);
        const prefix = raw.match(/^[^\s=]+\s*=\s*(["']?)/);
        if (!prefix) continue;
        const quote = prefix[1];
        const start = attrLocation.startOffset + prefix[0].length;
        const end = attrLocation.endOffset - (quote ? 1 : 0);
        const context = {
          kind: attr.name === "href" ? "link" : "image",
          attribute: attr.name,
        };
        const encode = (url) => {
          const escaped = url
            .replace(/&/g, "&amp;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
          if (quote) return escaped;
          return escaped.replace(
            /[\s=`]/g,
            (character) => "&#" + character.charCodeAt(0) + ";",
          );
        };
        if (attr.name !== "srcset") {
          replace(start, end, attr.value, context, encode);
          continue;
        }
        // Follow srcset URL/descriptor boundaries; commas inside data URLs are URL bytes.
        const { value, starts, ends } = decodeAttributeSource(markdown.slice(start, end));
        let cursor = 0;
        while (cursor < value.length) {
          while (/[\s,]/.test(value[cursor] ?? "") && cursor < value.length) cursor++;
          const urlStart = cursor;
          while (cursor < value.length && !/\s/.test(value[cursor])) cursor++;
          let urlEnd = cursor;
          while (value[urlEnd - 1] === ",") urlEnd--;
          if (urlEnd > urlStart)
            replace(
              start + starts[urlStart], start + ends[urlEnd - 1],
              value.slice(urlStart, urlEnd), context, encode,
            );
          if (urlEnd !== cursor) continue;
          let parentheses = 0;
          while (cursor < value.length) {
            const character = value[cursor++];
            if (character === "(") parentheses++;
            if (character === ")") parentheses--;
            if (character === "," && parentheses === 0) break;
          }
        }
      }
    }
    for (const child of node.childNodes ?? []) visitHtml(child, protectedNode);
    if (node.content) visitHtml(node.content, protectedNode);
  };
  visitHtml(parseFragment(htmlSource, { sourceCodeLocationInfo: true }));

  const stack = [];
  for (const [event, token] of events) {
    if (event === "exit") {
      stack.pop();
      continue;
    }
    stack.push(token.type);
    if (!["resourceDestinationString", "definitionDestinationString"].includes(token.type))
      continue;
    const start = token.start.offset;
    const end = token.end.offset;
    if (inside(start, protectedRanges)) continue;
    const literal = stack.some((type) => type.endsWith("DestinationLiteral"));
    const encode = (url) => url
      .replace(/&/g, "&amp;")
      .replace(literal ? /[<>\r\n]/g : /[()<>\s\\]/g, (character) =>
        encodeURIComponent(character).replace(/[()]/g, (point) =>
          "%" + point.charCodeAt(0).toString(16).toUpperCase(),
        ),
      );
    replace(
      start, end, decodeString(markdown.slice(start, end)),
      { kind: stack.includes("image") ? "image" : "link" }, encode,
    );
  }
  let result = markdown;
  for (const { start, end, value } of replacements.sort((a, b) => b.start - a.start))
    result = result.slice(0, start) + value + result.slice(end);
  return result;
}
