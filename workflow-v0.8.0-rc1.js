
(function(){
"use strict";
var VERSION="0.8.0-rc1";
var DB_NAME="mccdsigner-local-v1";
var STORE="kv";
var state={folders:{incoming:null,signed:null,archive:null},source:null,files:[],db:null};

function byId(id){return document.getElementById(id);}
function setStatus(id,text,tone){var el=byId(id);if(!el)return;el.textContent=text||"";el.dataset.tone=tone||"";}
function openDb(){
  if(state.db)return Promise.resolve(state.db);
  return new Promise(function(resolve,reject){
    var req=indexedDB.open(DB_NAME,1);
    req.onupgradeneeded=function(){if(!req.result.objectStoreNames.contains(STORE))req.result.createObjectStore(STORE);};
    req.onsuccess=function(){state.db=req.result;resolve(state.db);};
    req.onerror=function(){reject(req.error);};
  });
}
async function getValue(key){
  var db=await openDb();
  return await new Promise(function(resolve,reject){
    var req=db.transaction(STORE,"readonly").objectStore(STORE).get(key);
    req.onsuccess=function(){resolve(req.result);};
    req.onerror=function(){reject(req.error);};
  });
}
async function setValue(key,value){
  var db=await openDb();
  await new Promise(function(resolve,reject){
    var tx=db.transaction(STORE,"readwrite");
    tx.objectStore(STORE).put(value,key);
    tx.oncomplete=function(){resolve();};
    tx.onerror=function(){reject(tx.error);};
  });
}
async function deleteValue(key){
  var db=await openDb();
  await new Promise(function(resolve,reject){
    var tx=db.transaction(STORE,"readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete=function(){resolve();};
    tx.onerror=function(){reject(tx.error);};
  });
}
function bytesToDataUrl(bytes,mime){
  var binary="",chunk=32768;
  for(var i=0;i<bytes.length;i+=chunk)binary+=String.fromCharCode.apply(null,bytes.subarray(i,i+chunk));
  return "data:"+(mime||"image/png")+";base64,"+btoa(binary);
}
function dataUrlToBytes(value){
  var m=/^data:([^;,]+)?(;base64)?,(.*)$/s.exec(String(value||""));
  if(!m)throw new Error("Invalid embedded signature data.");
  var mime=m[1]||"image/png";
  var raw=m[2]?atob(m[3]):decodeURIComponent(m[3]);
  var bytes=new Uint8Array(raw.length);
  for(var i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i)&255;
  return {bytes:bytes,mime:mime};
}
function base64ToBytes(value){
  var raw=atob(String(value||"").replace(/\s+/g,""));
  var bytes=new Uint8Array(raw.length);
  for(var i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i)&255;
  return bytes;
}
function pick(obj,keys){
  for(var i=0;i<keys.length;i++){
    var value=obj,parts=keys[i].split(".");
    for(var j=0;j<parts.length;j++)value=value&&value[parts[j]];
    if(value!==undefined&&value!==null&&String(value).trim()!=="")return value;
  }
  return null;
}
async function saveProfile(){
  var p=window.__MCCD_APP_API__.getProfile();
  await setValue("profile",{
    full_name:p.full_name,
    qualifications:p.qualifications,
    gmc_number:p.gmc_number,
    signature_mime:p.signature_mime,
    signature_bytes:p.signature_bytes?p.signature_bytes.buffer:null
  });
  setStatus("wfProfileStatus","Profile and signature saved locally in this browser.","ok");
}
async function restoreProfile(){
  var p=await getValue("profile");
  if(!p){setStatus("wfProfileStatus","No saved browser profile yet. Import settings JSON or enter details above.","");return;}
  await window.__MCCD_APP_API__.setProfile({
    full_name:p.full_name||"",
    qualifications:p.qualifications||"",
    gmc_number:p.gmc_number||"",
    signature_mime:p.signature_mime||"image/png",
    signature_bytes:p.signature_bytes?new Uint8Array(p.signature_bytes):null
  });
  setStatus("wfProfileStatus","Saved local profile loaded"+(p.full_name?": "+p.full_name:"")+".","ok");
}
async function importSettings(file){
  var text=(await file.text()).replace(/^\uFEFF/,"");
  var raw=JSON.parse(text);
  var root=raw.user_settings||raw.profile||raw.settings||raw;
  var p={
    full_name:pick(root,["full_name","clinician_name","name","doctor_name"]),
    qualifications:pick(root,["qualifications","credentials","postnominals","post_nominals"]),
    gmc_number:pick(root,["gmc_number","gmc","gmcNumber","registration_number"])
  };
  var dataUrl=pick(root,["signature_data_url","signatureDataUrl","signature.data_url","signature.dataUrl"]);
  var base64=pick(root,["signature_base64","signatureBase64","signature.base64"]);
  var mime=pick(root,["signature_mime","signatureMime","signature.mime"])||"image/png";
  var signatureRef=pick(root,["signature_file","signature_path","signatureFile","signaturePath"]);
  if(dataUrl){
    var decoded=dataUrlToBytes(dataUrl);p.signature_bytes=decoded.bytes;p.signature_mime=decoded.mime;
  }else if(base64){
    p.signature_bytes=base64ToBytes(base64);p.signature_mime=String(mime);
  }
  await window.__MCCD_APP_API__.setProfile(p);
  await saveProfile();
  if(p.signature_bytes){
    setStatus("wfProfileStatus","Imported "+file.name+": name, qualifications, GMC and embedded signature loaded.","ok");
  }else if(signatureRef){
    setStatus("wfProfileStatus","Imported "+file.name+". The desktop JSON refers to "+signatureRef+". A browser cannot open that Windows path automatically; choose the signature image once and it will be remembered.","warning");
  }else{
    setStatus("wfProfileStatus","Imported "+file.name+". Choose the signature image once if it was not embedded.","warning");
  }
}
async function importSignature(file){
  if(!file)return;
  if(file.type!=="image/png")throw new Error("For final output, use a transparent PNG signature. JPEG signatures have an opaque background and can cover certificate text.");
  var p=window.__MCCD_APP_API__.getProfile();
  p.signature_bytes=new Uint8Array(await file.arrayBuffer());
  p.signature_mime=file.type;
  await window.__MCCD_APP_API__.setProfile(p);
  await saveProfile();
  setStatus("wfProfileStatus","Signature loaded from "+file.name+" and saved locally.","ok");
}
async function forgetProfile(){
  await deleteValue("profile");
  await window.__MCCD_APP_API__.setProfile({full_name:"",qualifications:"",gmc_number:""});
  await window.__MCCD_APP_API__.loadDummySignature();
  setStatus("wfProfileStatus","Saved local profile removed. Signer details cleared; a signature must be selected before signing.","warning");
}
function exportProfile(){
  var p=window.__MCCD_APP_API__.getProfile();
  var obj={
    format:"MCCDSigner web settings v1",
    full_name:p.full_name,
    qualifications:p.qualifications,
    gmc_number:p.gmc_number,
    signature_mime:p.signature_mime,
    signature_data_url:p.signature_bytes?bytesToDataUrl(p.signature_bytes,p.signature_mime):null
  };
  var blob=new Blob([JSON.stringify(obj,null,2)],{type:"application/json"});
  var url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download="MCCDSigner_web_settings.json";document.body.append(a);a.click();a.remove();
  setTimeout(function(){URL.revokeObjectURL(url);},10000);
}
async function permission(handle,requestIt){
  if(!handle)return false;
  if(typeof handle.queryPermission!=="function")return true;
  var result=await handle.queryPermission({mode:"readwrite"});
  if(result==="granted")return true;
  if(requestIt&&typeof handle.requestPermission==="function"){
    result=await handle.requestPermission({mode:"readwrite"});
    return result==="granted";
  }
  return false;
}
function folderStatus(){
  ["incoming","signed","archive"].forEach(function(kind){
    var handle=state.folders[kind];
    var id="wf"+kind.charAt(0).toUpperCase()+kind.slice(1)+"Folder";
    setStatus(id,handle?handle.name:"Not selected","");
  });
  var ready=state.folders.incoming&&state.folders.signed&&state.folders.archive;
  setStatus("wfFolderStatus",ready?"All three folders remembered locally. Permission may need renewing after a browser restart.":"Choose Incoming, Signed and Archive once. Folder handles are stored locally in this browser.",ready?"ok":"");
}
async function chooseFolder(kind){
  if(!window.showDirectoryPicker)throw new Error("Remembered folder workflow requires desktop Edge/Chrome. Use the normal Choose PDF workflow on this browser.");
  var handle=await window.showDirectoryPicker({id:"mccdsigner-"+kind,mode:"readwrite"});
  state.folders[kind]=handle;
  try{await setValue("folder:"+kind,handle);}catch(e){console.warn(e);}
  folderStatus();
  if(kind==="incoming")await refreshIncoming();
}
async function restoreFolders(){
  for(var i=0;i<3;i++){
    var kind=["incoming","signed","archive"][i];
    try{state.folders[kind]=await getValue("folder:"+kind)||null;}catch(e){}
  }
  folderStatus();
  if(state.folders.incoming&&await permission(state.folders.incoming,false))await refreshIncoming();
}
async function reconnectFolders(){
  var missing=[];
  for(var i=0;i<3;i++){
    var kind=["incoming","signed","archive"][i],h=state.folders[kind];
    if(!h||!(await permission(h,true)))missing.push(kind);
  }
  if(missing.length)setStatus("wfFolderStatus","Permission still needed for: "+missing.join(", ")+". Re-select if necessary.","warning");
  else{setStatus("wfFolderStatus","Folder permissions active.","ok");await refreshIncoming();}
}
async function refreshIncoming(){
  var select=byId("wfPdfSelect"),dir=state.folders.incoming;
  if(!select)return;
  state.files=[];
  if(!dir){select.innerHTML='<option value="">Choose Incoming folder first</option>';return;}
  if(!(await permission(dir,false))){
    select.innerHTML='<option value="">Incoming permission required</option>';
    setStatus("wfIncomingStatus","Click Reconnect saved folders.","warning");return;
  }
  for await(var entry of dir.entries()){
    var name=entry[0],handle=entry[1];
    if(handle.kind!=="file"||!/\.pdf$/i.test(name))continue;
    try{
      var file=await handle.getFile();
      state.files.push({name:name,handle:handle,lastModified:file.lastModified,size:file.size});
    }catch(e){}
  }
  state.files.sort(function(a,b){return b.lastModified-a.lastModified||a.name.localeCompare(b.name,"en-GB",{numeric:true});});
  select.innerHTML="";
  if(!state.files.length){select.innerHTML='<option value="">No PDFs found</option>';setStatus("wfIncomingStatus","No PDFs currently in Incoming.","");return;}
  state.files.forEach(function(item,index){
    var option=document.createElement("option");
    option.value=String(index);
    option.textContent=item.name+" — "+new Date(item.lastModified).toLocaleString("en-GB");
    select.append(option);
  });
  setStatus("wfIncomingStatus",state.files.length+" PDF"+(state.files.length===1?"":"s")+" available; newest first.","ok");
}
async function openSelected(){
  var select=byId("wfPdfSelect");
  if(!select||select.value==="")throw new Error("Select an MCCD from Incoming first.");
  var item=state.files[Number(select.value)];
  if(!item)throw new Error("Selected file is no longer available.");
  if(!(await permission(state.folders.incoming,true)))throw new Error("Incoming folder permission was not granted.");
  var file=await item.handle.getFile();
  state.source={name:item.name,handle:item.handle};
  setStatus("wfIncomingStatus","Opening "+item.name+"…","");
  await window.__MCCD_APP_API__.openPdf(await file.arrayBuffer(),item.name);
  setStatus("wfIncomingStatus",item.name+" loaded from Incoming. Review the automatic detection before generating the review PDF.","ok");
}
async function exists(dir,name){
  try{await dir.getFileHandle(name);return true;}catch(e){if(e&&e.name==="NotFoundError")return false;throw e;}
}
async function availableName(dir,preferred){
  if(!(await exists(dir,preferred)))return preferred;
  var m=/^(.*?)(\.pdf)$/i.exec(preferred),stem=m?m[1]:preferred,ext=m?m[2]:"";
  for(var n=2;n<1000;n++){var candidate=stem+" ("+n+")"+ext;if(!(await exists(dir,candidate)))return candidate;}
  throw new Error("Could not find an available filename.");
}
async function sha256(bytes){
  var arr=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
  var d=await crypto.subtle.digest("SHA-256",arr);
  return Array.from(new Uint8Array(d)).map(function(b){return b.toString(16).padStart(2,"0");}).join("");
}
async function writeVerify(dir,name,bytes){
  var handle=await dir.getFileHandle(name,{create:true});
  var writable=await handle.createWritable();
  await writable.write(bytes);await writable.close();
  var file=await handle.getFile();
  if(file.size!==bytes.byteLength)throw new Error("Verification failed for "+name+": size mismatch.");
  var readback=new Uint8Array(await file.arrayBuffer());
  var hashes=await Promise.all([sha256(bytes),sha256(readback)]);
  if(hashes[0]!==hashes[1])throw new Error("Verification failed for "+name+": checksum mismatch.");
}
async function approveWorkflow(){
  if(!state.source)return await window.__MCCD_APP_API__.fallbackApprove();
  var doc=window.__MCCD_APP_API__.getDocument();
  if(!doc.reviewBytes)throw new Error("Generate and review the signed PDF before approval.");
  var incoming=state.folders.incoming,signed=state.folders.signed,archive=state.folders.archive;
  if(!incoming||!signed||!archive)throw new Error("Incoming, Signed and Archive folders must all be selected.");
  if(!(await permission(incoming,true))||!(await permission(signed,true))||!(await permission(archive,true)))throw new Error("Folder permission was not granted.");
  var signedName=await availableName(signed,doc.reviewFileName||state.source.name.replace(/\.pdf$/i,"")+"-signed.pdf");
  setStatus("wfTransactionStatus","Writing and verifying signed PDF…","");
  await writeVerify(signed,signedName,doc.reviewBytes);
  var archiveName=await availableName(archive,state.source.name);
  setStatus("wfTransactionStatus","Signed PDF verified. Archiving and verifying original…","");
  await writeVerify(archive,archiveName,doc.originalBytes);
  setStatus("wfTransactionStatus","Both destination files verified. Removing original from Incoming…","");
  await incoming.removeEntry(state.source.name);
  try{await incoming.getFileHandle(state.source.name);throw new Error("Original still present in Incoming after remove.");}catch(e){if(e&&e.name!=="NotFoundError")throw e;}
  var sourceName=state.source.name;state.source=null;
  setStatus("wfTransactionStatus","Complete: "+signedName+" saved; original archived as "+archiveName+"; "+sourceName+" removed from Incoming.","ok");
  await window.__MCCD_APP_API__.clear();
  await refreshIncoming();
}
function installUi(){
  if(byId("mccdWorkflowCard"))return;
  var privacy=document.querySelector(".privacy-card");
  if(!privacy)return;
  privacy.insertAdjacentHTML("afterend",
    '<section id="mccdWorkflowCard" class="card mccd-workflow-card">'+
    '<div class="section-heading"><div><span class="step">W</span><h2>Local workflow</h2></div><p>Optional desktop workflow for locally-synced OneDrive folders. No Microsoft cloud API is used.</p></div>'+
    '<div class="wf-columns">'+
    '<div class="wf-panel"><h3>Clinician settings</h3><p>Loads desktop JSON fields such as <code>full_name</code>, <code>qualifications</code>, <code>gmc_number</code> and compatible aliases.</p>'+
    '<div class="button-row wrap"><label class="file-button secondary">Load settings JSON<input id="wfSettingsFile" type="file" accept="application/json,.json"></label>'+
    '<label class="file-button secondary">Choose transparent signature PNG<input id="wfSignatureFile" type="file" accept="image/png"></label>'+
    '<button id="wfSaveProfile" class="secondary compact" type="button">Save current profile</button>'+
    '<button id="wfExportProfile" class="secondary compact" type="button">Export web settings JSON</button>'+
    '<button id="wfForgetProfile" class="ghost compact" type="button">Forget local profile</button></div>'+
    '<p id="wfProfileStatus" class="help-text">Checking saved profile…</p></div>'+
    '<div id="wfDesktopFolderPanel" class="wf-panel"><h3>OneDrive-synced folders</h3>'+
    '<div class="wf-folder-grid"><button id="wfChooseIncoming" class="secondary compact">Choose Incoming</button><span id="wfIncomingFolder">Not selected</span>'+
    '<button id="wfChooseSigned" class="secondary compact">Choose Signed</button><span id="wfSignedFolder">Not selected</span>'+
    '<button id="wfChooseArchive" class="secondary compact">Choose Archive</button><span id="wfArchiveFolder">Not selected</span></div>'+
    '<div class="button-row wrap"><button id="wfReconnect" class="secondary compact">Reconnect saved folders</button></div>'+
    '<p id="wfFolderStatus" class="help-text">Checking remembered folders…</p></div></div>'+
    '<div id="wfMobilePanel" class="wf-panel hidden"><h3>Phone / Android workflow</h3><p>Android does not allow a PWA to adopt the whole Downloads folder. Use <strong>Choose PDF</strong> in step 2 below to open the individual MCCD, then after review use <strong>Approve / Share</strong> to save the signed PDF back to OneDrive.</p></div><div class="wf-incoming"><h3>Incoming MCCD</h3><div class="wf-open-row"><select id="wfPdfSelect"><option value="">Choose Incoming folder first</option></select>'+
    '<button id="wfRefreshIncoming" class="secondary compact">Refresh</button><button id="wfOpenSelected" class="primary compact">Open selected MCCD</button></div>'+
    '<p id="wfIncomingStatus" class="help-text">The standard Choose PDF control remains available for phone or unfamiliar-machine use.</p>'+
    '<p id="wfTransactionStatus" class="help-text"></p></div></section>'
  );
  byId("wfSettingsFile").addEventListener("change",async function(e){var f=e.target.files&&e.target.files[0];if(!f)return;try{await importSettings(f);}catch(err){setStatus("wfProfileStatus","Could not import settings: "+err.message,"error");}e.target.value="";});
  byId("wfSignatureFile").addEventListener("change",async function(e){var f=e.target.files&&e.target.files[0];if(!f)return;try{await importSignature(f);}catch(err){setStatus("wfProfileStatus",err.message,"error");}e.target.value="";});
  byId("wfSaveProfile").addEventListener("click",function(){saveProfile().catch(function(e){setStatus("wfProfileStatus",e.message,"error");});});
  byId("wfExportProfile").addEventListener("click",exportProfile);
  byId("wfForgetProfile").addEventListener("click",function(){forgetProfile().catch(function(e){setStatus("wfProfileStatus",e.message,"error");});});
  byId("wfChooseIncoming").addEventListener("click",function(){chooseFolder("incoming").catch(function(e){setStatus("wfFolderStatus",e.message,"error");});});
  byId("wfChooseSigned").addEventListener("click",function(){chooseFolder("signed").catch(function(e){setStatus("wfFolderStatus",e.message,"error");});});
  byId("wfChooseArchive").addEventListener("click",function(){chooseFolder("archive").catch(function(e){setStatus("wfFolderStatus",e.message,"error");});});
  byId("wfReconnect").addEventListener("click",function(){reconnectFolders().catch(function(e){setStatus("wfFolderStatus",e.message,"error");});});
  byId("wfRefreshIncoming").addEventListener("click",function(){refreshIncoming().catch(function(e){setStatus("wfIncomingStatus",e.message,"error");});});
  byId("wfOpenSelected").addEventListener("click",function(){openSelected().catch(function(e){setStatus("wfIncomingStatus",e.message,"error");});});
  document.querySelector("#pdfFile").addEventListener("change",function(){state.source=null;setStatus("wfTransactionStatus","","");});
}
window.__MCCD_WORKFLOW_APPROVE__=function(){return approveWorkflow().catch(function(e){setStatus("wfTransactionStatus","Workflow stopped safely: "+e.message+" The original is not removed unless both destination copies verify first.","error");alert("Folder workflow could not complete:\n\n"+e.message);});};
window.__MCCD_WORKFLOW_INIT__=async function(){
  installUi();
  var mobile=/Android/i.test(navigator.userAgent)||!window.showDirectoryPicker;
  if(mobile){
    var desktopPanel=byId("wfDesktopFolderPanel");
    var mobilePanel=byId("wfMobilePanel");
    if(desktopPanel)desktopPanel.classList.add("hidden");
    if(mobilePanel)mobilePanel.classList.remove("hidden");
    var incomingBlock=byId("wfPdfSelect")&&byId("wfPdfSelect").closest(".wf-incoming");
    if(incomingBlock)incomingBlock.classList.add("hidden");
  }
  await Promise.allSettled([restoreProfile(),mobile?Promise.resolve():restoreFolders()]);
};
if(window.__MCCD_APP_API__) {
  queueMicrotask(function(){ window.__MCCD_WORKFLOW_INIT__().catch(function(e){ console.error(e); }); });
}
})();