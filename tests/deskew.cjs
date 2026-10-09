const test=require('node:test'),assert=require('node:assert/strict');
const deskew=require('../deskew-v0.8.5.js');
function form(angle,blank=false){
 const width=800,height=1000,data=new Uint8ClampedArray(width*height*4).fill(255),a=angle*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
 if(blank)return {width,height,data};
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const X=c*(x-width/2)+s*(y-height/2)+width/2,Y=-s*(x-width/2)+c*(y-height/2)+height/2;
  const horizontal=X>60&&X<740&&[80,220,400,580,750,920].some(v=>Math.abs(Y-v)<1.2);
  const vertical=Y>80&&Y<920&&[60,390,740].some(v=>Math.abs(X-v)<1.2);
  if(horizontal||vertical){const i=(y*width+x)*4;data[i]=data[i+1]=data[i+2]=0;}
 }
 return {width,height,data};
}
for(const angle of [-3.8,-1.3,-.5,.5,1.4,3.2])test(`detect ${angle} degree form skew`,()=>{
 const actual=deskew.estimate(form(angle));assert.ok(actual.reliable);assert.ok(Math.abs(actual.angle-angle)<.15,JSON.stringify(actual));
});
test('straight and blank pages do not receive spurious corrections',()=>{assert.equal(deskew.estimate(form(0)).angle,0);assert.equal(deskew.estimate(form(0,true)).angle,0);});
test('deskew transform contains every corner, across portrait and landscape pages',()=>{
 for(const [w,h] of [[595,842],[842,595]])for(const angle of [-4.8,-1.3,.5,4.8]){
  const p=deskew.placement(w,h,angle),a=angle*Math.PI/180;
  for(const [x,y] of [[0,0],[0,h],[w,0],[w,h]]){
   const X=p.x+p.scale*(Math.cos(a)*x-Math.sin(a)*y),Y=p.y+p.scale*(Math.sin(a)*x+Math.cos(a)*y);
   assert.ok(X>=-1e-8&&X<=w+1e-8);assert.ok(Y>=-1e-8&&Y<=h+1e-8);
  }
 }
});
test('folder archiving uses unchanged source bytes after deskew normalization',()=>{
 const fs=require('node:fs'),vm=require('node:vm');
 const s=fs.readFileSync('assets/app-v0.8.5.js','utf8');
 const api=s.slice(s.indexOf(';window.__MCCD_APP_API__='));
 const original=new Uint8Array([1,2,3]),normalized=new Uint8Array([4,5,6]);
 const sandbox={window:{},Q:{sourceOriginalBytes:original,originalBytes:normalized,sourceName:'test.pdf'},Bm:'0.8.5'};
 vm.runInNewContext(api,sandbox);
 assert.deepEqual([...sandbox.window.__MCCD_APP_API__.getDocument().originalBytes],[1,2,3]);
});
