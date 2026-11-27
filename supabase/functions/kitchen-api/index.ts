import {createClient} from "npm:@supabase/supabase-js@2.112.4";
import jpeg from "npm:jpeg-js@0.4.4";
const cors={"Access-Control-Allow-Origin":"https://edm28contact-wq.github.io","Access-Control-Allow-Headers":"content-type, x-admin-session, authorization, apikey","Access-Control-Allow-Methods":"GET,POST,OPTIONS"};
const enc=new TextEncoder();
const answer=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
function db(){const keys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}") as Record<string,string>;const key=keys.default??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");const url=Deno.env.get("SUPABASE_URL");if(!url||!key)throw Error("Configuration serveur absente");return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})}
function b64u(data:Uint8Array){return btoa(String.fromCharCode(...data)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"")}
function from64(value:string){const a=value.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-value.length%4)%4);return Uint8Array.from(atob(a),c=>c.charCodeAt(0))}
async function mac(key:string,msg:string){const k=await crypto.subtle.importKey("raw",enc.encode(key),{name:"HMAC",hash:"SHA-256"},false,["sign"]);return b64u(new Uint8Array(await crypto.subtle.sign("HMAC",k,enc.encode(msg))))}
async function secret(c:any){const q=await c.from("system_settings").select("admin_token").eq("id",1).single();if(q.error||!q.data?.admin_token)throw Error("Configuration d'accès indisponible");return String(q.data.admin_token)}
async function token(c:any,scope:string,id:string,version:number){const payload={u:id,v:version,scope,exp:Date.now()+4*3600000,n:crypto.randomUUID()};const body=b64u(enc.encode(JSON.stringify(payload)));return body+"."+await mac(await secret(c),body)}
async function user(c:any,req:Request){try{const t=req.headers.get("x-admin-session")||req.headers.get("authorization")?.replace(/^Bearer /,"")||"";const parts=t.split(".");if(t.length>4096||parts.length!==2)return null;const [body,sig]=parts;if(await mac(await secret(c),body)!==sig)return null;const p=JSON.parse(new TextDecoder().decode(from64(body)));if(typeof p?.u!=="string"||!p.u||p.u.length>80||!Number.isFinite(Number(p.exp))||Number(p.exp)<=Date.now())return null;
if(p.scope==="kitchen-staff"){const q=await c.from("kitchen_staff").select("id,name,active,session_version,personnel_id").eq("id",p.u).maybeSingle();if(!q.data?.active||Number(q.data.session_version)!==Number(p.v)||!q.data.personnel_id)return null;const employee=await c.from("college_personnel").select("id,name,archived").eq("id",q.data.personnel_id).maybeSingle();if(employee.error||employee.data?.archived!==false)return null;return {scope:"staff",id:q.data.id,name:employee.data.name};}
if(p.scope&&p.scope!=="central-admin")return null;
const q=await c.from("admin_accounts").select("username,role,active,central_active,must_change_password,session_version,permissions").eq("username",p.u).maybeSingle();const a=q.data;if(q.error||!a?.active||a.central_active===false||a.must_change_password===true||Number(a.session_version)!==Number(p.v))return null;
if(a.role==="admin"||((a.role==="admin_limited"&&a.permissions?.college_admin===true)||a.permissions?.["cuisine.manage"]===true)&&a.permissions?.readonly!==true)return{scope:"admin",id:a.username,name:a.username};
if(a.permissions?.readonly!==true&&(a.permissions?.cuisine===true||a.permissions?.["cuisine.write"]===true))return{scope:"staff",id:a.username,name:a.username,existingAccount:true};
if(a.permissions?.["cuisine.read"]===true||a.permissions?.["cuisine.manage"]===true||a.permissions?.cuisine===true||a.permissions?.["cuisine.write"]===true)return{scope:"viewer",id:a.username,name:a.username};
return null;
}catch{return null}}
async function hash(pin:string,salt?:Uint8Array){const s=salt??crypto.getRandomValues(new Uint8Array(16));const key=await crypto.subtle.importKey("raw",enc.encode(pin),"PBKDF2",false,["deriveBits"]);const bytes=new Uint8Array(await crypto.subtle.deriveBits({name:"PBKDF2",hash:"SHA-256",salt:s,iterations:310000},key,256));return {pin_salt:btoa(String.fromCharCode(...s)),pin_hash:btoa(String.fromCharCode(...bytes)),pin_iterations:310000}}
function goodPin(pin:string){return /^\d{6,8}$/.test(pin)}
function temp(x:any,min=-60,max=120){if(x===""||x===null||x===undefined)return null;const v=Number(x);return Number.isFinite(v)&&v>=min&&v<=max?Math.round(v*100)/100:null}
function uuid(v:any){return typeof v==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)}
const forbidden=()=>answer({error:"Accès non autorisé"},403);
const allowed=(u:any,admin=false)=>!!u&&(!admin||u.scope==="admin");
const query=async (p:any)=>{if(p.error)throw p.error;return p.data??[]};

