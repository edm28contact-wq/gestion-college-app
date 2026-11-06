/* Archives historiques : lecture seule, jamais de modification des soldes courants. */
(function(){
"use strict";
let documents=[],loaded=false,busy=false,selected="inventory";
const h=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const numeric=n=>n===null||n===undefined?"Non renseigné":Number(n).toLocaleString("fr-FR");
function flags(items,kind){return items.filter(i=>kind==="inventory"?(i.quantity===null||i.match_status!=="Code coherent"):String(i.status||"").startsWith("Bloque"))}
function screen(){
 const target=document.getElementById("content");
 if(!target)return;
 const doc=documents.find(d=>d.kind===selected);
 const other=documents.find(d=>d.kind!==selected);
 const disabled=busy?"disabled":"";
 const rows=doc?.items||[];
 target.innerHTML=`<div class="card"><h2>Inventaires historiques</h2>
 <p class="muted">Relevés archivés et commandes historiques — lecture seule. Aucun effet sur les stocks actuels, commandes opérationnelles, achats ou valorisation.</p>
 <div class="actions"><button class="btn ${selected==="inventory"?"primary":"secondary"}" onclick="selectHistoricalStock('inventory')">Inventaire · 01/07/2026</button><button class="btn ${selected==="order"?"primary":"secondary"}" onclick="selectHistoricalStock('order')">Commande Henri Julien · 10/07/2026</button><button class="btn secondary" onclick="reloadHistoricalStock()" ${disabled}>Actualiser</button></div>
 </div>${doc?`<div class="card"><h2>${h(doc.title)}</h2>
 <p class="muted">Statut : à vérifier · ${rows.length} lignes · ${flags(rows,selected).length} ligne(s) nécessitant un contrôle · Source : ${h(doc.source_name)}</p>
 <div class="table"><table><thead><tr><th>Catégorie</th><th>Désignation originale</th><th>Référence photo</th><th>Quantité ${selected==="inventory"?"01/07":"commandée"}</th><th>Inscription</th><th>Unité</th><th>Correspondance</th><th>Contrôle</th></tr></thead>
 <tbody>${rows.map(i=>`<tr>
 <td>${h(i.category)}</td><td>${h(i.label)}</td><td>${h(i.reference||"—")}</td>
 <td>${i.quantity===null?"<span class='muted'>Non renseigné</span>":h(numeric(i.quantity))}</td>
 <td>${h(i.raw)}</td><td>${h(i.unit)}</td>
 <td>${h(i.product_code||"Non liée")}</td>
 <td>${selected==="inventory"?h(i.match_status||"")+" — "+h(i.note||""):h(i.status||"")+" — "+h(i.note||"")}</td>
 </tr>`).join("")}</tbody></table></div></div>`: '<div class="card">Aucun document trouvé pour cet onglet.</div>'}
 <div id="historicalStatus" class="status"></div>`;
}
window.historicalStockPage=function(){selected="inventory";screen();if(!loaded&&!busy)reloadHistoricalStock()};
window.selectHistoricalStock=function(kind){if(kind!=="inventory"&&kind!=="order")return;selected=kind;screen()};
window.reloadHistoricalStock=async function(){
 if(busy)return;busy=true;
 try{
  const result=await call(ADMIN,"historical-stock-documents");
  if(!result.ok||!Array.isArray(result.documents))throw Error("Réponse archive invalide");
  documents=result.documents;loaded=true;screen();
 }catch(error){
  const t=document.getElementById("historicalStatus");
  if(t){t.className="status err";t.textContent="Impossible de charger l'archive : "+frError(error.message)}
 }finally{busy=false}
};
})();
