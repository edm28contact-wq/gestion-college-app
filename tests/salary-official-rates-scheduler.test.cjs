"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const rateImport=()=>import("file://"+path.resolve("supabase/functions/college-payroll-rates-sync/rates.mjs"));
const navigo='<html><main><h1>Forfait Navigo Mois</h1><table><thead><tr><th>Zones du forfait</th><th>Plein tarif / mois</th></tr></thead><tbody><tr><td>Toutes zones 1 à 5</td><td>90,80 €</td></tr></tbody></table><p>Tarifs du forfait applicables au 1er janvier 2026</p></main></html>';
const meal='<h2>Repas</h2><h3>Cas général</h3><table><caption>Cas général - Montants au 1er janvier 2025</caption><tr><th>Nombre de repas</th><th>Montant de l\'avantage en 2026</th></tr><tr><th>1 repas</th><td>5,50 €</td></tr><tr><th>2 repas</th><td>11,00 €</td></tr></table>';
const housing='<h2>Logement</h2><table><caption>Avantage en nature logement - Montants pour 2026</caption><tr><th>Rémunération brute mensuelle</th><th>Pour 1 pièce en 2026</th><th>Par pièce principale (si plusieurs pièces) en 2026</th></tr>'+[
 ["Inférieure à 2 002,50 €","79,70 €","42,60 €"],
 ["De 2 002,50 € à 2 402,99 €","93,00 €","59,70 €"],
 ["De 2 403,00 € à 2 803,49 €","106,20 €","79,70 €"],
 ["De 2 803,50 € à 3 604,49 €","119,40 €","99,50 €"],
 ["De 3 604,50 € à 4 405,49 €","146,40 €","126,10 €"],
 ["De 4 405,50 € à 5 206,49 €","172,60 €","152,40 €"],
 ["De 5 206,50 € à 6 007,49 €","199,40 €","185,70 €"],
 ["Supérieure ou égale à 6 007,50 €","225,60 €","212,30 €"]
 ].map(row=>'<tr><th>'+row[0]+'</th><td>'+row[1]+'</td><td>'+row[2]+'</td></tr>').join("")+'</table>';
const vehicle='<h2>Véhicule</h2><table><caption>Évaluation forfaitaire : véhicule mis à disposition depuis le 1er février 2025</caption><tr><th>Type de véhicule</th><th>Sans carburant</th><th>Avec prise en charge du carburant</th></tr><tr><th>Véhicule acheté âgé de 5 ans ou moins</th><td>15 % du coût d achat</td><td>15 % plus frais ou 20 % du coût d achat</td></tr><tr><th>Véhicule acheté de plus de 5 ans</th><td>10 %</td><td>10 % plus frais ou 15 %</td></tr><tr><th>Véhicule loué ou en location avec option d achat (LOA)</th><td>50 %</td><td>50 % plus frais ou 67 %</td></tr></table>';
const vehicleBefore='<h2>Véhicule</h2><table><caption>Évaluation forfaitaire : véhicule mis à disposition avant le 1er février 2025</caption>'+
 '<tr><th>Type de véhicule</th><th>Sans carburant</th><th>Avec prise en charge du carburant</th></tr>'+
 '<tr><th>Véhicule acheté âgé de 5 ans ou moins</th><td>9 %</td><td>9 % ou 12 %</td></tr>'+
 '<tr><th>Véhicule acheté de plus de 5 ans</th><td>6 %</td><td>6 % ou 9 %</td></tr>'+
 '<tr><th>Véhicule loué (LOA)</th><td>30 %</td><td>30 % ou 40 %</td></tr></table>'+
 '<p>Particularités pour les véhicules 100 % électriques : Vous appliquez une réduction de 70 % sur le montant de l avantage, dans la limite de 4 641,60 € par an en 2026.</p>'+
 '<p>Particularités pour les véhicules 100 % électriques : Vous appliquez une réduction de 50 %, dans la limite de 2 026,30 € par an en 2026.</p>';
const ntic='<main><h2>Avantages en nature : ordinateurs, téléphones</h2><p>L avantage au forfait est évalué à 10 % du coût d achat TTC.</p></main>';
test("les cinq taux officiels 2026 sont extraits uniquement des rubriques explicitement vérifiables",async()=>{
 const m=await rateImport();
 const r=m.verificationReport(2026,{navigo,urssaf:meal+housing+vehicle+vehicleBefore,urssafDetails:ntic});
 assert.equal(r.status,"verified");
 assert.equal(r.categories.navigo.payload.monthlyCents,9080);
 assert.equal(r.categories.repas.payload.mealGeneralCents,550);
 assert.deepEqual(Array.from(r.categories.logement.payload.one),[7970,9300,10620,11940,14640,17260,19940,22560]);
 assert.equal(r.categories.vehicule.payload.leasedPercent,50);
 assert.equal(r.categories.vehicule.payload.electricNewCapCents,464160);
 assert.equal(r.categories.vehicule.payload.electricOldCapCents,202630);
 assert.equal(r.categories.ntic.payload.annualRate,0.1);
});
test("les chiffres d'une année précédente sont refusés pour l'année recherchée",async()=>{
 const m=await rateImport();
 assert.equal(m.verifyNavigo(navigo,2027).status,"pending");
 assert.equal(m.verifyMeal(meal,2027).status,"pending");
 assert.equal(m.verifyHousing(housing,2027).status,"pending");
});
test("toute source modifiée ou incomplète déclenche une alerte, jamais un nombre supposé",async()=>{
 const m=await rateImport();
 assert.notEqual(m.verifyVehicle((vehicle+vehicleBefore).replace("67 %","99 %"),2026).status,"verified");
 assert.notEqual(m.verifyMeal(meal.replace("11,00","12,00"),2026).status,"verified");
 assert.notEqual(m.verifyHousing(housing.replace("225,60","deux cents"),2026).status,"verified");
 assert.notEqual(m.verifyNavigo(navigo.replace("Tarifs du forfait applicables au 1er janvier 2026",""),2026).status,"verified");
});
test("le mécanisme périodique n'altère ni déclarations de paie ni virements SEPA",()=>{
 const edge=fs.readFileSync("supabase/functions/college-payroll-rates-sync/index.ts","utf8");
 const mig=fs.readFileSync("supabase/migrations/20261126103000_college_payroll_official_rates.sql","utf8");
 assert.match(edge,/college_verify_rates_cron_token/);
 assert.match(edge,/college_payroll_rate_checks/);
 assert.match(edge,/college_payroll_official_rate_snapshots/);
 assert.doesNotMatch(edge,/college_payroll_months|bank_details|personnel_events/);
 assert.match(mig,/ENABLE ROW LEVEL SECURITY/);
 assert.match(mig,/REVOKE ALL ON FUNCTION/);
});
