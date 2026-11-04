import { test } from 'node:test';
import assert from 'node:assert/strict';

const id = '12345678-1234-1234-1234-123456789abc';
const hash = 'a'.repeat(64);
const document = (blocks = [{type:'paragraph',content:[{type:'text',text:'Hello',styles:{bold:true}}]}]) => ({
    schemaVersion:1, documentId:id, markdownHash:hash, blocks,
});
const validator = async () => {
    const module = await import('../../app/shared/editor-document.mjs').catch(() => null);
    assert.ok(module?.validateEditorDocument, 'editor document validator must be available');
    return module.validateEditorDocument;
};

test('editor filename reservation recognizes decoded aliases without breaking ordinary percent names', async () => {
    const module = await import('../../app/shared/editor-document.mjs');
    assert.equal(typeof module.isEditorFilename, 'function');
    for (const name of ['editor.json','EDITOR.JSON','%65ditor.json','%2565ditor.json','%2525252565ditor.json']) {
        assert.equal(module.isEditorFilename(name), true, name);
    }
    for (const name of ['picture.png','100% done.png','broken%ZZ.png','../editor.json','%252525252565ditor.json']) {
        assert.equal(module.isEditorFilename(name), false, name);
    }
});

test('editor validation preserves notebook children, code settings, links and table cells', async () => {
    const validate = await validator();
    const value = document([
        {type:'notebook',props:{},children:[{type:'toggleListItem',content:[{type:'link',href:'https://example.com',content:[{type:'text',text:'Link',styles:{}}]}],children:[]}]},
        {type:'codeBlock',props:{language:'javascript',caption:'Example',wrap:true},content:'const value = 1;'},
        {type:'table',content:{type:'tableContent',columnWidths:[120,120],rows:[{cells:[[{type:'text',text:'Cell',styles:{}}],{type:'tableCell',props:{colspan:1,rowspan:1,backgroundColor:'default',textColor:'default',textAlignment:'left'},content:[]}]}]}},
    ]);
    assert.ok(validate(value, {documentId:id,markdownHash:hash}) === value);
    assert.equal(value.blocks[1].props.caption, 'Example');
    assert.equal(value.blocks[1].props.wrap, true);
});

test('editor validation rejects mismatched pairing, unsupported versions and malformed blocks', async () => {
    const validate = await validator();
    for (const value of [
        {...document(),schemaVersion:2}, {...document(),documentId:'not-a-uuid'},
        {...document(),documentId:'98765432-1234-1234-1234-123456789abc'},
        {...document(),markdownHash:'b'.repeat(64)}, document([]), document([null]),
        document([{type:'unknown'}]), document([{type:'paragraph',props:[]}]),
        document([{type:'paragraph',content:[{type:'text',text:12,styles:{}}]}]),
        document([{type:'paragraph',content:[{type:'link',href:12,content:[]}]}]),
        document([{type:'paragraph',children:{}}]),
        document([{type:'table',content:{type:'tableContent',rows:[{cells:[{type:'tableCell',content:'broken'}]}]}}]),
    ]) assert.throws(() => validate(value, {documentId:id,markdownHash:hash}));
});

test('editor validation bounds nesting and node counts and rejects prototype keys', async () => {
    const validate = await validator();
    const cyclic = document();
    cyclic.blocks[0].props = cyclic;
    let nested = {type:'paragraph'};
    for (let index = 0; index < 100; index++) nested = {type:'notebook',children:[nested]};
    for (const value of [cyclic, document([nested]), document(Array.from({length:60000}, () => ({type:'paragraph'}))), JSON.parse(JSON.stringify(document()).replace('"bold":true', '"__proto__":{}'))]) {
        assert.throws(() => validate(value, {documentId:id,markdownHash:hash}));
    }
});

test('editor validation checks known property types and keeps unknown JSON properties intact', async () => {
    const validate = await validator();
    for (const [type, props] of [
        ['codeBlock',{wrap:'true'}], ['checkListItem',{checked:1}],
        ['image',{showPreview:'yes'}], ['heading',{isToggleable:1}],
        ['codeBlock',{caption:[]}], ['codeBlock',{language:false}],
        ['image',{url:7}], ['file',{name:{}}],
        ['paragraph',{textColor:false}], ['paragraph',{backgroundColor:[]}],
        ['paragraph',{textAlignment:'sideways'}], ['heading',{level:0}],
        ['heading',{level:7}], ['heading',{level:1.5}], ['image',{previewWidth:-1}],
    ]) assert.throws(() => validate(document([{type,props}]), {documentId:id,markdownHash:hash}));
    const value = document([{type:'heading',props:{level:6,isToggleable:true,textAlignment:'justify',custom:{preserved:[1,true,'yes']}}}]);
    assert.ok(validate(value, {documentId:id,markdownHash:hash}) === value);
    assert.equal(value.blocks[0].props.custom.preserved[2], 'yes');
});
