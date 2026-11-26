// Extracts official, year-labeled rate tables. Never guesses missing figures.
export const URLS=Object.freeze({
 navigo:"https://www.iledefrance-mobilites.fr/titres-et-tarifs/detail/forfait-navigo-annuel",
 navigoData:"https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets/titres-et-tarifs/records?limit=50",
 transport2026:"https://www.iledefrance-mobilites.fr/tarifs-titre-de-transport-en-commun-2026",
 urssaf:"https://www.urssaf.fr/accueil/outils-documentation/taux-baremes/avantages-en-nature.html",
 urssafDetails:"https://www.urssaf.fr/accueil/employeur/cotisations/avantages-en-nature.html"
});
const normal=t=>String(t||"").replace(/&nbsp;|&#160;|&#xA0;/gi," ").replace(/&euro;|&#8364;/gi,"€").replace(/&agrave;/gi,"à").replace(/&eacute;/gi,"é").replace(/&rsquo;|&#8217;/gi,"’").replace(/[\u00a0\u202f]/g," ").replace(/\s+/g," ").trim();
const plain=html=>normal(String(html||"").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi," ")
 .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi," ").replace(/<[^>]*>/g," "));
const toCents=amount=>{
 const s=normal(amount).replace(/\s/g,"");
 if(!/^\d{1,6}[,.]\d{2}$/.test(s))return null;
 const [a,b]=s.replace(".",",").split(",");
 return Number(a)*100+Number(b);
};
const textMoney=str=>[...String(str||"").matchAll(/(\d[\d \u00a0\u202f]*[,.]\d{2})\s*€/g)].map(m=>toCents(m[1])).filter(Number.isInteger);
function tables(html){
 const found=[];
 for(const match of String(html||"").matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)){
  const block=match[1];
  const rows=[...block.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(row=>
   [...row[1].matchAll(/<(td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map(cell=>plain(cell[2])));
  found.push({caption:plain((block.match(/<caption\b[^>]*>([\s\S]*?)<\/caption>/i)||[])[1]||""),rows});
 }
 return found;
}
const bad=(source,message,status="unavailable")=>({status,source,message,payload:null});
const verified=(source,payload)=>({status:"verified",source,payload,message:"Barème daté vérifié sur la source officielle."});
export function verifyNavigo(html,year){
 const source=URLS.navigo,doc=plain(html);
 if(!doc.includes("Navigo Annuel"))return bad(source,"Page du forfait annuel non identifiable.");
 const yearMatch=doc.match(/Tarifs du forfait applicables au 1er janvier\s*(20\d{2})/i);
 if(!yearMatch||Number(yearMatch[1])!==year)return bad(source,"Le tarif officiel n'est pas publié pour l'année "+year+".","pending");
 const table=tables(html).find(t=>t.rows.some(r=>/Toutes zones 1 à 5/i.test(r[0]||"")));
 if(!table||!(/12e mois|12ème mois|12 ème mois|12\s*e\s*mois/i.test(doc)&&/offert/i.test(doc)))return bad(source,"Zonage annuel ou douzième mois offert non confirmé.");
 const line=table.rows.find(r=>/Toutes zones 1 à 5/i.test(r[0]||""));
 const monthly=toCents((line?.[1]||"").replace("€","").trim());
 if(!monthly||monthly<3000||monthly>30000)return bad(source,"Tarif mensuel toutes zones invalide.");
 return verified(source,{year,annualCents:monthly*11,paidMonthCents:monthly,payments:11,months:12,
  effectiveFrom:year+"-01-01",tariffVersion:"navigo-annuel-"+year});
}
export function verifyNavigoDataset(data,year){
 const source=URLS.navigoData;
 if(!data||!Array.isArray(data.results)||data.results.length>100)return bad(source,"Flux open data Île-de-France Mobilités illisible.");
 const rows=data.results.filter(row=>row?.product_name==="Forfait Navigo Annuel"&&
  row?.url===URLS.navigo&&row?.price_period==="par mois");
 if(rows.length!==1)return bad(source,"Abonnement annuel toutes zones absent ou non unique dans l'open data.");
 const value=toCents(String(rows[0].price||"").replace("€",""));
 if(value===null||value<3000||value>30000)return bad(source,"Prix annuel dans le jeu officiel non exploitable.");
 // Official dataset does not carry a year of application. The 2026 price is independently
 // qualified against the explicit 2026 tariff page. Do not roll it forward to a new year.
 if(year!==2026)return bad(source,"Le flux officiel indique un prix mais pas son année d'application. Vérification de la publication annuelle nécessaire.","pending");
 if(value!==9080)return bad(source,"Le prix du jeu officiel diverge du tarif annuel 2026 archivé : validation nécessaire.","review");
 return verified(source,{year,annualCents:value*11,paidMonthCents:value,payments:11,months:12,
  effectiveFrom:"2026-01-01",tariffVersion:"navigo-annuel-2026-open-data"});
}
export function verifyMeal(html,year){
 const source=URLS.urssaf;
 const table=tables(html).find(t=>/Cas général - Montants/i.test(t.caption)&&
  t.rows.some(r=>r.some(x=>new RegExp("avantage en "+year+"\\b","i").test(x))));
 if(!table)return bad(source,"Tableau repas du cas général absent pour "+year+".","pending");
 const one=table.rows.find(r=>/^1\s*repas$/i.test(r[0]||""));
 const two=table.rows.find(r=>/^2\s*repas$/i.test(r[0]||""));
 const value=toCents((one?.[1]||"").replace("€","").trim());
 const doubled=toCents((two?.[1]||"").replace("€","").trim());
 if(!value||value<200||value>2000||doubled!==value*2)return bad(source,"Repas : montants incohérents ou non lisibles.");
 return verified(source,{year,mealGeneralCents:value,effectiveFrom:year+"-01-01",tariffVersion:"urssaf-repas-"+year});
}
export function verifyHousing(html,year){
 const source=URLS.urssaf;
 const table=tables(html).find(t=>t.caption===("Avantage en nature logement - Montants pour "+year)&&
  t.rows.some(r=>r.some(x=>x.includes("Pour 1 pièce en "+year)))&&
  t.rows.some(r=>r.some(x=>x.includes("Par pièce principale"))));
 if(!table)return bad(source,"Tableau complet du logement 2026 absent pour l'année "+year+".","pending");
 const rows=table.rows.filter(r=>r.length>=3&&textMoney(r[0]).length>=1).map(r=>({bounds:textMoney(r[0]),one:textMoney(r[1]),perRoom:textMoney(r[2])}));
 if(rows.length!==8)return bad(source,"Logement : nombre de tranches différent de huit.");
 const thresholds=rows.slice(1).map(x=>x.bounds[0]),one=rows.map(x=>x.one[0]),perRoom=rows.map(x=>x.perRoom[0]);
 if(thresholds.length!==7||thresholds.some((t,i)=>!Number.isInteger(t)||t<100000||i>0&&t<=thresholds[i-1])||
  one.some((t,i)=>!Number.isInteger(t)||t<2000||t>50000||i>0&&t<one[i-1])||
  perRoom.some((t,i)=>!Number.isInteger(t)||t<1000||t>50000||i>0&&t<perRoom[i-1]))
  return bad(source,"Logement : tranches ou montants non cohérents.");
 return verified(source,{year,thresholds,one,perRoom,effectiveFrom:year+"-01-01",tariffVersion:"urssaf-logement-"+year});
}
export function verifyVehicle(html){
 const source=URLS.urssaf;
 const table=tables(html).find(t=>/Évaluation forfaitaire\s*:\s*véhicule mis à disposition depuis le 1er février 2025/i.test(t.caption)&&
  t.rows.some(r=>r.some(x=>/Avec prise en charge du carburant/i.test(x))));
 if(!table)return bad(source,"Tableau des véhicules mis à disposition depuis février 2025 introuvable.");
 const r=table.rows.filter(x=>x.length===3&&/Véhicule (acheté|loué)/i.test(x[0]));
 if(r.length!==3)return bad(source,"Tableau véhicule incomplet.");
 const percent=s=>[...String(s).matchAll(/(\d{1,3})\s*%/g)].map(m=>Number(m[1]));
 const values=r.map(x=>[percent(x[1]),percent(x[2])]);
 const expected=[[15,15,20],[10,10,15],[50,50,67]];
 const ok=values.every((line,i)=>line[0][0]===expected[i][0]&&
  line[1].includes(expected[i][1])&&line[1].includes(expected[i][2]));
 if(!ok)return bad(source,"Une règle de valorisation véhicule semble avoir changé : validation humaine nécessaire.","review");
 return verified(source,{effectiveFrom:"2025-02-01",purchasedYoungPercent:15,purchasedOldPercent:10,
  leasedPercent:50,withFuelPurchasedYoungPercent:20,withFuelPurchasedOldPercent:15,withFuelLeasedPercent:67,
  tariffVersion:"urssaf-vehicule-regime-2025-02"});
}
export function verifyTechnology(html,year){
 const source=URLS.urssafDetails,doc=plain(html);
 const start=doc.search(/Ordinateurs?, téléphones?/i);
 if(start<0)return bad(source,"La règle NTIC officielle n'a pas été retrouvée.","pending");
 const excerpt=doc.slice(start,start+3600);
 if(!/10\s*%/.test(excerpt))return bad(source,"Taux forfaitaire des outils numériques non identifiable.","review");
 return verified(source,{year,annualRate:0.10,tariffVersion:"urssaf-ntic-10-pct"});
}
export function verificationReport(year,html){
 const n=verifyNavigo(html.navigo||"",year),
 m=verifyMeal(html.urssaf||"",year),
 h=verifyHousing(html.urssaf||"",year),
 v=verifyVehicle(html.urssaf||""),
 t=verifyTechnology(html.urssafDetails||"",year);
 const categories={navigo:n,repas:m,logement:h,vehicule:v,ntic:t};
 const statuses=Object.values(categories).map(v=>v.status);
 return {year,status:statuses.every(x=>x==="verified")?"verified":statuses.includes("review")?"review":"incomplete",categories};
}
