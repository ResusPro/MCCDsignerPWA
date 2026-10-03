(function(root){
'use strict';
// Estimate the common angle of long printed form borders, rather than handwriting.
function estimate(image){
  var w=image.width,h=image.height,data=image.data,mask=new Uint8Array(w*h),horizontal=[],vertical=[];
  for(var i=0;i<mask.length;i++)mask[i]=data[i*4]*.2126+data[i*4+1]*.7152+data[i*4+2]*.0722<150?1:0;
  for(var y=3;y<h-3;y+=2)for(var x=3;x<w-3;x+=2){
    var p=y*w+x;if(!mask[p])continue;
    if(mask[p-2]&&mask[p+2]&&(!mask[p-2*w]||!mask[p+2*w]))horizontal.push(x,y);
    if(mask[p-2*w]&&mask[p+2*w]&&(!mask[p-2]||!mask[p+2]))vertical.push(x,y);
  }
  function evaluate(angle){
    var tangent=Math.tan(angle*Math.PI/180),offset=Math.ceil(Math.max(w,h)*.1)+8;
    function votes(points,size,isVertical){
      var bins=new Uint16Array(size+2*offset),peaks=[];
      for(var i=0;i<points.length;i+=2){
        var x=points[i],y=points[i+1],v=Math.round((isVertical?x+y*tangent:y-x*tangent)+offset);
        if(v>=0&&v<bins.length)bins[v]++;
      }
      // Merge adjacent bins to tolerate anti-aliased borders.
      for(var i=1;i<bins.length-1;i++){
        var count=bins[i-1]+bins[i]+bins[i+1];
        if(count>Math.max(w,h)*.12)peaks.push({position:i,count:count});
      }
      peaks.sort(function(a,b){return b.count-a.count;});
      var selected=[];
      peaks.forEach(function(p){if(selected.length<8&&!selected.some(function(q){return Math.abs(q.position-p.position)<8;}))selected.push(p);});
      return {score:selected.reduce(function(s,p){return s+p.count*p.count;},0),lines:selected.length};
    }
    var a=votes(horizontal,h,false),b=votes(vertical,w,true);
    return {angle:angle,score:a.score+b.score,lines:a.lines+b.lines};
  }
  var zero=evaluate(0),best=zero;
  for(var angle=-5;angle<=5.001;angle+=.1){var r=evaluate(angle);if(r.score>best.score)best=r;}
  var centre=best.angle;
  for(var angle=centre-.1;angle<=centre+.101;angle+=.02){var r=evaluate(angle);if(r.score>best.score)best=r;}
  var reliable=best.lines>=3&&best.score>zero.score*1.12&&Math.abs(best.angle)>=.15&&Math.abs(best.angle)<4.9;
  return {angle:reliable?Math.round(best.angle*100)/100:0,measuredAngle:Math.round(best.angle*100)/100,lines:best.lines,reliable:reliable};
}
function placement(width,height,angle){
  var radians=angle*Math.PI/180,c=Math.cos(radians),s=Math.sin(radians);
  var scale=Math.min(width/(Math.abs(c)*width+Math.abs(s)*height),height/(Math.abs(s)*width+Math.abs(c)*height));
  return {x:width/2-scale*(c*width-s*height)/2,y:height/2-scale*(s*width+c*height)/2,scale:scale};
}
async function normalize(options){
  var angles=[];
  for(var i=0;i<options.pdfjsDoc.numPages;i++){
    if(options.onProgress)options.onProgress(i,options.pdfjsDoc.numPages);
    var page=await options.pdfjsDoc.getPage(i+1),base=page.getViewport({scale:1}),viewport=page.getViewport({scale:1000/Math.max(base.width,base.height)});
    var canvas=options.createCanvas?options.createCanvas():document.createElement('canvas');
    canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
    var context=canvas.getContext('2d',{alpha:false,willReadFrequently:true});
    await page.render({canvasContext:context,viewport:viewport}).promise;
    angles.push(estimate(context.getImageData(0,0,canvas.width,canvas.height)));
    canvas.width=canvas.height=1;
  }
  if(!angles.some(function(a){return a.angle;}))return {bytes:options.bytes,angles:angles};
  var source=await options.PDFDocument.load(options.bytes),output=await options.PDFDocument.create();
  for(var i=0;i<source.getPageCount();i++){
    var original=source.getPage(i),angle=angles[i].angle;
    if(!angle){var copy=await output.copyPages(source,[i]);output.addPage(copy[0]);continue;}
    // Reuse the PDF page as a vector form: no raster re-encoding or scan-quality loss.
    var embedded=await output.embedPage(original),width=embedded.width,height=embedded.height;
    var corrected=output.addPage([width,height]),p=placement(width,height,angle);
    corrected.setRotation(options.degrees(original.getRotation().angle));
    corrected.drawPage(embedded,{x:p.x,y:p.y,xScale:p.scale,yScale:p.scale,rotate:options.degrees(angle)});
  }
  return {bytes:new Uint8Array(await output.save({useObjectStreams:false})),angles:angles};
}
var api={estimate:estimate,placement:placement,normalize:normalize};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
else root.MCCDDeskew=api;
})(typeof window!=='undefined'?window:globalThis);
