# Plan d'amélioration — Cours Chambertin

## Identité et compatibilité
Les libellés utilisateurs emploient Cours Chambertin. Les URL historiques `college/`, les noms de tables, les clés de permission et les identifiants d’intégration sont conservés.

## Déploiement qualifié
1. Ne pas modifier la production en cas d’échec des tests.
2. Créer une branche et une PR ; exécuter les contrôles métier avant intégration.
3. Le workflow `pages-qualified.yml` est prêt mais inactif par défaut. Pour l’activer, dans Settings → Pages choisir GitHub Actions et, dans Settings → Secrets and variables → Actions → Variables, créer `CHAMBERTIN_PAGES_CI=true`. Lancer ensuite le workflow sur main et vérifier le déploiement. Ne pas confondre ce prérequis avec une protection déjà active.
4. Les tests doivent inclure les régressions des droits, la navigation, le stock, la paie et les contrôles HACCP. Les tests navigateur sur données fictives complètent mais ne remplacent pas une recette avec les comptes de production.

## Points de contrôle
- Permissions : refus des comptes désactivés, changement de mot de passe, expiration, vérification des droits par opération ; compléter l’inventaire de toutes les fonctions encore hors dépôt.
- Sauvegardes : export de la base et des objets privés, restauration en environnement isolé, procédure documentée. Ne jamais supprimer des données ou index sur un simple signalement d’inutilisation.
- Facturation : Veryfi ou saisie manuelle, preuve du PDF, exclusion explicite des lignes, contrôle humain, idempotence et rapprochement stock.
- Salaires : créneaux individuels, historique daté, calculs d’absence, variables, clôture mensuelle ; renseigner les contrats et horaires réels avant calcul.
- Cantine : planning d’ouverture validé par le responsable, sondes installées et qualifiées, mesure à cœur, traçabilité, allergènes, plats témoins, réception, actions correctives, durée de conservation des preuves validée.
- Marne Invest : vérifier les 13 baux et les paramètres des biens ; importer les règlements réels ; configurer la messagerie ; ne pas envoyer automatiquement une quittance ou une relance non justifiée.
- Les intégrations externes et la qualification physique restent conditionnées aux accès et matériels réels. Ne pas créer de valeurs factices en production.