const TASK_PHOTO_BUCKET="kitchen-cleaning-photos";
const TASK_PHOTO_MAX=350000;
const taskPhotoDigest=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),b=>b.toString(16).padStart(2,"0")).join("");
function taskPhotoBytes(value:unknown):Uint8Array|null{
 if(typeof value!=="string"||value.length<136||value.length>400000||value.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(value))return null;
 try{
  const input=Uint8Array.from(atob(value),x=>x.charCodeAt(0));
  if(input.length<100||input.length>300000||input[0]!==255||input[1]!==216||input[input.length-2]!==255||input[input.length-1]!==217)return null;
  const decoded=jpeg.decode(input,{useTArray:true,tolerantDecoding:false,maxResolutionInMP:1.1,maxMemoryUsageInMB:32});
  if(decoded.width<240||decoded.height<240||decoded.width>1024||decoded.height>1024)return null;
  const clean=jpeg.encode({data:decoded.data,width:decoded.width,height:decoded.height},75).data;
  return clean.length>=100&&clean.length<=TASK_PHOTO_MAX?Uint8Array.from(clean):null;
 }catch{return null;}
}
const taskCheckColumns="id,task_id,performed_on,performed_at,performed_by,photo_bytes";
const MEATER_BASE="https://public-api.cloud.meater.com/v1";
class MeaterError extends Error {}
function meaterDatabaseError(stage:string,error:any){
 const code=typeof error?.code==="string"&&/^[A-Z0-9]{5,10}$/.test(error.code)?error.code:"DB";
 console.error("MEATER "+stage+" failed",code);
 return new MeaterError("MEATER : "+stage+" indisponible ("+code+"). Réessayez après actualisation.");
}
async function meaterCall(route:"/login"|"/devices",credential:any){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),9000);
 try{
  const login=route==="/login";
  const response=await fetch(MEATER_BASE+route,{method:login?"POST":"GET",redirect:"error",headers:login?{"Content-Type":"application/json"}:{"Authorization":"Bearer "+credential,"Accept-Language":"fr"},body:login?JSON.stringify(credential):undefined,signal:controller.signal});
  if(!response.ok)throw new MeaterError(response.status===401||response.status===403?"Identifiants ou jeton MEATER refusés":response.status===429?"Limite de requêtes MEATER atteinte":"MEATER indisponible (HTTP "+response.status+")");
  const result=await response.json();if(result.statusCode!==200||!result.data)throw new MeaterError("Réponse MEATER invalide");
  return result.data;
 }catch(err){if(err instanceof MeaterError)throw err;throw new MeaterError("Connexion MEATER indisponible");}
 finally{clearTimeout(timer);}
}
function normalizeMeaterDevices(value:any,now=Date.now()){
 if(!Array.isArray(value))throw new MeaterError("Liste des sondes MEATER invalide");
 const found=new Map<string,any>();
 for(const d of value.slice(0,100)){
  const id=d?.id,internal=d?.temperature?.internal,ambient=d?.temperature?.ambient,stamp=d?.updated_at;
  if(typeof id!=="string"||id.length<1||id.length>160||typeof internal!=="number"||!Number.isFinite(internal)||internal< -10||internal>105||typeof ambient!=="number"||!Number.isFinite(ambient)||ambient< -10||ambient>550||!Number.isSafeInteger(stamp)||stamp<=0)continue;
  const ms=stamp*1000;if(!Number.isFinite(ms)||ms>now+10000||ms<now-120000)continue;
  const previous=found.get(id);if(previous&&Date.parse(previous.measured_at)>ms)continue;
  found.set(id,{device_id:id,internal_c:internal,ambient_c:ambient,measured_at:new Date(ms).toISOString(),cook_id:typeof d.cook?.id==="string"&&d.cook.id.length>0&&d.cook.id.length<=160?d.cook.id:null,cook_state:typeof d.cook?.state==="string"?d.cook.state.slice(0,80):null});
 }
 return [...found.values()];
}
async function pollMeater(c:any,manual:boolean,preview=false,graph=false){
 const claim=graph?await c.rpc("kitchen_meater_claim_graph"):preview?await c.rpc("kitchen_meater_claim_preview"):await c.rpc("kitchen_meater_claim",{p_manual:manual});
 if(claim.error)throw meaterDatabaseError("accès au jeton",claim.error);
 const slot=claim.data;if(slot?.error)return {error:slot.error};if(slot?.skipped)return {skipped:true};
 if(!slot?.token||!slot?.generation)throw new MeaterError("MEATER : compte non configuré ou jeton indisponible.");
 let devices:any[]=[],problem:string|null=null,upstreamCount:number|null=null;
 try{
  const raw=await meaterCall("/devices",slot.token);
  devices=normalizeMeaterDevices(raw.devices);
  upstreamCount=raw.devices.length;
 }
 catch(err){problem=err instanceof MeaterError?err.message:"Connexion MEATER indisponible";}
 const data={p_generation:slot.generation,p_devices:devices,p_error:problem};
 const result=graph?await c.rpc("kitchen_meater_apply_graph",{...data,p_request_id:slot.request_id}):await c.rpc("kitchen_meater_apply",data);
 if(result.error)throw meaterDatabaseError("enregistrement des sondes",result.error);
 return {...result.data,upstream_count:upstreamCount,accepted_count:problem?null:devices.length};
}
async function meaterStatus(c:any,admin=false){
 const [cfg,probes]=await Promise.all([
  c.from("kitchen_meater_settings").select("vault_secret_id,enabled,test_until,last_poll_at,last_ok_at,last_error").eq("id",1).single(),
  c.from("kitchen_meater_probes").select("device_id,slot,label,qualified_at,qualification_expires_at,present,internal_c,ambient_c,measured_at,cook_id,cook_state").order("slot",{ascending:true,nullsFirst:false}).limit(100)
 ]);
 if(cfg.error||!cfg.data)throw meaterDatabaseError("configuration",cfg.error);
 if(probes.error)throw meaterDatabaseError("liste des sondes",probes.error);
 const now=Date.now(),production=cfg.data.enabled===true,testActive=!production&&Date.parse(cfg.data.test_until)>now,visible=admin||production||testActive;
 const links=production?await c.from("kitchen_meater_links").select("reheat_id,device_id,cook_id,attached_at,kitchen_reheats!inner(status)").eq("kitchen_reheats.status","en_cours").is("detached_at",null):{data:[],error:null};
 if(links.error)throw meaterDatabaseError("cycles associés",links.error);
 return {now:new Date(now).toISOString(),configured:!!cfg.data.vault_secret_id,enabled:production,test_active:testActive,test_until:testActive?cfg.data.test_until:null,last_poll_at:visible?cfg.data.last_poll_at:null,last_ok_at:visible?cfg.data.last_ok_at:null,last_error:visible?cfg.data.last_error:null,
  probes:(probes.data||[]).map((p:any)=>({...p,...(!visible?{present:false,internal_c:null,ambient_c:null,measured_at:null,cook_id:null,cook_state:null}:{}),qualified_at:Date.parse(p.qualification_expires_at)>now?p.qualified_at:null,fresh:visible&&p.present===true&&!cfg.data.last_error&&Number.isFinite(Date.parse(p.measured_at))&&Date.parse(p.measured_at)<=now+10000&&Date.parse(p.measured_at)>=now-120000})),links:production?links.data||[]:[]};
}
const PMS_SPECS:Record<string,any>={"pms":{"instruction":"Décrire l’activité réelle (cuisine sur place, satellite, liaison chaude/froide), déclaration DDPP et analyse des dangers. Ne pas considérer un modèle comme approuvé.","fields":[{"key":"activity","label":"Type d’activité","type":"text"},{"key":"document","label":"Référence PMS / déclaration","type":"text"},{"key":"assessment","label":"Analyse, diagramme, responsabilités et décisions","type":"textarea"},{"key":"verified","label":"Documents et obligations vérifiés","type":"check"}]},"training":{"instruction":"Tracer formation, consignes et vérification des bonnes pratiques. Ne pas enregistrer de diagnostics médicaux.","fields":[{"key":"staff","label":"Agent / groupe","type":"text"},{"key":"topic","label":"Formation ou contrôle d’hygiène","type":"text"},{"key":"document","label":"Référence de la procédure ou du justificatif","type":"text"},{"key":"assessment","label":"Compétences et observations","type":"textarea"},{"key":"verified","label":"Consignes comprises et appliquées","type":"check"}]},"premises":{"instruction":"Vérifier équipements, eau potable, flux propres/sales, état et interventions.","fields":[{"key":"area","label":"Zone / équipement","type":"text"},{"key":"kind","label":"Contrôle / maintenance","type":"text"},{"key":"assessment","label":"État, résultat et intervention","type":"textarea"},{"key":"document","label":"Référence de la procédure ou du justificatif","type":"text"},{"key":"verified","label":"État satisfaisant selon la procédure","type":"check"}]},"cleaning":{"instruction":"Les tâches existantes restent disponibles. Ce registre documente la procédure, les produits et la vérification de l’efficacité.","fields":[{"key":"area","label":"Zone ou matériel","type":"text"},{"key":"product","label":"Produit utilisé","type":"text"},{"key":"dilution","label":"Dosage selon fiche technique","type":"text"},{"key":"contact_time","label":"Temps de contact","type":"text"},{"key":"assessment","label":"Contrôle visuel ou autre vérification","type":"textarea"},{"key":"verified","label":"Protocole appliqué et contrôle satisfaisant","type":"check"}]},"pests":{"instruction":"Plan de lutte, inspection des dispositifs, interventions et signes de présence.","fields":[{"key":"area","label":"Zone / dispositif","type":"text"},{"key":"document","label":"Référence de la procédure ou du justificatif","type":"text"},{"key":"assessment","label":"Constat / intervention","type":"textarea"},{"key":"verified","label":"Absence d’indice ou maîtrise vérifiée","type":"check"}]},"waste":{"instruction":"Ne pas remettre en service les restes sans procédure adaptée. Identifier les lots et les décisions.","fields":[{"key":"area","label":"Zone / service","type":"text"},{"key":"lot","label":"Denrée / lot concerné","type":"text"},{"key":"decision","label":"Élimination ou devenir autorisé","type":"text"},{"key":"assessment","label":"Motif, quantité et conditions","type":"textarea"},{"key":"verified","label":"Procédure respectée","type":"check"}]},"delivery":{"instruction":"Une ligne par produit/lot. Limite applicable selon étiquette, catégorie et PMS ; température mesurée selon le protocole. La comparaison seule ne vaut pas réception acceptée.","fields":[{"key":"supplier","label":"Fournisseur","type":"text"},{"key":"delivery_note","label":"Bon de livraison","type":"text"},{"key":"product","label":"Produit / plat","type":"text"},{"key":"lot","label":"Lot ou identifiant de fabrication","type":"text"},{"key":"date_kind","label":"Type de date","type":"select","options":["DLC","DDM","Non applicable justifié"]},{"key":"date_label","label":"Date indiquée ou justification","type":"text"},{"key":"temp_mode","label":"Contrôle thermique","type":"select","options":["Mesuré","Non applicable justifié"]},{"key":"temperature","label":"Température mesurée (°C) ou sans objet","type":"text"},{"key":"limit","label":"Limite haute applicable (°C) ou sans objet","type":"text"},{"key":"document","label":"Référence de la procédure ou du justificatif","type":"text"},{"key":"packaging_ok","label":"Conditionnement, étiquetage, quantité et date contrôlés","type":"check"},{"key":"decision","label":"Décision","type":"select","options":["Acceptée","Isolée","Refusée"]}]},"storage":{"instruction":"Vérifier DLC, étiquettes, rotations, séparation crus/cuits/allergènes et stockage des produits ouverts.","fields":[{"key":"area","label":"Chambre / réserve","type":"text"},{"key":"product","label":"Produit / plat","type":"text"},{"key":"lot","label":"Lot ou identifiant de fabrication","type":"text"},{"key":"date_label","label":"DLC / DDM / date d’ouverture","type":"text"},{"key":"assessment","label":"Constat et devenir","type":"textarea"},{"key":"verified","label":"Dates, rotation et séparation vérifiées","type":"check"}]},"coldchain":{"instruction":"Les relevés Govee sont complémentaires. Vérifier les limites applicables, la fiabilité des mesures et les exigences spécifiques aux surgelés.","fields":[{"key":"area","label":"Chambre froide / enceinte","type":"text"},{"key":"temperature","label":"Température mesurée","type":"number","min":-60,"max":150},{"key":"limit","label":"Limite haute applicable","type":"number","min":-60,"max":150},{"key":"document","label":"Référence de la procédure ou du justificatif","type":"text"},{"key":"assessment","label":"Méthode, appareil et contrôle des produits","type":"textarea"},{"key":"verified","label":"Contrôle indépendant et seuil applicable vérifiés","type":"check"}]},"preparation":{"instruction":"Décongélation maîtrisée, séparation, hygiène, durée hors froid et étiquetage selon procédure.","fields":[{"key":"product","label":"Produit / plat","type":"text"},{"key":"lot","label":"Lot ou identifiant de fabrication","type":"text"},{"key":"document","label":"Référence de la procédure ou du justificatif","type":"text"},{"key":"assessment","label":"Conditions, horaires et observations","type":"textarea"},{"key":"verified","label":"Procédure et séparation respectées","type":"check"}]},"cooking":{"instruction":"Il n’existe pas de température universelle pour toute cuisson. Utiliser un couple temps/température validé pour le produit.","fields":[{"key":"product","label":"Produit / plat","type":"text"},{"key":"lot","label":"Lot ou identifiant de fabrication","type":"text"},{"key":"temperature","label":"Température à cœur","type":"number","min":-60,"max":150},{"key":"limit","label":"Minimum prévu par la procédure","type":"number","min":-60,"max":150},{"key":"duration","label":"Durée réelle et cible","type":"text"},{"key":"document","label":"Référence de la procédure ou du justificatif","type":"text"},{"key":"verified","label":"Durée et autres conditions de la procédure vérifiées","type":"check"}]},"reheating":{"instruction":"Registre complémentaire au minuteur : mesurer le passage à 10 °C et l’atteinte de la température de remise. Sans preuve suffisante, ne pas déclarer la conformité.","fields":[{"key":"product","label":"Produit / plat","type":"text"},{"key":"lot","label":"Lot ou identifiant de fabrication","type":"text"},{"key":"start","label":"Heure du passage à 10 °C ou début conservateur","type":"datetime"},{"key":"end","label":"Heure de mesure finale","type":"datetime"},{"key":"temperature","label":"Température finale à cœur","type":"number","min":-60,"max":150},{"key":"target","label":"Cible de remise au consommateur","type":"number","min":63,"max":105},{"key":"verified","label":"Heures et mesures réelles vérifiées ; première remise du jour","type":"check"}]},"cooling":{"instruction":"Contrôler 63 → 10 °C en deux heures au plus (hors analyse validée spécifique), puis stockage entre 0 et 3 °C.","fields":[{"key":"product","label":"Produit / plat","type":"text"},{"key":"lot","label":"Lot ou identifiant de fabrication","type":"text"},{"key":"start","label":"Heure du passage à 63 °C ou début conservateur","type":"datetime"},{"key":"end","label":"Heure de fin du refroidissement","type":"datetime"},{"key":"temperature","label":"Température finale à cœur","type":"number","min":-60,"max":150},{"key":"storage_temp","label":"Température enceinte après refroidissement","type":"number","min":-60,"max":150},{"key":"verified","label":"Horaires réels et mise au froid vérifiés","type":"check"}]},"hotservice":{"instruction":"Vérifier les températures réellement mesurées au service. Valeur minimale usuelle 63 °C hors analyse validée.","fields":[{"key":"product","label":"Produit / plat","type":"text"},{"key":"lot","label":"Lot ou identifiant de fabrication","type":"text"},{"key":"temperature","label":"Température à cœur au service","type":"number","min":-60,"max":150},{"key":"service","label":"Service / point de distribution","type":"text"},{"key":"verified","label":"Mesure représentative vérifiée","type":"check"}]},"coldservice":{"instruction":"Préparations culinaires froides : conservation 0–3 °C, retrait au plus près du service, maximum 2 h et maintien à ≤10 °C sauf analyse validée.","fields":[{"key":"product","label":"Produit / plat","type":"text"},{"key":"lot","label":"Lot ou identifiant de fabrication","type":"text"},{"key":"start","label":"Sortie de l’enceinte froide","type":"datetime"},{"key":"end","label":"Fin du service / contrôle","type":"datetime"},{"key":"storage_temp","label":"Température enceinte avant sortie","type":"number","min":-60,"max":150},{"key":"temperature","label":"Température maximale constatée du produit","type":"number","min":-60,"max":150},{"key":"verified","label":"Durée et maintien de la température vérifiés","type":"check"}]},"samples":{"instruction":"Échantillons représentatifs et identifiés, réservés aux contrôles officiels, conservés au moins 5 jours après présentation au consommateur à 0–3 °C. Adapter selon cuisine centrale/satellite.","fields":[{"key":"product","label":"Produit / plat","type":"text"},{"key":"lot","label":"Lot ou identifiant de fabrication","type":"text"},{"key":"served_at","label":"Date et heure de présentation","type":"datetime"},{"key":"sample_id","label":"Identifiant du prélèvement","type":"text"},{"key":"storage_temp","label":"Température enceinte de conservation","type":"number","min":-60,"max":150},{"key":"location","label":"Emplacement de conservation","type":"text"},{"key":"verified","label":"Prélèvement représentatif, identifié et conservé","type":"check"}]},"traceability":{"instruction":"Associer menus réellement servis, recettes, fournisseurs, bons et lots. Conserver les justificatifs ; ne pas déduire les lots depuis une facture OCR.","fields":[{"key":"product","label":"Produit / plat","type":"text"},{"key":"lot","label":"Lot ou identifiant de fabrication","type":"text"},{"key":"supplier","label":"Fournisseur / origine","type":"text"},{"key":"delivery_note","label":"Référence bon / pièce","type":"text"},{"key":"service","label":"Menu, date et service","type":"text"},{"key":"assessment","label":"Ingrédients et lots utilisés, destinataires si applicable","type":"textarea"},{"key":"verified","label":"Justificatifs disponibles et rapprochement vérifié","type":"check"}]},"allergens":{"instruction":"Les 14 catégories de l’annexe II du règlement 1169/2011 doivent être évaluées à partir des fiches et recettes réelles ; absence non déduite d’un texte vide.","fields":[{"key":"product","label":"Plat / recette et version","type":"text"},{"key":"document","label":"Fiches ingrédients et menu","type":"text"},{"key":"allergens","label":"Allergènes présents et risques de contamination croisée (ou absence justifiée)","type":"textarea"},{"key":"assessment","label":"Information écrite et mode de prévention","type":"textarea"},{"key":"verified","label":"Recette, substitution et information vérifiées","type":"check"}]},"metrology":{"instruction":"Vérification comparative selon PMS et norme applicable. Joindre référence du certificat, point de mesure et incertitude. Dossier MEATER spécifique disponible séparément.","fields":[{"key":"device","label":"Identifiant instrument","type":"text"},{"key":"reference_device","label":"Référent et certificat","type":"text"},{"key":"reference","label":"Valeur de référence","type":"number","min":-60,"max":150},{"key":"measured","label":"Valeur instrument","type":"number","min":-60,"max":150},{"key":"uncertainty","label":"Incertitude retenue","type":"number","min":0,"max":10},{"key":"tolerance","label":"Tolérance validée par le PMS","type":"number","min":0.01,"max":10},{"key":"document","label":"Référence de la procédure ou du justificatif","type":"text"},{"key":"verified","label":"Méthode, norme applicable et résultat vérifiés","type":"check"}]},"microbiology":{"instruction":"Saisir résultat du laboratoire et appréciation selon critère applicable ; ne pas inventer de fréquence universelle.","fields":[{"key":"product","label":"Denrée / surface","type":"text"},{"key":"lab","label":"Laboratoire","type":"text"},{"key":"document","label":"Rapport d’analyse","type":"text"},{"key":"assessment","label":"Résultat et interprétation","type":"textarea"},{"key":"decision","label":"Conclusion du rapport / responsable","type":"select","options":["Satisfaisant","Non satisfaisant","En attente"]}]},"incident":{"instruction":"Isoler les lots, alerter le responsable et évaluer retrait/rappel. En cas de suspicion de TIAC (au moins deux consommateurs), signalement sans délai ARS et DDPP ; ne pas attendre le logiciel.","fields":[{"key":"kind","label":"Nature de l’incident","type":"text"},{"key":"lot","label":"Lots / plats / services concernés","type":"text"},{"key":"assessment","label":"Constat, risque, isolement et mesures immédiates","type":"textarea"},{"key":"notification","label":"Responsable prévenu, décision retrait/rappel et autorités si applicable","type":"textarea"}]},"audit":{"instruction":"Revoir l’efficacité du PMS, les relevés, non-conformités, changements, actions et preuves.","fields":[{"key":"document","label":"Référence de la procédure ou du justificatif","type":"text"},{"key":"assessment","label":"Vérifications, écarts et décisions","type":"textarea"},{"key":"verified","label":"Revue effectuée et conclusions documentées","type":"check"}]}};

