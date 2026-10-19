# France Prep Fulfillment — Préparation du rendez-vous

Préparé pour la réunion avec Stéphane (France Prep Fulfillment). Toutes les
données de commande dans ce document sont **fictives**. Aucun appel n'a été
fait à France Prep Fulfillment. Aucune URL d'API, clé ou contrat
d'intégration réel de ce partenaire n'est inventé ici — tout ce qui n'est
pas confirmé par le code de ce dépôt est explicitement marqué comme une
proposition à valider.

Ce document ne recrée pas ce qui existe déjà ailleurs dans `docs/fulfillment/`
— voir [README.md](./README.md) pour la vue d'ensemble de la couche de
fulfillment, [PROVIDER-CONTRACT.md](./PROVIDER-CONTRACT.md) pour l'interface
`FulfillmentProvider`, [PARTNER-INTEGRATION-CHECKLIST.md](./PARTNER-INTEGRATION-CHECKLIST.md)
pour la liste générique des 21 informations qu'un partenaire doit fournir
avant qu'un adaptateur réel puisse être écrit, [WEBHOOKS.md](./WEBHOOKS.md)
pour la fondation webhooks existante, et [IDEMPOTENCY.md](./IDEMPOTENCY.md)
pour les mécanismes d'idempotence déjà en place.

## Rappel du périmètre (confirmé dans le code, pas recréé ici)

- **Confirmé dans le code** : interface `FulfillmentProvider`, registre
  `getFulfillmentProvider`, taxonomie d'erreurs typée
  `FulfillmentProviderError` (6 codes), fondation webhooks (HMAC-SHA256,
  anti-replay, idempotence via `WebhookLog`), réconciliation
  détection-seule (`reconciliation.ts`), 3 mécanismes d'idempotence
  (contrainte unique `FulfillmentOrder.orderId`, rejeu mock, déduplication
  webhook).
- **Simulé** : `MockFulfillmentProvider` — cycle de vie complet
  (`pending→accepted→processing→packed→shipped→delivered`), zéro appel
  réseau, erreurs forcées pour les tests (`INSUFFICIENT_STOCK`,
  `TEMPORARY_FAILURE`, `PERMANENT_FAILURE`, `PROVIDER_UNAVAILABLE`,
  `TRACKING_UNAVAILABLE`).
- **Documenté mais non implémenté** : un adaptateur réel pour France Prep
  Fulfillment (aucun fichier n'existe), une route webhook réelle (aucune
  route n'existe), persistance d'une étiquette/`shippingRequirements`
  (aucune colonne Prisma), mapping `workspaceId` ↔ identifiant vendeur
  partenaire.
- **Seul France Prep Fulfillment peut confirmer** : tout leur contrat
  d'API réel (authentification, endpoints, formats, webhooks, étiquettes,
  coûts) — voir les fiches ci-dessous.

## Exemple de commande (données fictives) — pour contextualiser la demande de Stéphane

Ce que `FulfillmentService` construit réellement aujourd'hui
(`CreateFulfillmentOrderInput`, interface réelle du code) :

```json
{
  "workspaceId": "wsp_fictif_7h3k2",
  "orderId": "ord_fictif_9f1a4",
  "items": [
    { "productId": "prod_fictif_a1", "sku": "SNK-AF1-43-BLK", "title": "Nike Air Force 1 '07 — Noir — Taille 43", "quantity": 1 },
    { "productId": "prod_fictif_a2", "sku": "SNK-AF1-42-WHT", "title": "Nike Air Force 1 '07 — Blanc — Taille 42", "quantity": 2 }
  ],
  "shippingAddress": {
    "line1": "12 Rue de la Fictive",
    "line2": "Appartement 4B",
    "city": "Lyon",
    "state": null,
    "postalCode": "69001",
    "country": "FR",
    "phone": "+33600000000",
    "email": "client.fictif@example.com"
  },
  "shippingRequirements": null
}
```

