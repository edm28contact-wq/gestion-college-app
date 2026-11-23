import {createClient} from "npm:@supabase/supabase-js@2.112.4";
const cors={"Access-Control-Allow-Origin":"https://edm28contact-wq.github.io","Access-Control-Allow-Headers":"content-type, x-admin-session, authorization, apikey","Access-Control-Allow-Methods":"GET,POST,OPTIONS"};
const enc=new TextEncoder();
const answer=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
function db(){const keys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}") as Record<string,string>;const key=keys.default??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");const url=Deno.env.get("SUPABASE_URL");if(!url||!key)throw Error("Configuration serveur absente");return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})}
function b64u(data:Uint8Array){return btoa(String.fromCharCode(...data)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"")}
function from64(value:string){const a=value.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-value.length%4)%4);return Uint8Array.from(atob(a),c=>c.charCodeAt(0))}
async function mac(key:string,msg:string){const k=await crypto.subtle.importKey("raw",enc.encode(key),{name:"HMAC",hash:"SHA-256"},false,["sign"]);return b64u(new Uint8Array(await crypto.subtle.sign("HMAC",k,enc.encode(msg))))}
async function secret(c:any){const q=await c.from("system_settings").select("admin_token").eq("id",1).single();if(q.error||!q.data?.admin_token)throw Error("Configuration d'accès indisponible");return String(q.data.admin_token)}
async function token(c:any,scope:string,id:string,version:number){const payload={u:id,v:version,scope,exp:Date.now()+4*3600000,n:crypto.randomUUID()};const body=b64u(enc.encode(JSON.stringify(payload)));return body+"."+await mac(await secret(c),body)}
async function user(c:any,req:Request){try{const t=req.headers.get("x-admin-session")||req.headers.get("authorization")?.replace(/^Bearer /,"")||"";const parts=t.split(".");if(parts.length!==2)return null;const [body,sig]=parts;if(await mac(await secret(c),body)!==sig)return null;const p=JSON.parse(new TextDecoder().decode(from64(body)));if(!p.u||Date.now()>Number(p.exp||0))return null;
if(p.scope==="kitchen-staff"){const q=await c.from("kitchen_staff").select("id,name,active,session_version,personnel_id").eq("id",p.u).maybeSingle();if(!q.data?.active||Number(q.data.session_version)!==Number(p.v)||!q.data.personnel_id)return null;const employee=await c.from("college_personnel").select("id,name,archived").eq("id",q.data.personnel_id).maybeSingle();if(employee.error||employee.data?.archived!==false)return null;return {scope:"staff",id:q.data.id,name:employee.data.name};}
if(p.scope&&p.scope!=="central-admin")return null;
const q=await c.from("admin_accounts").select("username,role,active,must_change_password,session_version,permissions").eq("username",p.u).maybeSingle();const a=q.data;if(!a?.active||a.must_change_password===true||Number(a.session_version)!==Number(p.v))return null;
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
 const u=await user(c,req);if(!u)return answer({error:"Session expirée ou accès non autorisé"},401);
  if(u.scope==="viewer"&&req.method!=="GET")return answer({error:"Ce pouvoir autorise uniquement la consultation de la cuisine."},403);
 if(action==="list"&&req.method==="GET"){
 const [rooms,ovens,dishes,defaults,tasks,staff,reheats,cold,checks,notes,connected,account,invalidated]=await Promise.all([
 query(await c.from("kitchen_cold_rooms").select("*").order("room_type").order("room_number")),
 query(await c.from("kitchen_ovens").select("*").eq("active",true).order("oven_number")),
 query(await c.from("kitchen_dish_types").select("*").eq("active",true).order("label")),
 (async()=>{const q=await c.from("kitchen_defaults").select("*").eq("id",1).single();if(q.error)throw q.error;return q.data})(),
 query(await c.from("kitchen_tasks").select("*").eq("active",true).order("label")),
 query(await c.from("kitchen_staff").select("id,name,active,personnel_id").order("name")),
 query(await c.from("kitchen_reheats").select("*").order("started_at",{ascending:false}).limit(300)),
 query(await c.from("kitchen_cold_readings").select("*").is("invalidated_at",null).order("measured_at",{ascending:false}).limit(500)),
 query(await c.from("kitchen_task_checks").select("*").order("performed_at",{ascending:false}).limit(300)),
 u.scope==="admin"?query(await c.from("kitchen_corrective_actions").select("*").order("created_at",{ascending:false}).limit(300)):Promise.resolve([]),
 query(await c.from("kitchen_connected_devices").select("id,kind,provider,label,model,room_id,device_identifier,raw_unit,status,last_checked_at,last_temperature_c,last_error,created_at").order("created_at",{ascending:false}).limit(80)),
 u.scope==="admin"?(async()=>{const q=await c.from("kitchen_govee_credentials").select("id").eq("id",1).maybeSingle();if(q.error)throw q.error;return {govee_key_configured:!!q.data}})():Promise.resolve(null),
 u.scope==="admin"?query(await c.from("kitchen_cold_readings").select("id,room_id,temperature_c,measured_at,invalidated_at,invalidated_by,invalidation_reason").not("invalidated_at","is",null).order("invalidated_at",{ascending:false}).limit(200)):Promise.resolve([])

 ]);
 return answer({me:u,rooms,ovens,dishes,defaults,tasks,staff,reheats,cold,checks,notes,connected,account,invalidated,now:new Date().toISOString()});
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
 
if(action==="task-report"&&req.method==="GET"){
 const day=url.searchParams.get("date")||"";
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day+"T12:00:00Z")))
  return answer({error:"Date du rapport invalide"},400);
 const [tasksResult,checksResult]=await Promise.all([
  c.from("kitchen_tasks").select("id,label,assigned_to,active,created_at").order("label"),
  c.from("kitchen_task_checks").select("id,task_id,performed_on,performed_at,performed_by").eq("performed_on",day)
 ]);
 if(tasksResult.error)throw tasksResult.error;if(checksResult.error)throw checksResult.error;
 return answer({date:day,tasks:tasksResult.data||[],checks:checksResult.data||[]});
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
 return answer({key_verified:true,devices:checked,matching_devices:relevant.length,checked_devices:checked.length,
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
 const x=await req.json().catch(()=>null);if(!x||typeof x!=="object")return answer({error:"Saisie JSON invalide"},400);
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
 if(now.getTime() <= new Date(q.data.due_at).getTime()-5*60*1000)
   return answer({error:"Saisie finale verrouillée : attendre les 5 dernières minutes du chrono."},409);
 const target=Number(q.data.target_end_c??63),start=Number(q.data.start_temperature_c);
 const maxInitial=Math.max(3,Number(q.data.target_start_c??2)+1);
 const good=t>=Math.max(63,target)&&start>=0&&start<=maxInitial;
 const afterReminder=now.getTime()>new Date(q.data.due_at).getTime();
 const changed=await c.from("kitchen_reheats").update({
    end_temperature_c:t,ended_at:now.toISOString(),ended_by:u.id,status:good?"seuils_respectes":"alerte"
  }).eq("id",x.id).eq("status","en_cours").select("*").maybeSingle();
 if(changed.error)throw changed.error;if(!changed.data)return answer({error:"Relevé modifié simultanément, actualisez"},409);
 return answer({reheat:changed.data,delta_c:Math.round((t-start)*100)/100,alert:!good,after_reminder:afterReminder});
 }
 if(action==="task-check"){
 if(u.scope!=="staff"||u.existingAccount)return forbidden();
 if(!uuid(x.task_id))return answer({error:"Tâche invalide"},400);
 const q=await c.from("kitchen_tasks").select("id,assigned_to").eq("id",x.task_id).eq("active",true).maybeSingle();if(!q.data)return answer({error:"Tâche absente"},404);
 if(u.scope!=="admin"&&q.data.assigned_to&&q.data.assigned_to!==u.id)return forbidden();
 const date=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
 const v=await c.from("kitchen_task_checks").insert({task_id:x.task_id,performed_on:date,performed_by:u.id}).select("*").single();
 if(v.error?.code==="23505")return answer({error:"Tâche déjà validée aujourd’hui"},409);if(v.error)throw v.error;return answer({check:v.data},201);
 }
 if(!allowed(u,true))return forbidden();
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
 if(!matched.capabilities?.some((cap:any)=>cap.instance==="sensorTemperature"))
  return answer({error:"Ce capteur ne présente pas de mesure de température accessible dans l'API"},409);
 const q=await c.from("kitchen_connected_devices").insert({
  kind:"cold_room",provider:"govee",label:String(matched.deviceName||sku).slice(0,80),
  model:sku,device_identifier:device,raw_unit:unit,room_id:roomId,status:"configured"
 }).select("id,label,status").single();
 if(q.error?.code==="23505")return answer({error:"Capteur ou chambre déjà associés"},409);
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
 if(q.data.last_checked_at && Date.now()-new Date(q.data.last_checked_at).getTime()<60*1000)
  return answer({error:"Actualisation limitée à une fois par minute et par capteur"},429);
 const now=new Date().toISOString();
 const state=await goveeCall(await goveeKey(c),"/device/state",{
  requestId:crypto.randomUUID(),payload:{sku:q.data.model,device:q.data.device_identifier}
 });
 const caps=state.payload?.capabilities||[];
 const online=caps.find((v:any)=>v.instance==="online")?.state?.value;
 const raw=caps.find((v:any)=>v.type==="devices.capabilities.property"&&v.instance==="sensorTemperature")?.state?.value;
 const value=typeof raw==="number"?raw:(typeof raw==="string"&&raw.trim()?Number(raw):null);
 if(online!==true||value===null||!Number.isFinite(value)){
  await c.from("kitchen_connected_devices").update({status:online===false?"offline":"error",last_checked_at:now,last_error:online===false?"Capteur hors ligne":"Température indisponible dans l'API"}).eq("id",id);
  return answer({error:"Capteur hors ligne ou mesure indisponible : aucun relevé ajouté"},409);
 }
 if(q.data.raw_unit!=="F"&&q.data.raw_unit!=="C")
  return answer({error:"Unité du capteur non configurée : aucun relevé ajouté"},422);
 const tc=temperatureToCelsius(value,q.data.raw_unit);
 if(tc< -60||tc>60)return answer({error:"Température reçue hors plage, unité du capteur à vérifier"},422);
 const room=await c.from("kitchen_cold_rooms").select("min_c,max_c,archived_at,deleted_at").eq("id",q.data.room_id).single();if(room.error)throw room.error;if(room.data.archived_at||room.data.deleted_at)return answer({error:"Chambre archivée : relevé automatique désactivé"},409);
 const alert=tc>Number(room.data.max_c)||(room.data.min_c!==null&&tc<Number(room.data.min_c));
 const insert=await c.from("kitchen_cold_readings").insert({
  room_id:q.data.room_id,temperature_c:tc,is_alert:alert,source:"govee_cloud",connected_device_id:id,taken_by:null,measured_at:now
 }).select("id,temperature_c,is_alert,measured_at").single();
 if(insert.error)throw insert.error;
 const updated=await c.from("kitchen_connected_devices").update({status:"online",last_checked_at:now,last_temperature_c:tc,last_error:null}).eq("id",id);
 if(updated.error)throw updated.error;
 return answer({reading:insert.data,alert,sensor_id:id});
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
 if(action==="add-task"){
 const label=String(x.label||"").trim(),assigned=x.assigned_to||null;
 if(label.length<3||label.length>100||(assigned&&!uuid(assigned)))return answer({error:"Tâche ou agent invalide"},400);
 if(assigned){const q=await c.from("kitchen_staff").select("id").eq("id",assigned).eq("active",true).maybeSingle();if(!q.data)return answer({error:"Agent introuvable"},400)}
 const q=await c.from("kitchen_tasks").insert({label,assigned_to:assigned}).select("*").single();if(q.error?.code==="23505")return answer({error:"Tâche déjà existante"},409);if(q.error)throw q.error;return answer({task:q.data},201);
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
 }catch(e){console.error("kitchen-api",e);return answer({error:"Erreur du service Cuisine"},500)}
});