const pmsText=(v:any,max=4000)=>typeof v==="string"&&v.trim().length>0&&v.trim().length<=max?v.trim():null;
function pmsDate(v:any){return typeof v==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+"T12:00:00Z"))&&new Date(v+"T12:00:00Z").toISOString().slice(0,10)===v;}
function pmsTime(v:any){return typeof v==="string"&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(v)&&Number.isFinite(Date.parse(v));}
function pmsEvaluate(code:string,input:any,observed:string,applicable:string){
 const spec=PMS_SPECS[code];if(!spec||!input||typeof input!=="object"||Array.isArray(input)||!pmsTime(observed)||Date.parse(observed)>Date.now()+10000)return {error:"Contrôle ou horodatage invalide"};
 const payload:Record<string,any>={},alerts:string[]=[],reviews:string[]=[];
 for(const f of spec.fields){
  const v=input[f.key];if(f.type==="check"){if(typeof v!=="boolean")return {error:"Réponse requise : "+f.label};payload[f.key]=v;if(!v)alerts.push("Non vérifié : "+f.label);}
  else if(f.type==="number"){if(typeof v!=="number"||!Number.isFinite(v)||v<f.min||v>f.max)return {error:"Valeur invalide : "+f.label};payload[f.key]=v;}
  else if(f.type==="datetime"){if(!pmsTime(v)||Date.parse(v)>Date.parse(observed)+10000)return {error:"Horaire réel invalide : "+f.label};payload[f.key]=v;}
  else if(f.type==="date"){if(!pmsDate(v))return {error:"Date invalide : "+f.label};payload[f.key]=v;}
  else if(f.type==="select"){if(!f.options.includes(v))return {error:"Choix requis : "+f.label};payload[f.key]=v;}
  else {const value=pmsText(v,f.type==="textarea"?4000:500);if(!value)return {error:"Champ requis : "+f.label};payload[f.key]=value;}
 }
 const x=payload;
 const fail=(condition:boolean,reason:string)=>{if(condition)alerts.push(reason);};
 const elapsed=(limit:number)=>{const ms=Date.parse(x.end)-Date.parse(x.start);if(ms<0)return false;payload.duration_minutes=Math.round(ms/600)/100;fail(ms>limit*60000,"Durée supérieure à "+limit+" minutes");return true;};
 let measured=false,nextDue:null|string=null;
 if(["reheating","cooling","coldservice"].includes(code)&&!elapsed(code==="reheating"?60:120))return {error:"La fin précède le début"};
 switch(code){
 case "delivery":{
  if(x.temp_mode==="Mesuré"){const parse=(v:string)=>/^-?\d+(?:[.,]\d+)?$/.test(v)?Number(v.replace(",",".")):NaN;const a=parse(x.temperature),b=parse(x.limit);if(!Number.isFinite(a)||!Number.isFinite(b)||a< -60||a>150||b< -60||b>150)return {error:"Température et limite numériques requises"};fail(a>b,"Température supérieure à la limite déclarée");}
  if(x.date_kind==="DLC"){if(!pmsDate(x.date_label))return {error:"DLC au format AAAA-MM-JJ requise"};const day=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(observed));fail(x.date_label<day,"DLC dépassée");}
  fail(x.decision!=="Acceptée","Réception isolée ou refusée");break;}
 case "coldchain":fail(x.temperature>x.limit,"Température supérieure à la limite déclarée");break;
 case "cooking":fail(x.temperature<x.limit,"Température sous le minimum déclaré");break;
 case "reheating":fail(x.temperature<x.target,"Température finale insuffisante");measured=true;break;
 case "cooling":fail(x.temperature>10,"Refroidissement final au-dessus de 10 °C");fail(x.storage_temp<0||x.storage_temp>3,"Enceinte hors plage 0–3 °C");measured=true;break;
 case "hotservice":fail(x.temperature<63,"Température de service sous 63 °C");measured=true;break;
 case "coldservice":fail(x.temperature>10,"Température au-dessus de 10 °C");fail(x.storage_temp<0||x.storage_temp>3,"Enceinte hors plage 0–3 °C");measured=true;break;
 case "samples":fail(x.storage_temp<0||x.storage_temp>3,"Enceinte des plats témoins hors plage 0–3 °C");payload.keep_until=new Date(Date.parse(x.served_at)+5*86400000).toISOString();nextDue=payload.keep_until.slice(0,10);break;
 case "metrology":payload.error_c=Math.abs(x.measured-x.reference);fail(payload.error_c+x.uncertainty>x.tolerance,"Écart et incertitude supérieurs à la tolérance déclarée");break;
 case "microbiology":fail(x.decision==="Non satisfaisant","Résultat non satisfaisant");if(x.decision==="En attente")reviews.push("Résultat en attente");break;
 case "incident":alerts.push("Incident à traiter par le responsable");break;
 }
 if(applicable!=="yes")reviews.push("Procédure PMS non validée ou applicabilité non confirmée");
 return {payload,result:alerts.length?"alert":reviews.length?"review":measured?"within_limits":"recorded",reasons:[...alerts,...reviews],nextDue};
}
const goveeBase="https://openapi.api.govee.com/router/api/v1";
async function goveeCall(apiKey:string,route:"/user/devices"|"/device/state",payload?:Record<string,unknown>){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),9000);
 try{
  const response=await fetch(goveeBase+route,{method:payload?"POST":"GET",
   headers:{"Govee-API-Key":apiKey,"Content-Type":"application/json"},
   body:payload?JSON.stringify(payload):undefined,signal:controller.signal});
  if(!response.ok)throw Error(response.status===401||response.status===403?"Clé Govee refusée":response.status===429?"Limite de requêtes Govee atteinte":"Govee indisponible (HTTP "+response.status+")");
  const result=await response.json();
  if(result.code!==200)throw Error("Govee : "+String(result.message||result.msg||result.code));
  return result;
 }finally{clearTimeout(timer)}
}
async function goveeKey(c:any){
 const q=await c.rpc("kitchen_govee_get_api_key");if(q.error)throw Error("Accès sécurisé Govee indisponible");
 if(!q.data)throw Error("Configurez d'abord la clé API Govee");
 return String(q.data);
}
const validDeviceId=(v:any)=>typeof v==="string"&&v.length>5&&v.length<100&&/^[0-9A-Za-z:._-]+$/.test(v);
const temperatureToCelsius=(value:number,unit:"F"|"C")=>
 Math.round((unit==="F"?(value-32)*5/9:value)*100)/100;
const deletionEmail="enguerrand@danglade.net";
function canDeleteRoom(room:any){
 const created=Date.parse(room.created_at),now=Date.now();
 if(!Number.isFinite(created)||created>now)return false;
 if(now-created<86400000)return true;
 if(!room.archived_at)return false;
 const threshold=new Date(room.archived_at);
 if(!Number.isFinite(threshold.getTime())||threshold.getTime()>now)return false;
 threshold.setUTCFullYear(threshold.getUTCFullYear()+1);
 return now>=threshold.getTime();
}

async function readGoveeLiveState(sensor:any,key:string){
 const checked_at=new Date().toISOString();
 try{
  if(sensor.raw_unit!=="F"&&sensor.raw_unit!=="C")throw Error("Unité non configurée");
  const state=await goveeCall(key,"/device/state",{requestId:crypto.randomUUID(),payload:{sku:sensor.model,device:sensor.device_identifier}});
  const caps=state.payload?.capabilities||[];
  const online=caps.find((cap:any)=>cap.instance==="online")?.state?.value;
  const raw=caps.find((cap:any)=>cap.type==="devices.capabilities.property"&&cap.instance==="sensorTemperature")?.state?.value;
  const numeric=typeof raw==="number"?raw:typeof raw==="string"&&raw.trim()?Number(raw):null;
  if(online!==true||numeric===null||!Number.isFinite(numeric))return {status:online===false?"offline":"error",temperature_c:null,checked_at:new Date().toISOString(),error:"Capteur hors ligne ou température indisponible"};
  const temperature_c=temperatureToCelsius(numeric,sensor.raw_unit);
  if(temperature_c< -60||temperature_c>60)throw Error("Température hors plage : vérifiez l’unité");
  return {status:"online",temperature_c,checked_at:new Date().toISOString(),error:null};
 }catch(err){return {status:"error",temperature_c:null,checked_at,error:err instanceof Error?err.message.slice(0,180):"Lecture Govee indisponible"};}
}
async function goveeLive(c:any){
 const claim=await c.rpc("kitchen_claim_govee_live");
 if(claim.error)throw claim.error;
 const claimed=Array.isArray(claim.data)?claim.data:[];
 if(claimed.length){
  let key="",problem="";
  try{key=await goveeKey(c);}catch(err){problem=err instanceof Error?err.message:"Connexion Govee indisponible";}
  for(let offset=0;offset<claimed.length;offset+=4){
   await Promise.all(claimed.slice(offset,offset+4).map(async(sensor:any)=>{
    const state=key?await readGoveeLiveState(sensor,key):{status:"error",temperature_c:null,checked_at:new Date().toISOString(),error:problem};
    const saved=await c.from("kitchen_connected_devices").update({live_state:state}).eq("id",sensor.id).eq("live_request_id",sensor.live_request_id).eq("room_id",sensor.room_id);
    if(saved.error)throw saved.error;
   }));
  }
 }
 const [rooms,sensors]=await Promise.all([
  query(await c.from("kitchen_cold_rooms").select("id,label,min_c,max_c").is("archived_at",null).is("deleted_at",null).order("room_type").order("room_number")),
  query(await c.from("kitchen_connected_devices").select("id,room_id,model,live_state,last_temperature_c,last_checked_at").eq("provider","govee").eq("kind","cold_room"))
 ]);
 const now=Date.now();
 return {rooms:rooms.map((room:any)=>{
  const sensor=sensors.find((d:any)=>d.room_id===room.id),state=sensor?.live_state;
  const age=now-Date.parse(state?.checked_at||"");
  return {...room,sensor:sensor?{model:sensor.model,status:state?.status||"pending",temperature_c:state?.temperature_c??null,checked_at:state?.checked_at??null,age_seconds:Number.isFinite(age)?Math.round(age/1000):null,fresh:state?.status==="online"&&state.temperature_c!=null&&Number.isFinite(Number(state.temperature_c))&&Number.isFinite(age)&&age>=-10000&&age<=130000,error:state?.error??null,last_temperature_c:sensor.last_temperature_c,last_checked_at:sensor.last_checked_at}:null};
 }),now:new Date(now).toISOString(),queried:claimed.length};
}
async function meaterLive(c:any,graph=false){
 const result=await pollMeater(c,true,true,graph);
 const s=await meaterStatus(c,true);
 return {...s,preview:true,graph_requested:graph,graph_available:!s.enabled&&s.configured,cached:result?.skipped===true,cloud_device_count:result?.upstream_count??null,cloud_fresh_count:result?.accepted_count??null,last_error:result?.error||s.last_error};
}

async function syncGoveeDevice(c:any,sensor:any,key:string,slotAt?:string){
 const failed=async(message:string,statusCode=409,offline=false)=>{
  const update=await c.from("kitchen_connected_devices").update({
   status:offline?"offline":"error",last_checked_at:new Date().toISOString(),last_error:message.slice(0,180)
  }).eq("id",sensor.id).eq("room_id",sensor.room_id);
  if(update.error)throw update.error;
  return {error:message,statusCode};
 };
 try{
  if(sensor.raw_unit!=="F"&&sensor.raw_unit!=="C")
   return await failed("Unité de température du capteur non configurée",422);
  const room=await c.from("kitchen_cold_rooms").select("min_c,max_c,archived_at,deleted_at")
   .eq("id",sensor.room_id).maybeSingle();
  if(room.error)throw room.error;
  if(!room.data||room.data.archived_at||room.data.deleted_at)
   return await failed("Chambre inactive : relevé automatique suspendu",409);
  const state=await goveeCall(key,"/device/state",{
   requestId:crypto.randomUUID(),payload:{sku:sensor.model,device:sensor.device_identifier}
  });
  const caps=state.payload?.capabilities||[];
  const online=caps.find((cap:any)=>cap.instance==="online")?.state?.value;
  const raw=caps.find((cap:any)=>cap.type==="devices.capabilities.property"&&cap.instance==="sensorTemperature")?.state?.value;
  const numeric=typeof raw==="number"?raw:typeof raw==="string"&&raw.trim()?Number(raw):null;
  if(online!==true||numeric===null||!Number.isFinite(numeric))
   return await failed("Capteur hors ligne ou température indisponible",409,online===false);
  const degrees=temperatureToCelsius(numeric,sensor.raw_unit);
  if(degrees < -60||degrees>60)
   return await failed("Température hors plage : vérifiez l'unité du capteur",422);
  // Recheck the association and the active schedule after the network request.
  const [currentSensor,currentRoom]=await Promise.all([
   c.from("kitchen_connected_devices").select("room_id,raw_unit").eq("id",sensor.id).maybeSingle(),
   c.from("kitchen_cold_rooms").select("min_c,max_c,archived_at,deleted_at,auto_collection_enabled,auto_collection_last_slot_at,auto_collection_updated_at").eq("id",sensor.room_id).maybeSingle()
  ]);
  if(currentSensor.error)throw currentSensor.error;if(currentRoom.error)throw currentRoom.error;
  if(currentSensor.data?.room_id!==sensor.room_id||currentSensor.data?.raw_unit!==sensor.raw_unit||
     !currentRoom.data||currentRoom.data.archived_at||currentRoom.data.deleted_at||
     (slotAt&&(!currentRoom.data.auto_collection_enabled||
      Date.parse(currentRoom.data.auto_collection_last_slot_at||"")!==Date.parse(slotAt)||
      Date.parse(currentRoom.data.auto_collection_updated_at)>Date.parse(slotAt))))
   return {error:"Affectation ou programmation modifiée pendant la collecte : aucun relevé ajouté",statusCode:409};
  const measuredAt=new Date().toISOString();
  const isAlert=degrees>Number(currentRoom.data.max_c)||(currentRoom.data.min_c!==null&&degrees<Number(currentRoom.data.min_c));
  const added=await c.from("kitchen_cold_readings").insert({
   room_id:sensor.room_id,temperature_c:degrees,is_alert:isAlert,source:"govee_cloud",
   connected_device_id:sensor.id,taken_by:null,measured_at:measuredAt
  }).select("id,temperature_c,is_alert,measured_at").single();
  if(added.error)throw added.error;
  const updated=await c.from("kitchen_connected_devices").update({
   status:"online",last_checked_at:measuredAt,last_temperature_c:degrees,last_error:null
  }).eq("id",sensor.id).eq("room_id",sensor.room_id);
  if(updated.error)throw updated.error;
  return {reading:added.data,alert:isAlert,sensor_id:sensor.id};
 }catch(err){
  console.error("Govee sync failed for sensor",sensor.id,err);
  const message=err instanceof Error?err.message:"Lecture du capteur impossible";
  return await failed(message.slice(0,180),503);
 }
}