Points à ne jamais présenter comme acquis : `sku` est le seul identifiant
produit (ADKSY n'a aucun concept de variante en base) ; `shippingRequirements`
existe comme type TypeScript mais n'est jamais rempli aujourd'hui (aucune
marketplace ne fournit ces données) ; aucune étiquette n'existe nulle part
dans le code (`MockFulfillmentProvider.supportsLabels()` retourne `false`).

## A. Fiche de réunion — API et authentification

- [ ] URL de base en sandbox ?
- [ ] URL de base en production ?
- [ ] Méthode d'authentification (clé API / OAuth / mutual TLS / autre) ?
- [ ] Comment le secret est-il transmis sur chaque requête (en-tête, query param) ?
- [ ] Rotation/expiration des clés — y a-t-il une politique ?
- [ ] Endpoint exact (méthode + chemin) pour créer une commande de fulfillment ?
- [ ] Liste exacte des champs obligatoires de la requête, avec noms et types ?
- [ ] Liste exacte des champs facultatifs ?
- [ ] Quel identifiant vendeur attendent-ils (format, longueur, où l'obtenir) ?
- [ ] Format attendu pour le SKU (longueur max, caractères autorisés) ?
- [ ] Format attendu pour la quantité (entier, par ligne ou total) ?
- [ ] Forme exacte de la réponse à la création (statut HTTP, structure JSON) ?
- [ ] Nom du champ contenant leur propre identifiant de commande ?
- [ ] Mécanisme d'idempotence proposé (clé client, en-tête dédié, ou aucun) ?
- [ ] Limites de débit (requêtes/seconde ou /minute) ?
- [ ] Politique de retry recommandée côté client en cas d'échec ?

## B. Fiche de réunion — Étiquettes

- [ ] Qui génère l'étiquette : France Prep Fulfillment ou ADKSY ?
- [ ] Format(s) accepté(s)/fourni(s) (PDF, ZPL, PNG) ?
- [ ] Dimensions standard de l'étiquette ?
- [ ] Endpoint pour générer ou récupérer l'étiquette ?
- [ ] Mode de transmission : téléchargement direct, URL temporaire, pièce jointe de webhook ?
- [ ] Si URL temporaire : durée de validité ?
- [ ] Comment l'étiquette est-elle associée à la commande ADKSY et à leur commande (quel identifiant commun) ?
- [ ] À quel moment du cycle de vie de la commande l'étiquette devient-elle disponible (à la création, à l'acceptation, autre) ?
- [ ] Qui a la responsabilité d'imprimer l'étiquette (eux en interne, ou nous devons leur fournir le fichier) ?

## C. Fiche de réunion — Suivi, webhooks et erreurs

- [ ] Liste complète des statuts/événements possibles côté partenaire ?
- [ ] Endpoint de suivi (polling) si pas de webhook ?
- [ ] Format exact du payload webhook (identifiant événement, type, horodatage, référence commande) ?
- [ ] Schéma de signature : nom de l'en-tête, algorithme, encodage (hex/base64) ?
- [ ] Chaîne exacte signée (corps brut ou sous-ensemble canonique) ?
- [ ] Identifiant unique d'événement pour éviter les doublons côté ADKSY ?
- [ ] Retentent-ils l'envoi du webhook en cas de réponse non-2xx ? Combien de fois, avec quel délai ?
- [ ] Distinction claire entre erreurs temporaires (à retenter) et permanentes (à ne pas retenter) ?
- [ ] Jusqu'à quel moment une commande peut-elle être annulée ?
- [ ] Processus en cas de colis perdu — qui est notifié, comment ?
- [ ] Processus de retour, si applicable ?

## Plan d'intégration technique (10 étapes, non exécutées)

| # | Étape | Prérequis | Critère de fin |
|---|---|---|---|
| 1 | Obtenir et examiner la documentation officielle de France Prep Fulfillment | Réponses de Stéphane aux fiches A/B/C | Document technique reçu et relu par l'équipe, toutes les questions A/B/C répondues |
| 2 | Définir le mapping commande ADKSY → format partenaire | Étape 1 terminée | Tableau de correspondance champ-par-champ écrit et validé, sans aucun champ deviné |
| 3 | Décider du mapping `workspaceId` ↔ identifiant vendeur externe | Étape 1 terminée (savoir ce que le partenaire attend comme identifiant) | Décision écrite : nouvelle colonne ou table de correspondance, migration Prisma additive proposée et validée humainement |
| 4 | Développer l'adaptateur (`FranceFPFAdapter` ou nom équivalent) implémentant `FulfillmentProvider` | Étapes 1-3 terminées | Toutes les méthodes de l'interface implémentées, aucune valeur inventée, revue de code faite |
| 5 | Ajouter la/les route(s) webhook et la vérification de signature | Format webhook + schéma de signature confirmés (fiche C) | Route `/api/webhooks/fulfillment/france-prep` créée, signature vérifiée avec `verifyHmacSignature`, tests de signature valide/invalide passants |
| 6 | Intégrer récupération et stockage sécurisé des étiquettes (si fournies) | Fiche B répondue | Flux de récupération testé en sandbox, stockage choisi (URL vs fichier) documenté, aucun secret dans les logs |
| 7 | Compléter suivi des colis et gestion des erreurs | Étapes 4-5 terminées | Mapping statuts partenaire → `FulfillmentProviderOrderStatus` complet, chaque code d'erreur partenaire mappé à un des 6 codes `FulfillmentProviderError` |
| 8 | Écrire tests unitaires et tests de contrat (données fictives) | Étape 4 terminée | Voir section Tests ci-dessous — tous les cas couverts, 0 appel réseau réel dans les tests unitaires |
| 9 | Tester en sandbox partenaire | Accès sandbox obtenu auprès de Stéphane | Cycle complet (création → statut → étiquette si applicable → tracking → annulation) exécuté avec succès en sandbox, aucune donnée de production impliquée |
| 10 | Validation humaine avant mise en production | Étape 9 terminée avec succès | Revue explicite par un humain du code, des logs de test sandbox, et autorisation écrite avant tout `providerId` réel assigné à un `FulfillmentPartner` de production |

## Tests à prévoir (aucun à exécuter contre la production)

| Cas | Intention |
|---|---|
| Commande acceptée | Le flux nominal crée bien la commande partenaire et renvoie un `externalOrderId` |
| SKU inconnu ou quantité invalide | L'adaptateur renvoie `VALIDATION_FAILURE`, jamais une commande partielle silencieuse |
| Erreur d'authentification | `AUTH_FAILURE` levée, aucune commande créée côté partenaire ni côté ADKSY |
| Timeout et nouvelle tentative | `TEMPORARY_FAILURE` (`retryable: true`), le retry ne crée pas de doublon |
| Répétition de la même demande | Idempotence : un deuxième appel pour le même `orderId` ne crée jamais une deuxième `FulfillmentOrder` ni une deuxième commande partenaire |
| Webhook reçu plusieurs fois | `status: 'skipped_duplicate'` à la deuxième réception du même `(providerId, eventId)` |
| Signature invalide | Webhook rejeté avant tout traitement, jamais de fuite du secret dans les logs |
| Étiquette indisponible ou URL expirée | Erreur explicite, jamais une étiquette vide/corrompue affichée comme valide |
| Suivi reçu dans le désordre | Les événements sont stockés avec leur propre horodatage, jamais réordonnés ou perdus |
| Annulation après création | `cancelFulfillmentOrder` fonctionne avant expédition ; après expédition, `UNSUPPORTED_OPERATION` (déjà le comportement du mock, à répliquer côté réel) |

Chaque test contre le partenaire réel passe d'abord en sandbox (étape 9 du
plan ci-dessus) — jamais directement en production.

## Informations à obtenir auprès de Stéphane (synthèse)

Toutes les cases non cochées des fiches A/B/C ci-dessus, en priorité :
authentification réelle, endpoint de création, identifiant vendeur attendu,
qui génère l'étiquette et sous quel format, schéma de signature webhook.
