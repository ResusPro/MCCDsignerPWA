const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function setup({edge=true,blocked=false}={}){
 const timers=[];const ctx={module:{exports:{}},navigator:{userAgent:edge?'Mozilla Edg/155.0':'Mozilla Chrome/155.0'},WebAssembly:{compile:async()=>{if(blocked)throw Error('blocked')}},Uint8Array,setTimeout:(fn,delay)=>{timers.push({fn,delay});return timers.length},clearTimeout:()=>{}};
 vm.runInNewContext(fs.readFileSync('browser-compat-v0.8.6.js','utf8'),ctx);return {api:ctx.module.exports,timers};
}
test('Edge receives longer OCR deadlines',()=>{const h=setup();assert.equal(h.api.budgets().load,120000);assert.equal(h.api.budgets().recognize,90000);assert.equal(setup({edge:false}).api.budgets().load,30000);});
test('blocked WebAssembly fails before spawning OCR',async()=>{let spawned=false;const h=setup({blocked:true});await assert.rejects(h.api.loadWorker(()=>{spawned=true},{},{}),/WebAssembly/);assert.equal(spawned,false);});
test('worker parameters complete before worker becomes reusable',async()=>{
 const h=setup();let configured=false;const worker={setParameters:async()=>{configured=true},terminate:async()=>{}};
 assert.equal(await h.api.loadWorker(async()=>worker,{},{}),worker);assert.equal(configured,true);
});
test('failed worker initialization disposes the worker',async()=>{
 const h=setup();let terminated=0;await assert.rejects(h.api.loadWorker(async()=>({setParameters:async()=>{throw Error('storage failed')},terminate:async()=>{terminated++}}),{},{}),/storage failed/);assert.equal(terminated,1);
});
test('worker resolving after timeout is disposed instead of reused',async()=>{
 const h=setup();let resolve,terminated=0;const pending=new Promise(r=>resolve=r);const result=h.api.loadWorker(()=>pending,{},{});
 for(let i=0;i<8;i++)await Promise.resolve();h.timers[0].fn();await assert.rejects(result,/timed out/);
 resolve({setParameters:async()=>{},terminate:async()=>{terminated++}});for(let i=0;i<8;i++)await Promise.resolve();assert.equal(terminated,1);
});
test('manual placement cancels detection and unlocks review controls',()=>{
 const s=fs.readFileSync('assets/app-v0.8.6.js','utf8');const fn=s.slice(s.indexOf('function manualPlacement(){'),s.indexOf('async function browserCheck(){'));
 let cleared=0;const ctx={Q:{detectionSerial:7},$:{runDetection:{},generateReview:{disabled:true}},clearOcrWorker:()=>cleared++,Jm:(el,v)=>el.disabled=v,th(){},eh(){},Ym(){}};
 vm.runInNewContext(fn+';manualPlacement()',ctx);assert.equal(ctx.Q.detectionSerial,8);assert.equal(ctx.$.generateReview.disabled,false);assert.equal(ctx.$.runDetection.disabled,false);assert.equal(cleared,1);
});