async function syncManualGovee(c:any,sensor:any,key:string){
 if(sensor.last_checked_at&&Date.now()-Date.parse(sensor.last_checked_at)<60000)
  return {error:"Actualisation limitée à une fois par minute et par capteur",statusCode:429,skipped:true};
 return await syncGoveeDevice(c,sensor,key);
}
async function syncAllGovee(c:any){
 const [rooms,sensors]=await Promise.all([
  query(await c.from("kitchen_cold_rooms").select("id,label").is("archived_at",null).is("deleted_at",null)),
  query(await c.from("kitchen_connected_devices").select("*").eq("provider","govee").eq("kind","cold_room"))
 ]);
 const names=new Map(rooms.map((r:any)=>[r.id,r.label]));
 const active=sensors.filter((s:any)=>names.has(s.room_id));
 if(!active.length)return {total:0,received:0,skipped:0,failed:0,devices:[]};
 const key=await goveeKey(c),devices:any[]=[];
 for(let offset=0;offset<active.length;offset+=4){
  const batch=await Promise.all(active.slice(offset,offset+4).map(async(sensor:any)=>{
   const label=names.get(sensor.room_id);
   try{
    const result=await syncManualGovee(c,sensor,key);
    if("reading" in result&&result.reading)return {label,status:"received",temperature_c:result.reading.temperature_c,measured_at:result.reading.measured_at,alert:result.alert};
    return {label,status:"skipped" in result&&result.skipped?"skipped":"failed",error:result.error||"Lecture non confirmée"};
   }catch{return {label,status:"failed",error:"Lecture du capteur impossible"};}
  }));
  devices.push(...batch);
 }
 return {total:active.length,received:devices.filter(d=>d.status==="received").length,skipped:devices.filter(d=>d.status==="skipped").length,failed:devices.filter(d=>d.status==="failed").length,devices};
}
async function syncAllMeater(c:any){
 const result=await pollMeater(c,true),s=await meaterStatus(c,true);
 const devices=s.probes.map((p:any)=>({label:p.label||("Sonde …"+p.device_id.slice(-8)),fresh:p.fresh,measured_at:p.measured_at}));
 return {total:devices.length,received:result?.received??0,fresh:devices.filter((p:any)=>p.fresh).length,skipped:result?.skipped===true,error:result?.error||s.last_error||null,devices};
}
async function syncAllSensors(c:any){
 const [govee,meater]=await Promise.allSettled([syncAllGovee(c),syncAllMeater(c)]);
 return {
  govee:govee.status==="fulfilled"?govee.value:{error:"Collecte Govee indisponible"},
  meater:meater.status==="fulfilled"?meater.value:{error:"Collecte MEATER indisponible"}
 };
}

Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(!["GET","POST"].includes(req.method))return answer({error:"Méthode non autorisée"},405);
 try{
 const c=db(),url=new URL(req.url),action=url.searchParams.get("action")||"list";
 if(action==="staff-list"&&req.method==="GET"){const rows=await query(await c.from("kitchen_staff").select("id,name").eq("active",true).order("name"));return answer({staff:rows})}
 if(action==="login"&&req.method==="POST"){
 const ip=(req.headers.get("x-forwarded-for")||"unknown").split(",")[0].trim();
 const since=new Date(Date.now()-15*60000).toISOString();const attempts=await c.from("kitchen_login_attempts").select("id",{count:"exact",head:true}).eq("ip",ip).eq("success",false).gte("attempted_at",since);
 if((attempts.count??0)>=8)return answer({error:"Trop de tentatives. Réessayez plus tard."},429);
 const x=await req.json(),pin=String(x.pin??"");const q=await c.from("kitchen_staff").select("id,name,active,session_version,pin_salt,pin_hash").eq("id",String(x.staff_id||"")).maybeSingle();const a=q.data;
 let ok=false;if(a?.active&&goodPin(pin)){const h=await hash(pin,Uint8Array.from(atob(a.pin_salt),c=>c.charCodeAt(0)));ok=h.pin_hash===a.pin_hash}
 await c.from("kitchen_login_attempts").insert({staff_id:a?.id??null,ip,success:ok});
 if(!ok)return answer({error:"Identifiant ou code PIN incorrect"},401);
 return answer({token:await token(c,"kitchen-staff",a.id,a.session_version),staff:{id:a.id,name:a.name}});
 }
if(action==="meater-auto-sync"&&req.method==="POST"){
 const payload=await req.json().catch(()=>null),timestamp=payload?.timestamp,signature=payload?.signature;
 if(!Number.isSafeInteger(timestamp)||Math.abs(Date.now()-timestamp*1000)>120000||typeof signature!=="string"||!/^[A-Za-z0-9_-]{43}$/.test(signature))return forbidden();
 if(signature!==await mac(await secret(c),"kitchen-meater-cron:"+timestamp))return forbidden();
 return answer(await pollMeater(c,false));
 }
 if(action==="govee-auto-sync"&&req.method==="POST"){
  const payload=await req.json().catch(()=>null);
  const timestamp=payload?.timestamp,signature=payload?.signature;
  if(!Number.isSafeInteger(timestamp)||Math.abs(Date.now()-timestamp*1000)>120000||
     typeof signature!=="string"||!/^[A-Za-z0-9_-]{43}$/.test(signature))
   return forbidden();
  if(signature!==await mac(await secret(c),"kitchen-govee-cron:"+timestamp))return forbidden();
  const due=await c.rpc("kitchen_govee_due_rooms",{p_now:new Date().toISOString()});
  if(due.error)throw due.error;
  if(!due.data?.length)return answer({attempted:0,received:0,failed:0,skipped:0});
  const apiKey=await goveeKey(c);
  const claimed=await c.rpc("kitchen_claim_govee_due");
  if(claimed.error)throw claimed.error;
  const eligible=claimed.data||[];
  let received=0,failed=0;
  for(const entry of eligible){
   const sensor=entry.sensor;
   try{
    const result=await syncGoveeDevice(c,sensor,apiKey,entry.slot_at);
    if("reading" in result)received++;
    else failed++;
   }catch(err){console.error("Govee collection error for sensor",sensor.id,err);failed++}
  }
  return answer({attempted:eligible.length,received,failed,skipped:Math.max(0,due.data.length-eligible.length)});
 }
 const u=await user(c,req);if(!u)return answer({error:"Session expirée ou accès non autorisé"},401);
  if(u.scope==="viewer"&&req.method!=="GET")return answer({error:"Ce pouvoir autorise uniquement la consultation de la cuisine."},403);
 if(action==="govee-live"&&req.method==="GET")return answer(await goveeLive(c));
 if(action==="meater-live"&&req.method==="GET")return answer(await meaterLive(c));
 if(action==="meater-graph-live"&&req.method==="GET")return answer(await meaterLive(c,true));
 if(action==="meater-status"&&req.method==="GET")return answer(await meaterStatus(c,u.scope==="admin"));
 if(action==="meater-paths"&&req.method==="GET"){
  const fields="id,device_id,label,slot,armed_at,status,started_at,deadline_at,trigger_c,cold_c,cold_at,heating,hot_c,hot_at,reached_c,finished_at,last_measure_at,last_record_at,last_c,last_ambient_c,reason";
  const [cfg,probes,active,history]=await Promise.all([
   c.from("kitchen_meater_settings").select("enabled,vault_secret_id,last_ok_at,last_poll_at,last_error").eq("id",1).single(),
   c.from("kitchen_meater_probes").select("device_id,slot,label,present,internal_c,ambient_c,measured_at").not("slot","is",null).order("slot"),
   c.from("kitchen_meater_paths").select(fields).in("status",["armed","running"]).order("slot"),
   c.from("kitchen_meater_paths").select(fields).in("status",["target","expired","cancelled"]).order("finished_at",{ascending:false}).limit(50)
  ]);
  for(const q of [cfg,probes,active,history])if(q.error)throw meaterDatabaseError("parcours technique",q.error);
  return answer({now:new Date().toISOString(),configured:!!cfg.data.vault_secret_id,professional:cfg.data.enabled,last_ok_at:cfg.data.last_ok_at,last_poll_at:cfg.data.last_poll_at,last_error:cfg.data.last_error,can_write:u.scope==="admin"||(u.scope==="staff"&&!u.existingAccount),probes:probes.data,paths:[...active.data,...history.data]});
 }
 if(action.startsWith("meater-path-history:")&&req.method==="GET"){
  const id=action.slice("meater-path-history:".length);if(!uuid(id))return answer({error:"Parcours invalide"},400);
  const q=await c.from("kitchen_meater_path_samples").select("measured_at,internal_c,ambient_c,event").eq("path_id",id).order("measured_at").limit(500);
  if(q.error)throw meaterDatabaseError("historique du parcours",q.error);return answer({samples:q.data});
 }
 if(action==="meater-history"&&req.method==="GET"){
 const id=url.searchParams.get("reheat_id");if(!uuid(id))return answer({error:"Cycle invalide"},400);
 const q=await c.from("kitchen_meater_samples").select("measured_at,internal_c,ambient_c,received_at").eq("reheat_id",id).order("measured_at",{ascending:false}).limit(1000);
 if(q.error)throw q.error;return answer({samples:(q.data||[]).reverse()});
 }
 if(action==="pms-overview"&&req.method==="GET"){
 const [plan,alerts,records]=await Promise.all([
 c.from("kitchen_pms_plan").select("*").order("category").order("title"),
 c.rpc("kitchen_pms_open_alerts"),c.from("kitchen_pms_records").select("*").order("observed_at",{ascending:false}).order("id",{ascending:false}).limit(50)]);
 for(const q of [plan,alerts,records])if(q.error)throw q.error;
 return answer({plan:plan.data,alerts:alerts.data,records:records.data,specs:PMS_SPECS});
 }
 if(action==="pms-history"&&req.method==="GET"){
 const offset=Number(url.searchParams.get("offset")||"0"),code=url.searchParams.get("code");
 if(!Number.isSafeInteger(offset)||offset<0||offset>1000000||(code&&!PMS_SPECS[code]))return answer({error:"Filtre invalide"},400);
 let q=c.from("kitchen_pms_records").select("*",{count:"exact"});if(code)q=q.eq("code",code);
 const r=await q.order("observed_at",{ascending:false}).order("id",{ascending:false}).range(offset,offset+99);if(r.error)throw r.error;return answer({records:r.data,total:r.count,offset,has_more:offset+(r.data||[]).length<(r.count||0)});
 }
 if(action==="pms-followups"&&req.method==="GET"){
 const id=url.searchParams.get("id");if(!uuid(id))return answer({error:"Dossier invalide"},400);
 const r=await c.from("kitchen_pms_followups").select("*").eq("record_id",id).order("event_seq",{ascending:true});if(r.error)throw r.error;return answer({followups:r.data});
 }
 if(action==="list"&&req.method==="GET"){
 const taskDay=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
 const nextTaskDay=new Date(Date.parse(taskDay+"T12:00:00Z")+86400000).toISOString().slice(0,10);
 const [rooms,ovens,dishes,defaults,tasks,staff,reheats,cold,checks,notes,connected,account,invalidated,coldOverview,nextTasks]=await Promise.all([
 query(await c.from("kitchen_cold_rooms").select("*").order("room_type").order("room_number")),
 query(await c.from("kitchen_ovens").select("*").eq("active",true).order("oven_number")),
 query(await c.from("kitchen_dish_types").select("*").eq("active",true).order("label")),
 (async()=>{const q=await c.from("kitchen_defaults").select("*").eq("id",1).single();if(q.error)throw q.error;return q.data})(),
 query(await c.rpc("kitchen_task_calendar",{p_day:taskDay})),
 query(await c.from("kitchen_staff").select("id,name,active,personnel_id").order("name")),
 query(await c.from("kitchen_reheats").select("*").order("started_at",{ascending:false}).limit(300)),
 query(await c.from("kitchen_cold_readings").select("*").is("invalidated_at",null).order("measured_at",{ascending:false}).limit(500)),
 query(await c.from("kitchen_task_checks").select(taskCheckColumns).order("performed_at",{ascending:false}).limit(300)),
 u.scope==="admin"?query(await c.from("kitchen_corrective_actions").select("*").order("created_at",{ascending:false}).limit(300)):Promise.resolve([]),
 query(await c.from("kitchen_connected_devices").select("id,kind,provider,label,model,room_id,device_identifier,raw_unit,status,last_checked_at,last_temperature_c,last_error,created_at").order("created_at",{ascending:false}).limit(80)),
 u.scope==="admin"?(async()=>{const q=await c.from("kitchen_govee_credentials").select("id").eq("id",1).maybeSingle();if(q.error)throw q.error;return {govee_key_configured:!!q.data}})():Promise.resolve(null),
 u.scope==="admin"?query(await c.from("kitchen_cold_readings").select("id,room_id,temperature_c,measured_at,invalidated_at,invalidated_by,invalidation_reason").not("invalidated_at","is",null).order("invalidated_at",{ascending:false}).limit(200)):Promise.resolve([]),
 query(await c.rpc("kitchen_cold_room_overview")),
 query(await c.rpc("kitchen_task_calendar",{p_day:nextTaskDay}))
 ]);
 const catalog=(rows:any[],day:string)=>rows.filter(t=>t.active&&t.starts_on<=day&&(!t.ends_on||t.ends_on>=day)&&(t.recurrence!=="once"||t.starts_on===day||t.single_day)&&(u.scope!=="staff"||u.existingAccount||!t.assigned_to||t.assigned_to===u.id))
 .map(t=>({id:t.id,label:t.label,assigned_to:t.assigned_to,recurrence:t.recurrence,weekdays:t.weekdays,scheduled_time:t.scheduled_time,starts_on:t.starts_on,ends_on:t.ends_on})).sort((a,b)=>a.id.localeCompare(b.id));
 const taskPlan=catalog(tasks,taskDay),nextTaskPlan=catalog(nextTasks,nextTaskDay);
 return answer({me:u,rooms,ovens,dishes,defaults,task_plan:{date:taskDay,tasks:taskPlan},task_plan_next:JSON.stringify(taskPlan)!==JSON.stringify(nextTaskPlan)?{date:nextTaskDay,tasks:nextTaskPlan}:null,tasks:tasks.filter((t:any)=>t.scheduled),optional_tasks:tasks.filter((t:any)=>!t.scheduled&&t.active&&t.recurrence==="on_demand"&&t.starts_on<=taskDay&&(!t.ends_on||t.ends_on>=taskDay)),task_settings:u.scope==="admin"?tasks:undefined,staff,reheats,cold,checks,notes,connected,account,invalidated,cold_overview:coldOverview,now:new Date().toISOString()});
 }
 
if(action==="cold-room-chart"&&req.method==="GET"){
 const roomId=url.searchParams.get("room_id")||"";
 const period=url.searchParams.get("period")||"day";
 const day=url.searchParams.get("date")||"";
 if(!uuid(roomId))return answer({error:"Chambre froide invalide"},400);
 if(!["day","week","month","year"].includes(period))return answer({error:"Période invalide"},400);
 if(!/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(day)||
    !Number.isFinite(Date.parse(day+"T12:00:00Z"))||
    new Date(day+"T12:00:00Z").toISOString().slice(0,10)!==day)
  return answer({error:"Date invalide"},400);
 const roomResult=await c.from("kitchen_cold_rooms")
  .select("id,label,room_number,room_type,min_c,max_c,archived_at")
  .eq("id",roomId).is("deleted_at",null).maybeSingle();
 if(roomResult.error)throw roomResult.error;
 if(!roomResult.data)return answer({error:"Chambre introuvable"},404);
 const series=await c.rpc("kitchen_cold_room_history_chart",{
  p_room_id:roomId,p_period:period,p_anchor:day
 });
 if(series.error)throw series.error;
 const raw=Array.isArray(series.data)?series.data:[];
 const boundary=raw[0];
 if(!boundary?.window_start||!boundary?.window_end)
  return answer({error:"Fenêtre historique indisponible"},503);
 const points=raw.filter((r:any)=>r.bucket_at&&Number(r.sample_count)>0).map((r:any)=>({
  at:r.bucket_at,min_c:Number(r.min_c),mean_c:Number(r.mean_c),max_c:Number(r.max_c),
  count:Number(r.sample_count),alerts:Number(r.alert_count)
 }));
 let count=0,alerts=0,totalC=0,lowest:number|null=null,highest:number|null=null;
 for(const r of raw){
  const samples=Number(r.sample_count)||0;
  if(!samples)continue;
  count+=samples;alerts+=Number(r.alert_count)||0;totalC+=Number(r.sum_c)||0;
  lowest=lowest===null?Number(r.min_c):Math.min(lowest,Number(r.min_c));
  highest=highest===null?Number(r.max_c):Math.max(highest,Number(r.max_c));
 }
 return answer({room:roomResult.data,period,date:day,
  start_at:boundary.window_start,end_at:boundary.window_end,
  points,summary:{readings:count,alerts,
   min_c:lowest,mean_c:count?Math.round(totalC/count*100)/100:null,max_c:highest},
  source:"kitchen_cold_readings",time_zone:"Europe/Paris",
  aggregation:period==="day"?"5min":period==="week"?"hour":period==="month"?"day":"month"});
}
if(action==="cold-history"&&req.method==="GET"){
 const roomId=url.searchParams.get("room_id")||"",offsetRaw=url.searchParams.get("offset")||"0",limitRaw=url.searchParams.get("limit")||"100";
 if(roomId&&!uuid(roomId))return answer({error:"Identifiant de chambre invalide"},400);
 if(!/^\d+$/.test(offsetRaw)||!/^\d+$/.test(limitRaw))return answer({error:"Pagination invalide"},400);
 const offset=Number(offsetRaw),limit=Number(limitRaw);
 if(!Number.isSafeInteger(offset)||offset<0||offset>1000000||!Number.isSafeInteger(limit)||limit<1||limit>500)
  return answer({error:"Pagination hors limites"},400);
 let q=c.from("kitchen_cold_readings").select("id,room_id,measured_at,temperature_c,is_alert,source,taken_by,connected_device_id",{count:"exact"}).is("invalidated_at",null).order("measured_at",{ascending:false}).order("id",{ascending:false}).range(offset,offset+limit-1);
 if(roomId)q=q.eq("room_id",roomId);
 const result=await q;
 if(result.error)throw result.error;
 return answer({readings:result.data||[],total:result.count??0,offset,limit,has_more:offset+(result.data?.length||0)<(result.count??0)});
}
 
if(action==="task-settings"&&req.method==="GET"){
 if(u.scope!=="admin")return forbidden();
 const day=url.searchParams.get("date")||"";
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day+"T12:00:00Z"))||new Date(day+"T12:00:00Z").toISOString().slice(0,10)!==day)return answer({error:"Date invalide"},400);
 return answer({tasks:await query(await c.rpc("kitchen_task_calendar",{p_day:day}))});
 }

 if(action==="task-photo"&&req.method==="GET"){
  if(u.scope!=="admin")return forbidden();
  const id=url.searchParams.get("id");if(!uuid(id))return answer({error:"Validation invalide"},400);
  const q=await c.from("kitchen_task_checks").select("photo_path,photo_sha256,photo_bytes").eq("id",id).maybeSingle();
  if(q.error)throw q.error;if(!q.data?.photo_path)return answer({error:"Aucune photo enregistrée pour cette validation"},404);
  const photo=await c.storage.from(TASK_PHOTO_BUCKET).download(q.data.photo_path);
  if(photo.error||!photo.data)return answer({error:"Preuve photographique indisponible. Prévenez le responsable."},503);
  const bytes=new Uint8Array(await photo.data.arrayBuffer());
  if(bytes.length!==q.data.photo_bytes||await taskPhotoDigest(bytes)!==q.data.photo_sha256)return answer({error:"Intégrité de la photo non vérifiée"},409);
  return new Response(bytes,{headers:{...cors,"Content-Type":"image/jpeg","Cache-Control":"no-store, private","X-Content-Type-Options":"nosniff","Content-Disposition":"inline; filename=nettoyage.jpg"}});
 }
 if(action==="task-report"&&req.method==="GET"){
 const day=url.searchParams.get("date")||"";
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day+"T12:00:00Z")))
  return answer({error:"Date du rapport invalide"},400);
 const [tasksResult,checksResult]=await Promise.all([
  c.rpc("kitchen_task_calendar",{p_day:day}),
  c.from("kitchen_task_checks").select(taskCheckColumns).eq("performed_on",day)
 ]);
 if(tasksResult.error)throw tasksResult.error;if(checksResult.error)throw checksResult.error;
 const checks=checksResult.data||[],checked=new Set(checks.map((v:any)=>v.task_id));
 return answer({date:day,tasks:(tasksResult.data||[]).filter((t:any)=>t.scheduled||checked.has(t.id)).map((t:any)=>({...t,active:t.scheduled||checked.has(t.id)})),checks});
}
 if(action==="govee-test"&&req.method==="GET"){
 if(u.scope!=="admin")return forbidden();
 const key=await goveeKey(c);
 const response=await goveeCall(key,"/user/devices");
 const all=Array.isArray(response.data)?response.data:response.data?.devices;
 if(!Array.isArray(all))return answer({error:"Govee ne renvoie pas une liste d'appareils exploitable"},502);
 const linked=await c.from("kitchen_connected_devices").select("model,device_identifier,raw_unit")
    .eq("provider","govee").eq("kind","cold_room");
 if(linked.error)throw linked.error;
 const relevant=all.filter((device:any)=>{
  if(!validDeviceId(device.device)||typeof device.sku!=="string")return false;
  const sku=device.sku.toUpperCase();
  return sku==="H5179"||sku==="H5192"||
    (Array.isArray(device.capabilities)&&device.capabilities.some((cap:any)=>cap.instance==="sensorTemperature"));
 });
 const check=async (device:any)=>{
  const sku=String(device.sku),id=String(device.device);
  const registered=(linked.data||[]).find((sensor:any)=>sensor.model===sku&&sensor.device_identifier===id);
  const inputUnit=registered?.raw_unit|| (sku.toUpperCase()==="H5179"?"F":null);
  const base={device:id,sku,label:String(device.deviceName||sku).slice(0,80),
    raw_unit:inputUnit,unit_source:registered?"configured":sku.toUpperCase()==="H5179"?"h5179_default":"unknown"};
  const supportsTemperature=Array.isArray(device.capabilities)&&device.capabilities.some((cap:any)=>cap.instance==="sensorTemperature");
  if(!supportsTemperature)return {...base,temperature_capability:false,status:"non_expose",online:null,raw_temperature:null,temperature_c:null,raw_humidity:null};
  try{
   const reading=await goveeCall(key,"/device/state",{requestId:crypto.randomUUID(),payload:{sku,device:id}});
   const caps=Array.isArray(reading.payload?.capabilities)?reading.payload.capabilities:[];
   const onlineValue=caps.find((cap:any)=>cap.instance==="online")?.state?.value;
   const rawTemp=caps.find((cap:any)=>cap.instance==="sensorTemperature")?.state?.value;
   const rawHumidity=caps.find((cap:any)=>cap.instance==="sensorHumidity")?.state?.value;
   const numeric=(v:any)=>typeof v==="number"&&Number.isFinite(v)?v:typeof v==="string"&&v.trim()!==""&&Number.isFinite(Number(v))?Number(v):null;
   const temp=numeric(rawTemp),humidity=numeric(rawHumidity);
   const online=typeof onlineValue==="boolean"?onlineValue:null;
   return {...base,temperature_capability:true,online,
    raw_temperature:temp,temperature_c:temp!==null&&(inputUnit==="F"||inputUnit==="C")?temperatureToCelsius(temp,inputUnit):null,raw_humidity:humidity,
    status:online===false?"hors_ligne":temp===null?"sans_mesure":online===true?"donnees_recues":"statut_non_confirme"};
  }catch(err){
   const message=err instanceof Error?err.message:"Erreur de communication";
   return {...base,temperature_capability:true,status:"erreur_api",online:null,raw_temperature:null,temperature_c:null,raw_humidity:null,
     error:message.slice(0,200)};
  }
 };
 const checked=await Promise.all(relevant.slice(0,8).map(check));
 const discovered=all.filter((d:any)=>validDeviceId(d.device)&&typeof d.sku==="string").map((d:any)=>({
  device:d.device,sku:d.sku,label:String(d.deviceName||d.sku).slice(0,80),
  temperature_capability:Array.isArray(d.capabilities)&&d.capabilities.some((cap:any)=>cap.instance==="sensorTemperature")
 }));
 return answer({key_verified:true,devices:checked,discovered,matching_devices:relevant.length,checked_devices:checked.length,
   account_devices:all.length,unit_confirmed:checked.some((d:any)=>d.raw_unit==="F"||d.raw_unit==="C")});
 }
 if(action==="govee-discover"&&req.method==="GET"){
 if(u.scope!=="admin")return forbidden();
 const key=await goveeKey(c),result=await goveeCall(key,"/user/devices");
 const devices=Array.isArray(result.data)?result.data:result.data?.devices;
 return answer({devices:(Array.isArray(devices)?devices:[]).filter((d:any)=>validDeviceId(d.device)&&typeof d.sku==="string").map((d:any)=>({
 device:d.device,sku:d.sku,label:String(d.deviceName||d.sku),type:String(d.type||""),
 temperature_capability:Array.isArray(d.capabilities)&&d.capabilities.some((cap:any)=>cap.instance==="sensorTemperature")
 }))});
 }
 if(req.method!=="POST")return answer({error:"Action inconnue"},404);
 if(action==="task-check"){
  if(u.scope!=="staff"||u.existingAccount)return forbidden();
  if(Number(req.headers.get("content-length")||0)>410000)return answer({error:"Photo trop volumineuse"},413);
  const raw=await req.text();if(raw.length>410000)return answer({error:"Photo trop volumineuse"},413);
  let x:any;try{x=JSON.parse(raw);}catch{return answer({error:"Saisie invalide"},400);}
  if(!x||!uuid(x.task_id)||!pmsDate(x.day))return answer({error:"Tâche ou date invalide. Actualisez le site."},400);
  const day=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  if(day!==x.day)return answer({error:"La date a changé. Actualisez les tâches."},409);
  if(typeof x.photo_jpeg!=="string")return answer({error:"Photo obligatoire. Prenez une photo de la tâche réalisée."},400);
  const cal=await c.rpc("kitchen_task_calendar",{p_day:day});if(cal.error)throw cal.error;
  const task=(cal.data||[]).find((t:any)=>t.id===x.task_id);
  if(!task)return answer({error:"Tâche introuvable"},404);
  if(!task.scheduled&&!(task.active&&task.recurrence==="on_demand"&&task.starts_on<=day&&(!task.ends_on||task.ends_on>=day)))return answer({error:"Tâche non programmée aujourd’hui"},409);
  if(task.assigned_to&&task.assigned_to!==u.id)return forbidden();
  const prior=await c.from("kitchen_task_checks").select("id").eq("task_id",x.task_id).eq("performed_on",day).maybeSingle();
  if(prior.error)throw prior.error;if(prior.data)return answer({error:"Tâche déjà validée aujourd’hui. Actualisez."},409);
  const bytes=taskPhotoBytes(x.photo_jpeg);
  if(!bytes)return answer({error:"Photo JPEG invalide ou trop volumineuse. Reprenez la photo."},400);
  const digest=await taskPhotoDigest(bytes);
  const path=x.task_id+"/"+u.id+"/"+crypto.randomUUID()+".jpg";
  const storage=c.storage.from(TASK_PHOTO_BUCKET);
  const uploaded=await storage.upload(path,bytes,{contentType:"image/jpeg",upsert:false,cacheControl:"0"});
  if(uploaded.error)return answer({error:"Enregistrement de la photo impossible. La tâche n’a pas été validée."},503);
  const q=await c.rpc("kitchen_task_validate_photo",{p_task_id:x.task_id,p_agent:u.id,p_day:day,p_path:path,p_sha256:digest,p_bytes:bytes.length});
  // A definitive business rejection means that this unique upload cannot be referenced by a check.
  // On an uncertain transport error preserve the object: never delete potential evidence.
  if(q.error){console.error("task-photo: résultat de validation incertain",q.error.code);return answer({error:"Résultat incertain. Actualisez les tâches avant de réessayer."},503);}
  if(q.data?.error){const deleted=await storage.remove([path]);if(deleted.error)console.error("task-photo: nettoyage du fichier non associé impossible");return answer(q.data,Number(q.data.status)||400);}
  if(!q.data?.check)return answer({error:"Résultat incertain. Actualisez les tâches avant de réessayer."},503);
  return answer(q.data,201);
 }
 const x=await req.json().catch(()=>null);if(!x||typeof x!=="object")return answer({error:"Saisie JSON invalide"},400);
 if(action==="pms-record"){
 if(u.scope!=="admin"&&(u.scope!=="staff"||u.existingAccount))return forbidden();
 if(!uuid(x.request_id)||typeof x.code!=="string"||!PMS_SPECS[x.code])return answer({error:"Contrôle invalide"},400);
 const existing=await c.from("kitchen_pms_records").select("id,result,reasons").eq("request_id",x.request_id).maybeSingle();if(existing.error)throw existing.error;if(existing.data)return answer({record:existing.data,duplicate:true});
 const plan=await c.from("kitchen_pms_plan").select("applicable,revision").eq("code",x.code).single();if(plan.error)throw plan.error;
 const result=pmsEvaluate(x.code,x.payload,x.observed_at,plan.data.applicable);
 if("error" in result)return answer({error:result.error},400);
 const corrective=pmsText(x.corrective_action,4000),evidence=pmsText(x.evidence_ref,500);
 if(result.result==="alert"&&(!corrective||corrective.length<3))return answer({error:"Écart détecté : documentez l’action immédiate avant d’enregistrer. "+result.reasons.join(" · ")},409);
 const r=await c.from("kitchen_pms_records").insert({request_id:x.request_id,code:x.code,plan_revision:plan.data.revision,observed_at:x.observed_at,recorded_by:u.id,actor_name:u.name,payload:result.payload,result:result.result,reasons:result.reasons,corrective_action:corrective,evidence_ref:evidence,next_due:result.nextDue}).select("*").single();
 if(r.error){if(r.error.code==="23505")return answer({error:"Enregistrement déjà reçu, actualisez l’historique"},409);throw r.error;}return answer({record:r.data},201);
 }
 if(action==="pms-followup"){
 if(u.scope!=="admin"&&(u.scope!=="staff"||u.existingAccount))return forbidden();
 if(!uuid(x.id)||!["followup","closed","reopened"].includes(x.operation)||!pmsText(x.note,4000))return answer({error:"Suivi invalide"},400);
 if(x.operation!=="followup"&&u.scope!=="admin")return forbidden();
 const q=await c.rpc("kitchen_pms_followup",{p_id:x.id,p_action:x.operation,p_note:x.note.trim(),p_evidence:pmsText(x.evidence_ref,500),p_actor:u.id,p_name:u.name});if(q.error)throw q.error;return answer(q.data,q.data.error?Number(q.data.status)||400:200);
 }
 if(action==="meater-path-arm"||action==="meater-path-cancel"){
  if(u.scope!=="admin"&&(u.scope!=="staff"||u.existingAccount))return forbidden();
  if(action==="meater-path-arm"&&(typeof x.device_id!=="string"||!x.device_id||x.device_id.length>160))return answer({error:"Sonde invalide"},400);
  if(action==="meater-path-cancel"&&!uuid(x.id))return answer({error:"Parcours invalide"},400);
  const q=action==="meater-path-arm"?await c.rpc("kitchen_meater_path_arm",{p_device:x.device_id,p_actor:u.id}):await c.rpc("kitchen_meater_path_cancel",{p_id:x.id,p_actor:u.id});
  if(q.error)throw meaterDatabaseError("commande du parcours",q.error);return answer(q.data,q.data?.error?409:200);
 }
 if(action==="meater-attach"){
 if(u.scope!=="staff"||u.existingAccount)return forbidden();
 if(!uuid(x.reheat_id)||typeof x.device_id!=="string"||x.device_id.length<1||x.device_id.length>160)return answer({error:"Cycle ou sonde invalide"},400);
 const q=await c.rpc("kitchen_meater_attach",{p_reheat:x.reheat_id,p_device:x.device_id,p_actor:u.id});if(q.error)throw q.error;
 return answer(q.data,q.data.error?409:200);
 }
 if(action==="cold-reading"){
 if(u.scope!=="staff"||u.existingAccount)return forbidden();
 const room=(await c.from("kitchen_cold_rooms").select("*").eq("id",String(x.room_id||"")).maybeSingle()).data;
 const t=temp(x.temperature_c);if(!room||room.archived_at||room.deleted_at||t===null)return answer({error:"Chambre inactive ou température invalide"},400);
 const alert=t>Number(room.max_c)||(room.min_c!==null&&t<Number(room.min_c));
 const q=await c.from("kitchen_cold_readings").insert({room_id:room.id,temperature_c:t,is_alert:alert,taken_by:u.id}).select("*").single();if(q.error)throw q.error;
 return answer({reading:q.data,alert},201);
 }
 if(action==="start-reheat"){
 if(u.scope!=="staff"||u.existingAccount)return forbidden();
 const coldRoomId=String(x.cold_room_id||""),ovenId=String(x.oven_id||""),dishTypeId=String(x.dish_type_id||"");
 const t=temp(x.temperature_c,-10,90);
 if(!uuid(coldRoomId)||!uuid(ovenId)||!uuid(dishTypeId)||t===null)
   return answer({error:"Chambre froide, four, type de plat ou température à cœur manquant"},400);
 const [coldQ,ovenQ,dishQ,defaultsQ]=await Promise.all([
  c.from("kitchen_cold_rooms").select("id,label,archived_at,deleted_at").eq("id",coldRoomId).maybeSingle(),
  c.from("kitchen_ovens").select("id,oven_number,label,active").eq("id",ovenId).maybeSingle(),
  c.from("kitchen_dish_types").select("id,label,active").eq("id",dishTypeId).maybeSingle(),
  c.from("kitchen_defaults").select("*").eq("id",1).single()
 ]);
 for(const q of [coldQ,ovenQ,dishQ,defaultsQ])if(q.error)throw q.error;
 if(!coldQ.data||coldQ.data.archived_at||coldQ.data.deleted_at||!ovenQ.data?.active||!dishQ.data?.active)return answer({error:"Équipement ou type de plat non disponible"},400);
 const started=new Date(),minutes=Number(defaultsQ.data.reminder_minutes),due=new Date(started.getTime()+minutes*60000);
 const record={
  cold_room_id:coldRoomId,oven_id:ovenId,dish_type_id:dishTypeId,
  cold_room_label_snapshot:coldQ.data.label,oven_label_snapshot:ovenQ.data.label,dish_type_label_snapshot:dishQ.data.label,
  oven_number:ovenQ.data.oven_number,service_number:1,
  start_temperature_c:t,target_start_c:defaultsQ.data.target_start_c,target_end_c:defaultsQ.data.target_end_c,reminder_minutes:minutes,
  started_at:started.toISOString(),due_at:due.toISOString(),started_by:u.id
 };
 const q=await c.from("kitchen_reheats").insert(record).select("*").single();if(q.error)throw q.error;
 return answer({reheat:q.data},201);
 }
 if(action==="finish-reheat"){
 if(u.scope!=="staff"||u.existingAccount)return forbidden();
 if(!uuid(x.id))return answer({error:"Relevé invalide"},400);
 const t=temp(x.temperature_c,-10,120);if(t===null)return answer({error:"Température finale invalide"},400);
 const q=await c.from("kitchen_reheats").select("*").eq("id",x.id).maybeSingle();if(q.error)throw q.error;
 if(!q.data)return answer({error:"Relevé introuvable"},404);if(q.data.status!=="en_cours")return answer({error:"Relevé déjà terminé"},409);
 const now=new Date();
 const elapsedMs=now.getTime()-Date.parse(q.data.started_at);
 const withinConservativeDuration=Number.isFinite(elapsedMs)&&elapsedMs>=0&&elapsedMs<=60*60000;
 const target=Number(q.data.target_end_c??63),start=Number(q.data.start_temperature_c);
 const maxInitial=Math.max(3,Number(q.data.target_start_c??2)+1);
 const good=t>=Math.max(63,target)&&start>=0&&start<=maxInitial&&withinConservativeDuration;
 const afterReminder=now.getTime()>new Date(q.data.due_at).getTime();
 const changed=await c.from("kitchen_reheats").update({
    end_temperature_c:t,ended_at:now.toISOString(),ended_by:u.id,status:good?"seuils_respectes":"alerte"
  }).eq("id",x.id).eq("status","en_cours").select("*").maybeSingle();
 if(changed.error)throw changed.error;if(!changed.data)return answer({error:"Relevé modifié simultanément, actualisez"},409);
 return answer({reheat:changed.data,delta_c:Math.round((t-start)*100)/100,alert:!good,after_reminder:afterReminder,elapsed_minutes:Math.round(elapsedMs/600)/100,conservative_duration_ok:withinConservativeDuration});
 }
 if(!allowed(u,true))return forbidden();
 if(action==="sync-all-sensors")return answer(await syncAllSensors(c));
 if(action==="archive-room"){
 const id=String(x.id||"");if(!uuid(id))return answer({error:"Chambre invalide"},400);
 const room=await c.from("kitchen_cold_rooms").select("id,archived_at,deleted_at").eq("id",id).maybeSingle();
 if(room.error)throw room.error;if(!room.data||room.data.deleted_at)return answer({error:"Chambre introuvable"},404);
 if(room.data.archived_at)return answer({error:"Chambre déjà archivée"},409);
 const running=await c.from("kitchen_reheats").select("id",{count:"exact",head:true}).eq("cold_room_id",id).eq("status","en_cours");
 if(running.error)throw running.error;if((running.count??0)>0)return answer({error:"Un réchauffage est encore en cours depuis cette chambre"},409);
 const current=await c.from("kitchen_defaults").select("default_cold_room_id").eq("id",1).single();
 if(current.error)throw current.error;
 if(current.data.default_cold_room_id===id){
  const alternative=await c.from("kitchen_cold_rooms").select("id").neq("id",id).is("archived_at",null).is("deleted_at",null).limit(1);
  if(alternative.error)throw alternative.error;
  if(!alternative.data?.length)return answer({error:"Il faut conserver une chambre froide par défaut"},409);
  const changed=await c.from("kitchen_defaults").update({default_cold_room_id:alternative.data[0].id}).eq("id",1);if(changed.error)throw changed.error;
 }
 const q=await c.from("kitchen_cold_rooms").update({archived_at:new Date().toISOString(),archived_by:u.id}).eq("id",id).is("archived_at",null).is("deleted_at",null).select("id,archived_at").maybeSingle();
 if(q.error)throw q.error;if(!q.data)return answer({error:"Chambre mise à jour simultanément"},409);
 return answer({archived:q.data});
 }
 if(action==="request-room-delete-code"){
 const id=String(x.id||"");if(!uuid(id))return answer({error:"Chambre invalide"},400);
 const q=await c.from("kitchen_cold_rooms").select("*").eq("id",id).maybeSingle();
 if(q.error)throw q.error;if(!q.data||q.data.deleted_at)return answer({error:"Chambre introuvable"},404);
 if(!canDeleteRoom(q.data))return answer({error:"Suppression refusée : moins de 24 heures après création ou après un an d’archivage uniquement"},409);
 const otp=await c.auth.signInWithOtp({email:deletionEmail,options:{shouldCreateUser:false}});
 if(otp.error)return answer({error:"Authentification email indisponible. Vérifiez la configuration du compte et l’envoi des codes."},503);
 return answer({requested:true,message:"Un code de vérification a été demandé à l’adresse autorisée, sous réserve de la configuration de l’authentification email."});
 }
 if(action==="delete-room"){
 const id=String(x.id||""),code=String(x.code||"").trim();
 if(!uuid(id)||!/^[0-9]{6,8}$/.test(code))return answer({error:"Chambre ou code incorrect"},400);
 const q=await c.from("kitchen_cold_rooms").select("*").eq("id",id).maybeSingle();
 if(q.error)throw q.error;if(!q.data||q.data.deleted_at)return answer({error:"Chambre introuvable"},404);
 if(!canDeleteRoom(q.data))return answer({error:"Conditions de suppression non remplies"},409);
 const verified=await c.auth.verifyOtp({email:deletionEmail,token:code,type:"email"});
 if(verified.error||verified.data.user?.email?.toLowerCase()!==deletionEmail)return answer({error:"Code expiré ou non valide"},403);
 const running=await c.from("kitchen_reheats").select("id",{count:"exact",head:true}).eq("cold_room_id",id).eq("status","en_cours");
 if(running.error)throw running.error;if((running.count??0)>0)return answer({error:"Réchauffage en cours : suppression impossible"},409);
 const current=await c.from("kitchen_defaults").select("default_cold_room_id").eq("id",1).single();
 if(current.error)throw current.error;
 if(current.data.default_cold_room_id===id){
  const alternative=await c.from("kitchen_cold_rooms").select("id").neq("id",id).is("archived_at",null).is("deleted_at",null).limit(1);
  if(alternative.error)throw alternative.error;
  if(!alternative.data?.length)return answer({error:"Choisir une autre chambre par défaut avant suppression"},409);
  const migrated=await c.from("kitchen_defaults").update({default_cold_room_id:alternative.data[0].id}).eq("id",1);
  if(migrated.error)throw migrated.error;
 }
 const changed=await c.from("kitchen_cold_rooms").update({deleted_at:new Date().toISOString(),deleted_by:u.id}).eq("id",id).is("deleted_at",null).select("id,deleted_at").maybeSingle();
 if(changed.error)throw changed.error;if(!changed.data)return answer({error:"Chambre modifiée simultanément"},409);
 return answer({deleted:true,preserved_history:true});
 }

 
