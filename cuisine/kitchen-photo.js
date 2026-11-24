"use strict";
(function(){
 let activeCapture=null,activeHistory=null;
 const text=(el,value)=>{el.textContent=String(value??"");};
 const stop=stream=>{if(stream)stream.getTracks().forEach(t=>t.stop());};
 const sizeLimit=300000;
 function makeDialog(id,title){
  const d=document.createElement("dialog");d.id=id;d.className="kitchen-photo-dialog";
  const h=document.createElement("h2");text(h,title);d.append(h);document.body.append(d);return d;
 }
 function capture({label,onSubmit,onSaved}){
  if(activeCapture)return;
  const d=makeDialog("kitchenPhotoCapture","Photo obligatoire après nettoyage");
  const name=document.createElement("p");name.className="kp-name";text(name,label);d.append(name);
  const desc=document.createElement("p");text(desc,"Cadrez uniquement la zone nettoyée. Aucun élève ni membre du personnel, aucun document nominatif.");
  d.append(desc);
  const video=document.createElement("video");video.autoplay=true;video.muted=true;video.playsInline=true;video.setAttribute("aria-label","Aperçu en direct de la caméra");video.hidden=true;d.append(video);
  const img=document.createElement("img");img.alt="Photo de la zone nettoyée à vérifier";img.hidden=true;d.append(img);
  const feedback=document.createElement("p");feedback.setAttribute("role","status");feedback.setAttribute("aria-live","polite");feedback.className="kp-status";d.append(feedback);
  const actions=document.createElement("div");actions.className="kp-actions";d.append(actions);
  const button=(label,fn,primary=false)=>{const b=document.createElement("button");b.type="button";b.className=primary?"kp-primary":"kp-secondary";text(b,label);b.addEventListener("click",fn);actions.append(b);return b;};
  let stream=null,photo="",sending=false,opening=false,generation=0,closed=false;
  const close=()=>{if(!sending)d.close();};
  const cancel=button("Annuler",close);
  const start=button("Activer la caméra",()=>openCamera());
  const take=button("Prendre la photo",()=>takePhoto(),true);
  const retake=button("Reprendre la photo",()=>{photo="";img.removeAttribute("src");img.hidden=true;openCamera();});
  const submit=button("Valider la tâche avec la photo",()=>send(),true);
  take.disabled=true;retake.hidden=true;submit.disabled=true;
  const endStream=()=>{stop(stream);stream=null;video.srcObject=null;video.hidden=true;};
  function teardown(){if(closed)return;closed=true;generation++;endStream();photo="";img.removeAttribute("src");d.remove();if(activeCapture===d)activeCapture=null;}
  d.addEventListener("cancel",event=>{if(sending)event.preventDefault();});
  d.addEventListener("close",teardown);
  activeCapture=d;d.showModal();
  async function openCamera(){
   if(opening||sending||closed)return;
   if(!navigator.mediaDevices?.getUserMedia){text(feedback,"Caméra indisponible. Utilisez un navigateur compatible sur une connexion HTTPS. Aucune validation sans photo.");return;}
   opening=true;start.disabled=true;take.disabled=true;submit.disabled=true;retake.hidden=true;photo="";img.hidden=true;endStream();const current=++generation;
   text(feedback,"Autorisez l’accès à la caméra.");
   try{
    const next=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:"environment"},width:{ideal:1280},height:{ideal:960}}});
    if(closed||current!==generation){stop(next);return;}
    stream=next;video.srcObject=stream;video.hidden=false;await video.play();
    if(closed||current!==generation)return;
    if(!video.videoWidth||!video.videoHeight)throw Error("La caméra ne fournit pas encore d’image. Réessayez.");
    start.hidden=true;take.disabled=false;text(feedback,"Cadrez la zone nettoyée puis prenez la photo.");
   }catch(err){endStream();start.hidden=false;text(feedback,err?.name==="NotAllowedError"?"Accès caméra refusé. Autorisez-le dans les paramètres du navigateur puis réessayez.":(err?.message||"Caméra indisponible. Réessayez."));}
   finally{opening=false;start.disabled=false;}
  }
  function takePhoto(){
   if(closed||sending||!stream||!video.videoWidth||!video.videoHeight)return;
   try{
    const c=document.createElement("canvas"),scale=Math.min(1,1024/Math.max(video.videoWidth,video.videoHeight));
    c.width=Math.round(video.videoWidth*scale);c.height=Math.round(video.videoHeight*scale);
    if(c.width<240||c.height<240)throw Error("Résolution insuffisante. Utilisez une autre caméra.");
    const ctx=c.getContext("2d",{alpha:false});if(!ctx)throw Error("Capture impossible.");
    ctx.drawImage(video,0,0,c.width,c.height);let encoded="";
    for(const quality of [.84,.74,.64,.54,.44]){
     const url=c.toDataURL("image/jpeg",quality);
     if(!url.startsWith("data:image/jpeg;base64,"))continue;
     const body=url.slice(23);
     if(body.length<=Math.floor(sizeLimit/3)*4){encoded=body;break;}
    }
    c.width=0;c.height=0;
    if(!encoded)throw Error("Photo trop volumineuse. Reprenez-la.");
    photo=encoded;img.src="data:image/jpeg;base64,"+photo;img.hidden=false;
    endStream();take.disabled=true;start.hidden=true;retake.hidden=false;submit.disabled=false;
    text(feedback,"Vérifiez la photo. Confirmez seulement si la tâche est réellement terminée.");
   }catch(err){text(feedback,err.message||"Capture impossible.");}
  }
  async function send(){
   if(!photo||sending||closed)return;sending=true;submit.disabled=true;retake.disabled=true;cancel.disabled=true;start.disabled=true;take.disabled=true;text(feedback,"Enregistrement de la photo et de la validation…");
   try{
    await onSubmit(photo);
    if(closed)return;
    sending=false;d.close();if(typeof onSaved==="function")await onSaved();
   }catch(err){if(!closed){text(feedback,err.message||"Enregistrement impossible. Tâche non confirmée.");submit.disabled=false;retake.disabled=false;cancel.disabled=false;}}
   finally{sending=false;}
  }
  openCamera();
 }
 function closeCapture(){if(activeCapture){activeCapture.close();}}
 function showHistory({report,staff,fetchPhoto}){
  if(activeHistory)activeHistory.close();
  const d=makeDialog("kitchenPhotoHistory","Preuves de nettoyage — "+report.date);activeHistory=d;
  let url=null,epoch=0;
  const note=document.createElement("p");note.textContent="Photos des validations enregistrées. Les anciennes validations restent consultables sans photo.";d.append(note);
  const list=document.createElement("div");list.className="kp-history";d.append(list);
  const preview=document.createElement("section");preview.className="kp-preview";const title=document.createElement("h3"),img=document.createElement("img"),feedback=document.createElement("p");img.alt="Preuve photographique du nettoyage";img.hidden=true;feedback.setAttribute("role","status");preview.append(title,img,feedback);d.append(preview);
  const reset=()=>{if(url)URL.revokeObjectURL(url);url=null;img.removeAttribute("src");img.hidden=true;};
  const names=new Map((report.tasks||[]).map(t=>[t.id,t.label]));
  const users=new Map((staff||[]).map(a=>[a.id,a.name]));
  for(const c of report.checks||[]){
   const row=document.createElement("div");row.className="kp-history-row";
   const label=document.createElement("div"),strong=document.createElement("strong"),caption=document.createElement("small");
   text(strong,names.get(c.task_id)||"Tâche");text(caption,(users.get(c.performed_by)||"Agent")+" · "+new Date(c.performed_at).toLocaleString("fr-FR",{timeZone:"Europe/Paris"}));label.append(strong,caption);row.append(label);
   if(c.photo_bytes>0){
    const b=document.createElement("button");b.type="button";b.className="kp-secondary";text(b,"Voir la photo");row.append(b);
    b.addEventListener("click",async()=>{
     const current=++epoch;reset();text(title,names.get(c.task_id)||"Tâche");text(feedback,"Chargement sécurisé…");
     try{const blob=await fetchPhoto(c.id);if(current!==epoch||!d.open)return;if(blob.type!=="image/jpeg")throw Error("Format de preuve invalide.");url=URL.createObjectURL(blob);img.src=url;img.hidden=false;text(feedback,"Photo enregistrée avec cette validation.");preview.scrollIntoView({block:"nearest"});}
     catch(err){if(current===epoch)text(feedback,err.message||"Photo indisponible.");}
    });
   }else{const no=document.createElement("span");text(no,"Sans photo (ancienne validation)");row.append(no);}
   list.append(row);
  }
  if(!(report.checks||[]).length){const empty=document.createElement("p");text(empty,"Aucune validation à cette date.");list.append(empty);}
  const close=document.createElement("button");close.type="button";close.className="kp-secondary";text(close,"Fermer");close.addEventListener("click",()=>d.close());d.append(close);
  d.addEventListener("close",()=>{epoch++;reset();if(activeHistory===d)activeHistory=null;d.remove();});d.showModal();
 }
 window.KitchenPhoto={capture,closeCapture,showHistory};
})();
