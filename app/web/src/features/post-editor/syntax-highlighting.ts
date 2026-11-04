import { SyntaxHighlightingExtension } from "@blocknote/core/extensions";

export const syntaxHighlighting = SyntaxHighlightingExtension({
  createHighlighter: async () => {
    const [{ createBundledHighlighter }, { createOnigurumaEngine }] =
      await Promise.all([
        import("shiki/core"),
        import("shiki/engine/oniguruma"),
      ]);
    const grammars = {
      javascript: () => import("@shikijs/langs/javascript"),
      typescript: () => import("@shikijs/langs/typescript"),
      python: () => import("@shikijs/langs/python"),
      go: () => import("@shikijs/langs/go"),
      bash: () => import("@shikijs/langs/shellscript"),
      json: () => import("@shikijs/langs/json"),
      html: () => import("@shikijs/langs/html"),
      css: () => import("@shikijs/langs/css"),
      sql: () => import("@shikijs/langs/sql"),
      markdown: () => import("@shikijs/langs/markdown"),
      java: () => import("@shikijs/langs/java"),
      cpp: () => import("@shikijs/langs/cpp"),
    };
    const createHighlighter = createBundledHighlighter<
      keyof typeof grammars,
      "github-light"
    >({
      langs: grammars,
      themes: { "github-light": () => import("@shikijs/themes/github-light") },
      engine: () => createOnigurumaEngine(import("shiki/wasm")),
    });
    return createHighlighter({
      themes: ["github-light"],
      langs: Object.keys(grammars) as Array<keyof typeof grammars>,
    });
  },
});