if(action==="pms-plan-save"){
 const code=x.code,v=x.config;if(typeof code!=="string"||!PMS_SPECS[code]||!Number.isInteger(x.revision)||x.revision<0||!v||!["pending","yes","no"].includes(v.applicable))return answer({error:"Configuration PMS invalide"},400);
 const config={applicable:v.applicable,responsible:pmsText(v.responsible,200)||"",procedure_ref:pmsText(v.procedure_ref,500)||"",frequency:pmsText(v.frequency,200)||"",next_review:v.next_review||null,justification:pmsText(v.justification,4000)||""};
 if((config.next_review&&!pmsDate(config.next_review))||(config.applicable!=="pending"&&(!config.responsible||!config.justification))||(config.applicable==="yes"&&(!config.procedure_ref||!config.frequency||!config.next_review)))return answer({error:"Responsable, justification, procédure, fréquence et date de revue requis selon le statut"},400);
 const q=await c.rpc("kitchen_pms_update_plan",{p_code:code,p_revision:x.revision,p_config:config,p_actor:u.id});if(q.error)throw q.error;return answer(q.data,q.data.error?Number(q.data.status)||400:200);
 }
 if(action==="meater-permission")return answer({error:"Ce formulaire a été supprimé. Actualisez le site (Ctrl + F5)."},410);
 if(action==="meater-qualification"){
 const id=x.device_id,ev=x.evidence;
 if(typeof id!=="string"||id.length<1||id.length>160||!ev||typeof ev!=="object")return answer({error:"Dossier invalide"},400);
 for(const k of ["cold_ref","cold_probe","hot_ref","hot_probe","reference_uncertainty"])if(typeof ev[k]!=="number"||!Number.isFinite(ev[k]))return answer({error:"Mesures numériques requises"},400);
 for(const k of ["manufacturer_certificate","reference_certificate"])if(typeof ev[k]!=="string"||ev[k].trim().length<3||ev[k].length>240)return answer({error:"Références de certificats requises"},400);
 if(typeof ev.transmission_verified!=="boolean"||typeof ev.hygiene_verified!=="boolean")return answer({error:"Contrôles requis"},400);
 const q=await c.rpc("kitchen_meater_record_qualification",{p_device:id,p_evidence:ev,p_actor:u.id});if(q.error)throw meaterDatabaseError("qualification",q.error);return answer(q.data,q.data.error?409:200);
 }
 if(action==="meater-login"){
 const email=typeof x.email==="string"?x.email.trim().toLowerCase():"",password=typeof x.password==="string"?x.password:"";
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||password.length<1||password.length>512)return answer({error:"Identifiants MEATER invalides"},400);
 let result;try{result=await meaterCall("/login",{email,password});}catch(err){return answer({error:err instanceof MeaterError?err.message:"Connexion impossible"},400);}
 if(typeof result.token!=="string"||result.token.length<20||result.token.length>8192)return answer({error:"Jeton MEATER invalide"},502);
 const q=await c.rpc("kitchen_meater_set_token",{p_token:result.token});
 if(q.error||q.data!==true)throw meaterDatabaseError("stockage sécurisé du jeton",q.error);
 return answer({configured:true,enabled:false});
 }
 if(action==="meater-test"){
 const result=await pollMeater(c,true);return answer(result,result?.error?400:200);
 }
 if(action==="meater-probe-config"){
 const id=x.device_id,slot=x.slot,label=typeof x.label==="string"?x.label.trim():"",qualified=x.qualified;
 if(typeof id!=="string"||id.length<1||id.length>160||!(slot===null||Number.isInteger(slot)&&slot>=1&&slot<=12)||!label||label.length>80||typeof qualified!=="boolean")return answer({error:"Configuration invalide"},400);
 const q=await c.rpc("kitchen_meater_configure_probe",{p_device:id,p_slot:slot,p_label:label,p_qualified:qualified,p_actor:u.id});if(q.error)throw meaterDatabaseError("affectation",q.error);
 return answer(q.data,q.data.error?409:200);
 }
 if(action==="meater-test-mode"){
 if(typeof x.enabled!=="boolean")return answer({error:"État d’essai invalide"},400);
 const q=await c.rpc("kitchen_meater_test_mode",{p_enabled:x.enabled});if(q.error)throw meaterDatabaseError("mode d’essai",q.error);return answer(q.data,q.data.error?409:200);
 }
 if(action==="meater-enable"){
 if(typeof x.enabled!=="boolean")return answer({error:"État invalide"},400);
 const q=await c.rpc("kitchen_meater_enable",{p_enabled:x.enabled});if(q.error)throw meaterDatabaseError("activation de la collecte",q.error);return answer(q.data,q.data.error?409:200);
 }
 if(action==="govee-save-key"){
 const key=String(x.api_key||"").trim();
 if(key.length<10||key.length>240)return answer({error:"Clé API Govee invalide"},400);
 const tested=await goveeCall(key,"/user/devices");
 if(tested.code!==200)return answer({error:"Clé Govee refusée"},400);
 const q=await c.rpc("kitchen_govee_set_api_key",{p_key:key});
 if(q.error)throw Error("Enregistrement sécurisé de la clé Govee impossible");
 return answer({configured:true,verified:true});
 }
