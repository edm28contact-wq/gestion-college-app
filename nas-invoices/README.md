# Agent NAS — classement des factures PDF (premiere phase)

**Pas d'entree en stock, pas d'import comptable, pas de deplacement ni de suppression des PDF originaux.**

Un NAS capable d'executer Docker/Container Manager et ayant acces a Internet peut effectuer la surveillance sans PC Windows. Aucune installation n'est active tant que les chemins et le NAS ne sont pas configures.

## Resultat

Fichier `SCAN_000145.pdf` contenant la facture LA NORMANDE SA du 30/09/2026 -> copie exacte `2026-09-30 LA NORMANDE.pdf` dans `FACTURES_CLASSEES`.

- Date = **date de facture**, pas date de livraison / echeance / periode.
- Fournisseur = nom lu (forme juridique terminale retiree si applicable) en majuscules.
- Numero de facture = controle de presence, **absent du nom final**.
- Plusieurs documents distincts de meme date/fournisseur : ` (2)`, ` (3)`... sans ecrasement.
- Facture incertaine ou impossible a lire : copie intacte dans `A_VERIFIER` sous son nom original.
- Copie atomique, anti-doublons SHA-256, source preservee.
- Aucune ecriture de stock ni dans la base Supabase.

## Preparation sur NAS compatible Docker

1. Installer le gestionnaire de conteneurs fourni par le NAS (Synology Container Manager, QNAP Container Station ou Docker compatible), si le modele le permet.
2. Copier ce dossier `nas-invoices/` sur le NAS. Creer dans ce dossier `ENTREE_FACTURES`, `FACTURES_CLASSEES` et `A_VERIFIER`.
3. Copier `.env.example` en `.env` **sur le NAS seulement**, y renseigner les identifiants Veryfi dedies. Ne pas committer `.env`, ne pas placer le token dans le navigateur.
4. Donner a l'utilisateur du conteneur (UID/GID 10001) les droits de lecture du dossier source et d'ecriture dans les deux destinations.
5. Pour la premiere execution, conserver `DRY_RUN=true`. Lancer `docker compose up -d --build` puis lire `docker compose logs -f invoices`.
6. Verifier la lecture et le nom propose ; passer ensuite `DRY_RUN=false` et redemarrer par `docker compose up -d` **seulement apres validation de l'installation**.

Le mode simulation utilise Veryfi et peut donc consommer des appels OCR. Ne pas laisser le service tourner en boucle en simulation pendant une longue periode.

## Securite

La cle Veryfi est stockee dans le NAS, pas dans le depot GitHub. Utiliser un compte/une cle Veryfi destine(e) a l'agent si disponible. Les copies ne deviennent visibles qu'une fois les octets ecrits. Ne jamais exposer SMB directement sur Internet.

Le conteneur doit garder acces au reseau HTTPS sortant vers Veryfi. Le NAS doit etre allume. Les PDF originaux sont uniquement lus et ne sont pas deplaces.

## Limites de cette version

- Le modele de NAS, les chemins finaux et les identifiants Veryfi ne sont pas encore fournis : la configuration reelle ne peut pas etre terminee.
- Les factures sans scores de confiance exploitables seront mises en revue pour eviter un nom incorrect.
- Veryfi est un service payant pouvant appliquer des quotas et des couts ; aucune gestion automatique du quota interne Supabase dans ce module local.
- Ne pas utiliser ce script pour mettre a jour les stocks : ce n'est **que** du classement de PDF.

## Tests

```bash
cd nas-invoices
python -m unittest discover -v
```
