# Agent NAS — classement des factures PDF (premiere phase)

**Pas d'entree en stock, pas d'import comptable, pas de deplacement ni de suppression des PDF originaux.**

Un NAS capable d'executer Docker/Container Manager et ayant acces a Internet peut effectuer la surveillance sans PC Windows. Aucune installation n'est active tant que les chemins et le NAS ne sont pas configures.

## Dossier source confirme

Le dossier exact est le sous-dossier `SEC-Factures a Saisir` du partage `02-Secretariat`, repertoire `03-COMPTABLE`. Son chemin UNC Windows a ete confirme par capture d'ecran. Par securite, l'adresse locale du NAS n'est pas inscrite dans ce depot public.

**Attention :** un chemin Windows UNC (commencant par deux antislashs) n'est pas un chemin Linux de l'hote NAS. Dans `.env` sur le NAS, `NAS_SOURCE_HOST_PATH` devra indiquer le chemin ABSOLU de ce dossier tel qu'il existe sur le NAS. Il reste a verifier selon le modele et le volume du NAS.

Le montage du dossier source est `read_only: true`. Avec `create_host_path: false`, Compose doit refuser une source inexistante au lieu de creer par erreur un dossier vide. Le programme n'ecrit jamais dans ce dossier.

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
2. Copier ce dossier `nas-invoices/` sur le NAS. Creer dans ce dossier uniquement `FACTURES_CLASSEES` et `A_VERIFIER`. Ne pas creer une nouvelle source `ENTREE_FACTURES` : le montage doit pointer vers le dossier NAS existant.
3. Copier `.env.example` en `.env` **sur le NAS seulement**. Renseigner `NAS_SOURCE_HOST_PATH` avec le chemin Linux absolu confirme et les identifiants Veryfi dedies. Ne jamais y mettre directement le chemin UNC Windows, ne pas committer `.env`, ne pas placer le token dans le navigateur.
4. Donner a l'utilisateur du conteneur (UID/GID 10001) les droits de lecture du dossier source et d'ecriture dans les deux destinations.
5. Pour la premiere execution, conserver `DRY_RUN=true`. Lancer `docker compose up -d --build` puis lire `docker compose logs -f invoices`.
6. Verifier la lecture et le nom propose ; passer ensuite `DRY_RUN=false` et redemarrer par `docker compose up -d` **seulement apres validation de l'installation**.

Le mode simulation utilise Veryfi et peut donc consommer des appels OCR. Ne pas laisser le service tourner en boucle en simulation pendant une longue periode.

## Securite et protection des donnees sensibles

**Par defaut : aucun document n'est envoye a Veryfi**, y compris en simulation.
L'agent refuse de demarrer si `ALLOW_EXTERNAL_OCR` n'est pas defini explicitement sur `true`.
Avant toute activation : verifier le contrat de sous-traitance (DPA), la localisation de traitement des donnees, la duree de conservation, les sous-traitants et le niveau de confidentialite des PDF.
L'activation ne doit se faire que par une personne autorisee a traiter ces donnees.

Le compte utilise pour le conteneur n'a pas besoin du role administrateur Synology. Donner uniquement lecture sur le partage source et ecriture sur les deux dossiers d'archive. Ne pas monter les autres dossiers du NAS. Isoler les comptes, appliquer les mises a jour DSM, activer MFA pour les administrateurs et restreindre le pare-feu.

## Securite

La cle Veryfi est stockee dans le NAS, pas dans le depot GitHub. Utiliser un compte/une cle Veryfi destine(e) a l'agent si disponible. Les copies ne deviennent visibles qu'une fois les octets ecrits. Ne jamais exposer SMB directement sur Internet.

Le conteneur doit garder acces au reseau HTTPS sortant vers Veryfi. Le NAS doit etre allume. Les PDF originaux sont uniquement lus et ne sont pas deplaces.

## Prototype de comparaison de deux OCR locaux

Le module `ocr_consensus.py` est un composant **isole, sans acces reseau ni ecriture en stock**. Il recoit des extractions structurees independantes de deux moteurs (cibles : PaddleOCR PP-StructureV3 et docTR). Les adaptateurs reels de ces moteurs, leur installation et le rapprochement geométrique page/ligne **ne sont pas encore realises**.

Pour chaque ligne alignee (position `pN:rN`), il controle :
- fournisseur/date/numero de facture ;
- reference exacte du fournisseur et designation ;
- quantites, prix unitaire HT, total HT, unites d'achat et de tarification ;
- correspondance **unique** a un produit actif du catalogue ;
- coherence arithmetique et facteur de conversion vers le stock.

Des divergences ou l'absence d'une ligne conduisent a `review` ; un accord correct produit uniquement `candidate_for_review`, jamais un mouvement de stock. **Un accord entre OCR ne suffit pas pour declencher une entree en stock** : l'existence du produit, le conditionnement, l'absence de doublon et la confirmation de reception restent obligatoires.

Aucun document du NAS n'a ete lu et aucune facture n'a ete envoyee a un service externe. La phase suivante depend du modele Synology exact, de la RAM et d'un jeu de factures de test anonymisees.

## Politique de 1 a 3 lectures (prototype)

Le composant autonome `ocr_review_policy.py` gere les decisions d'orchestration, **sans declencher de lecture OCR ni aucune ecriture en stock** :

- Premiere lecture : si tous les produits sont verts et le document complet, arret ; sinon lancer une deuxieme lecture.
- Deuxieme lecture : si aucune ligne orange n'est presente et les controles documentaires sont satisfaits, arret, y compris en presence de lignes rouges exclues ; sinon troisieme lecture.
- Troisieme lecture : les oranges restants doivent etre corriges manuellement. Aucun quatrieme passage automatique.
- Chaque rouge est **exclu de la reception**, mais conserve dans la piste d'audit pour etre reintegre manuellement plus tard.
- Une ligne disparue d'une lecture reste a examiner ; une ligne nouvelle ne devient pas verte sans confirmation par une lecture suivante.
- Une erreur de controle global de couverture/pages/total empêche l'arret automatique, meme avec des lignes vertes.

**Limite de production critique :** le lecteur actuel `lecteur-veryfi/veryfi.js` cree des mouvements de stock a la validation de la facture et peut bloquer une reintegration apres reception partielle de la meme facture. Il faut modifier les transactions de reception pour avoir un statut de traitement par ligne, une cle d'idempotence par ligne et un mecanisme de reception complementaire avant toute mise en service. Ce changement ne les active pas.



- Le dossier source est identifie sous Windows, mais le modele de NAS, le chemin Linux absolu, la destination choisie et les identifiants Veryfi ne sont pas connus : la connexion reelle ne peut pas etre activee.
- Les factures sans scores de confiance exploitables seront mises en revue pour eviter un nom incorrect.
- Veryfi est un service payant pouvant appliquer des quotas et des couts ; aucune gestion automatique du quota interne Supabase dans ce module local.
- Ne pas utiliser ce script pour mettre a jour les stocks : ce n'est **que** du classement de PDF.

## Tests

```bash
cd nas-invoices
python -m unittest discover -v
```