if(action==="govee-add-sensor"){
 const roomId=String(x.room_id||""),sku=String(x.sku||""),device=String(x.device||""),unit=String(x.raw_unit||"");
 if(!uuid(roomId)||!/^H[0-9A-Z]{3,12}$/.test(sku)||!validDeviceId(device)||!["C","F"].includes(unit))
  return answer({error:"Chambre, modèle, identifiant ou unité invalide"},400);
 const [room,discovered]=await Promise.all([
  c.from("kitchen_cold_rooms").select("id").eq("id",roomId).is("archived_at",null).is("deleted_at",null).maybeSingle(),
  goveeCall(await goveeKey(c),"/user/devices")
 ]);
 if(room.error)throw room.error;if(!room.data)return answer({error:"Chambre froide introuvable"},404);
 const devices=Array.isArray(discovered.data)?discovered.data:discovered.data?.devices;
 const matched=(Array.isArray(devices)?devices:[]).find((d:any)=>d.device===device&&d.sku===sku);
 if(!matched)return answer({error:"Capteur absent du compte Govee"},404);
 if(!Array.isArray(matched.capabilities)||!matched.capabilities.some((cap:any)=>cap.instance==="sensorTemperature"))
  return answer({error:"Ce capteur ne présente pas de mesure de température accessible dans l'API"},409);
 const existing=await c.from("kitchen_connected_devices").select("id,label,status,room_id,raw_unit,model").eq("provider","govee").eq("device_identifier",device).maybeSingle();
 if(existing.error)throw existing.error;
 if(existing.data){
  if(existing.data.room_id===roomId&&existing.data.raw_unit===unit&&existing.data.model===sku)return answer({sensor:existing.data,unchanged:true});
  return answer({error:"Cette sonde est déjà enregistrée. Utilisez Modifier l’association sur sa fiche."},409);
 }
 const occupant=await c.from("kitchen_connected_devices").select("id").eq("provider","govee").eq("kind","cold_room").eq("room_id",roomId).maybeSingle();
 if(occupant.error)throw occupant.error;
 if(occupant.data)return answer({error:"Cette chambre possède déjà une sonde Govee. Choisissez une chambre libre."},409);
 const q=await c.from("kitchen_connected_devices").insert({
  kind:"cold_room",provider:"govee",label:String(matched.deviceName||sku).slice(0,80),
  model:sku,device_identifier:device,raw_unit:unit,room_id:roomId,status:"configured"
 }).select("id,label,status").single();
 if(q.error?.code==="23505")return answer({error:"Association modifiée entre-temps. Actualisez les sondes et choisissez une chambre libre."},409);
 if(q.error)throw q.error;return answer({sensor:q.data},201);
 }

