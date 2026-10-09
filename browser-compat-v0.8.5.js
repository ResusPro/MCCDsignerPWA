(function(root){
'use strict';
function isEdge(){return /Edg\//.test(navigator.userAgent);}
function budgets(){return isEdge()?{load:120000,recognize:90000}:{load:30000,recognize:30000};}
async function checkWasm(){
  if(typeof WebAssembly==='undefined')throw new Error('WebAssembly is unavailable in this browser. Automatic OCR cannot run; use manual placement.');
  try{await WebAssembly.compile(new Uint8Array([0,97,115,109,1,0,0,0]));}
  catch(e){throw new Error('This browser could not run WebAssembly. Automatic OCR cannot run; use manual placement.');}
}
async function loadWorker(create,options,parameters){
  await checkWasm();
  var active=true,worker=null,timer;
  var pending=Promise.resolve().then(function(){return create(options);});
  var timeout=new Promise(function(resolve,reject){timer=setTimeout(function(){active=false;reject(new Error('Local OCR engine loading timed out. Use manual placement or run Check browser.'));},budgets().load);});
  // A worker resolving after the deadline must not remain alive or be reused.
  var initialization=pending.then(async function(w){
    worker=w;if(!active){await w.terminate();throw new Error('OCR initialization was cancelled.');}
    await w.setParameters(parameters);
    if(!active){await w.terminate();throw new Error('OCR initialization was cancelled.');}
    return w;
  });
  try{return await Promise.race([initialization,timeout]);}
  catch(e){active=false;if(worker)await worker.terminate().catch(function(){});throw e;}
  finally{clearTimeout(timer);}
}
var api={isEdge:isEdge,budgets:budgets,checkWasm:checkWasm,loadWorker:loadWorker};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.MCCDBrowser=api;
})(typeof window!=='undefined'?window:globalThis);
