# Plan de fiabilité — Gestion Collège (2026-11-09)

## Périmètre
Secrétariat, Administration Collège, produits, stocks, factures fournisseurs, lecture OCR, planning et salaires.

## Changements réalisés
- **Tests automatisés :** \`tests/reader-regressions.test.cjs\` + workflow \`.github/workflows/quality-gates.yml\`, dix tests sans dépendance supplémentaire.
- **Catalogue :** filtre « Qualité » dans Administration → Produits, persistant après édition/archivage, avec vue « Conditionnement / unité à compléter » et « Prix catalogue à vérifier ».
- **Tableau de bord :** indicateur « Fiches à fiabiliser », lié au filtre des produits concernés.
- **Supabase :** notebook de diagnostic en lecture seule (aucune correction automatique de donnée).

## Données constatées lors de l'audit
| Contrôle | Valeur |
| --- | ---: |
| Produits enregistrés | 95 |
| Produits actifs | 84 |
| Fiches actives sans conditionnement/unité | 1 |
| Prix catalogue à vérifier (0/absent) | 57 |
| Factures fournisseurs validées | 3 |
| Empreintes PDF distinctes parmi ces factures | 3 |
| Soldes de stock négatifs | 0 |
| Alias fournisseur enregistrés | 0 |
| Corrections OCR vérifiées enregistrées | 0 |
| Pages OCR gratuit vérifiées | 0 |

La fiche \`0000 — plateaux\` est incomplète : **aucune valeur n'a été déduite ou créée**.
Un prix catalogue nul peut être intentionnel et ne signifie pas que le prix de facture est faux.

## Points de sécurité vérifiés
- Les 113 tables \`public\` ont RLS activé ; aucune politique RLS sur ces tables. L'accès direct aux tables est restreint, mais les Edge Functions dotées des clés serveur doivent chacune être auditées.
- 71 Edge Functions actives utilisent \`verify_jwt=false\` ; les fonctions clés vérifient des sessions signées côté application. **Cela n'établit pas à lui seul une vulnérabilité, ni la sûreté des 71 fonctions.**
- La fonction SQL \`finalize_secretariat_tableur_invoice\` vérifie sous verrou transactionnel l'empreinte du PDF **et** le couple fournisseur/numéro. La table \`supplier_invoices\` possède un index unique sur \`file_hash\`. Ne pas réimplémenter une seconde logique de déduplication concurrente sans test transactionnel.

## Tests avant chaque validation en production
1. Facture correcte : vert, total retenu exact, un seul mouvement de réception.
2. Deux lignes identiques : orange tant qu'aucune confirmation explicite sur le PDF n'a été donnée.
3. TVA manquante ou incohérente : validation automatique interdite.
4. Écart quantité × prix unitaire / HT : correction vérifiée avant passage au vert.
5. Conversion de conditionnement incertaine : valeur stock à confirmer.
6. Ligne exclue : ni réception ni mouvement de stock.
7. Même facture PDF présentée une deuxième fois : rejet, pas de nouveau stock.
8. Même facture fournisseur/numéro dans un PDF différent : rejet transactionnel.
9. Page OCR corrigée : vérifier en base \`invoice_free_ocr_verified_pages\` et son rechargement.
10. Correction d'une ligne OCR enregistrée : vérifier la trace, l'alias et les conflits éventuels.
11. Salarié masqué : absent de la saisie de nouveaux événements, historique conservé.
12. Clôture d'un mois de salaire : à concevoir et valider avant déploiement.

## Limitations actuelles
- Les tests de comportement frontend ont été exécutés sur les fonctions de production de façon ciblée, sans navigateur authentifié. Un parcours complet avec une facture réelle et le suivi du stock reste indispensable.
- La présence du workflow GitHub Actions ne rend pas les contrôles obligatoires **avant** publication sur \`main\` sans règle de protection/validation des statuts. Ne pas annoncer que les publications sont bloquées sans cette configuration.
- Les tables d'apprentissage ne contiennent pas encore d'exemples corrigés. Impossible de garantir une amélioration automatique tant que le flux de validation n'a pas été testé de bout en bout.
- La sauvegarde et la restauration complètes du projet ne sont pas certifiées lors de cet audit. Ne pas engager de nettoyage destructif sans point de restauration validé.
- La clôture de la paie, les index et les anciennes Edge Functions de test nécessitent des validations dédiées ; aucune suppression ni changement de privilège n'a été effectué.

## Diagnostic Supabase
[Ouvrir le notebook de contrôle](https://supabase.com/dashboard/project/zreegtzfpwrjgdhhunxx/explorer/notebook/e3752550-0801-49f2-a7b2-c707e17899ab)

Les requêtes du notebook sont en lecture seule.
