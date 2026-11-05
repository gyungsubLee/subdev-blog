import { createHash } from 'node:crypto';
// The external server is stubbed; preserve the real bulk receipt boundary and
// keep old single-save assertions focused on the authored document operation.
export function bulkResponse(input, result = {}, source) {
  const contentCommit=result.contentCommit??'c'.repeat(40);
  const sources={};
  if(source)for(const operation of input.operations??[]) {
    if(operation.type==='categories.save')continue;
    const id=operation.id??operation.document.metadata.id;
    const document=operation.document??{...source.document,metadata:{...source.document.metadata,...operation.changes},markdown:operation.markdown??source.document.markdown};
    sources[id]={...source,document,editor:operation.editor??source.editor,revision:'d'.repeat(64),editorRevision:operation.editor?'e'.repeat(64):null,contentCommit};
  }
  return {...result,requestId:input.requestId,state:result.state??'published',contentCommit,sources,
    categories:{categories:input.operations?.find(operation=>operation.type==='categories.save')?.categories??source?.categories??[],revision:'f'.repeat(64),contentCommit},
    receipt:{requestId:input.requestId,payloadHash:createHash('sha256').update(JSON.stringify(input)).digest('hex'),contentCommit}};
}
