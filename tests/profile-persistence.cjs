const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('workflow-v0.8.4.js','utf8');
function harness({backup=null,idb=null,file=null,failIdb=false,delayFile=0}={}){
 const local=new Map(),writes=[],events={},fields={};
 if(backup)local.set('mccdsigner-profile-backup-v2',JSON.stringify(backup));
 let profile={full_name:'',qualifications:'',gmc_number:'',signature_bytes:null};
 const api={getProfile:()=>profile,setProfile:async p=>{profile=p},loadDummySignature:async()=>{profile.signature_bytes=null}};
 const window={addEventListener:(name,fn)=>events[name]=fn,__MCCD_APP_API__:null};
 const sandbox={window,document:{getElementById:id=>fields[id]||null,addEventListener:(name,fn)=>events[name]=fn},navigator:{storage:{}},localStorage:{getItem:k=>local.get(k)||null,setItem:(k,v)=>local.set(k,v),removeItem:k=>local.delete(k)},console:{warn(){}},setTimeout,clearTimeout,Uint8Array,ArrayBuffer,Date,Promise,btoa:s=>Buffer.from(s,'binary').toString('base64'),atob:s=>Buffer.from(s,'base64').toString('binary')};
 const hooks=`window.test={restoreProfile,saveProfile,checkpointProfile,scheduleProfileSave,forgetProfile};
 getValue=async()=>{if(${failIdb})throw new Error('IDB unavailable');return window.idb};
 setValue=async(k,p)=>{if(${failIdb})throw new Error('IDB unavailable');window.writes.push(['idb',p.full_name]);window.idb=p};
 deleteValue=async()=>{window.idb=null};
 readProfileFile=async()=>window.file;
 writeProfileFile=async p=>{await new Promise(r=>setTimeout(r,${delayFile}));window.writes.push(['file',p.full_name]);window.file=p;return true};
 deleteProfileFile=async()=>{window.file=null};`;
 vm.runInNewContext(source.replace(/\}\)\(\);\s*$/,hooks+'})();'),sandbox);
 Object.assign(window,{__MCCD_APP_API__:api,idb,file,writes});
 return {window,local,events,fields,get profile(){return profile},set profile(p){profile=p},api:window.test};
}
const saved=(name,time)=>({full_name:name,qualifications:'MBBS',gmc_number:'1234567',file_initials:'TU',signature_data_url:'data:image/png;base64,AQID',saved_at:time});
test('backgrounding before restoration never overwrites existing profile',async()=>{
 const h=harness({idb:saved('Existing signer','2026-10-01T12:00:00Z')});
 h.events.pagehide();await new Promise(r=>setTimeout(r,5));assert.equal(h.window.writes.length,0);
 await h.api.restoreProfile();assert.equal(h.profile.full_name,'Existing signer');assert.deepEqual([...h.profile.signature_bytes],[1,2,3]);
});
test('latest saved copy wins over a stale local JSON file',async()=>{
 const h=harness({backup:saved('Newest','2026-10-02T12:00:00Z'),idb:saved('Older','2026-10-01T12:00:00Z'),file:saved('Stale','2026-09-30T12:00:00Z')});
 await h.api.restoreProfile();assert.equal(h.profile.full_name,'Newest');
});
test('input creates immediate backup before asynchronous saves or process exit',async()=>{
 const h=harness();await h.api.restoreProfile();h.profile={full_name:'Typed signer',qualifications:'MBBS',gmc_number:'1234567',signature_bytes:new Uint8Array([4,5,6])};
 h.api.scheduleProfileSave();assert.equal(JSON.parse([...h.local.values()][0]).full_name,'Typed signer');
 h.events.pagehide();await new Promise(r=>setTimeout(r,5));assert.equal(h.window.file.full_name,'Typed signer');
 const reopened=harness({backup:JSON.parse([...h.local.values()][0])});await reopened.api.restoreProfile();assert.equal(reopened.profile.full_name,'Typed signer');assert.deepEqual([...reopened.profile.signature_bytes],[4,5,6]);
});
test('IDB failure still saves and restores using independent storage',async()=>{
 const h=harness({failIdb:true});await h.api.restoreProfile();h.profile={full_name:'Fallback signer',signature_bytes:new Uint8Array([1])};await h.api.saveProfile();
 assert.equal(h.window.file.full_name,'Fallback signer');
 const reopened=harness({failIdb:true,file:h.window.file});await reopened.api.restoreProfile();assert.equal(reopened.profile.full_name,'Fallback signer');
});
test('concurrent saves finish in order and Forget removes every backup',async()=>{
 const h=harness({delayFile:10});await h.api.restoreProfile();h.profile={full_name:'First'};const first=h.api.saveProfile();h.profile={full_name:'Second'};const second=h.api.saveProfile();await Promise.all([first,second]);assert.equal(h.window.file.full_name,'Second');
 await h.api.forgetProfile();assert.equal(h.window.file,null);assert.equal(h.window.idb,null);assert.equal(h.local.size,0);h.events.pagehide();await new Promise(r=>setTimeout(r,5));assert.equal(h.local.size,0);
});
test('legacy IndexedDB signatures and corrupt JSON recover correctly',async()=>{
 const h=harness({idb:{full_name:'Legacy',signature_bytes:new Uint8Array([7,8]).buffer},file:{full_name:'Broken',signature_data_url:'invalid',saved_at:'2026-10-02'}});
 await h.api.restoreProfile();assert.equal(h.profile.full_name,'Legacy');assert.deepEqual([...h.profile.signature_bytes],[7,8]);
});