if(action==="govee-reassign-sensor"){
 const id=String(x.id||""),roomId=String(x.room_id||"");
 if(!uuid(id)||!uuid(roomId))return answer({error:"Capteur ou chambre invalide"},400);
 const result=await c.rpc("kitchen_reassign_govee_sensor",{p_sensor_id:id,p_room_id:roomId,p_actor:u.id});
 if(result.error){
  if(result.error.code==="23505"||/déjà un thermomètre|already/i.test(result.error.message||""))
   return answer({error:"Cette chambre dispose déjà d’un thermomètre connecté"},409);
  if(/introuvable|inactive/i.test(result.error.message||""))return answer({error:result.error.message},400);
  throw result.error;
 }
 return answer({updated:true,id,room_id:roomId});
}
if(action==="govee-sync"){
 const id=String(x.id||"");if(!uuid(id))return answer({error:"Capteur invalide"},400);
 const q=await c.from("kitchen_connected_devices").select("*").eq("id",id).eq("provider","govee").eq("kind","cold_room").maybeSingle();
 if(q.error)throw q.error;if(!q.data)return answer({error:"Capteur introuvable"},404);
 const result=await syncManualGovee(c,q.data,await goveeKey(c));
 if("error" in result)return answer({error:result.error},result.statusCode);
 return answer(result);
}
if(action==="probe-register"){
 const model=String(x.model||"").trim(),label=String(x.label||"").trim();
 if(!["testo 104-IR","testo 104-IR BT"].includes(model)||label.length<2||label.length>80)
  return answer({error:"Nom ou modèle Testo invalide"},400);
 const q=await c.from("kitchen_connected_devices").insert({
  kind:"food_probe",provider:"testo",model,label,status:"pending",
  last_error:"Intégration automatique indisponible : saisie manuelle requise"
 }).select("id,label,model,status").single();
 if(q.error)throw q.error;return answer({probe:q.data},201);
 }
