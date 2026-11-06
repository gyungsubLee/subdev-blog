import assert from "node:assert/strict";
import test from "node:test";
import { parseMarkdownDocument } from "../../app/shared/document.mjs";

test("document dates reject calendar overflow instead of silently rolling into another month", () => {
  for (const field of ["created", "updated"]) {
    for (const value of [
      "2025-02-29",
      "2024-02-30",
      "1900-02-29",
      "2025-04-31T12:00:00Z",
      "2025-02-30T00:30:00+09:00",
    ]) {
      assert.throws(
        () => parseMarkdownDocument(`---\n${field}: ${value}\n---\nBody`),
        /ISO/,
        `${field} must reject ${value}`,
      );
    }
  }
});

test("document dates preserve leap days and local calendar dates across timezone offsets", () => {
  for (const value of [
    "2024-02-29",
    "2000-02-29",
    "2025-01-01T00:30:00+09:00",
    "2025-12-31T23:30:00-09:00",
  ]) {
    const result = parseMarkdownDocument(`---\ncreated: ${value}\nupdated: ${value}\n---\nBody`);
    assert.equal(result.createdAt, value);
    assert.equal(result.updatedAt, value);
  }
});
