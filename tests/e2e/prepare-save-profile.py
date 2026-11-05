from pathlib import Path
import re,json,hashlib
root=Path(__file__).resolve().parents[2];folder=root/'.tmp/save-stage-profile/modules';trace=(root/'tests/e2e/save-trace.mjs').as_uri()
folder.mkdir(parents=True,exist_ok=True)
paths={'content':root/'app/server/src/content.mjs','publication':root/'app/server/src/public-publication.mjs','handler':root/'app/server/src/handler.mjs'}
output={k:folder/(k+'.mjs') for k in paths}
for key,src in paths.items():
 s=src.read_text()
 def rewrite(m):
  name=m.group(1)
  if not name.startswith('.'):return m.group(0)
  dest=(src.parent/name).resolve()
  mapped=next((output[k] for k,v in paths.items() if dest==v),dest)
  return 'from '+repr(mapped.as_uri())
 s=re.sub(r'from [\'\"]([^\'\"]+)[\'\"]',rewrite,s)
 s=re.sub(r'import\([\'\"](\.[^\'\"]+)[\'\"]\)',lambda m: 'import('+repr(next((output[k] for k,v in paths.items() if (src.parent/m.group(1)).resolve()==v),(src.parent/m.group(1)).resolve()).as_uri())+')',s)
 if key=='content':
  s="import { stage } from "+repr(trace)+";\n"+s
  s=s.replace("new URL('../generated/content-catalog.json', import.meta.url)",'new URL('+repr((root/'app/server/generated/content-catalog.json').as_uri())+')')
  needle="    const categoryRead = request.method"
  assert needle in s;s=s.replace(needle,"    stage('source_preflight');\n"+needle,1)
  needle="    const writeBlob = async (bytes) => {"
  assert s.count(needle)==1;s=s.replace(needle,needle+"\n        stage('source_objects');")
  needle="        let current = await head();"
  assert s.count(needle)==1;s=s.replace(needle,"        stage('candidate_check');\n"+needle)
  needle="        await ensurePublicPublication(await publicationOptions(candidate, sourceSnapshot));"
  assert s.count(needle)==1;s=s.replace(needle,"        stage('public.lookup');\n"+needle+"\n        stage('main_advance');")
  needle="            await ensurePublicPublication(await publicationOptions(current));"
  assert s.count(needle)==1;s=s.replace(needle,"            stage('final_verification');\n"+needle)
  needle="            if (current !== candidate) await ensurePublicPublication(await publicationOptions(current));"
  assert s.count(needle)==1;s=s.replace(needle,"            if (current !== candidate) { stage('final_verification'); await ensurePublicPublication(await publicationOptions(current)); }")
  needle="            const nextTree = await call('/git/trees'"
  assert s.count(needle)==1;s=s.replace(needle,"            stage('source_objects');\n"+needle)
 elif key=='publication':
  s="import { stage } from "+repr(trace)+";\n"+s
  needle='  const source = await sourceTree(options);';assert needle in s;s=s.replace(needle,"  stage('public.source_tree');\n"+needle+"\n  stage('public.reuse_load');")
  needle='  const previous = incremental ? await previousPublication(options, source) : null;';assert needle in s;s=s.replace(needle,needle+"\n  stage('public.transform');")
  needle='  const { files, baseTree, removed } = await preparePublicFiles(options, true);';assert needle in s;s=s.replace(needle,needle+"\n  stage('public.upload');")
 output[key].write_text(s)
(root/'.tmp/save-stage-profile/source-hashes.json').write_text(json.dumps({str(v.relative_to(root)):hashlib.sha256(v.read_bytes()).hexdigest() for v in paths.values()},indent=2)+'\n')
print('Prepared instrumented copies; production source files unchanged')
