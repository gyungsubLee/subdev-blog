import { createExtension, type Extension, type PartialBlock } from '@blocknote/core';

type Shortcut = NonNullable<Extension['keyboardShortcuts']>[string];

const blockTypes: PartialBlock[] = [
  { type: 'paragraph' },
  { type: 'heading', props: { level: 1 } },
  { type: 'heading', props: { level: 2 } },
  { type: 'heading', props: { level: 3 } },
  { type: 'checkListItem', props: { checked: false } },
  { type: 'bulletListItem' },
  { type: 'numberedListItem' },
  { type: 'toggleListItem' },
  { type: 'codeBlock' },
];

function duringComposition(
  editor: Parameters<Shortcut>[0]['editor'],
  event: KeyboardEvent,
) {
  return event.isComposing || event.keyCode === 229 || editor.prosemirrorView.composing;
}

const keyboardShortcuts: Record<string, Shortcut> = {};

for (const [digit, blockType] of blockTypes.entries()) {
  const convertBlock: Shortcut = ({ editor, event }) => {
    if (duringComposition(editor, event)) return false;

    const { block } = editor.getTextCursorPosition();
    const content = editor.schema.blockSchema[block.type].content;
    if (content !== 'inline' && block.type !== 'codeBlock') return false;

    editor.updateBlock(block, blockType);
    return true;
  };

  keyboardShortcuts[`Cmd-Alt-${digit}`] = convertBlock;
  keyboardShortcuts[`Ctrl-Shift-${digit}`] = convertBlock;
}

keyboardShortcuts['Mod-d'] = ({ editor, event }) => {
  if (duringComposition(editor, event)) return false;

  const blocks = editor.getSelection()?.blocks ?? [
    editor.getTextCursorPosition().block,
  ];
  const copies: PartialBlock<any, any, any>[] = structuredClone(blocks);
  const pending = [...copies];
  while (pending.length) {
    const block = pending.pop()!;
    delete block.id;
    pending.push(...(block.children ?? []));
  }

  const inserted = editor.insertBlocks(copies, blocks[blocks.length - 1], 'after');
  if (inserted.length === 1) {
    editor.setTextCursorPosition(inserted[0], 'end');
  } else {
    editor.setSelection(inserted[0], inserted[inserted.length - 1]);
  }
  return true;
};

keyboardShortcuts['Mod-e'] = ({ editor, event }) => {
  if (duringComposition(editor, event)) return false;
  const { block } = editor.getTextCursorPosition();
  if (
    block.type === 'codeBlock' ||
    editor.schema.blockSchema[block.type].content !== 'inline'
  ) return false;

  editor.toggleStyles({ code: true });
  return true;
};

export const notionExtension = createExtension({
  key: 'notion-writing',
  // Native quote input and list keymaps use different meanings for these keys.
  runsBefore: [
    'quote-block-shortcuts',
    'toggle-list-item-shortcuts',
    'numbered-list-item-shortcuts',
    'bullet-list-item-shortcuts',
    'check-list-item-shortcuts',
    'heading-shortcuts',
    'paragraph-shortcuts',
  ],
  inputRules: [
    {
      find: /^>\s$/,
      replace: () => ({ type: 'toggleListItem' }),
    },
    {
      find: /^[ai]\.\s$/,
      replace: () => ({ type: 'numberedListItem' }),
    },
  ],
  keyboardShortcuts,
});
