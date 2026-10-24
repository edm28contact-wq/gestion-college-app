(function(root){
"use strict";
// Local image enhancement for scanned invoice OCR. Never changes the original PDF.
// This module is deliberately dependency-free: it works with HTML Canvas and PDF.js.
const MAX_PIXELS=6500000;
function bound(n,lo,hi){return Math.max(lo,Math.min(hi,n))}
function gray(r,g,b){return (77*r+150*g+29*b)>>8}
function estimateSkew(canvas){
 const width=Math.min(640,canvas.width),height=Math.max(1,Math.round(canvas.height*width/canvas.width));
 if(height>1700||width<80||height<100)return {angle:0,confidence:0};
 const sample=document.createElement("canvas");sample.width=width;sample.height=height;
 const ctx=sample.getContext("2d",{willReadFrequently:true});
 if(!ctx)return {angle:0,confidence:0};
 ctx.fillStyle="#fff";ctx.fillRect(0,0,width,height);ctx.drawImage(canvas,0,0,width,height);
 const data=ctx.getImageData(0,0,width,height).data;
 const points=[],step=3,padX=Math.max(8,Math.floor(width*.04)),padY=Math.max(8,Math.floor(height*.04));
 for(let y=padY;y<height-padY;y+=step){
  for(let x=padX;x<width-padX;x+=step){
   const i=(y*width+x)*4;
   if(gray(data[i],data[i+1],data[i+2])<145)points.push(x-width/2,y-height/2);
  }
 }
 sample.width=0;sample.height=0;
 if(points.length<200||points.length>120000)return {angle:0,confidence:0};
 // Horizontal projection is strongest when table rules and text baselines are level.
 const angles=[-2.5,-2,-1.5,-1,-.5,0,.5,1,1.5,2,2.5];
 let best={angle:0,score:0},zero=0;
 for(const angle of angles){
  const radians=angle*Math.PI/180,cos=Math.cos(radians),sin=Math.sin(radians);
  const bin=new Uint16Array(height+60);let score=0;
  for(let i=0;i<points.length;i+=2){
   const y=Math.round(points[i+1]*cos+points[i]*sin+height/2+30);
   if(y>=0&&y<bin.length)bin[y]++;
  }
  for(let i=0;i<bin.length;i++)score+=bin[i]*bin[i];
  if(angle===0)zero=score;
  if(score>best.score)best={angle,score};
 }
 const confidence=zero>0?best.score/zero-1:0;
 return {angle:best.angle!==0&&confidence>=.20?best.angle:0,confidence};
}
function deskew(canvas){
 const skew=estimateSkew(canvas);
 if(!skew.angle)return {canvas,angle:0,rotated:false};
 const angle=skew.angle*Math.PI/180,w=canvas.width,h=canvas.height;
 const nw=Math.ceil(Math.abs(w*Math.cos(angle))+Math.abs(h*Math.sin(angle)));
 const nh=Math.ceil(Math.abs(w*Math.sin(angle))+Math.abs(h*Math.cos(angle)));
 if(nw*nh>MAX_PIXELS*1.08)return {canvas,angle:0,rotated:false};
 const rotated=document.createElement("canvas");rotated.width=nw;rotated.height=nh;
 const ctx=rotated.getContext("2d");
 if(!ctx)return {canvas,angle:0,rotated:false};
 ctx.fillStyle="white";ctx.fillRect(0,0,nw,nh);
 ctx.translate(nw/2,nh/2);ctx.rotate(angle);
 ctx.drawImage(canvas,-w/2,-h/2);
 return {canvas:rotated,angle:skew.angle,rotated:true};
}
function improveContrast(canvas){
 const width=canvas.width,height=canvas.height,pixels=width*height;
 if(pixels<1||pixels>MAX_PIXELS*1.1)throw Error("Dimensions de la page non prises en charge");
 const ctx=canvas.getContext("2d",{willReadFrequently:true});
 if(!ctx)throw Error("Traitement d'image Canvas indisponible");
 const image=ctx.getImageData(0,0,width,height),src=image.data;
 const values=new Uint8Array(pixels),stride=width+1;
 const integral=new Uint32Array(stride*(height+1));
 let low=255,high=0;
 // Downsampling for statistics is enough; preserve all pixels for the actual enhancement.
 for(let y=0;y<height;y++){
  let running=0;const row=y*width,ir=y*stride,next=(y+1)*stride;
  for(let x=0;x<width;x++){
   const p=row+x,i=p*4,v=gray(src[i],src[i+1],src[i+2]);values[p]=v;
   running+=v;integral[next+x+1]=integral[ir+x+1]+running;
   if((x&15)===0&&(y&7)===0){low=Math.min(low,v);high=Math.max(high,v)}
  }
 }
 const radius=bound(Math.round(Math.min(width,height)/45),14,44),normalized=new Uint8Array(pixels);
 const strength=high-low<35?1.3:1.85;
 // Background normalization compensates shadows and grey paper without deleting thin characters.
 for(let y=0;y<height;y++){
  const top=Math.max(0,y-radius),bottom=Math.min(height,y+radius+1);
  for(let x=0;x<width;x++){
   const left=Math.max(0,x-radius),right=Math.min(width,x+radius+1),p=y*width+x;
   const sum=integral[bottom*stride+right]-integral[top*stride+right]-integral[bottom*stride+left]+integral[top*stride+left];
   const mean=sum/((bottom-top)*(right-left));
   normalized[p]=bound(Math.round(247+(values[p]-mean)*strength),0,255);
  }
 }
 // Conservative unsharp mask for small print: keep antialiased edges instead of binarizing them.
 for(let y=0;y<height;y++){
  const row=y*width;
  for(let x=0;x<width;x++){
   const p=row+x,v=normalized[p],l=normalized[p>row?p-1:p],r=normalized[x+1<width?p+1:p];
   const u=normalized[y>0?p-width:p],d=normalized[y+1<height?p+width:p];
   const sharp=bound(Math.round(v+(v-(l+r+u+d)/4)*.46),0,255);
   const color=sharp>248?255:sharp;
   const i=p*4;src[i]=color;src[i+1]=color;src[i+2]=color;src[i+3]=255;
  }
 }
 ctx.putImageData(image,0,0);
 return canvas;
}
function prepare(original,{straighten=true}={}){
 if(!original||original.width<1||original.height<1)throw Error("Page vide");
 const aligned=straighten?deskew(original):{canvas:original,angle:0,rotated:false};
 const enhanced=document.createElement("canvas");enhanced.width=aligned.canvas.width;enhanced.height=aligned.canvas.height;
 const ctx=enhanced.getContext("2d",{willReadFrequently:true});if(!ctx)throw Error("Canvas indisponible");
 ctx.drawImage(aligned.canvas,0,0);if(aligned.rotated){aligned.canvas.width=0;aligned.canvas.height=0}
 improveContrast(enhanced);
 return {canvas:enhanced,angle:aligned.angle,mode:"contraste local, nuances de gris, netteté"};
}
function score({text,confidence}){
 const t=String(text||""),characters=(t.match(/[a-zà-ÿ0-9]/gi)||[]).length;
 if(characters<10)return 0;
 const lines=t.split(/\n/).filter(x=>x.trim().length>5).length;
 const numbers=(t.match(/\b\d+[,.]\d{2,4}\b/g)||[]).length;
 const invoiceLines=(t.match(/^\s*(?:\d{1,3}\s*\/\s*)?[a-z0-9]{3,}\s+.{6,}\d+[,.]\d{2}/gim)||[]).length;
 const conf=Number.isFinite(Number(confidence))?bound(Number(confidence),0,100):0;
 return conf*.65+Math.min(18,characters/60)+Math.min(8,lines/5)+Math.min(8,numbers/3)+Math.min(8,invoiceLines*2);
}
const api={prepare,score,estimateSkew};
if(typeof module==="object"&&module.exports)module.exports=api;
else root.InvoiceImageEnhancer=api;
})(typeof window!=="undefined"?window:this);
