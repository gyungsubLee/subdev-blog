import {
  BlockNoteSchema,
  createBlockSpec,
  createCodeBlockSpec,
  type BlockImplementation,
} from "@blocknote/core";

export const languages = {
  text: { name: "Plain text" },
  javascript: { name: "JavaScript", aliases: ["js"] },
  typescript: { name: "TypeScript", aliases: ["ts"] },
  python: { name: "Python", aliases: ["py"] },
  go: { name: "Go" },
  bash: { name: "Bash", aliases: ["sh", "shell"] },
  json: { name: "JSON" },
  html: { name: "HTML" },
  css: { name: "CSS" },
  sql: { name: "SQL" },
  markdown: { name: "Markdown", aliases: ["md"] },
  java: { name: "Java" },
  cpp: { name: "C++" },
};

const base = createCodeBlockSpec({
  supportedLanguages: languages,
  indentLineWithTab: true,
});

const codeConfig = {
  ...base.config,
  propSchema: {
    ...base.config.propSchema,
    caption: { default: "" },
    wrap: { default: false },
  },
} as const;

// The native renderer only uses language; extra persisted props do not change its contract.
const renderNative = base.implementation.render as unknown as NonNullable<
  BlockImplementation<
    "codeBlock",
    typeof codeConfig.propSchema,
    "plain"
  >["render"]
>;

export const codeBlockSpec = createBlockSpec<
  "codeBlock",
  typeof codeConfig.propSchema,
  "plain"
>(
  codeConfig,
  {
    meta: base.implementation.meta,
    parse: base.implementation.parse,
    parseContent: base.implementation.parseContent,
    render(block, editor) {
      let currentProps = block.props;
      // Keep the native language picker and code editing behavior.
      const safeLanguage =
        block.props.language in languages ? block.props.language : "text";
      const rendered = renderNative.call(
        {},
        { ...block, props: { ...block.props, language: safeLanguage } },
        editor,
      );
      const dom = document.createElement("div");
      dom.className = "notion-code";
      dom.appendChild(rendered.dom);

      const tools = document.createElement("div");
      tools.className = "notion-code-tools";
      tools.contentEditable = "false";
      const languagePicker = dom.querySelector("select");
      if (languagePicker) {
        languagePicker.setAttribute("aria-label", "코드 언어");
        tools.appendChild(languagePicker.parentElement!);
      }

      const copy = document.createElement("button");
      copy.type = "button";
      copy.textContent = "복사";
      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(
            rendered.contentDOM?.textContent ?? "",
          );
          copy.textContent = "복사 완료";
        } catch {
          copy.textContent = "복사 실패";
        }
        setTimeout(() => {
          copy.textContent = "복사";
        }, 1800);
      });
      tools.appendChild(copy);

      const wrap = document.createElement("button");
      wrap.type = "button";
      wrap.textContent = "줄바꿈";
      wrap.setAttribute("aria-pressed", String(block.props.wrap));
      wrap.addEventListener("click", () =>
        editor.updateBlock(block, { props: { wrap: !currentProps.wrap } }),
      );
      tools.appendChild(wrap);
      dom.prepend(tools);
      dom.dataset.wrap = String(block.props.wrap);

      const caption = document.createElement("input");
      caption.className = "notion-code-caption";
      caption.placeholder = "캡션 추가";
      caption.setAttribute("aria-label", "코드 캡션");
      caption.contentEditable = "false";
      caption.value = block.props.caption;
      caption.readOnly = !editor.isEditable;
      caption.addEventListener("input", () =>
        editor.updateBlock(block.id, { props: { caption: caption.value } }),
      );
      caption.addEventListener("keydown", (event) => {
        event.stopPropagation();
        if (event.key === "Enter" && !event.isComposing) {
          event.preventDefault();
          caption.blur();
        }
      });
      dom.appendChild(caption);
      return {
        ...rendered,
        dom,
        update(node) {
          if (node.type.name !== "codeBlock") return false;
          currentProps = {
            language: String(node.attrs.language),
            caption: String(node.attrs.caption),
            wrap: Boolean(node.attrs.wrap),
          };
          dom.dataset.wrap = String(currentProps.wrap);
          wrap.setAttribute("aria-pressed", String(currentProps.wrap));
          if (caption.value !== currentProps.caption)
            caption.value = currentProps.caption;
          if (languagePicker)
            languagePicker.value =
              currentProps.language in languages
                ? currentProps.language
                : "text";
          return true;
        },
      };
    },
    toExternalHTML(block) {
      const figure = document.createElement("div");
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.className = "language-" + block.props.language;
      code.dataset.language = block.props.language;
      pre.appendChild(code);
      figure.appendChild(pre);
      if (block.props.caption) {
        const caption = document.createElement("p");
        caption.textContent = block.props.caption;
        figure.appendChild(caption);
      }
      return { dom: figure, contentDOM: code };
    },
  },
  base.extensions,
)();

export const editorSchema = BlockNoteSchema.create().extend({
  blockSpecs: { codeBlock: codeBlockSpec },
});
