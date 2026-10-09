const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('assets/app-v0.8.6.js','utf8');
const loader=source.slice(source.indexOf('async function $m('),source.indexOf('function eh(',source.indexOf('async function $m(')));
function setup(mode){
 const destroyed=[],documents=[],calls=[];
 const Q={openSerial:0};
 function makeDoc(){const id=documents.length;const doc={numPages:1,loadingTask:{destroy:async()=>destroyed.push(id)},getPage:async()=>({rotate:0,getViewport:()=>({width:595,height:842})})};documents.push(doc);return doc;}
 const sandbox={Q,Qh(){},Qr:()=>({promise:Promise.resolve(makeDoc())}),URL,Uint8Array,document:{baseURI:'https://test.example/'},Kp:{},td(){},Ym(){},Km:v=>v,Gm:()=>({}),ah(){},oh(){},Vh:async()=>{},Bh:async()=>calls.push('detection'),zh(){},console,$:{documentStatus:{},placementCard:{classList:{remove(){}},scrollIntoView(){}},clearDocument:{}},window:{MCCDDeskew:{normalize:async({bytes})=>{if(mode==='error')throw Error('render failed');if(mode==='stale')Q.openSerial++;return {bytes:mode==='corrected'?new Uint8Array([4,5,6]):bytes,angles:[]};}}}};
 vm.runInNewContext(loader,sandbox);return {sandbox,Q,destroyed,documents,calls};
}
test('deskew replacement destroys loading task and opens corrected PDF',async()=>{const s=setup('corrected');await s.sandbox.$m(new Uint8Array([1,2,3]),'scan.pdf');assert.deepEqual(s.destroyed,[0]);assert.equal(s.Q.pdfjsDoc,s.documents[1]);assert.deepEqual([...s.Q.originalBytes],[4,5,6]);assert.deepEqual([...s.Q.sourceOriginalBytes],[1,2,3]);assert.deepEqual(s.calls,['detection']);});
test('straight PDF opens without premature destruction',async()=>{const s=setup('straight');await s.sandbox.$m(new Uint8Array([1]),'scan.pdf');assert.deepEqual(s.destroyed,[]);assert.equal(s.Q.pdfjsDoc,s.documents[0]);});
test('deskew render failure retains original error after cleanup',async()=>{const s=setup('error');await assert.rejects(s.sandbox.$m(new Uint8Array([1]),'scan.pdf'),/Deskew could not complete: render failed/);assert.deepEqual(s.destroyed,[0]);});
test('superseded PDF load is disposed without starting detection',async()=>{const s=setup('stale');await s.sandbox.$m(new Uint8Array([1]),'scan.pdf');assert.deepEqual(s.destroyed,[0]);assert.deepEqual(s.calls,[]);assert.equal(s.Q.pdfjsDoc,undefined);});