if(action==="set-staff-pin"||action==="create-staff"){
 const pin=String(x.pin||"");
 let staffId=String(x.staff_id||"");
 if(action==="create-staff"){
   const name=String(x.name||"").trim().toLocaleUpperCase("fr-FR");
   if(name.length<2||name.length>80)return answer({error:"Nom de salarié invalide"},400);
   const lookup=await c.from("kitchen_staff").select("id,personnel_id").eq("name",name).maybeSingle();
   if(lookup.error)throw lookup.error;
   if(!lookup.data?.personnel_id)return answer({error:"Salarié non rattaché à la cuisine : utilisez une fiche existante"},404);
   staffId=lookup.data.id;
 }
 if(!uuid(staffId)||!goodPin(pin))return answer({error:"Agent ou PIN invalide (6 à 8 chiffres)"},400);
 const q=await c.from("kitchen_staff").select("id,personnel_id,active,session_version").eq("id",staffId).maybeSingle();
 if(q.error)throw q.error;if(!q.data?.personnel_id)return answer({error:"Agent non rattaché à un salarié"},404);
 const staff=await c.from("college_personnel").select("id,name,archived").eq("id",q.data.personnel_id).maybeSingle();
 if(staff.error)throw staff.error;if(!staff.data||staff.data.archived)return answer({error:"Salarié archivé ou introuvable"},409);
 const h=await hash(pin);
 const changed=await c.from("kitchen_staff").update({...h,name:staff.data.name,active:true,session_version:Number(q.data.session_version)+1})
  .eq("id",staffId).eq("session_version",q.data.session_version).select("id,name,active,personnel_id").maybeSingle();
 if(changed.error)throw changed.error;if(!changed.data)return answer({error:"Compte modifié simultanément, actualisez"},409);
 return answer({staff:changed.data});
 }
 if(action==="set-staff-active"){
 const staffId=String(x.staff_id||"");
 if(!uuid(staffId)||typeof x.active!=="boolean")return answer({error:"Agent ou statut invalide"},400);
 const q=await c.from("kitchen_staff").select("id,personnel_id,active,pin_hash,session_version").eq("id",staffId).maybeSingle();
 if(q.error)throw q.error;if(!q.data?.personnel_id)return answer({error:"Agent non rattaché à un salarié"},404);
 if(x.active){
   if(!q.data.pin_hash)return answer({error:"Définir un PIN avant l'activation"},409);
   const st=await c.from("college_personnel").select("archived").eq("id",q.data.personnel_id).maybeSingle();
   if(st.error)throw st.error;if(st.data?.archived!==false)return answer({error:"Le salarié n'est pas actif"},409);
 }
 const changed=await c.from("kitchen_staff").update({active:x.active,session_version:Number(q.data.session_version)+1})
   .eq("id",staffId).eq("session_version",q.data.session_version).select("id,name,active,personnel_id").maybeSingle();
 if(changed.error)throw changed.error;if(!changed.data)return answer({error:"Compte modifié simultanément, actualisez"},409);
 return answer({staff:changed.data});
 }
 if(action==="add-room"){
 const type=String(x.room_type||""),n=Number(x.room_number),label=String(x.label||"").trim(),min=x.min_c==null?null:temp(x.min_c,-50,40),max=temp(x.max_c,-50,40);
 if(!["positive","negative"].includes(type)||!Number.isInteger(n)||n<1||n>99||label.length<2||label.length>80||max===null||(x.min_c!=null&&min===null)||(min!==null&&min>max))return answer({error:"Paramètres de la chambre invalides"},400);
 const q=await c.from("kitchen_cold_rooms").insert({room_type:type,room_number:n,label,min_c:min,max_c:max}).select("*").single();
 if(q.error?.code==="23505")return answer({error:"Numéro de chambre déjà utilisé pour ce type"},409);if(q.error)throw q.error;return answer({room:q.data},201);
 }
 if(action==="save-room-collection-schedule"){
 const id=String(x.id||""),mode=String(x.mode||""),enabled=x.enabled;
 const interval=x.interval_minutes,rawTimes=x.times;
 if(!uuid(id)||typeof enabled!=="boolean"||!["interval","times"].includes(mode)||
    !Number.isInteger(interval)||interval<5||interval>1440||
    !Array.isArray(rawTimes)||rawTimes.length>24||
    rawTimes.some((v:any)=>typeof v!=="string"||!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(v)))
  return answer({error:"Programmation invalide : fréquence de 5 à 1 440 min et heures au format HH:MM (24 maximum)"},400);
 const times=[...new Set<string>(rawTimes)].sort();
 if(mode==="times"&&!times.length)return answer({error:"Renseignez au moins une heure fixe"},400);
 const current=await c.from("kitchen_cold_rooms").select("auto_collection_enabled,auto_collection_mode,auto_collection_interval_minutes,auto_collection_times").eq("id",id).is("archived_at",null).is("deleted_at",null).maybeSingle();
 if(current.error)throw current.error;if(!current.data)return answer({error:"Chambre froide active introuvable"},404);
 if(current.data.auto_collection_enabled===enabled&&current.data.auto_collection_mode===mode&&Number(current.data.auto_collection_interval_minutes)===interval&&JSON.stringify(current.data.auto_collection_times)===JSON.stringify(times))
  return answer({updated:false,unchanged:true});
 const updated=await c.from("kitchen_cold_rooms").update({
  auto_collection_enabled:enabled,auto_collection_mode:mode,auto_collection_interval_minutes:interval,
  auto_collection_times:times,auto_collection_updated_at:new Date().toISOString()
 }).eq("id",id).is("archived_at",null).is("deleted_at",null).select("id,auto_collection_enabled,auto_collection_mode,auto_collection_interval_minutes,auto_collection_times").maybeSingle();
 if(updated.error)throw updated.error;if(!updated.data)return answer({error:"Chambre devenue inactive"},409);
 return answer({updated:true,schedule:updated.data});
 }
if(action==="update-room"){
 const id=String(x.id||""),label=String(x.label||"").trim();
 const min=x.min_c===null?null:temp(x.min_c,-50,40),max=temp(x.max_c,-50,40);
 if(!uuid(id)||label.length<2||label.length>80||max===null||(x.min_c!==null&&min===null)||(min!==null&&min>max))
   return answer({error:"Nom ou seuils de chambre incorrects"},400);
 const q=await c.from("kitchen_cold_rooms").update({label,min_c:min,max_c:max}).eq("id",id).is("archived_at",null).is("deleted_at",null).select("*").maybeSingle();
 if(q.error)throw q.error;if(!q.data)return answer({error:"Chambre introuvable"},404);return answer({room:q.data});
 }
 if(action==="add-oven"){
 const number=Number(x.oven_number),label=String(x.label||"").trim();
 if(!Number.isInteger(number)||number<1||number>99||label.length<2||label.length>80)
   return answer({error:"Numéro de four (1 à 99) et nom requis"},400);
 const q=await c.from("kitchen_ovens").insert({oven_number:number,label}).select("*").single();
 if(q.error?.code==="23505")return answer({error:"Ce numéro de four existe déjà"},409);
 if(q.error)throw q.error;return answer({oven:q.data},201);
 }
 if(action==="update-oven"){
 const id=String(x.id||""),label=String(x.label||"").trim();
 if(!uuid(id)||label.length<2||label.length>80)return answer({error:"Nom de four incorrect"},400);
 const q=await c.from("kitchen_ovens").update({label}).eq("id",id).select("*").maybeSingle();
 if(q.error)throw q.error;if(!q.data)return answer({error:"Four introuvable"},404);return answer({oven:q.data});
 }
 if(action==="add-dish-type"){
 const label=String(x.label||"").trim();
 if(label.length<2||label.length>80)return answer({error:"Nom de type de plat incorrect"},400);
 const q=await c.from("kitchen_dish_types").insert({label}).select("*").single();
 if(q.error?.code==="23505")return answer({error:"Ce type de plat existe déjà"},409);
 if(q.error)throw q.error;return answer({dish_type:q.data},201);
 }
 if(action==="update-dish-type"){
 const id=String(x.id||""),label=String(x.label||"").trim();
 if(!uuid(id)||label.length<2||label.length>80)return answer({error:"Type de plat invalide"},400);
 const q=await c.from("kitchen_dish_types").update({label}).eq("id",id).select("*").maybeSingle();
 if(q.error?.code==="23505")return answer({error:"Ce type de plat existe déjà"},409);
 if(q.error)throw q.error;if(!q.data)return answer({error:"Type de plat introuvable"},404);return answer({dish_type:q.data});
 }
 if(action==="save-defaults"){
 const roomId=String(x.default_cold_room_id||""),ovenId=String(x.default_oven_id||""),dishId=String(x.default_dish_type_id||"");
 const start=temp(x.target_start_c,-10,20),end=temp(x.target_end_c,63,120),minutes=Number(x.reminder_minutes);
 if(!uuid(roomId)||!uuid(ovenId)||!uuid(dishId)||start===null||end===null||!Number.isInteger(minutes)||minutes<1||minutes>60)
   return answer({error:"Valeurs par défaut invalides : cible de fin ≥ 63 °C, rappel de 1 à 60 min"},400);
 const refs=await Promise.all([
  c.from("kitchen_cold_rooms").select("id").eq("id",roomId).is("archived_at",null).is("deleted_at",null).maybeSingle(),
  c.from("kitchen_ovens").select("id").eq("id",ovenId).eq("active",true).maybeSingle(),
  c.from("kitchen_dish_types").select("id").eq("id",dishId).eq("active",true).maybeSingle()
 ]);
 if(refs.some(q=>q.error))throw refs.find(q=>q.error)!.error;
 if(refs.some(q=>!q.data))return answer({error:"Une des valeurs par défaut référence un équipement ou un plat absent"},400);
 const q=await c.from("kitchen_defaults").update({
  default_cold_room_id:roomId,default_oven_id:ovenId,default_dish_type_id:dishId,
  target_start_c:start,target_end_c:end,reminder_minutes:minutes,updated_at:new Date().toISOString()
 }).eq("id",1).select("*").single();
 if(q.error)throw q.error;return answer({defaults:q.data});
 }
 if(action==="add-task"||action==="update-task"){
 const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
 const day=String(x.effective_on||today),label=String(x.label||"").trim(),assigned=x.assigned_to||null;
 const starts=String(x.starts_on||day),ends=x.ends_on?String(x.ends_on):null,weekdays=x.weekdays??[1,2,3,4,5,6,7];
 const validDay=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+"T12:00:00Z"))&&new Date(v+"T12:00:00Z").toISOString().slice(0,10)===v;
 const recurrence=x.recurrence??"daily",priority=x.priority??"normal",scheduled=x.scheduled_time||null;
 const description=String(x.description||"").trim(),instructions=String(x.instructions||"").trim(),active=x.active??true;
 const id=action==="update-task"?x.id:null,scope=x.scope??"future";
 if((action==="update-task"&&!uuid(id))||label.length<3||label.length>100||(assigned&&!uuid(assigned))||
 !validDay(day)||day<today||!validDay(starts)||(ends&&(!validDay(ends)||ends<starts))||
 !Array.isArray(weekdays)||!weekdays.length||weekdays.some((d:any)=>!Number.isInteger(d)||d<1||d>7)||
 !["daily","weekly","once","monthly","on_demand"].includes(recurrence)||(recurrence==="monthly"&&new Set(weekdays).size!==1)||!["low","normal","high","urgent"].includes(priority)||
 !["future","single"].includes(scope)||typeof active!=="boolean"||description.length>1000||instructions.length>2000||
 (scheduled&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(scheduled)))return answer({error:"Paramètres de tâche invalides"},400);
 const q=await c.rpc("kitchen_task_save",{p_task_id:id,p_day:day,p_single_day:scope==="single",
 p_config:{label,assigned_to:assigned,active,starts_on:starts,ends_on:ends,weekdays,recurrence,priority,scheduled_time:scheduled,description,instructions},p_actor:u.id});
 if(q.error)throw q.error;
 return answer(q.data,q.data.error?Number(q.data.status)||400:action==="add-task"?201:200);
 }

 if(action==="invalidate-cold-reading"){
 const id=String(x.id||""),reason=String(x.reason||"").trim();
 if(!uuid(id)||reason.length<8||reason.length>500)return answer({error:"Relevé et motif de correction de 8 à 500 caractères requis"},400);
 const current=await c.from("kitchen_cold_readings").select("id,invalidated_at,room_id,temperature_c,measured_at").eq("id",id).maybeSingle();
 if(current.error)throw current.error;if(!current.data)return answer({error:"Relevé introuvable"},404);
 if(current.data.invalidated_at)return answer({error:"Ce relevé a déjà été invalidé"},409);
 const updated=await c.from("kitchen_cold_readings").update({
  invalidated_at:new Date().toISOString(),invalidated_by:u.id,invalidation_reason:reason
 }).eq("id",id).is("invalidated_at",null).select("id,invalidated_at").maybeSingle();
 if(updated.error)throw updated.error;if(!updated.data)return answer({error:"Relevé déjà modifié par un autre utilisateur"},409);
 return answer({invalidated:true,reading_id:id,kept_for_audit:true});
}
if(action==="corrective"){
 const type=String(x.entity_type||""),id=String(x.entity_id||""),note=String(x.note||"").trim();
 if(!["chambre_froide","remise_en_temperature","tache"].includes(type)||!uuid(id)||note.length<3||note.length>1000)return answer({error:"Observation invalide"},400);
 const table=type==="chambre_froide"?"kitchen_cold_readings":type==="remise_en_temperature"?"kitchen_reheats":"kitchen_task_checks";
 const exists=await c.from(table).select("id").eq("id",id).maybeSingle();if(exists.error)throw exists.error;if(!exists.data)return answer({error:"Événement introuvable"},404);
 const q=await c.from("kitchen_corrective_actions").insert({entity_type:type,entity_id:id,note,created_by:u.id}).select("*").single();if(q.error)throw q.error;return answer({note:q.data},201);
 }
 return answer({error:"Action inconnue"},404);
 }catch(e){if(e instanceof MeaterError)return answer({error:e.message},503);console.error("kitchen-api",e);return answer({error:"Erreur du service Cuisine"},500)}
});