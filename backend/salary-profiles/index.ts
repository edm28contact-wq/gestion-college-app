import {createClient} from "npm:@supabase/supabase-js@2.112.4";
const cors={"Access-Control-Allow-Origin":"https://edm28contact-wq.github.io","Access-Control-Allow-Headers":"content-type,authorization,x-admin-session,apikey","Access-Control-Allow-Methods":"GET,POST,OPTIONS"};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"}});
const isId=(value:unknown)=>typeof value==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const isMonth=(value:unknown)=>typeof value==="string"&&/^(20\d{2}|2100)-(0[1-9]|1[0-2])$/.test(value);
const numeric=(value:unknown,max:number,positive=false)=>{
 if(typeof value!=="number"||!Number.isFinite(value)||value<0||value>max||(positive&&value<=0))return null;
 return Math.round((value+Number.EPSILON)*100)/100;
};
const validWeekdays=(value:unknown)=>Array.isArray(value)&&value.length>=1&&value.length<=5&&
 value.every(day=>Number.isInteger(day)&&day>=1&&day<=5)&&new Set(value).size===value.length;
function benefits(value:unknown){
 if(!Array.isArray(value)||value.length>20)return null;
 const result:{label:string;amount:number}[]=[];
 for(const item of value){
  if(!item||typeof item!=="object")return null;
  const label=(item as Record<string,unknown>).label;
  const amount=numeric((item as Record<string,unknown>).amount,100000);
  if(typeof label!=="string"||label.trim().length<2||label.trim().length>100||amount===null)return null;
  result.push({label:label.trim(),amount});
 }
 return result;
}
function client(){
 const keys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}") as Record<string,string>;
 return createClient(Deno.env.get("SUPABASE_URL")!,keys.default||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false,autoRefreshToken:false}});
}
function decode(value:string){const part=value.replace(/-/g,"+").replace(/_/g,"/");return Uint8Array.from(atob(part+"=".repeat((4-part.length%4)%4)),c=>c.charCodeAt(0))}
async function administrator(db:any,req:Request){
 try{
  const raw=req.headers.get("x-admin-session")||req.headers.get("authorization")?.replace(/^Bearer /,"")||"";
  const parts=raw.split(".");if(parts.length!==2)return null;
  const setting=await db.from("system_settings").select("admin_token").eq("id",1).single();
  if(setting.error||!setting.data)return null;
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(String(setting.data.admin_token)),{name:"HMAC",hash:"SHA-256"},false,["verify"]);
  const signature=decode(parts[1]);
  if(!await crypto.subtle.verify("HMAC",key,signature,new TextEncoder().encode(parts[0])))return null;
  const session=JSON.parse(new TextDecoder().decode(decode(parts[0])));
  if(!session.u||!Number.isFinite(Number(session.exp))||Date.now()>=Number(session.exp))return null;
  const row=await db.from("admin_accounts").select("username,active,role,permissions,session_version").eq("username",session.u).maybeSingle();
  if(row.error||!row.data?.active||row.data.role!=="admin"||Number(row.data.session_version)!==Number(session.v))return null;
  if(row.data.permissions?.readonly===true)return null;
  return row.data.username as string;
 }catch{return null}
}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 try{
  const db=client(),user=await administrator(db,req);
  if(!user)return json({error:"Accès aux rémunérations réservé à l'administrateur autorisé."},403);
  const url=new URL(req.url),action=url.searchParams.get("action");
  if(action==="month-list"&&req.method==="GET"){
   const month=url.searchParams.get("month");
   if(!isMonth(month))return json({error:"Mois invalide"},400);
   const found=await db.from("college_salary_monthly")
    .select("employee_id,month,base_salary_gross,bonus_gross,weekly_hours,actual_hours,working_days,benefits_in_kind,version")
    .eq("month",month).limit(500);
   if(found.error)throw found.error;
   if(found.data?.length===500)return json({error:"Trop de fiches mensuelles pour une réponse complète."},409);
   return json({ok:true,month,records:found.data||[]});
  }
  if(action==="employee-month"&&req.method==="GET"){
   const employeeId=url.searchParams.get("employee_id"),month=url.searchParams.get("month");
   if(!isId(employeeId)||!isMonth(month))return json({error:"Salarié ou mois invalide"},400);
   const staff=await db.from("college_personnel").select("id,name").eq("id",employeeId).maybeSingle();
   if(staff.error)throw staff.error;
   if(!staff.data)return json({error:"Salarié introuvable"},404);
   const [current,previous]=await Promise.all([
    db.from("college_salary_monthly").select("employee_id,month,base_salary_gross,bonus_gross,weekly_hours,actual_hours,working_days,benefits_in_kind,version").eq("employee_id",employeeId).eq("month",month).maybeSingle(),
    db.from("college_salary_monthly").select("month,base_salary_gross,weekly_hours,working_days").eq("employee_id",employeeId).lt("month",month).order("month",{ascending:false}).limit(1).maybeSingle()
   ]);
   if(current.error)throw current.error;
   if(previous.error)throw previous.error;
   return json({ok:true,record:current.data||null,
    previous:previous.data||null,employee_id:employeeId,month});
  }
  if(action==="save-month"&&req.method==="POST"){
   const body=await req.json().catch(()=>null),employeeId=body?.employee_id,month=body?.month;
   if(!isId(employeeId)||!isMonth(month))return json({error:"Salarié ou mois invalide"},400);
   const base=numeric(body.base_salary_gross,1000000),
    bonus=numeric(body.bonus_gross,1000000),weekly=numeric(body.weekly_hours,60,true),
    actual=body.actual_hours===null?null:numeric(body.actual_hours,744),
    days=body.working_days,extras=benefits(body.benefits_in_kind);
   if(base===null||bonus===null||weekly===null||(body.actual_hours!==null&&actual===null)||
      !validWeekdays(days)||extras===null)
    return json({error:"Champs invalides : salaire, prime, heures hebdomadaires ou heures réelles."},400);
   const staff=await db.from("college_personnel").select("id,name").eq("id",employeeId).maybeSingle();
   if(staff.error)throw staff.error;
   if(!staff.data)return json({error:"Salarié introuvable"},404);
   const worker=String(staff.data.name||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase();
   if(/\b(MEDJEBER|MOREL)\b/.test(worker)&&days.includes(3))
    return json({error:"Ce salarié ne travaille pas le mercredi. Décochez ce jour."},400);
   const data={base_salary_gross:base,bonus_gross:bonus,weekly_hours:weekly,actual_hours:actual,
    working_days:[...days].sort((a,b)=>a-b),benefits_in_kind:extras,
    updated_by:user,updated_at:new Date().toISOString()};
   if(body.version===null){
    const inserted=await db.from("college_salary_monthly").insert({
     ...data,employee_id:employeeId,month,version:1
    }).select("employee_id,month,base_salary_gross,bonus_gross,weekly_hours,actual_hours,working_days,benefits_in_kind,version").single();
    if(inserted.error?.code==="23505")return json({error:"Une autre session a créé la fiche. Actualisez avant d'enregistrer."},409);
    if(inserted.error)throw inserted.error;
    return json({ok:true,record:inserted.data});
   }
   if(!Number.isInteger(body.version)||body.version<1)return json({error:"Version de fiche invalide"},400);
   const updated=await db.from("college_salary_monthly").update({...data,version:body.version+1})
    .eq("employee_id",employeeId).eq("month",month).eq("version",body.version)
    .select("employee_id,month,base_salary_gross,bonus_gross,weekly_hours,actual_hours,working_days,benefits_in_kind,version").maybeSingle();
   if(updated.error)throw updated.error;
   if(!updated.data)return json({error:"La fiche a été modifiée dans une autre session. Actualisez avant de réessayer."},409);
   return json({ok:true,record:updated.data});
  }
  return json({error:"Action non disponible"},404);
 }catch(error){
  console.error("college-salary-profiles",error instanceof Error?error.message:"Erreur backend");
  return json({error:"Service de suivi salarial indisponible. Aucune modification confirmée."},500);
 }
});
