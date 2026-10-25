export const EDITOR_FILENAME = 'editor.json';

/** Recognize reserved source names without rejecting unrelated attachment names. */
export function isEditorFilename(name) {
    if (typeof name !== 'string') return false;
    let decoded = name;
    try {
        for (let count = 0; count < 5; count++) {
            const next = decodeURIComponent(decoded);
            if (next === decoded) break;
            decoded = next;
        }
    } catch {
        return false;
    }
    return decoded.toLowerCase() === EDITOR_FILENAME;
}

const uuidPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const hashPattern = /^[a-f0-9]{64}$/;
const forbiddenKeys = new Set(['__proto__', 'constructor', 'prototype']);
// Keep this list aligned with code-block.ts: BlockNote's installed defaults plus notebook.
const blockTypes = new Set([
    'audio', 'bulletListItem', 'checkListItem', 'codeBlock', 'divider', 'file',
    'heading', 'image', 'numberedListItem', 'paragraph', 'quote', 'table',
    'toggleListItem', 'video', 'notebook',
]);
const noContentTypes = new Set(['audio', 'divider', 'file', 'image', 'video', 'notebook']);

function requireValue(condition, message) {
    if (!condition) throw new Error(message);
}

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        && Object.getPrototypeOf(value) === Object.prototype;
}

function validateJson(value, depth, budget) {
    requireValue(depth <= 64 && --budget.remaining >= 0, 'Editor document exceeds structural limits');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number' && Number.isFinite(value)) return;
    if (Array.isArray(value)) {
        for (const item of value) validateJson(item, depth + 1, budget);
        return;
    }
    requireValue(isObject(value), 'Editor document must contain JSON values');
    for (const [key, item] of Object.entries(value)) {
        requireValue(!forbiddenKeys.has(key), 'Unsafe editor document key');
        validateJson(item, depth + 1, budget);
    }
}

function validateInline(content) {
    requireValue(Array.isArray(content), 'Invalid editor inline content');
    for (const item of content) {
        requireValue(isObject(item), 'Invalid editor inline item');
        if (item.type === 'text') {
            requireValue(typeof item.text === 'string' && isObject(item.styles), 'Invalid editor text');
            for (const [name, value] of Object.entries(item.styles)) {
                const color = name === 'textColor' || name === 'backgroundColor';
                const flag = ['bold', 'italic', 'underline', 'strike', 'code'].includes(name);
                requireValue((color && typeof value === 'string') || (flag && typeof value === 'boolean'), 'Invalid editor text style');
            }
        } else {
            requireValue(item.type === 'link' && typeof item.href === 'string' && Array.isArray(item.content), 'Invalid editor link');
            requireValue(item.content.every(child => child?.type === 'text'), 'Invalid editor link content');
            validateInline(item.content);
        }
    }
}

function validateProps(props, type) {
    requireValue(isObject(props), 'Invalid editor block props');
    for (const [name, value] of Object.entries(props)) {
        if (['wrap', 'checked', 'showPreview', 'isToggleable'].includes(name)) {
            requireValue(typeof value === 'boolean', 'Invalid editor boolean property: ' + name);
        } else if (['caption', 'language', 'url', 'name', 'textColor', 'backgroundColor'].includes(name)) {
            requireValue(typeof value === 'string', 'Invalid editor string property: ' + name);
        } else if (name === 'textAlignment') {
            requireValue(['left', 'center', 'right', 'justify'].includes(value), 'Invalid editor text alignment');
        } else if (name === 'level' && type === 'heading') {
            requireValue(Number.isInteger(value) && value >= 1 && value <= 6, 'Invalid editor heading level');
        } else if (name === 'previewWidth') {
            requireValue(typeof value === 'number' && Number.isFinite(value) && value >= 0, 'Invalid editor preview width');
        }
    }
}

function validateTable(content) {
    requireValue(isObject(content) && content.type === 'tableContent' && Array.isArray(content.rows), 'Invalid editor table');
    if (content.columnWidths !== undefined) {
        requireValue(Array.isArray(content.columnWidths) && content.columnWidths.every(width => width === null || (typeof width === 'number' && width >= 0)), 'Invalid editor table widths');
    }
    for (const row of content.rows) {
        requireValue(isObject(row) && Array.isArray(row.cells), 'Invalid editor table row');
        for (const cell of row.cells) {
            if (Array.isArray(cell)) validateInline(cell);
            else {
                requireValue(isObject(cell) && cell.type === 'tableCell' && (cell.props === undefined || isObject(cell.props)), 'Invalid editor table cell');
                if (cell.props !== undefined) validateProps(cell.props, 'tableCell');
                validateInline(cell.content);
            }
        }
    }
}

function validateBlocks(blocks) {
    requireValue(Array.isArray(blocks), 'Editor blocks must be an array');
    for (const block of blocks) {
        requireValue(isObject(block) && blockTypes.has(block.type), 'Unsupported editor block type');
        requireValue(block.id === undefined || typeof block.id === 'string', 'Invalid editor block ID');
        if (block.props !== undefined) validateProps(block.props, block.type);
        if (block.type === 'table') validateTable(block.content);
        else if (noContentTypes.has(block.type)) {
            requireValue(block.content === undefined, 'Unexpected editor block content');
        } else if (block.content !== undefined) {
            if (block.type !== 'codeBlock' || typeof block.content !== 'string') validateInline(block.content);
        }
        if (block.children !== undefined) validateBlocks(block.children);
    }
}

/**
 * Validate the persisted editor snapshot without changing any properties.
 * The caller computes markdownHash from the exact UTF-8 Markdown body.
 * @param {unknown} value
 * @param {{ documentId: string, markdownHash: string }} pairing
 * @returns {import('./post').EditorDocument}
 */
export function validateEditorDocument(value, { documentId, markdownHash }) {
    validateJson(value, 0, {remaining: 50000});
    requireValue(isObject(value), 'Editor document must be an object');
    requireValue(value.schemaVersion === 1, 'Unsupported editor document version');
    requireValue(typeof value.documentId === 'string' && uuidPattern.test(value.documentId) && value.documentId === documentId, 'Editor document ID mismatch');
    requireValue(typeof value.markdownHash === 'string' && hashPattern.test(value.markdownHash) && value.markdownHash === markdownHash, 'Editor Markdown hash mismatch');
    requireValue(Array.isArray(value.blocks) && value.blocks.length > 0, 'Editor document requires blocks');
    validateBlocks(value.blocks);
    return value;
}
