# ADKSY — Roadmap status (single reference)

## 0. TABLE DE REPRISE (à copier au début de chaque nouvelle session) — audit du 2026-11-23

_Source de vérité = preuves du dépôt (fichiers, tests, sections ci-dessous, commits). « Rapport historique » = déclaré, non rejouable ici. Les sections 1 à 17 plus bas sont l'historique, **non modifié**._
_Livraison — LOCAL : dans le répertoire de travail, non commité · COMMIT : dans un commit · PUSH : sur le remote · PREVIEW : déployé. **Tous les lots ci-dessous sont LOCAL**, sauf une partie de R3-B (COMMIT `e1754c1`, PUSH/PREVIEW rapportés §3 l.156, non revérifiés). Aucune livraison PREVIEW n'est prouvée pour le code actuel._
_Classes de réserve : **P0** bloque l'audit/la mise en production · **P1** à corriger ou prouver avant activation Production · **P2** peut attendre._

**⚠ RECTIFICATIF (réconciliation, voir §18) — remplace les lignes R3-C.0.1 et R3-C.0.2 du tableau ci-dessous.** **R3-C.0.1 : VALIDÉ dans son périmètre historique (`images/reorder`), aucune régression trouvée (statique)** ; le défaut de même famille sur 12 autres routes est une **nouvelle réserve P2 hors périmètre** (non autorisée), et non un sous-lot « OUVERT » ni un P1. **R3-C.0.2 : OUVERT mais explicitement différé** (réserve R3-C n°13, « lot front à planifier après les lots ordonnés », jamais autorisé) ; défaut **préexistant** (déjà présent à `a141e95`), fonctionnel, **ne bloque ni LIV-1, ni Preview, ni B.11, ni l'audit Production** (à corriger avant activation Production, P1 fonctionnel).

| Lot | Verdict | Statut actuel | Réserves | Preuves | Blocage | Prochaine étape |
|---|---|---|---|---|---|---|
| Lot A | NON VÉRIFIÉ | rapport absent du dépôt | définition/rapport inconnus | aucune (déclaré par le propriétaire) | rapport à fournir | fournir le rapport |
| B.1/B.2 | NON VÉRIFIÉ | idem | idem | aucune | idem | idem |
| R3-B | VALIDÉ AVEC RÉSERVES (§3) | partie COMMIT `e1754c1` (jetons de connexion non envoyés au navigateur) ; reste LOCAL | P0 livraison : reste non commité/non déployé · P1 : rotation des jetons exposés avant correctif à décider · P1 : `simulate` sans garde d'environnement | §3 ; `response-credential-exposure.test.ts`, `publicResponseSelects.test.ts` ; commit `e1754c1` | commit + Preview | plan Git (§ audit 2026-11-23) |
| R3-C | VALIDÉ AVEC RÉSERVES (§1, §5) | LOCAL | LEVÉES (§5) : garde BD universelle, `prisma/.env`, scripts `db:*`, route stock, surfaces AI/Stripe/cron/OAuth, limites de plan · P1 : indépendance limitée de l'audit ; stockage réseau jamais testé (mock) · P2 : `npx prisma` brut, 401 au lieu de 404, cascade FK d'un tenant | §1, §5 ; 133 tests live rapportés ; `docs/DB-SAFETY.md` | rejouer les tests live avant commit | relecture indépendante + rejeu | rejeu gardé avant commit |
| R3-C.0.1 | OUVERT (JSON malformé/null → 500) | LOCAL : correctif seulement sur `images/reorder` ; 12 autres lectures `request.json()` sans garde | P1 : routes publiques (signup, forgot/reset-password, email/verify) et orders, listings, products, fulfillment/send+simulate, images/[imageId] ; parseur/TypeError → 500 | audit statique 2026-11-23 ; `images/reorder/route.ts` (garde) ; tests : reorder seulement | autorisation/rapport historique : NON VÉRIFIÉ | lot dédié à autoriser |
| R3-C.0.2 | OUVERT (images sans workspaceId) | LOCAL : `dashboard/products/[id]/images/page.tsx` inchangé ; suppression, réordonnancement, « principale » sans `?workspaceId=` alors que `getVerifiedWorkspaceId` l'exige (400) | P1 : fonction Images cassée ; réserve R3-C n°13 | audit statique ; §1 réserve 13 ; `security.ts:40-48` | autorisation historique : NON VÉRIFIÉE | lot front à autoriser |
| R4/R5 | PASS AVEC RÉSERVES (§7, §8.1) | LOCAL | P1 : procédure d'opérateur du seed de plans en Production (4 variables) ; état des plans en base Production NON VÉRIFIÉ · P2 : périmètre reconstruit, `fetch-etsy-taxonomy` | §7 ; `seed-safety`, `seed-plans-target`, `r3c-seed.live` | non commité | commit |
| R6 | PASS AVEC RÉSERVES (§8) | LOCAL | P1 : `DELETE /api/workspaces/[id]` n'annule pas l'abonnement Stripe · P2 : énumération de comptes, `email/verify` sans limite, DNS-rebinding SSRF, 6 échecs CRLF non comparés | §8 ; `r6-routes.test.ts` (123), `r3c-r6-routes.live` | décision produit (suppression) | décision + commit |
| C6 | PASS AVEC RÉSERVES (§9) | LOCAL (commentaires de schéma) | P2 : montants Float, `User.deletedAt` non appliqué, `ApiKey`/`Webhook` non utilisés | §9 ; `migrate diff` vide | non commité | commit |
| C1 | PASS AVEC RÉSERVES (§10), option 2 | LOCAL (commentaires/doc) | P1 : fonction `reserve_product_stock()` et CHECK en base réelle NON VÉRIFIÉS ; aucune contrainte contre un stock négatif · P2 : `StockService` code mort | §10 ; `c1-stock-decision.test.ts` (20) | lecture seule du schéma Supabase de test à autoriser | audit Production |
| S7 | PASS AVEC RÉSERVES (§11) | LOCAL (`engines >=22.20`, `.nvmrc`, Dockerfile) | P0 Preview : `next build` jamais exécuté sous Node 22.20, version Node Vercel NON VÉRIFIÉE · P1 : `npm audit` NON VÉRIFIÉ (devient P0 si critique) · P2 : Dockerfile prod, `@types/*` | §11 ; `s7-node-dependencies.test.ts` (16) | build sur Preview | build + `npm audit` en ligne |
| Dashboard Analytics | PASS AVEC RÉSERVES (§12) | LOCAL | P2 : découpage Basic/Advanced à valider par le produit, pas de test de rendu React, plan Free reçoit les compteurs Basic | §12 ; `analytics-basic-advanced.test.ts` (35) | non commité | commit avec S8 (fichiers communs) |
| S8 | PASS AVEC RÉSERVES (§13) | LOCAL | P0 déploiement : migration `20261121000000_add_order_currency` NON appliquée nulle part ; à appliquer AVANT le code · P1 : remboursements/frais/livraison non importés (profit « inconnu ») ; formats `currency` eBay/Etsy non vérifiés sur API réelle · P2 : Float, anciennes lignes `UNKNOWN`, `notifyNewOrder` en € | §13 ; `financial.test.ts` (71), `orderFinancials.test.ts` (30), `order-sync-currency.test.ts` (16), `analytics-financial.test.ts` (17) | migration à autoriser sur la base Preview | autoriser migration Preview |
| B.9 | VALIDÉ (rapport historique) | PREVIEW rapporté (`e1754c1`) | non revérifié | §3 l.11 (observation de 2 utilisateurs) | — | — |
| OAuth Sandbox 1 | PARTIEL (§3 l.12) | PREVIEW rapporté | `sellerId`/`accountId` NULL : vendeur non identifié | SQL rapporté (workspace `cmvwvt71…`) | identité vendeur | B.12 |
| OAuth Sandbox 2 | PARTIEL (§3 l.13) | PREVIEW rapporté | session eBay réutilisée ; vendeur non identifié | SQL rapporté (`cmwnto79…`) | idem | B.12 |
| B.11.0 | BLOCKED — NOT READY (§14) | LOCAL (doc) | titulaire non confirmé ; 2e vendeur non prouvé ; Preview non vérifié | §14 | 3 conditions humaines/Preview | lever les 3 conditions |
| B.11.1 | PASS WITH RESERVES (§15) | LOCAL | P1 : révocation chez eBay absente (déconnexion locale seulement) · P2 : environnement non persisté (migration proposée non créée) · LEVÉES : state non lié au workspace, config ambiguë | §15 ; `oauth-state-binding` (33), `marketplaceOAuthConfig` (56) | vérification manuelle Sandbox/RuName | — |
| B.11.1-R | PASS WITH RESERVES (§16) | LOCAL | défaut de replay CONFIRMÉ puis corrigé ; P2 : pas de purge `oauth_state` | §16 ; `oauth-state-replay.test.ts` (16) | — | — |
| B.11.1-R.1 | PASS WITH RESERVES (§17) | LOCAL (audit statique) | aucun défaut ; réserve d'atomicité LEVÉE par R.2 (PostgreSQL local uniquement) | §17 | — | — |
| B.11.1-R.2 | PASS (§17) | LOCAL (PostgreSQL local isolé) | P1 : pas de preuve Supabase/PgBouncer ; pas d'instances Next.js réelles ; table vide au départ | `oauth-state-atomicity.live.test.ts` (10) : 10 appels → 1 consommé + 9 replays ; 30 rounds ; 10 backends | — | preuve Preview (B.11) |
| B.11.1-R.3 | COMPLETE (§17) | LOCAL (doc) | réserves ouvertes listées §17 | §17 | — | — |
| B.12 | NON COMMENCÉ | — | identité vendeur et doublons non gérés ; pas de règle commerciale | §3 l.16 ; audit 2026-11-23 | autorisation séparée | conception (WARN/BLOCK/allow) |
| Audit Production | NON COMMENCÉ | — | P0 livraison (rien sur Preview) ; voir lignes ci-dessus | — | après Preview + B.11 + B.12 | après B.12 |
| OAuth Production | NON COMMENCÉ — INTERDIT | — | — | — | autorisation séparée | — |
| Première publication Production | NON COMMENCÉ — INTERDIT | — | — | — | autorisation séparée | — |

**Contradictions et non-vérifiés (2026-11-23).** (1) Le résumé donne « 15 éléments R3-B non commités » : introuvable (aucune trace dans la roadmap ; 124 fichiers locaux au total : 68 modifiés + 56 non suivis, 103 entrées Git avec dossiers regroupés). (2) La roadmap dit « Preview = `preview/ebay-sandbox-isolation` @ `e1754c1` » mais les références locales montrent : branche locale `preview/ebay-sandbox-isolation` = `ef748e5`, `origin/preview/ebay-sandbox-isolation` = `a141e95` (références distantes probablement périmées), `refs/r3b/preview-fetch` = `e1754c1` ; l'état distant réel est NON VÉRIFIÉ (aucun réseau). (3) `ef748e5` est le **parent** de `e1754c1` (= HEAD actuel) ; le « checkout Windows » est donc `e1754c1` + travaux locaux, pas `ef748e5`. (4) `origin/main` local (`e6c83b0`) est antérieur à `a141e95` : référence périmée.
**Ordre avant eBay Production :** livraison Preview du code actuel → migration S8 sur la base de test → B.11 (3 preuves) → B.12 → audit Production → autorisation séparée OAuth Production → autorisation séparée première publication. « Site en ligne », « Preview READY », « OAuth Sandbox réussi » ou « compte connecté » ne sont **jamais** une autorisation de publier en Production.

---

_Last update: 2026-11-20 — R4/R5 (seeds) audited, repaired and secured locally; historical objectives of R6, C6, C1, S7, S8 recovered from the user's old ChatGPT conversations (objectives only); R3-C closed with reserves; R3-C.8 (universal DB guard) and R3-C.9 (remaining surfaces) completed locally; C.10 (cross-platform tests) done; second exhaustive documentary search (R4, R5, R6, C6/C1, S7, S8): nothing found. Nothing below is committed, pushed or deployed._
_Rule: a lot is `VALIDÉ` only if a closure report or reproducible proof exists. Otherwise: `STATUT À CONFIRMER` (or `BLOCKED` when the source definition/report is missing)._
_Evidence levels used: **code** (static reading) · **mock** (mocked-Prisma tests) · **DB locale** (real PostgreSQL 14, dedicated local cluster) · **Preview** (deployed) · **rapporté** (result reported, not re-run in the last audit)._

## 1. Official status of R3-C

> **R3-C : VALIDÉ AVEC RÉSERVES — CODE LOCAL, NON COMMITÉ, NON DÉPLOYÉ.**
> Closure audit (R3-C.7) performed by the same instance that wrote the work: **independence limited**. Accepted by the user.

Scope (reconstituted historical definition, not a formal spec found in a repository): prove, on a real disposable local PostgreSQL, that workspace A can neither read, modify nor delete workspace B's data, including ownership, relations, transactions and composed operations, with adversarial known-foreign ids, and with no access to Production / remote Supabase.

### Main proofs
| Step | Proof | Level |
|---|---|---|
| C.2.1 DB Safety Guard + Prisma connection | `src/lib/testing/dbSafetyGuard.ts` (fail-closed: only `127.0.0.1`/`localhost`, port 5433, db and role `adksy_r3c_test`, consistent `DATABASE_URL`/`DIRECT_URL`, redirect parameters and external-service credentials refused, reason codes only in errors); installed as Vitest `setupFiles`; guarded runner `scripts/r3c/run-with-test-db.mjs`; 59 guard tests; live Prisma connection (identity, non-superuser, read-only transaction) | code + mock + DB locale (rapporté) |
| C.2.2 A/B harness | `src/lib/testing/r3cHarness.ts`: two synthetic tenants (`@r3c.invalid`, `FAKE-` tokens), cleanup by recorded ids only, reproducible; 7 live tests; 18 migrations applied with `prisma migrate deploy` to the local test DB only | DB locale (rapporté) |
| C.3 cross-workspace reads | 29 live tests: by id, by list, by filters, foreign workspace, no session, unverified e-mail; no byte of B in any response | DB locale (rapporté) |
| C.4 modify / delete | 23 live tests + 16 image tests: PATCH/DELETE of product, listing, workspace, notifications, fulfillment simulate, services called directly, shared-marketplace disconnect, mass assignment | DB locale (rapporté) |
| C.5 relations / transactions | 13 live tests: references to B refused, tenant-confined transactions, 6+6 concurrent stock reservations, per-workspace uniqueness, tenant removal leaves B byte-identical | DB locale (rapporté) |
| C.6 corrections | see vulnerabilities below; 8 unit tests for the product allowlist | code + mock + DB locale (rapporté) |
| C.7 closure audit | independent-style read-only audit (limited independence): Git integrity, code review of both fixes and of the guard, count reconciliation (93 live tests = 5+7+29+23+16+13, guard 59 exact) | code |
| Totals | **93 live DB tests** reported passing · **244 targeted non-DB tests** reported passing · **TypeScript without error** reported | rapporté (not re-run during C.7) |

### Vulnerabilities found and fixed
1. **`StorageService.updateImageOrder`** — user A could rewrite `order`/`isMain` of workspace B's images through A's own product. Fixed (ownership of every image id checked before any write, uniform error, writes filtered by `id` + `productId`, strict route validation incl. malformed JSON → 400). Verified: mock + live.
2. **`PATCH /api/products/[id]` mass assignment** — the raw body reached `prisma.product.update`; A could send `workspaceId` and move its own product into B's tenant. Fixed by the `PRODUCT_UPDATABLE_FIELDS` allowlist applied inside `ProductService.updateProduct` (applies to every caller). Verified: red live test turned green, 8 unit tests.

### Reserves, and the future lot they are assigned to
_Status of each reserve after R3-C.8 / R3-C.9: see §5 (reserves 1-3, 5, 7, 8 treated; 4, 6, 9-14 still open)._
No functionality is changed by this document. Lots below are proposals pending the user's authorisation.

| # | Reserve | Assigned lot |
|---|---|---|
| 1 | DB guard is not universal outside Vitest | **R3-C.8 — universal DB guard** (future, separate authorisation) |
| 2 | `prisma/.env` is auto-loaded by Prisma and not seen by the guard | R3-C.8 |
| 3 | Direct Prisma commands (`npm run db:reset`, `db:push`, `db:seed`) are dangerous if the target is wrong | R3-C.8 (wrapper/guard for the npm scripts) · reviewed again in S7 |
| 4 | `ProductService.createProduct` still spreads `data` (then sets `workspaceId`) | R3-C.8 (shared creation allowlist) · S7 |
| 5 | `api/test/stock-race-condition` route is gated only by `NODE_ENV !== 'production'`, no authentication | S7 (remove or authenticate) |
| 6 | `api/fulfillment/simulate` has no environment guard (any user can simulate shipping/delivery of their own orders) | Production-readiness audit + S7 |
| 7 | AI agent routes, Stripe webhooks, sync crons, OAuth callback not tested on a real DB | **R3-C.9 — live tests for the remaining surfaces** (before the Production-readiness audit) |
| 8 | Plan limits bypassed in live tests (no `Plan` rows in the test DB) | R3-C.9 (seed minimal plans in the local test DB only) |
| 9 | Storage network access mocked (fake client) | Production-readiness audit (integration against a Supabase **test** project, if ever authorised) |
| 10 | Test results reported but not re-run during C.7 | Re-run (guarded runner) before the commit / Preview validation |
| 11 | C.7 audit independence limited (same instance) | Independent review by another session or by the owner before commit |
| 12 | Observed, not isolation defects: foreign workspace answers 401 (not 404/403); cascade deletion of a tenant with orders may be blocked by FK rules (unconfirmed) | Decide in S7 / account-deletion design |
| 13 | Adjacent defect: `dashboard/products/[id]/images/page.tsx` calls delete and reorder without `?workspaceId=` | Frontend fix lot (to schedule after the ordered lots) |
| 14 | Everything is uncommitted; Preview not validated | Commit (separate authorisation) → Preview deployment → network inspection |

## 2. R4/R5 — source search (read-only)

**Result: `BLOCKED — DÉFINITION/RAPPORT SOURCE MANQUANT`.** Neither a definition nor a report for R4 or R5 exists in anything that was searched.

| Lot | Définition retrouvée | Rapport retrouvé | Preuve | Statut |
|---|---|---|---|---|
| R4 | Non | Non | aucune | BLOCKED — source manquante |
| R5 | Non | Non | aucune | BLOCKED — source manquante |

Searched (no checkout, no network):
- `adksy-test-migrate`: working tree, `docs/`, all root Markdown/TXT, all 8 refs (`security/r3b-public-selects`, `preview/ebay-sandbox-isolation`, `backup/ef748e5`, `refs/r3b/preview-fetch`, `origin/main`, `origin/preview/ebay-sandbox-isolation`, `origin/claude/happy-ptolemy-3k00fn`, `origin/HEAD`) — 165 commits; commit messages, file contents (`R4`, `R5`, `R4/R5`, `R4-*`, `lot R4`, `phase R4`…), file names, and `git log -S` on the literal tokens.
- `resell-hub-final` (sibling clone): working tree and all 14 refs, including remote-tracking branches absent from the first clone (`claude/adksy-prisma-supabase-audit-h4kxg6`, `hotfix/image-upload-workspace-id`, `fix-workspace-infinite-loading`, `fix-google-oauth-slug-collision`, `fix-expired-connection-display`, `vision-fix-local`) and its `refs/stash` — 0 relevant hit. Three stashes exist there (`backup-before-ebay-sandbox-branch`, `temp-local-env-example`, `temp-vitest-config`): names only, contents not read.
- `resellhubfinal` (third copy, a Git repo): 4 refs and working tree — 0 hit.
- File names containing `R4`/`R5`/`roadmap`/`closure`/`rapport` under `Downloads` (depth ≤ 2): only the generic `PHASE2_ROADMAP.md` and `PRODUCTION_ROADMAP.md` (old "Phase 2.x" numbering, unrelated to the R/C/S roadmap) and this file.
- The only textual matches for `R4`/`R5` are order identifiers in `etsy-update-order-status-tracking.test.ts` (`'r4'`, `'r5'`) — unrelated.

**To unblock R4/R5, the user must supply** (any of): the original R4 and R5 definitions (objective, scope, acceptance criteria); their closure reports (verdict, tests, files changed, reserves); the commit hashes / branch names of their implementation if they exist outside these three clones; or the chat/export where they were produced. The same applies to R6, C6/C1, S7 and S8.

## 3. Consolidated roadmap (reference table)

| Ordre | Lot | Statut | Preuves | Réserves | Prochaine action |
|---|---|---|---|---|---|
| 1 | Rapports R3-B → S8 | **BLOCKED — source manquante** (R4+) | Retrouvés : travaux R3-B/R3-C de cette série de sessions uniquement | Voir §2 | Fournir les rapports |
| 2 | **R3-B** | **VALIDÉ AVEC RÉSERVES — code local** | Audits R3-B.2→R3-B.5.11 (sessions) ; sélections Prisma publiques Orders/Listings/Fulfillment/Partners/Connections ; `simulate` minimal ; mock + code | Non commité/non déployé ; Preview non validé ; garde d'environnement de `simulate` ; jetons déjà exposés avant le correctif (rotation à décider) | Commit (autorisation) → Preview → inspection réseau |
| 3 | **R3-C** (+ R3-C.8, R3-C.9) | **VALIDÉ AVEC RÉSERVES — code local, non commité, non déployé** | §1 : 93 tests live DB + 244 non-DB + tsc (rapportés) ; 2 vulnérabilités corrigées | Réserves restantes après C.8/C.9 : voir §5 | Relecture indépendante avant commit ; S7 ; audit Production |
| 4 | R4 (seeds: réparation) | **PASS AVEC RÉSERVES — code local, non commité** (objectif récupéré ; définition détaillée et rapport originaux toujours absents) | §7 : audit, réparation de `prisma/seed.js`, 10 tests live + tests de sécurité | Périmètre reconstruit à partir de l'objectif seul ; non commité ; Preview non validé | Relecture indépendante, commit sur autorisation |
| 5 | R5 (seeds: sécurisation) | **PASS AVEC RÉSERVES — code local, non commité** (idem) | §7 : garde fail-closed, plus de mot de passe codé en dur, idempotence, transaction, confirmation de cible de la seed de plans | idem | idem |
| 6 | R6 (audit des autres routes) | **PASS AVEC RÉSERVES — audit et corrections réalisés en local, non commités** | §8 : 48 routes / 64 handlers, 5 constats corrigés + tests | Définition détaillée originale absente ; réserves §8 ; non commité | Relecture indépendante ; puis **C6 (commentaire du schéma)**, puis C1 |
| 7 | C6 (commentaire du schéma) puis C1 (décision sur une fonction SQL et une contrainte CHECK) | **C6 : PASS AVEC RÉSERVES** (§9, commentaires seuls, local, non commité) — **C1 : PASS AVEC RÉSERVES** (§10, décision option 2, documentation/commentaires seuls, local, non commité) ; objectifs récupérés (ChatGPT), deux lots distincts, dans cet ordre | Aucun rapport original ; élément de contexte repéré dans l'historique Git : commit `aa91573` (fonction `reserve_product_stock()` + CHECK non négatif, commit non atteignable depuis les branches locales), sans valoir C1 | Définitions détaillées absentes | Réalisés (C6 §9, C1 §10) |
| 8 | S7 (Node.js 22.20+, compatibilité des dépendances, vulnérabilités npm) | **PASS AVEC RÉSERVES** (§11 : compatibilité Node 22.20+ prouvée hors ligne ; audit de vulnérabilités NON VÉRIFIÉ faute de réseau ; local, non commité) — objectif récupéré (ChatGPT) | Aucun rapport original | Les réserves de sécurité de R3-C proposées pour « S7 » (stock route, simulate, raw Prisma CLI, 401/404) ne font PAS partie de cet objectif récupéré : à réaffecter | Après C1 |
| 9 | Dashboard Analytics | **NON COMMENCÉ** (ticket rédigé) | Audit statique : `dashboard/page.tsx:76-78`, `api/analytics/dashboard/route.ts:17-23`, `dashboardMetricsState.ts:43` | À faire après S7 (ordre convenu) | Découpage base/avancé de `getDashboardMetrics`, puis correctif |
| 10 | S8 (devises, bénéfice des commandes synchronisées, précision des montants, Analytics) | **PASS AVEC RÉSERVES (local, mocks, non commité)** — voir §13 | Section 13 de ce fichier ; pas de rapport original | Après le Dashboard Analytics | Confirmation produit + test DB réelle + migration à appliquer hors Production |
| 11 | B.9 validation manuelle Preview | **VALIDÉ** (observation de 2 utilisateurs) | Rapport utilisateurs | Non revérifié par Claude | — |
| 12 | OAuth Sandbox — parcours 1 | **PARTIEL** | SQL (workspace `cmvwvt71…`) : connexion à 2026-11-19 17:30:22.714 UTC, tokens chiffrés présents, `updatedAt` inchangé depuis | `sellerId`/`accountId` NULL : vendeur non identifié | B.11 / B.12 |
| 13 | OAuth Sandbox — parcours 2 | **PARTIEL** | SQL (workspace `cmwnto79…`) : ligne distincte créée 2026-11-19 18:12:27.029 UTC | Session eBay réutilisée (écran de connexion non vu) ; vendeur non identifié | B.11 / B.12 |
| 14 | Isolation SQL (connexions eBay) | **VALIDÉ** | Audit SQL en lecture seule : 2 lignes distinctes, WS2 inchangé | Reflète l'état du 2026-11-19 | — |
| 15 | B.11 test Sandbox, 2e vendeur | **BLOCKED** | Préflight PASS (Preview `e1754c1`, config Sandbox vérifiée par les utilisateurs) | Accord du titulaire du workspace `cmvsydyt…` et 2e vendeur Sandbox distinct non confirmés | Obtenir les deux confirmations |
| 16 | B.12 identité vendeur / anti-doublon | **NON COMMENCÉ** | État des lieux : pas de `getShopId` eBay, pas de scope identité, `sellerId` NULL | Migration éventuelle à autoriser séparément | Conception puis implémentation |
| 17 | Préparation Production (audit final) | **NON COMMENCÉ** | — | Réserves n° 6, 7, 9 de R3-C | Après B.12 |
| 18 | OAuth eBay Production | **NON COMMENCÉ — interdit à ce stade** | — | — | Étape distincte |
| 19 | Première publication réelle | **NON COMMENCÉ — interdit à ce stade** | — | — | Étape distincte |

## 4. Local test infrastructure (to remember)
- PostgreSQL 14.24, WSL2 Ubuntu-22.04, cluster `adksy_r3c` on port 5433, database and role `adksy_r3c_test` (non-superuser), SCRAM, `127.0.0.1` only, manual start. Password only in `/home/cheik/.adksy-r3c/pgpass` (mode 600, outside the repository) — never printed.
- Start the cluster inside a long-running background `wsl … sleep` command (WSL stops when idle); stop it cleanly (`pg_ctlcluster 14 adksy_r3c stop`) then `wsl --terminate Ubuntu-22.04`.
- Run DB tests only with `node scripts/r3c/run-with-test-db.mjs vitest <explicit test files>`. Never a global `vitest run`; never `prisma migrate dev|reset`, `db push`, seed.

## 5. R3-C.8 and R3-C.9 — results (local code, not committed)

_C.8 and C.9 are additional security tasks identified by the R3-C.7 audit. They are **not** the historical R4/R5 lots (which remain `BLOCKED — DÉFINITION/RAPPORT SOURCE MANQUANT`)._

### R3-C.8 — universal DB guard: **PASS** (local code)
- New shared builder `scripts/db/lib/guardedEnv.mjs`; guarded wrapper `scripts/db/guarded-prisma.mjs`; the npm scripts `db:push`, `db:reset`, `db:seed`, `db:studio` now go through it (new `db:check`, `db:migrate:status`, `db:migrate:deploy`). Destructive ones need `--confirm-local-test-db`; no flag forwarding; no `migrate dev`; local test DB only.
- The guard now scans the env **files** Prisma and Vite load (`.env*`, `prisma/.env`) — also when the shell has no DB variable (the C.7 gap) — and refuses shell-exported DB variables unless they are exactly the authorized target. The Vitest setup derives the project root from its own location.
- Documentation: `docs/DB-SAFETY.md` (architecture + bypass matrix).
- Proof: 76 new tests (env-file parsing/scan, `buildGuardedEnv`, real spawn of both scripts with a synthetic credentials file, npm-script assertions) + the 59 guard tests = 135 passing; end-to-end demonstration that a synthetic hostile `prisma/.env` is refused by Vitest and by `npm run db:check` (file removed afterwards); live non-destructive `npm run db:migrate:status` on the local DB ("schema is up to date").
- **Still open:** a raw `npx prisma …` typed directly cannot be intercepted by repository code (documented); a test that sets `process.env.DATABASE_URL` at runtime would not be detected (none exists).

### R3-C.9 — remaining surfaces: **PASS AVEC RÉSERVES** (local DB + mocks)
| Surface | Level | Result |
|---|---|---|
| Plan limits (products, listings, orders, marketplaces) | DB locale (real plans/subscriptions) | Counts are per workspace (A below limit while A+B would exceed it); soft-deleted rows ignored; one tenant's subscription status never changes another's entitlements; `POST /api/products` refused for A at its limit and allowed for B |
| AI agent (actions, confirm/cancel, conversation history, feature gate) | DB locale | B's action/conversation never readable or modifiable by A (404, B byte-identical); workspace comes only from the session; plan gate and cancelled subscription → 403; no LLM called |
| Stripe webhooks | DB locale + local SDK signature check (fake key/secret, no network) | Unsigned → 400, forged → 401; signed event links only the named workspace; replay idempotent; **vulnerability found and fixed** (below) |
| Sync crons | DB locale + spies on the sync services | Fail-closed auth (missing/wrong/length-mismatched secret, unset `CRON_SECRET` → 401); each connection synced with its own workspace id; failures isolated; response = counts only |
| OAuth callback | DB locale + spy on the connection service (no OAuth) | Session-only workspace; invalid/missing/wrong-length state, missing code → 400 without exchange; per-workspace marketplace limit enforced; **information leak found and fixed** (below) |
| Dev stock route | DB locale | **Hardened** (below) |
| Storage | mock (fake client) — unchanged from C.4 | Network storage never contacted; real integration still untested |
| Fulfillment simulate | DB locale (C.4) + mock (C.5) | Isolation proven; **no environment guard added** — see reserves |

Vulnerabilities found by the new tests (red first, then fixed, then green):
1. **Stripe `handleSubscriptionCreated`** — a signed event naming workspace B for a Stripe subscription id already linked to workspace A overwrote A's subscription plan. Now refused (`Subscription already belongs to another workspace`). Reachable only with a validly signed event, so low exposure, but the cross-tenant write path is closed.
2. **OAuth callback error redirect** — the raw upstream error message was placed in the redirect URL (history/logs; could carry provider details or token fragments). Now only a known-safe message or a generic one is shown.
3. **`/api/test/stock-race-condition`** — unauthenticated, enabled for any `NODE_ENV` except `production`, and its `cleanup` / `simulate` actions took a workspace id from the body. Now: `development` only, a single body read (it was broken for `simulate`/`cleanup`), and it only acts on the synthetic workspaces its own `setup` created.

Totals (reported): **133 live DB tests** (8 files: 93 from R3-C + 13 plans/AI + 27 Stripe/cron/OAuth/stock) and **377 targeted non-DB tests** passing; `tsc` clean. 4 failures exist in the unrelated `MarketplaceConnectionsCard.test.ts` (source-pattern tests that expect LF endings; the component file has CRLF on this Windows checkout) — pre-existing, file untouched.

### Reserves — status after C.8/C.9
| # | Reserve | Status |
|---|---|---|
| 1 | DB guard not universal | **Mostly treated** (npm scripts, env files, shell variables); raw Prisma CLI remains documented-only |
| 2 | `prisma/.env` not blocked | **Treated** |
| 3 | Direct Prisma commands dangerous | **Treated for `npm run db:*`**; raw `npx prisma` still open |
| 4 | `createProduct` spread | Open (R3-C.8 follow-up / S7) |
| 5 | Stock race-condition route | **Treated** |
| 6 | `simulate` without environment guard | Open — product decision needed (the dashboard uses it as a demo flow); tracked for S7 / Production audit |
| 7 | AI, Stripe, cron, OAuth untested on real DB | **Treated** (DB locale / mocks as listed above); Preview not validated |
| 8 | Plan limits bypassed | **Treated** (real plans in the local DB) |
| 9 | Storage network mocked | Open |
| 10-14 | Results rerun before commit; limited audit independence; 401 vs 404/403; FK cascade on tenant deletion; dashboard images without `workspaceId`; uncommitted | Open |

## 6. C.10 and second documentary search (R4, R5, R6, C6/C1, S7, S8)

### C.10 — cross-platform source-pattern tests: **PASS**
- Cause: `MarketplaceConnectionsCard.test.ts` reads the component source with `fs.readFileSync` and searches it with LF patterns (`'\n}\n'`, `'return {\n    ok: false,'`). On this Windows checkout (`core.autocrlf=true`) the working copy is CRLF while the Git index is LF, so 4 tests failed.
- Fix (test only): the source is normalized to LF **in memory** (`.replace(/\r\n/g, '\n')`) before the existing assertions run. No assertion removed, the component is untouched.
- Proof: 4 failing → 35/35 passing on the CRLF checkout; an in-memory check with forced-LF and forced-CRLF variants of the component shows the raw CRLF text does not contain the LF patterns while both normalized variants are identical and contain them.

### Sources examined for R4/R5 and the other lots (all read-only; nothing applied, fetched or checked out)
| Source | What was examined | Result |
|---|---|---|
| `adksy-test-migrate` | working tree, all 8 refs (165 commits), reflog, **26 unreachable commits** (security-hardening commits of 2026-10-12/13, stashes' commits, old merge parents), file contents of every commit, deleted files in history, tags (none) | No `R3-x`, `R4`, `R5`, `R6`, `S7`, `S8`, `C6`, `C6/C1` token. Only `Shelf C1` (seed data) |
| `resell-hub-final` (sibling clone) | 14 refs (185 commits), 29 reflog commits, 5 unreachable commits, 3 stashes (`backup-before-ebay-sandbox-branch`, `temp-local-env-example`, `temp-vitest-config`) read via `git grep`/`git show`, not applied | Same: none |
| `resellhubfinal` (third copy) | 4 refs (23 commits), 21 reflog commits, 10 unreachable commits (WIP/index of the August audit branch) | Same: none |
| GitHub `cheikhsarrxiv-crypto/resell-hub-final` | `git ls-remote` (refs only): 10 branches, PR refs #1–#8; every head/PR-head commit exists in the local object store and was scanned | No lot reports; commit subjects are product fixes |
| Vercel deployments (read-only API) | 40 deployments, commit messages | No lot markers; production = `main` @ `a141e95`, Preview = `preview/ebay-sandbox-isolation` @ `e1754c1` |
| Documents | 53 root Markdown/TXT files (old "Phase 2.x" audits, `PHASE2_ROADMAP.md`, `PRODUCTION_ROADMAP.md`), `docs/fulfillment/*` | Different numbering; no R/C/S lot definition or report |

**Confidence that the originals are not in any accessible source: high.** They were produced in conversations / sessions whose outputs were never committed.

### Leads (not definitions)
- **Claude Code sessions referenced in commit trailers** (the conversations that produced the code; the R/C/S reports may be inside them or in later, uncommitted sessions): `session_01SPxrNf4jCVeGP3Cun1BtSa` (2026-08-23 → 09-08, 35 commits), `session_01TndpJWRn9WVyDS2pWDZtM2` (2026-09-13 → 10-19, 121 commits), `session_01AAuitMgVCRko3Q8Sfm9whv` (2026-11-02, 1 commit = `e1754c1`). The R3-B…B.12 conversations dated 2026-11-19/20 are later than any commit.
- **Naming families that do exist in the code** (older, different scheme): `Phase 1…12C` (e.g. Phase 12A/12C, 11A–11E, 10.5), `Option A/B`, `D-1/D-2 fix`, `Connector Hub audit (B1)`, `Fulfillment Integration Foundation V1`. No mapping to R4/R5/R6/C6/S7/S8 is established or assumed.

### Reconstruction of R6, C6/C1, S7, S8 (only what is confirmable)
| Lot | Objective | Historical position | Work done | Remaining | Source/proof | Confidence | Status |
|---|---|---|---|---|---|---|---|
| R6 | unknown | after R4/R5 (user-stated order) | unknown | unknown | none | — | STATUT À CONFIRMER |
| C6/C1 | unknown | after R6 | unknown | unknown | none | — | STATUT À CONFIRMER |
| S7 | "clôture sécurité" (user-stated label only) | after C6/C1 | unknown; several R3-C reserves are proposed to land here | unknown | none | — | STATUT À CONFIRMER |
| S8 | "audit de cohérence Analytics après le correctif Dashboard" (user-stated) | after Dashboard Analytics | unknown | unknown | none | — | STATUT À CONFIRMER |

No lot definition is created or inferred from the names.

## 7. R4/R5 — seeds: repair and security (local code, not committed)

**Provenance of the definition.** The repositories contain no R4/R5 definition or report. The objective below was recovered by the user from old ChatGPT conversations: *R4/R5 = repair and security of the seeds* (historical order: R4/R5 → R6 → C6 → C1 → S7 → S8; R6 = audit of the other routes, C6 = schema comment, C1 = decision on a SQL function and a CHECK constraint, S7 = Node.js 22.20+ / dependency compatibility / npm vulnerabilities, S8 = currencies, profit of synchronized orders, amount precision, Analytics). The detailed definitions and original reports are still missing, so the scope was reconstructed from this objective and from technical evidence in the repository — **no historical sub-task was invented**.

### Audit (static + executed on the local test DB)
| Item | Finding | Level |
|---|---|---|
| `prisma/seed.js` — target | No check of the database it runs against: `node prisma/seed.js` ran on whatever `DATABASE_URL` held (Production included) | **Confirmed** |
| `prisma/seed.js` — credentials | Hardcoded, documented demo password (README, QUICK_START, PROJECT_SUMMARY) and printed at the end of every run; a seeded Production would carry a known-credentials Pro account | **Confirmed** |
| `prisma/seed.js` — broken on the current schema | `marketplaceId` set to `Marketplace.id` while the foreign key references `Marketplace.name` → crash; `listings[0].product` used without `include` → would also crash | **Confirmed by execution** (local test DB) |
| `prisma/seed.js` — partial / non-idempotent | No transaction: run 1 left a user + subscription + workspace without products; run 2 created an **orphan Subscription** then failed on the unique slug (subscriptions 1 → 2) | **Confirmed by execution** |
| `prisma/seed.js` — logs | Any Prisma failure printed the full invocation (arguments include the password hash) | Confirmed by reading |
| `prisma/seed.js` — overwrite / isolation | Reference rows and the demo user use `update: {}` (never overwritten); all demo rows are created in one workspace | Already safe |
| `prisma/seed-plans-production.js` | Plan-only, `--dry-run`, opt-in flag, `update: {}`: already safe; but it never showed which database it targets and a write run could hit any database if the flag was set; plans were written one by one | Theoretical risk |
| `scripts/fetch-etsy-taxonomy.ts` | Upserts only the global `EtsyTaxonomyNode` reference table from the Etsy API (needs `ETSY_CLIENT_ID`); no delete, no tenant data, no credential in the source. Intended for real environments. Not run (external API) | Reviewed, no change |
| Other init data | `MockFulfillmentProvider` (in memory), `docs`, `.env.example`; no other script writes to a database | Reviewed |
| `db:seed` npm script | Already routed through the guarded wrapper by R3-C.8 | Already safe |

### Corrections
- `prisma/seed.js` rewritten (demo data unchanged): **fail-closed target** (loads the shared DB guard; refuses anything but the dedicated local test DB, any env-file or external-credential redirection, and refuses if the guard cannot be loaded); **no hardcoded password** (account has no password unless `ADKSY_DEMO_USER_PASSWORD` ≥ 12 chars is given; hashed, never printed); **idempotent and atomic** (the demo graph is one transaction, created only if the demo workspace is absent; a workspace owned by another account with the demo slug is left untouched; nothing is ever deleted; reference data `update: {}`); **repaired** (`marketplaceId` = marketplace name, `include: { product: true }`); safe error line (no Prisma dump); `--dry-run`; lazy Prisma client; exports for tests.
- `prisma/seed-plans-production.js`: prints the target (host / port / name only) and, before any write, requires `PLAN_SEED_EXPECTED_DB_HOST` to equal the host of `DATABASE_URL` (fail-closed, exit code 2); plans are written in one transaction. Dry run and the existing gate are unchanged. **It was not run against anything.**
- `.env.example` (new `PLAN_SEED_EXPECTED_DB_HOST`, `ADKSY_DEMO_USER_PASSWORD`) and README / QUICK_START / PROJECT_SUMMARY (no published credentials).
- Legacy test "seed.js unchanged" adapted (the file legitimately changed).

### Tests
| Level | Result |
|---|---|
| Static / pure / real child processes, no DB (`src/__tests__/prisma/seed-safety.test.ts` + legacy `seed-plans-production.test.ts`) | 52 passing, incl. 9 hostile-target refusals, short password, unknown flags, env-file redirection, guard-not-loadable, target confirmation of the plan seed |
| Local test DB (`src/__tests__/isolation/r3c-seed.live.test.ts`, guarded runner) | 10 passing: full graph in one workspace, no password by default, bcrypt hash only, idempotent ×3, existing user / plan / marketplace preserved, foreign demo slug untouched, atomic rollback, concurrent runs → one workspace, other tenants byte-identical |
| Before/after on the local DB | Before: crash + partial data + orphan subscription. After: complete graph, second run changes nothing |
| Regression | 9 live files = 143 tests passing; 10 non-DB files = 312 tests passing; `tsc` clean |

### Result and reserves
**R4/R5: PASS AVEC RÉSERVES (local code, not committed).** Not declared `VALIDÉ`: the original detailed definition and report are not available to confirm that every historical criterion is met.
- Reserves: scope reconstructed from the objective only; not committed; Preview/Production not validated (and no seed was run anywhere but the local test DB); `fetch-etsy-taxonomy.ts` runs against whatever database the environment names (by design, reference data only); `seed-plans-production.js` now needs the extra variable in the operator procedure (documented); raw `npx prisma db seed` is not configured (no `prisma.seed` in `package.json`).
- Remaining: independent review; commit decision; **next historical step: R6 — audit of the other routes.**

## 8. R4/R5 correctif final (cible complète du seed de plans) et R6 (audit des autres routes)

### 8.1 R4/R5 — correctif final
`prisma/seed-plans-production.js` ne se contente plus de comparer le hostname. Avant toute écriture il exige **hôte + port + nom de base** nommés par l'opérateur (`PLAN_SEED_EXPECTED_DB_HOST/PORT/NAME`, jamais codés en dur) et identiques à `DATABASE_URL`. Il refuse (code 2, **avant création du client Prisma**) : variable manquante/invalide, tout écart, URL ambiguë (`host=`, `hostaddr=`, `port=`, `dbname=`, `options=`, `service=`…, plusieurs hôtes, pas de base, schéma non postgres), `DIRECT_URL` pointant ailleurs, tout fichier `.env`/`prisma/.env` désignant une autre cible, et toute défaillance interne du garde (fail-closed). Cible affichée sans utilisateur, mot de passe, paramètres ni URI. `.env.example`, `docs/DB-SAFETY.md` mis à jour. Tests : `seed-plans-target.test.ts` (58, dont 2 processus enfants réels, aucune base). **Jamais exécuté sur une base réelle.** Verdict R4/R5 : **PASS AVEC RÉSERVES** (inchangé : définition détaillée originale absente, non commité).

### 8.2 R6 — périmètre et méthode
Définition historique récupérée (ChatGPT) : *audit des autres routes*. Définition détaillée et rapport originaux **absents** : périmètre reconstruit à partir du code, de l'architecture et des preuves R3-B / R3-C ; aucune sous-tâche historique inventée. Inventaire par script (`src/app/api/**/route.ts`) : **48 fichiers de route, 64 handlers** (GET 27, POST 24, PUT 6, PATCH 3, DELETE 4, d après l inventaire automatique). Middleware : seules `/api/auth*`, `/api/cron*` et `/api/email/verify` sont publiques ; le reste exige une session, **et chaque route revérifie** (workspace via `verifyWorkspaceAccess`, ressource via propriétaire, cron via secret à temps constant, webhook Stripe via signature).

### 8.3 Constats
| # | Sévérité | Nature | Route / fichier | Constat | Statut |
|---|---|---|---|---|---|
| 1 | **MEDIUM** | Confirmé (lecture + exécution) | `actionTools.ts` (`downloadImageForEtsyUpload`), `StorageService.rehostImageFromUrl` — chemins de publication Etsy / création produit IA | `fetch(url)` brut d'URL d'images issues de résultats de sourcing externes (eBay, Etsy, recherche web) : SSRF aveugle (métadonnées cloud 169.254.169.254, réseau interne), redirections non contrôlées, pas de délai, corps téléchargé en entier avant contrôle de taille | **Corrigé** (`src/lib/security/ssrfGuard.ts`) |
| 2 | **MEDIUM** | Confirmé | `errorResponse` (`src/lib/security.ts`) — toutes les routes qui l'utilisent ; copie dans `ai/agent/profile` | Renvoyait `error.message` brut : les erreurs Prisma contiennent modèle, arguments, identifiants, colonnes, hôte | **Corrigé** |
| 3 | LOW | Confirmé | `analytics/dashboard`, `analytics/overview` | `days=abc` → NaN → Invalid Date → erreur brute ; `days=99999999` → balayage non borné | **Corrigé** (`parseAnalyticsDays`, 1–365) |
| 4 | LOW | Confirmé | `PUT /api/workspaces/[id]` | Liste blanche de champs correcte, mais valeurs non typées/non bornées (objet, tableau, texte illimité) → erreur brute | **Corrigé** (schéma zod) |
| 5 | LOW | Confirmé | `POST /api/onboarding` | `step` chaîne/flottant accepté, champs non typés/non bornés transmis au service | **Corrigé** (schéma zod, champs inconnus ignorés) |
| 6 | LOW (fonctionnel) | Confirmé | `dashboard/settings/page.tsx` | Le PUT n'envoyait pas `workspaceId` exigé par la route → échec 400 de l'enregistrement des réglages | **Corrigé** (paramètre ajouté) |
| 7 | MEDIUM | Dette de sécurité / produit | `DELETE /api/workspaces/[id]` | Supprime le workspace sans annuler l'abonnement Stripe (facturation qui continue), session JWT conservant un `workspaceId` supprimé ; suppression en cascade selon le schéma | **Non corrigé** (changement de comportement produit) — à décider |
| 8 | LOW | Dette | `POST /api/email/verify` (public) | Pas de limitation de débit ; messages distincts selon l'état du jeton (énumération d'un `userId`). Jeton 256 bits haché : force brute irréaliste | Non corrigé |
| 9 | LOW | Dette | `signup` (« User already exists »), `forgot-password` (échec d'envoi seulement si le compte existe) | Énumération de comptes | Non corrigé |
| 10 | LOW | Dette | webhook Stripe | `WebhookLog.error` stocke un message d'erreur brut (2000 car.), table interne | Non corrigé |
| 11 | INFO | Risque théorique | `ssrfGuard` | Fenêtre DNS-rebinding entre la vérification et le `fetch` (agent HTTP à adresse épinglée non implémenté) | Documenté |
| 12 | INFO | Comportement voulu | `workspaces/[id]` GET, `subscriptions` | Renvoient `stripeCustomerId` / `stripeSubscriptionId` **du propriétaire lui-même** (identifiants non secrets) | Accepté |
| 13 | INFO | Déjà protégé | produits, annonces, commandes, images, fulfillment, connexions, OAuth, Stripe checkout/portal/webhook, cron, admin, notifications, AI agent/chat, route de test | Prouvé par R3-B / R3-C (133+ tests live) ; admin = liste e-mail réservée à l'inscription ; cron = secret en temps constant, échec fermé | — |
Aucun CRITICAL ni HIGH confirmé. Surfaces non validées : appels réels eBay/Etsy/Stripe/OpenAI/Tavily/SMTP (interdits), comportement réseau réel du garde SSRF (DNS simulé), exécution en environnement Preview/Production.

### 8.4 Tests
| Niveau | Résultat |
|---|---|
| `src/__tests__/security/r6-routes.test.ts` (sans base ni réseau) | 123 : adresses privées v4/v6, URL hostiles (schémas, identifiants, ports, notations décimale/hex/octale, IPv6 mappée), résolution privée, redirections, délai/taille, `errorResponse` avec vraies classes d'erreur Prisma, `days`, PUT workspace (mass assignment, types, tailles, 403), onboarding |
| `src/__tests__/isolation/r3c-r6-routes.live.test.ts` (base locale, runner gardé) | 5 : champs sensibles non modifiables, 400 propres sans texte Prisma, A ne peut pas écrire chez B, onboarding non redirigeable par le corps, étapes invalides sans effet |
| Suites existantes touchées (storage rehost, actionTools, pipeline Etsy) | 148 passent (résolveur DNS simulé globalement : `vitestNoDns.setup.ts`) |
| Régression | 10 fichiers live = 148 tests ; suite complète sans base : 3261 passent, **6 échecs préexistants** (tests de code source qui cherchent des `\n` alors que la copie de travail Windows est en CRLF : `middleware-cron`, `middleware-password-reset`, `ai/agent/profile` ; fichiers de prod non liés à un défaut) ; `tsc` propre |
| Avant correctif | Constats 1–6 établis par lecture du code et trace d'appel ; pas de rejeu rouge des anciens comportements (pas de retour en arrière du code autorisé) |

### 8.5 Réserves non affectées de R3-C (lot historique réel non retrouvé)
Conservées ici, **sans les rattacher à S7** : route de stock de test (`/api/test/stock-race-condition`, déjà gardée par `NODE_ENV` et corrigée en C.9), garde de la simulation fulfillment, CLI Prisma brute hors wrapper, 401 vs 404 pour une ressource d'un autre workspace (observé à nouveau en R6), absence de test sur Preview/Production, B.11/B.12 inchangés.

### 8.6 Suite
Prochaine étape historique : C6 (§9), C1 (§10), S7 (§11) et le correctif Dashboard Analytics (§12) réalisés, puis **S8**.

## 9. C6 — commentaire et documentation du schéma (local, non commité)

**Définition historique récupérée :** « C6 : commentaire du schéma » (ChatGPT). **Définition détaillée et rapport originaux : absents** — périmètre reconstruit à partir de cet objectif et du schéma Prisma/PostgreSQL actuel ; aucune sous-tâche historique n'est prétendue retrouvée.

### Audit
`prisma/schema.prisma` : 1089 lignes, 32 modèles, **0 enum** (tous les statuts sont des `String` libres), 18 migrations (`20260824…` à `20261008…`). Comparaison migrations/schéma : une base locale construite par `prisma migrate deploy` à partir des 18 migrations donne un `migrate diff` **vide** contre `schema.prisma` (aucune dérive de structure) et `migrate status` « up to date ». Déjà bien documentés : modèles IA (AgentAction, AiUsage*), provenance produit, source de vérité du stock (Inventory), index partiel de Listing. Manques ou commentaires trompeurs constatés :
| Constat | Nature |
|---|---|
| Aucune explication de l'isolation par workspace, des modèles à portée indirecte (ProductImage, OrderItem, Shipment, TrackingEvent, AgentMessage), utilisateur (Notification, ApiKey, jetons) ou globaux (Plan, Marketplace, FulfillmentPartner, EtsyTaxonomyNode) | absent |
| `Product.quantity` : commentaire affirmant qu'un CHECK `quantity >= 0` « existe en production, ajouté par la migration stock_race_fix » | **trompeur** : aucune migration de ce nom ; une base issue des 18 migrations n'a ni CHECK ni fonction SQL (vérifié en lecture seule). Existence en base réelle : non vérifiable depuis le dépôt |
| `Subscription.status` : « cancelled, expired » | **obsolète** : le code écrit `canceled` (Stripe), `past_due` ; seuls active/trialing/past_due donnent l'accès payant |
| `WebhookLog.marketplace` : « ebay \| etsy » | incomplet : le webhook Stripe y écrit `stripe` |
| `MarketplaceConnection` : colonnes d'identifiants non expliquées, `status` « mock, error » jamais écrits, `apiKey/apiSecret` hérités et non écrits | ambigu |
| Soft-delete (User, Product, Listing), `User.deletedAt` jamais écrit et non vérifié à la connexion, SKU d'un produit supprimé non réutilisable (unique non partiel) | absent |
| Monnaie : tous les montants `Float`, aucune colonne devise hors Plan ; `Order.estimatedProfit` = 0 pour les commandes synchronisées | absent (objectif S8) |
| `ApiKey`, `Webhook` : non utilisés par le code applicatif ; `Plan.billingPeriod`, `autoDelistEnabled` non lus | absent |
| Champs sensibles (`FulfillmentPartner.apiKey/webhookUrl`, identifiants de connexion, données personnelles des commandes) | absent |

### Modifications
Uniquement des commentaires dans `prisma/schema.prisma` (+188 lignes de commentaires ; 11 lignes retirées : anciens commentaires remplacés ou déplacés) : bloc « SCHEMA CONVENTIONS » (isolation, identifiants, statuts libres, argent, soft-delete, horodatages, objets présents en base mais absents du fichier), puis notes par modèle (User, tokens, Workspace, Plan, Subscription, Product, ProductImage, Inventory, Marketplace, MarketplaceConnection, WebhookLog, Listing, Order, OrderItem, FulfillmentPartner/Order, Shipment, ApiKey/Webhook, Notification, OnboardingData, EtsyTaxonomyNode). Chaque affirmation a été vérifiée dans le code ; l'ancien commentaire de `Product.quantity` est corrigé sans supprimer la mise en garde utile.

### Validations
`prisma validate` OK ; `prisma migrate diff` schéma HEAD → schéma actuel : **migration vide** (aucun changement de structure : types, noms, relations, index, contraintes identiques) ; base locale vs schéma actuel : vide ; `migrate status` : à jour ; les lignes ajoutées hors commentaires du diff texte sont 4 déclarations dont seul le commentaire de fin de ligne a changé ; `tsc` propre ; tests lisant le schéma et 2 suites live (42) passent. Aucune migration lancée (seul `migrate status` / `migrate diff` en lecture), aucune écriture en base.

### Réserves
- Périmètre reconstruit ; définition détaillée originale absente ; non commité ; Preview/Production non validés.
- **Incohérence structurelle documentée, non corrigée (hors C6) :** aucune fonction SQL `reserve_product_stock()` ni CHECK sur `Product.quantity` dans les migrations (le commit `aa91573` qui les mentionnait n'est pas atteignable) → à trancher en **C1**.
- Autres limites documentées, non corrigées : montants en `Float` sans devise (S8), `User.deletedAt` non appliqué à la connexion, `ApiKey.key`/`Webhook.secret` sans protection si un jour utilisés, `Workspace` → `Subscription` sans suppression en cascade ni annulation Stripe (voir §8.3 n° 7).
- Réserves R3-C et R6 et 6 échecs CRLF (§8.4, non comparés à l'état initial) inchangés ; R4/R5 et R6 restent PASS AVEC RÉSERVES.
- Prochaine étape historique : **C1** (fonction SQL et contrainte CHECK).

## 10. C1 — décision sur `reserve_product_stock()` et le CHECK `quantity >= 0` (local, non commité)

**Objectif historique récupéré (ChatGPT) :** « C1 : décision sur une fonction SQL et une contrainte CHECK ». Définition détaillée et rapport originaux **absents** ; périmètre reconstruit à partir des preuves du dépôt, aucune tâche d'origine inventée.

### Preuves (classées)
| Cl. | Preuve |
|---|---|
| **A** code actuel | `StockService.reserveStock` appelle `SELECT * FROM reserve_product_stock(${productId}, ${quantity})` (**2 arguments**). Son **seul appelant** est la route de test `/api/test/stock-race-condition` (réservée à `NODE_ENV=development`, C.9) ; `tests/stock-race-condition.test.ts` est obsolète et hors périmètre Vitest. `releaseStock/getStockLevel/isStockAvailable` agissent sur `Product.quantity`, qui n'est pas le stock réel. Les ventes réelles passent par `ProductService.reserveInventory` (`OrderService`, `OrdersSyncService`) : **un seul `UPDATE` conditionnel `available >= quantity`** sur `Inventory`, atomique (preuve live : R3-C relations/transactions). |
| **B** migrations | 18 migrations : aucune ne crée de fonction (`CREATE FUNCTION` absent), aucune n'ajoute de CHECK (le mot n'apparaît que dans un commentaire), aucun dossier `stock_race_fix`. Une base locale construite par `migrate deploy` n'a ni fonction ni CHECK (vérifié en C6, lecture seule). |
| **C** Git accessible | Aucun commit de toutes les branches (165 commits, locales et distantes) n'a jamais contenu un chemin `stock_race_fix` ni une migration créant la fonction. `reserve_product_stock` / `stock_race_fix` n'apparaissent (commits `628c904`, `c38a9ba`) que dans des **documents** Markdown ; l'affirmation du schéma vient du commit `b8f934d` (« docs: document undeclared CHECK constraint on Product.quantity », ancêtre de HEAD, modification d'une seule ligne de commentaire, sans migration). Le commit `aa91573` existe comme objet local mais **n'est ancêtre d'aucune branche** (aucune ne le contient) ; son message dit : la fonction « existait seulement comme documentation incohérente, jamais dans une migration suivie » ; il y ajoutait une fonction à **3 arguments** `(text, text, bigint)` + un CHECK dans une migration `20261012120000_fix_reserve_product_stock`, **non appliquée à une base** ; il n'a pas été intégré. |
| **D** hypothèse | Que la fonction ou le CHECK existent dans une base réelle (ancienne application manuelle des documents) : **non vérifiable** ici. |
| **E** Production / distante | **Non accessible dans ce lot, non vérifiée.** Aucune affirmation n'est faite sur Production ou Supabase. |

Conséquence : le commentaire du schéma (« CHECK existe en production, migration stock_race_fix ») et 10 documents à la racine (✅ fonction, ✅ CHECK, ✅ migration) affirmaient un état que **aucune preuve du dépôt ne soutient** ; et `StockService.reserveStock` appelle une signature (2 args) différente de celle du seul candidat jamais écrit (3 args) : sur une base issue des migrations, il échoue proprement (`success:false`).

### Décision : **OPTION 2** — retirer/corriger les affirmations obsolètes
Option 1 refusée : créer une migration « pour faire correspondre une ancienne affirmation » est explicitement exclu ; de plus la protection fonctionnelle existe déjà (`reserveInventory`), et la fonction candidate (`aa91573`, 3 args) ne correspond pas à l'appel actuel (2 args) : la raccorder serait un changement de comportement du stock, hors C1. Option 3 refusée : l'existence réelle n'est **pas prouvée** (D/E), et elle est même réfutée pour toute base issue des migrations ; **l'option 3 n'est pas vérifiable pour Production**. Aucun mécanisme fonctionnel n'est supprimé : `StockService` est conservé tel quel (comportement inchangé), seulement documenté.

### Modifications (commentaires et documentation uniquement)
- `prisma/schema.prisma` : note de `Product.quantity` mise à jour avec la décision C1 (commentaire seul).
- `src/services/StockService.ts` : commentaire d'exactitude (fonction non créée par les migrations, unique appelant, `Product.quantity` non source de vérité, aucun changement de comportement).
- `src/services/ai/AiUsageService.ts` : un commentaire ne présente plus `StockService` comme précédent prouvé.
- 10 documents racine (`AUDIT_STRICT_PHASE_2_9_3.md`, `FINAL_SECURITY_AUDIT.md`, `PHASE_2.8.1_{BLOCKERS_STATUS,COMPLETE_AUDIT,FINAL_AUDIT,SUMMARY}.md`, `PHASE_2.8.3_REAL_ENVIRONMENT_REPORT.md`, `POSTGRES_REAL_TEST_GUIDE.md`, `STOCK_RACE_CONDITION_{AUDIT,TEST_GUIDE}.md`) : bandeau « C1 CORRECTION » en tête ; contenu d'origine conservé.
- Nouveau test `src/__tests__/prisma/c1-stock-decision.test.ts` (20 tests statiques : migrations, chemins de vente, appelants, commentaires, bandeaux, aucune nouvelle migration).

### Validations
Aucune migration créée ni exécutée, aucune structure modifiée : `prisma validate` OK et `prisma migrate diff` schéma HEAD → schéma actuel = **migration vide** (hors ligne, URL factice, aucune connexion). Base PostgreSQL locale **non démarrée**, aucune écriture. `tsc` propre. Tests : c1 (20), seed-plans-production, product-access-inventory et `src/services/__tests__` : 207 passent (70 ignorés = suites live). Suite complète non relancée ; les 6 échecs CRLF (§8.4) restent non comparés à l'état initial.

### Réserves
- **Production/Supabase/Preview : état réel de la fonction et du CHECK inconnu, non vérifié** ; si un opérateur les a créés à la main, rien dans le dépôt ne le reflète.
- **Aucune contrainte de base n'empêche `Inventory.available` / `Product.quantity` de devenir négatifs** ; seule la garde applicative (`reserveInventory`, `updateMany` conditionnel) protège, et uniquement sur les chemins qui l'utilisent. Un CHECK éventuel serait une **décision de structure future**, hors C1 (à présenter à part, avec contrôle des données existantes).
- `StockService` reste du code mort hors route de test (appelle une fonction absente) ; le supprimer ou le réécrire relève d'une décision séparée. `tests/stock-race-condition.test.ts` (obsolète) non modifié.
- L'objet git `aa91573` reste non intégré (rien n'a été récupéré ni fusionné) ; sa migration, si un jour reprise, devrait être revue (signature 3 args vs appel 2 args).
- Réserves antérieures (R3-C, R6, S-lots, 6 échecs CRLF) et statuts R4/R5, R6, C6 : inchangés ; aucun Preview/Production déclaré validé ; non commité.
- Prochaine étape historique : **S7** (Node.js 22.20+, compatibilité des dépendances, vulnérabilités npm) — non commencée.

## 11. S7 — Node.js 22.20+, compatibilité des dépendances, vulnérabilités npm (local, non commité)

**Objectif historique récupéré (ChatGPT) :** « Node.js 22.20+, compatibilité des dépendances, vulnérabilités npm ». Définition détaillée et rapport originaux **absents** ; périmètre reconstruit depuis cet objectif et les preuves du dépôt, sans tâche inventée. **Aucun accès réseau** dans ce lot (aucun `npm audit` en ligne, `update`, `install`, `outdated`).

### Observations
- **Node installé : v24.20.0 ; npm : 11.19.0** (non modifiés). Node 22.20 lui-même **n'est pas installé** : sa compatibilité est établie par preuves statiques, pas par exécution.
- **Avant :** aucun champ `engines`, ni `.nvmrc` / `.node-version` / `.npmrc`, aucune CI (`.github` absent) ; `vercel.json` ne contient que les crons ; **`Dockerfile` en `node:18-alpine` (2 étages)** ; README et QUICK_START : « Node.js 18+ ».
- **Dépendances verrouillées** (`package-lock.json` v3, 446 entrées, 266 déclarent `engines.node`) : **aucune n'exclut Node 22.20.0 ni 24.20.0** ; la **plus haute exigence minimale est 22.20** (`@napi-rs/lzma-linux-x64-gnu`, optionnelle, via `rollup`) ; `@supabase/supabase-js` 2.112.3 (**dépendance de production**) et ses 5 sous-paquets exigent `>=22.0.0` → **Node 18 et 20 sont incompatibles** (le Dockerfile existant l'était). Node 20.19 est refusé par 7 paquets, Node 18.20 par 28.
- **Cadre :** Next 14.2.35 (`>=18.17`), React 18.3.1, Prisma / client 5.22.0 (`>=16.13`), vitest 4.1.10 (`^20 || ^22 || >=24`), TypeScript 5.9.3, Stripe 22.5.0 (`>=18`), Sentry 10.70.0 (`>=18`), next-auth 5.0.0-beta.32 : tous compatibles Node 22.20 d'après leurs `engines`.
- **Cohérence package.json / lockfile :** 0 écart sur les 3 sections de dépendances ; versions installées = verrouillées pour les 14 paquets clés ; 446/446 entrées résolues sur `registry.npmjs.org` avec hash d'intégrité ; `npm ls` hors ligne sans paquet invalide/manquant (seuls des optionnels propres à d'autres plateformes sont « UNMET », normal sous Windows).
- **Scripts :** seul script de cycle de vie du projet : `postinstall = prisma generate`. Paquets avec script d'installation : `@prisma/client`, `@prisma/engines`, `prisma`, `@sentry/cli`, `fsevents` (téléchargent des binaires à l'installation : réseau requis à ce moment).
- **API Node récentes :** aucune API réservée à Node 24 dans `src/`, `scripts/`, `prisma/`. Les scripts qui importent un fichier `.ts` directement (`scripts/db/lib/guardedEnv.mjs` → `dbSafetyGuard.ts`) reposent sur le *type stripping* de Node, activé sans option depuis **22.18** (d'après les notes de version de Node ; vérifié ici seulement sur 24.20) : le plancher 22.20 le couvre, 20.x et <22.18 non.

### Verdict de compatibilité
Le dépôt est **compatible Node ≥ 22.20 d'après les preuves statiques** (engines de 266 paquets, API, type stripping). **Non prouvé par exécution sur Node 22.20** (non installé) : suite de tests et build sous 22.20 à faire plus tard.

### Corrections (minimales, sans installation ni réseau)
- `package.json` : `"engines": { "node": ">=22.20.0" }` (`engine-strict` non activé : avertissement seulement).
- `package-lock.json` : le même `engines` dans l'entrée racine (3 lignes, ce que npm écrit lui-même ; reste valide, 446 entrées inchangées, aucune régénération).
- `.nvmrc` : `22.20.0`.
- `Dockerfile` : `node:18-alpine` → `node:22-alpine` (2 étages) + commentaire ; **tag non épinglé sur 22.20** (existence du tag exact non vérifiable hors ligne).
- `README.md`, `QUICK_START.md` : « Node.js 22.20+ ».
- Test `src/__tests__/security/s7-node-dependencies.test.ts` (16 tests) : plancher, miroir du lockfile, `.nvmrc`, Dockerfile, engines de tous les paquets verrouillés, intégrité/registre, cohérence des plages, scripts d'installation.

### Vulnérabilités npm — **NON VÉRIFIÉ**
Aucune donnée d'advisory locale : le cache npm local ne contient pas d'advisories, le dépôt ne contient aucun rapport d'audit ni identifiant CVE/GHSA. `npm audit --offline` a renvoyé « 0 vulnérabilité », **résultat sans valeur** (aucune base consultée) : il ne doit pas être lu comme « aucune vulnérabilité ». **Aucune CVE, aucun score ni version corrigée n'est affirmé.** À faire en ligne ultérieurement : `npm audit` (prod et dev) sur ce lockfile ; examiner en priorité `next` 14.2.35 (ligne 14 ancienne), `next-auth` 5.0.0-beta.32 (bêta), `prisma`/`@prisma/client` 5.22.0, `@sentry/nextjs` 10.70.0, `stripe` 22.5.0, `@supabase/supabase-js` 2.112.3, `@anthropic-ai/sdk` 0.124.0, `bcryptjs` 2.4.3, `zod` 3.25.76, ainsi que les transitives (446 entrées).

### Dette constatée, non corrigée (nécessite installation/réseau ou dépasse S7)
- `@types/react` / `@types/react-dom` 19.x avec `react` 18.3.1 ; `@types/node` 20.19.43 alors que le plancher est 22.20 (types à aligner : installation requise).
- `@prisma/internals` (devDependency) : aucune utilisation trouvée dans `src/`, `scripts/`, `prisma/` ; `semver` utilisé par un test est transitif (non déclaré).
- Dockerfile : l'étage de production lance `npm ci --only=production` alors que `postinstall` exécute `prisma generate` et que `prisma` est une devDependency → échec probable de l'image (**établi par lecture, non exécuté**) ; hors périmètre Node, non modifié.
- Version Node effective de Vercel (réglage projet) **non vérifiée** (accès interdit) : avec `engines >=22.20.0`, la prochaine construction Vercel sélectionnerait Node 22 ou plus ; à confirmer avant tout déploiement.
- `next build`, suite complète et tests sous Node 22.20 non exécutés ; les 6 échecs CRLF (§8.4) restent non comparés à l'état initial.

### Validations
`tsc` propre ; 16 tests S7 + guarded scripts + `src/__tests__/prisma` : 183 passent ; `npm ls` hors ligne sans problème bloquant ; JSON de `package.json` et du lockfile valides. Aucune base démarrée, aucune migration, aucun réseau.

### Réserves
- **PASS AVEC RÉSERVES :** vulnérabilités NON VÉRIFIÉES, Node 22.20 non exécuté, non commité, Preview/Production non validés, définition détaillée d'origine absente.
- Statuts et réserves R3-B, R3-C, R4/R5, R6, C6, C1 inchangés.
- Prochaine étape historique : **Analytics Dashboard**, puis **S8** (non commencés).

## 12. Correctif Dashboard Analytics — accès Starter aux statistiques de base (local, non commité)

**Nature :** correctif fonctionnel de séparation Basic / Advanced Analytics (ordre historique : après S7, avant S8). **Ce n'est pas S8** : aucun calcul, aucune précision monétaire, aucune devise ni profit de commande synchronisée n'a été touché.

### Problème reproduit (par lecture du code et des plans)
Les deux routes `/api/analytics/dashboard` et `/api/analytics/overview` étaient **entièrement** soumises à `advancedAnalytics` (Starter et Free : `false`). Les pages `/dashboard` et `/workspace/[slug]` affichaient alors **un écran « Upgrade required » unique à la place de toute la page** ; `/dashboard/analytics` affichait une erreur « Failed to load analytics » au-dessus de sections vides. Aucune route ne servait de statistiques de base. De plus le client prenait **tout 403** pour un verrouillage de plan (un 403 « Email verification required » aurait été présenté comme « Upgrade »).

### Découpage Basic / Advanced (décision documentée)
Aucun indicateur de plan « basic analytics » n'existe (et le schéma ne doit pas changer) ; la page tarifaire ne cite que « Advanced analytics » (Pro et au-dessus).
- **Basic (tous les plans, y compris Free) :** compteurs d'activité sans montants — commandes de la période, produits, annonces actives, commandes en attente (mêmes filtres que `getDashboardMetrics`).
- **Advanced (feature `advancedAnalytics`, inchangée) :** tout le financier/analytique — chiffre d'affaires, bénéfice, marge, par marketplace, fulfillment, tendance, performance produits/marketplaces.
Ce découpage est un choix de moindre privilège (aucune donnée premium au Starter) : **à valider par le produit** (par ex. revenus bruts en Basic ?).

### Avant / après
| | Avant | Après |
|---|---|---|
| Starter, `/dashboard` | écran « Upgrade required » unique | page utilisable : 4 compteurs Basic + 3 cartes Advanced verrouillées (lien « View plans ») |
| Starter, `/dashboard/analytics` | erreur + sections vides | compteurs Basic + 3 cartes verrouillées (tendance, top produits, marketplaces) |
| Starter, `/workspace/[slug]` | écran « Upgrade required » unique | compteurs Basic + bloc d'upgrade |
| Plan avancé | page complète | **identique** (mêmes données, mêmes sections) ; une panne du endpoint Basic ne la dégrade pas |
| 403 non lié au plan (e-mail non vérifié…) | présenté comme « upgrade » | vraie erreur |
| 401, 5xx, réseau, workspace étranger | erreur | **inchangé : vraies erreurs** (jamais transformées en succès ni en données vides) |

### Mise en œuvre
- `GET /api/analytics/basic` (nouveau) : `getVerifiedWorkspaceId` (workspace de la session vérifiée) + 4 `count()` filtrés par ce workspace ; aucune colonne de montant ; non soumis à une feature de plan.
- `dashboard` et `overview` : **toujours** soumis à `hasFeature('advancedAnalytics')` côté serveur avant toute requête ; le refus 403 porte désormais `code: ADVANCED_ANALYTICS_REQUIRED` (message inchangé) pour être identifiable ; seules `error` et `code` sont renvoyées (aucune donnée).
- Client : `classifyMetricsResponse` ne traite comme verrou de plan que le 403 portant ce code ; `classifyBasicResponse`, `classifyOverviewResponse`, `composeAccessView` (logique pure) ; `DashboardLockedCard` ; les 3 pages chargent Basic et Advanced séparément.
- Fichiers modifiés : `src/app/api/analytics/{dashboard,overview}/route.ts`, `src/services/AnalyticsService.ts` (méthode ajoutée, `getDashboardMetrics` intact), `src/types/index.ts`, `src/lib/dashboardMetricsState.ts`, `src/components/dashboard/DashboardStates.tsx`, `src/app/dashboard/page.tsx`, `src/app/dashboard/analytics/page.tsx`, `src/app/workspace/[slug]/page.tsx`, `src/lib/__tests__/dashboardMetricsState.test.ts` (2 tests 403 adaptés au code d'identification + 1 test ajouté). Créés : `src/app/api/analytics/basic/route.ts`, `src/lib/analyticsAccess.ts`, `src/__tests__/security/analytics-basic-advanced.test.ts`.

### Preuves et tests
`analytics-basic-advanced.test.ts` (35 tests, routes réelles, plan/workspace/service simulés) + classifieur + `route-security` existant + r6-routes + subscription-status-access : **210 passent**. Couverts : Starter Basic 200 avec 4 champs seulement et aucun champ financier ; Starter Advanced 403 + code, corps limité à `error`/`code`, **aucune requête analytique exécutée** ; plan avancé 200 identique ; Basic non soumis au plan ; workspace issu de la session (query ignorée) ; workspace étranger → 401, aucune donnée, jamais présenté comme verrou ; e-mail non vérifié → 403 sans code ; 500 → erreur générique sans texte Prisma ; absence de session → 401 ; `days` borné ; composition : Starter → page Basic, plan avancé → page complète (même si Basic tombe), 401/5xx/403 non identifié → erreurs réelles ; les formules de `getDashboardMetrics` sont vérifiées inchangées par le test. `tsc` propre. **Aucune base démarrée.**

### Isolation
Le plan est vérifié côté serveur sur le workspace **vérifié** (pas sur la query) ; le masquage dans l'interface n'est pas le contrôle ; les règles R3-B / R3-C / R6 (`getVerifiedWorkspaceId`, `errorResponse` sans texte de base, bornage de `days`) sont conservées.

### Réserves
- **PASS AVEC RÉSERVES :** pas de test live sur base réelle (interdit ce lot) ; pas de test de rendu React (aucune bibliothèque DOM dans le projet : la logique de vue est testée en pur, le JSX seulement par typecheck et relecture) ; non commité ; Preview/Production non validés.
- Définition Basic/Advanced à confirmer par le produit ; plan **Free** reçoit aussi les compteurs Basic (aucun drapeau ne les distingue).
- Le Dashboard « 14 derniers jours » (sparkline) reste Advanced ; page `/workspace/[slug]` : ancienne interface conservée, traitée minimalement.
- Les calculs et la justesse des chiffres relèvent de **S8** (non commencé) ; réserves antérieures (R3-B, R3-C, R4/R5, R6, C6, C1, S7, 6 échecs CRLF non comparés) inchangées.
- Prochaine étape historique : **S8** (devises, bénéfice des commandes synchronisées, précision des montants, Analytics).

## 13. S8 — monnaies, commandes synchronisées, profit et précision financière (local, non commité)

**Verdict : PASS AVEC RÉSERVES.** Preuves = tests unitaires/mocks + `tsc` + `prisma validate`. Aucune base démarrée, aucun test sur base réelle, Preview/Production non touchés.

### Objectif
Données financières fiables : chaque montant rattaché à sa devise réelle, aucune addition inter-devises, aucun taux inventé, aucun profit « estimé » présenté comme réel, précision exacte.

### Audit — causes confirmées (avant S8)
1. `Order` n'avait **aucune devise** ; les adapters eBay/Etsy jetaient la devise reçue ; l'UI affichait « € » partout.
2. `getDashboardMetrics` / tendances / marketplaces **additionnaient toutes les commandes** sans distinguer les devises, et incluaient les commandes annulées.
3. Adapters : `parseFloat("12abc")` = 12, valeur absente = **0 silencieux** ; Etsy `amount && divisor` traitait 0 comme absent. La sync enregistrait ces faux 0.
4. Commandes synchronisées : `estimatedProfit = 0` (coût, frais, livraison, remboursements non importés) ; ce 0 faisait baisser profit et marge (profit « trompeur »).
5. Performance produit : `purchasePrice × nb de ventes` (ignorait les quantités) et coût absent/0 traité comme 0 → profit flatteur.
6. Float JS : sommes/produits sans arrondi exact. Test existant `19.99 × 3` faux (cet exemple est exact en flottant) — remplacé par `0.07×100` et `1.1×3`.

### Corrections
- `src/lib/financial.ts` : codes ISO 4217 validés, unités mineures par devise, arithmétique en entiers (`sumMoney`, `multiplyMoney`, `roundMoney`), `orderCurrency` (devise enregistrée ; EUR pour commande native sans devise ; **UNKNOWN** pour commande synchronisée sans devise), agrégation par devise, tendance, performance produit (profit `null` si coût inconnu), formatage (devise inconnue = montant sans symbole). **Aucune fonction de conversion, aucun taux.**
- `src/services/marketplace/orderFinancials.ts` : parsing strict eBay/Etsy (montant décimal strict, devise valide, cohérence devise commande/lignes, quantité entière ≥ 1) ; problèmes bloquants : total, prix, quantité, `currency_mismatch` ; devise absente/invalide = non bloquante, stockée NULL.
- `OrdersSyncService` : commande à données invalides **non enregistrée** (comptée `failed`, id seul loggé) ; devise stockée telle que rapportée ; devise enregistrée jamais modifiée ni montants écrasés par une autre devise ; devise NULL complétée à la première devise valide ; arrondi exact dans la devise.
- `AnalyticsService` : `getDashboardMetrics` (chiffres plats = devise principale + `byCurrency`, `mixedCurrencies`, `cancelledOrders`, `ordersWithUnknownProfit`, `marginAvailable`) et `getOverview` (une devise par réponse, `otherCurrencies` en nombres seulement) ; annulées exclues ; profit des commandes synchronisées exclu du profit et de la marge (compté à part) ; marge `null` sans base.
- API/UI : `/api/analytics/overview` renvoie `getOverview` ; commandes : drapeau dérivé `profitKnown` (R3-B.5.6 garde `externalOrderId` hors réponses) ; pages commandes/dashboard/analytics/workspace affichent la devise de la commande, « — » pour un profit inconnu, les autres devises séparément. `salesSummaryTools` (agent IA) ne somme plus qu'une devise.
- Schéma : `Order.currency String?` (additif, nullable) + migration `20261121000000_add_order_currency` (**non appliquée**).

### Fichiers
Modifiés (S8) : `prisma/schema.prisma`, `OrdersSyncService.ts`, `EbayAdapter.ts`, `EtsyAdapter.ts`, `AnalyticsService.ts`, `OrderService.ts`, routes analytics `dashboard`/`overview`, routes commandes, pages dashboard/orders/analytics/workspace, `salesSummaryTools.ts`, `src/types/*`. Créés : `src/lib/financial.ts`, `src/services/marketplace/orderFinancials.ts`, migration ci-dessus. Tests : `src/lib/__tests__/financial.test.ts` (71, 1 corrigé), `src/services/marketplace/__tests__/orderFinancials.test.ts` (30, nouveau), `src/__tests__/marketplace/order-sync-currency.test.ts` (16, nouveau), `src/services/__tests__/analytics-financial.test.ts` (17, nouveau).

### Tests exécutés (mocks, pas de base)
Ciblés : financial + marketplace + analytics-financial + `__tests__/security` + dashboardMetricsState + publicResponseSelects + outils IA : **51 fichiers passent, 5 skipped (tests live nécessitant la base locale), 1145 tests passent, 39 skipped**. `tsc --noEmit` : propre. `prisma validate` : valide (URL factice, aucune connexion). Suite complète non lancée (consigne).

### Isolation
`getVerifiedWorkspaceId` conservé sur orders/analytics ; toutes les requêtes Analytics filtrées par le workspace vérifié (vérifié par test : chaque appel Prisma porte `ws-1`, commandes d'un autre workspace jamais comptées) ; gate `ADVANCED_ANALYTICS_REQUIRED` et Basic inchangés (35 tests `analytics-basic-advanced` passent).

### Précision et devises
Float conservé en stockage (pas de changement de type) ; arrondi aux frontières (import, agrégation) en unités mineures de la devise. Aucune conversion : devises séparées, UNKNOWN isolée.

### Réserves
- Migration **à appliquer (`prisma migrate deploy`) AVANT le déploiement du code** ; non appliquée ; non testée sur base réelle.
- Remboursements, frais marketplace, livraison, taxes : **non importés** par les adapters (aucune donnée dans le modèle/flux) → profit des commandes synchronisées affiché « inconnu », pas calculé. Statut annulé : exclu des totaux ; remboursement partiel/total : non modélisé (aucune valeur inventée).
- Formats `currency` eBay/Etsy lus à côté des montants : **non vérifiés contre les API réelles** (pas de réseau).
- Anciennes lignes synchronisées sans devise = UNKNOWN (pas de backfill, volontairement).
- `NotificationService.notifyNewOrder` écrit « € » en dur (aucun appelant dans `src`, non modifié). Prix produits/annonces et page admin (MRR) restent EUR (convention, hors commandes).
- Float en base : une migration vers Decimal reste une décision produit (non faite).
- Non commité ; Preview/Production non validés ; pas de test live DB.

## 14. B.11.0 — préflight Sandbox eBay, workspace cible, isolation Preview (audit local, aucun OAuth)

**Verdict : BLOCKED — B.11 NOT READY** (préflight utile ; aucune modification d'application, aucun accès Vercel/Preview/Supabase/eBay, aucun OAuth réalisé). Distinction : ce lot vérifie des **préconditions** ; il n'autorise **pas** l'OAuth réel.

### Préconditions
| Condition | Statut | Preuve / absence |
|---|---|---|
| Workspace cible autorisé par son titulaire (`cmvsydyt…`) | **NON AUTORISÉ** (aucune confirmation reçue) | Roadmap l.87 ; rien d'autre localement |
| 2e vendeur Sandbox distinct du 1er | **BLOCKED — SECOND SELLER NOT VERIFIED** | `sellerId`/`accountId` NULL sur les deux lignes (l.84-85) ; l'adapter eBay n'a pas de `getShopId` → aucune identité vendeur n'est stockée par ADKSY ; le parcours 2 a réutilisé une session eBay |
| Config Sandbox / Preview | **NOT VERIFIED** | Aucun `.env` local (seul `.env.example`) ; variables Vercel non consultées (interdit) ; « vérifiée par les utilisateurs » (rapport non revérifié) |
| Callback Preview | **NOT VERIFIED** | URL Preview, `EBAY_REDIRECT_URI`, RuName non lisibles localement |
| Isolation Preview/Production (base, secrets, NextAuth, cookies) | **NOT VERIFIED** | Idem |
| Protections code workspace/OAuth | **OK (code + tests)** | voir ci-dessous |

### Code audité (statique) — OK
- connect/callback/disconnect : session requise, `verifyWorkspaceAccess(session.user.workspaceId)` (propriété + e-mail vérifiés, relus en base), jamais de `workspaceId` issu de la query/corps ; state 64 car. lié au navigateur par cookie httpOnly, comparé en temps constant, consommé ; erreurs de callback génériques (R3-C.9) ; upsert sur `(workspaceId, marketplaceId)` : une connexion d'un autre workspace n'est jamais touchée ; limite de plan avant création ; jetons chiffrés par workspace (AES-256-GCM), jamais loggés.
- Sandbox par défaut : `EBAY_SANDBOX_MODE !== 'false'` (connect, callback, disconnect, adapter, Browse). Hôtes `auth.sandbox.ebay.com` / `api.sandbox.ebay.com`. Tests existants : `MarketplaceConnectionService`, `ebay-oauth`, `oauth-callback-security` → 67 passent, 6 skipped (live DB).
- Scopes par défaut : `sell.inventory`, `sell.fulfillment`, `sell.account` (aucun scope identité) → l'identité du vendeur ne peut pas être lue.

### Constats / risques pour B.11
1. `session.user.workspaceId` = workspace **le plus récemment créé** de l'utilisateur, figé à la connexion (`src/auth.ts`) : il n'y a pas de sélecteur ; « sélectionner le workspace » = se connecter avec le compte ADKSY dont c'est le plus récent workspace.
2. Le state n'est pas lié au workspace : si la session change entre connect et callback (même navigateur), la connexion va au workspace de la session au moment du callback. Atténuation : session privée dédiée, pas de changement de compte.
3. Aucune trace d'environnement (sandbox/production) sur `MarketplaceConnection`, et aucun garde-fou client-id (pas de contrôle « SBX ») : seule la variable `EBAY_SANDBOX_MODE` décide. `ebay.com` en production exigerait `EBAY_SANDBOX_MODE='false'` exact.
4. Pas d'unicité sur `sellerId` entre workspaces : un même vendeur eBay peut être connecté à deux workspaces (c'est le sujet de B.12).
5. `disconnect` efface les jetons localement mais **ne révoque pas** le jeton chez eBay (aucun appel de révocation) : à tester comme « déconnexion locale » seulement.
6. `vercel.json` déclare 2 crons (`sync-orders`, `sync-listings`, protégés par `CRON_SECRET`) ; leur exécution sur Preview n'a pas pu être vérifiée.

### Protocole futur (non exécuté)
**A. Préconditions (toutes requises avant de lancer) :** titulaire du workspace cible confirme par écrit ; 2e vendeur Sandbox confirmé distinct (identifiant vendeur eBay Sandbox masqué fourni par son titulaire, compte opérationnel) ; Preview exact = `preview/ebay-sandbox-isolation` @ `e1754c1` avec `EBAY_SANDBOX_MODE=true`, client-id/secret/RuName Sandbox, `EBAY_REDIRECT_URI` = `<URL Preview>/api/marketplace/callback/ebay` identique au RuName, `NEXTAUTH_URL` = URL Preview, base de test dédiée (hôte ≠ Production), aucun secret Production ; workspace cible sans connexion eBay incompatible ; lecture SQL « avant » (statut des lignes, sans jetons).
**B. Connexion (par le titulaire) :** fenêtre privée dédiée → URL Preview exacte (pas `adksy.org`) → connexion au compte ADKSY autorisé → vérifier que le workspace affiché est le bon (cf. constat 1) → Settings > Integrations > connecter eBay → vérifier que l'URL eBay est `auth.sandbox.ebay.com` → se connecter avec le **2e** compte Sandbox (pas de session eBay réutilisée) → autoriser → retour sur le callback Preview.
**C. Vérifications :** `status=connected` ; ligne unique `(workspaceId cible, ebay)` ; autres workspaces inchangés (`updatedAt`/statut identiques) ; jetons présents mais jamais affichés ; aucune connexion Production ; aucune donnée réelle ; déconnexion puis reconnexion testables (révocation eBay non couverte) ; logs sans jetons/secrets ; identité vendeur : preuve externe (déclaration du titulaire), ADKSY ne la stocke pas.

### Suite
Obtenir : (1) accord du titulaire du workspace, (2) preuve du 2e vendeur distinct, (3) vérification des variables Preview par un lot autorisé à les lire. B.12 (identité vendeur) non commencé ; OAuth non autorisé par ce lot.


## 15. B.11.1 — hardening OAuth Sandbox avant le 2e vendeur (local, non commité)

**Verdict : PASS WITH RESERVES — B.11.1 HARDENING COMPLETE.** Ne signifie PAS que B.11 est prêt ni que l'OAuth est autorisé : **le statut opérationnel B.11 reste BLOCKED** (accord du titulaire du workspace, preuve du 2e vendeur distinct, configuration Preview non vérifiée — §14). Aucun OAuth, aucun appel réseau, aucune base, aucun environnement distant.

### Risques confirmés (lecture du code, puis tests)
1. **State non lié au workspace (confirmé).** Le callback comparait `state` au cookie puis attribuait la connexion au workspace de la session **au moment du callback**. Un changement de workspace/utilisateur entre connect et callback dans le même navigateur re-attribuait la connexion (la session B avec un cookie démarré par A était acceptée avant correctif).
2. **Configuration ambiguë acceptée (confirmé).** `EBAY_SANDBOX_MODE !== 'false'` ; identifiants absents → chaînes vides ; callback absent → repli silencieux sur `localhost` ; `FALSE`, `0`, ` false` = Sandbox sans signal ; `false` sur Preview/dev = Production sans garde.
3. **Révocation (non corrigée, documentée ci-dessous).**

### Correctif 1 — state lié au workspace initiateur (sans migration ni stockage)
- `src/lib/oauthStateBinding.ts` : le cookie `oauth_state_<marketplace>` contient `v1.<state>.<issuedAt>.<mac>` avec `mac = HMAC-SHA256(clé dérivée de TOKEN_ENCRYPTION_KEY, marketplace | state | workspaceId | userId | issuedAt)`, calculé à `connect` à partir du workspace **vérifié** (`verifyWorkspaceAccess`) et de `session.user.id`. Ni workspaceId ni userId dans le cookie, l'URL ou la réponse.
- Callback : state de l'URL = state du cookie (temps constant) ; âge ≤ 10 min (+ 60 s d'écart d'horloge) ; MAC recalculé avec le workspace/utilisateur **actuels** de la session vérifiée. Autre workspace, autre utilisateur, autre marketplace, MAC/state/horodatage altéré, ancien cookie « state nu » → 400 « Invalid OAuth state », aucun échange, aucune écriture. Cookie supprimé (consommé) s'il est de notre format mais expiré ou lié à un autre workspace ; supprimé aussi après tout flux validé (succès, limite de plan, échec d'échange : replay impossible).
- Conservés : session obligatoire, `verifyWorkspaceAccess`, cookie httpOnly / SameSite=Lax / 600 s / `secure` en production, limite de plan avant création, upsert `(workspaceId, marketplace)`, jetons chiffrés, aucun state/code/jeton dans les logs, erreurs génériques. Clé absente → exception (fail closed).
- Alternatives écartées : table de states en base (migration + nettoyage) ; workspace en paramètre d'URL (interdit : la propriété ne doit pas venir de la requête). Effet de bord : un flux démarré avant le déploiement échoue au callback (l'utilisateur relance).

### Correctif 2 — validation Sandbox/Production fail-closed (`src/lib/marketplaceOAuthConfig.ts`, utilisée par connect et callback ; disconnect inchangé : il doit rester possible)
- `EBAY_SANDBOX_MODE` : absent/vide/`true` → Sandbox (défaut conservé) ; exactement `false` → Production ; **toute autre valeur refusée**.
- Production refusée hors runtime de production (`VERCEL_ENV=production`, ou sans `VERCEL_ENV` : `NODE_ENV=production`) : jamais sur Preview ni en dev local.
- Client ID/secret requis, sans espace ; callback requis (plus de repli `localhost`) : RuName (lettres/chiffres/`.`/`_`/`-`) ou URL https `…/api/marketplace/callback/ebay` sans identifiants/query/fragment, host = host de `NEXTAUTH_URL` s'il est défini ; `http://localhost` autorisé seulement hors Vercel.
- Marqueurs de Client ID : `-SBX-` / `-PRD-` est une **convention observée, non garantie** : utilisée **uniquement pour refuser une contradiction** (Sandbox + `-PRD-`, Production + `-SBX-`, ou les deux). Sans marqueur : accepté avec `clientIdEnvironmentVerified=false`.
- Échec : `connect` → 503 `MARKETPLACE_CONFIG_INVALID`, aucun URL OAuth, aucun cookie ; `callback` → redirection générique, état consommé ; log = **code de raison seulement**. Aucun appel à eBay.
- **Vérification manuelle obligatoire avant B.11** (non automatisable) : (a) Client ID/secret de l'environnement Preview = keyset **Sandbox** de l'application eBay (portail développeur) ; (b) RuName de type Sandbox pointant vers le callback du Preview exact ; (c) `EBAY_SANDBOX_MODE=true`, `NEXTAUTH_URL` = URL du Preview ; (d) aucune variable `EBAY_*` de Production dans l'environnement Preview.

### Révocation des jetons — audit (aucune implémentation, aucun appel eBay)
- Aujourd'hui `disconnectMarketplace` met `status='not_connected'` et efface `encryptedOauthToken`, `encryptedRefreshToken`, `tokenExpiresAt` pour `(workspace, marketplace)` ; `sellerId`, `lastSyncAt`, annonces et commandes restent ; route idempotente, aucun jeton loggé. **Le jeton reste valide chez eBay** tant qu'il n'est pas révoqué ou retiré côté eBay. Une reconnexion refait un OAuth complet et remplace la ligne.
- Un futur lot devra : déchiffrer le jeton uniquement dans la déconnexion ; appeler l'endpoint de révocation eBay (existence pour ce flux, hôte Sandbox/Production et authentification **à confirmer dans la documentation officielle**) ; définir l'ordre et le comportement si eBay est injoignable (ne pas bloquer la déconnexion locale, mais le signaler) ; ne jamais logger le jeton ; tester en Sandbox seulement ; probablement mémoriser « révocation distante non confirmée ». Pour B.11 la déconnexion testée sera **locale**.

### Migration proposée (NON créée, NON appliquée)
Tracer l'environnement dans la connexion : `ALTER TABLE "MarketplaceConnection" ADD COLUMN "environment" TEXT;` (nullable, additif, sans backfill ; `sandbox`/`production` écrit au callback depuis `resolveEbayOAuthConfig().environment`). Non faite : déploiement ordonné requis (migration avant code) et sujet proche de B.12. Sans elle, la garantie repose sur le garde-fou de configuration au callback, pas sur une trace persistée.

### Fichiers
Créés : `src/lib/oauthStateBinding.ts`, `src/lib/marketplaceOAuthConfig.ts`, `src/__tests__/marketplace/oauth-state-binding.test.ts`, `src/lib/__tests__/marketplaceOAuthConfig.test.ts`. Modifiés : routes `connect` et `callback` (`src/app/api/marketplace/…/[marketplace]/route.ts`), `src/__tests__/marketplace/oauth-callback-security.test.ts` (4 assertions de câblage mises à jour vers le nouveau mécanisme, non affaiblies), `src/__tests__/isolation/r3c-stripe-cron-oauth.live.test.ts` (cookie lié, variables Sandbox factices, 1 cas de refus ; **non exécuté** : exige la base locale), `.env.example` (commentaire), cette roadmap.

### Tests (mocks, sans réseau ni base)
`oauth-state-binding` 33 (mécanisme réel + vraies routes connect/callback) ; `marketplaceOAuthConfig` 56 ; `oauth-callback-security` 23 ; suite ciblée OAuth + marketplace + sécurité + sourcing eBay + isolation : **20 fichiers passent, 8 skipped (live), 644 tests passent, 143 skipped**. Mutation vérifiée (retirer le workspace du MAC fait échouer 4 tests). `tsc --noEmit` propre. Schéma inchangé.

### Réserves
- Hardening non éprouvé sur Preview/eBay réels ; test live local modifié mais non exécuté.
- Marqueurs `-SBX-`/`-PRD-` : heuristique de contradiction seulement ; RuName non vérifiable ; vérification manuelle obligatoire.
- Environnement non persisté dans la connexion ; révocation distante non implémentée ; identité vendeur et unicité (B.12) non traitées.
- Un flux OAuth en cours au déploiement échoue (à relancer).
- Non commité ; Preview/Production non validés ; B.11 reste **BLOCKED**.

## 16. B.11.1-R — vérification anti-replay du state OAuth (local, non commité)

**Verdict : PASS WITH RESERVES — défaut CONFIRMÉ puis CORRIGÉ localement** (consommation unique côté serveur). **B.11 opérationnel reste BLOCKED** (accord du titulaire du workspace, identité du 2e vendeur, configuration Preview non vérifiée). Aucun OAuth, réseau, base, environnement distant ni migration.

### Audit — réponses (code réellement exécuté, pas les tests)
Avant correctif (B.11.1) :
1. Consommation = **uniquement** un `Set-Cookie` de suppression envoyé au navigateur. 2. **Non** : le serveur ne gardait aucune trace (ni base, ni mémoire). 3. **Oui** : une copie du cookie (autre onglet, requête parallèle, proxy, valeur exfiltrée) restait valide 10 min. 4. **Oui**, tant que la copie existe. 5. **Oui** : 5 rejeux séquentiels = 5 échanges de code ; 10 callbacks parallèles = 10 échanges (mesuré sur la vraie route). 6. **Oui** : autant d'upserts `(workspaceId, marketplace)` que de rejeux, tous pour le workspace initiateur (jamais un autre workspace : le MAC l'interdit). 7. **Oui**, la protection n'existait que dans chaque navigateur. 8. Sans objet (rien n'était mémorisé). 9. **Oui** : changement de session/workspace/utilisateur rejeté (HMAC). 10. Expiré : refusé (10 min, horloge). Rejeté pour mismatch de state/format : le cookie n'est pas consommé (voulu : un lien forgé ne doit pas tuer le flux légitime) ; rejeté pour mauvais workspace : cookie supprimé côté navigateur, mais le propriétaire légitime qui en détient encore une copie peut finir **une seule fois**.
Limite d'impact (à ne pas surestimer) : le `code` d'autorisation eBay est à usage unique côté eBay, donc un rejeu du **même** code échoue chez eBay ; mais le serveur ne le garantissait pas, et un rejeu avec un autre code (state identique) passait.

### Preuve
`src/__tests__/marketplace/oauth-state-replay.test.ts`, exécuté **avant** le correctif sur la vraie route : 8 échecs / 15 (rejeu après succès : 307 au lieu de 400 ; 5 appels → 5 échanges ; 10 en parallèle → 10 échanges ; etc.).

### Correctif (sans migration)
- `src/lib/oauthStateConsumption.ts` : après la vérification du cookie et **avant** config, limite de plan et échange de code, le callback insère une ligne dans le registre d'idempotence existant `WebhookLog` (`@@unique([workspaceId, marketplace, eventId])`) : `marketplace='oauth_state'`, `eventId='<marketplace>:<sha256(state)>'`, workspace vérifié, `status='processed'`, `payload='{}'` (le state n'est jamais stocké). L'unicité de l'index rend l'insertion **atomique, durable, multi-instance et valable après redémarrage** ; l'appelant perdant reçoit P2002 → `replay` → 400 « Invalid OAuth state » + cookie supprimé. Toute autre erreur de base est relancée : **fail closed** (aucun échange, redirection d'erreur générique, aucun détail).
- Précédent identique : déduplication des webhooks Stripe (`marketplace:'stripe'`). Les lecteurs existants filtrent par marketplace précis (fournisseurs de fulfillment) : les lignes `oauth_state` ne les polluent pas ; suppression en cascade avec le workspace.
- Inchangés : HMAC, liaison workspace/utilisateur, comparaison en temps constant, expiration, cookies httpOnly/Lax/secure, erreurs génériques, session, `verifyWorkspaceAccess`, limite de plan, upsert, chiffrement.

### Tests
`oauth-state-replay` **16** (normal ; rejeu après succès ; rejeu après échec d'échange ; 5 répétitions ; 2 et 10 callbacks concurrents → exactement 1 échange ; flux distincts indépendants ; state altéré ; expiré ; changement de workspace/utilisateur ; rejeu après rejet ; aucun workspace étranger touché ; fail-closed sur erreur de base ; pas de state/code/secret dans les lignes, corps ou logs ; ordre du câblage) ; `oauth-state-binding` 33 (registre stubbé) ; `oauth-callback-security` 23 ; config 56 ; + `ebay-oauth`, `services/marketplace`, `__tests__/security`, `__tests__/isolation` : **16 fichiers passent, 8 skipped (live), 448 tests passent, 143 skipped**. `tsc --noEmit` propre.

### Réserves
- Mocks seulement : le registre est simulé par une Map atomique ; l'atomicité réelle repose sur la contrainte unique du schéma (relue dans `schema.prisma`), non exécutée sur une vraie base (le test live local existant n'a pas été relancé).
- Les lignes `oauth_state` ne sont pas purgées : une ligne par tentative (faible volume) ; purge périodique des lignes > 24 h à prévoir (non faite).
- Le state est consommé avant l'échange : un échec d'échange ou une limite de plan obligent à relancer la connexion (comportement déjà vrai côté navigateur).
- Réutilise `WebhookLog` plutôt qu'une table dédiée : choix sans migration ; une table `OAuthStateUse(stateHash unique, expiresAt)` avec purge reste l'alternative propre (migration à autoriser).
- Non commité ; Preview/Production non validés ; B.12 non commencé.

## 17. B.11.1-R.3 — clôture documentaire du hardening anti-replay (documentation seule)

**Nature :** ajout documentaire. Aucun code, test, schéma, migration, base, réseau ni environnement distant touché par ce lot. Il consigne les résultats **vérifiés** de B.11.1-R.1 et B.11.1-R.2 ; rien n'est réécrit dans les sections 1 à 16.

### B.11.1-R.1 — audit final statique (lecture seule) : PASS WITH RESERVES
- Ordre dans la route callback : session et workspace vérifié → HMAC, utilisateur, workspace, expiration, comparaison en temps constant → **consommation durable** → configuration, limite de plan → échange du code. La validation précède la consommation ; la consommation précède tout échange.
- Aucun contournement : `handleOAuthCallback` n'est appelé qu'une fois, depuis cette route, qui n'expose que `GET`.
- Déduplication persistante par l'index unique `WebhookLog(workspaceId, marketplace, eventId)` ; `eventId = '<marketplace>:<sha256(state)>'` ; aucun state brut stocké.
- `P2002` = replay ; toute autre erreur de base est relancée (fail-closed) ; aucun repli en mémoire ; l'échange ne peut pas se poursuivre sur erreur de base.
- Lecteurs de `WebhookLog` examinés (Stripe, fulfillment, `AiUsageService`) : aucun impact ; aucune purge existante ne supprime ces lignes.
- **Aucun défaut confirmé.** Réserves : atomicité réelle non exécutée à ce moment-là (levée par R.2, voir ci-dessous), absence de purge, réutilisation de `WebhookLog`, détection de `P2002` par duck-typing, assertions de test à portée limitée (service mocké, comptage via `handleOAuthCallback`).

### B.11.1-R.2 — preuve PostgreSQL locale : PASS
- **Cible :** PostgreSQL local isolé `127.0.0.1:5433`, base `adksy_r3c_test` ; runner et gardes existants validés (identité réelle de la connexion contrôlée) ; identifiants et URI jamais affichés. Test : `src/__tests__/isolation/oauth-state-atomicity.live.test.ts` (10 tests), exécuté uniquement via `scripts/r3c/run-with-test-db.mjs`, vraie fonction `consumeOAuthState()`, vrai client Prisma, aucune Map.
- **Résultats :** 10 appels simultanés sur un même state → **1 consommation, 9 replays**, 0 autre erreur, 1 ligne ; 30 rounds de 10 appels → **30 consommations, 270 replays**, 0 erreur ; 10 connexions indépendantes (10 backends PostgreSQL distincts) → **1 insertion, 9 doublons `P2002`** ; 12 states indépendants en parallèle → **12 consommations**, sans collision, puis 12 replays ; même valeur de state sous une autre marketplace/un autre workspace = flux indépendant ; workspace inexistant → erreur (fail-closed), jamais prise pour un replay ; aucun state brut stocké ; ligne sentinelle d'un workspace étranger intacte.
- **Index réellement utilisé :** `CREATE UNIQUE INDEX "WebhookLog_workspaceId_marketplace_eventId_key" ON public."WebhookLog" USING btree ("workspaceId", marketplace, "eventId")` (unique et valide).
- **Nettoyage :** suppression par identifiants exacts (lignes, workspaces, utilisateurs de fixture) ; post-contrôle SQL indépendant en lecture seule : 0 reliquat (utilisateurs, workspaces, lignes `oauth_state`, sentinelle) ; cluster arrêté proprement, WSL terminé. Le premier lancement avait échoué sur une assertion du test lui-même (format d'`eventId` d'une ligne synthétique du cas 2c) : assertion corrigée, aucun reliquat.
- **Réserve propre à R.2 :** `WebhookLog` était **vide** avant le test ; la preuve de préservation d'anciennes données est donc limitée.

### Réserve « atomicité PostgreSQL non éprouvée » — état actuel
La section 16 (B.11.1-R) et le rapport R.1 indiquent que l'atomicité réelle n'était pas éprouvée (mocks seulement). **Cette réserve est désormais levée pour le PostgreSQL local isolé**, sur la base de la preuve B.11.1-R.2 ci-dessus. L'historique des sections 15 et 16 est conservé tel quel. **Cette preuve n'est pas une preuve Supabase ni Production** (voir réserves ouvertes).

### Réserves encore ouvertes
1. Aucune preuve sur Supabase / PgBouncer (pooler en mode transaction non testé).
2. Aucun test avec plusieurs instances Next.js réelles (la contrainte vit dans PostgreSQL, mais le scénario multi-instance applicatif n'a pas été exécuté).
3. Aucune politique de purge des lignes `oauth_state` (une ligne par callback ayant passé la vérification).
4. Utilisation temporaire de `WebhookLog` (sans migration) ; alternative propre : table dédiée `OAuthStateUse(stateHash unique, expiresAt)` + purge, migration à autoriser séparément.
5. Migration S8 `20261121000000_add_order_currency` non appliquée à la base locale de test (les tests live qui créent des commandes échoueraient tant qu'elle ne l'est pas ; hors périmètre).
6. Rien n'est commité, poussé ni déployé ; Preview et Production non validés.

### Statut global (au moment de cette clôture)
| Élément | Statut |
|---|---|
| Hardening local B.11.1 (state lié, config fail-closed) | **COMPLETE** (PASS WITH RESERVES, §15) |
| Audit anti-replay R.1 | **COMPLETE** (PASS WITH RESERVES) |
| Preuve PostgreSQL locale R.2 | **COMPLETE** (PASS) |
| Hardening anti-replay | **VALIDÉ en local** (PostgreSQL local isolé uniquement) |
| OAuth Sandbox opérationnel | **NON VALIDÉ** |
| B.11 opérationnel | **BLOCKED** |

**Conditions B.11 toujours bloquantes (non techniques) :** (1) autorisation du titulaire du workspace cible ; (2) preuve d'un deuxième vendeur Sandbox distinct du premier ; (3) configuration Preview vérifiée (Sandbox, RuName, callback, `NEXTAUTH_URL`, base dédiée, absence de secrets Production).

### Étape suivante recommandée
Aucune action technique requise pour B.11. Décisions à prendre : lever les trois conditions ci-dessus ; décider de la purge des lignes `oauth_state` (ou de la table dédiée) ; B.12 (identité vendeur / anti-doublon) reste non commencé et distinct. Ce lot n'autorise ni OAuth, ni B.12, ni audit Production.

## 18. Réconciliation de la roadmap et des décisions historiques (2026-11-23, documentation seule)

_Aucun code, test, schéma, base, réseau, commit ou branche. Rectifie le §0 (audit du même jour) ; les sections 1 à 17 ne sont pas modifiées._

### Décisions historiques retrouvées
| Élément | Source | Nature de la preuve |
|---|---|---|
| Ordre officiel après S8 : B.11 → B.12 → audit final Production → OAuth Production (autorisation distincte) → première publication réelle (autorisation distincte) | §3 lignes 15 à 19 ; §14 à §17 ; consignes du propriétaire | roadmap + déclaré |
| R3-C.0.1 traité et validé avant les tests PostgreSQL | déclaré par le propriétaire ; **aucun rapport, aucun commit ni aucune ligne de roadmap ne le nomme** (aucun commit : tout est local) | **déclaré** ; vérifiable : `images/reorder/route.ts` et son test |
| R3-C.0.2 (images sans `workspaceId`) : défaut adjacent trouvé pendant R3-C, **différé** | §1 réserve 13 : « Frontend fix lot (to schedule after the ordered lots) » ; §8.5 | roadmap |

### R3-C.0.1 — verdict exact
- **Périmètre historique vérifiable :** `PUT /api/products/[id]/images/reorder`. Garde présente : JSON invalide → 400 « Request body must be valid JSON », racine non objet (`null`, tableau, chaîne, nombre, booléen) → 400 « must be a JSON object ». Le test `images/reorder/__tests__/route.test.ts` (describe « malformed or unexpected JSON bodies return a clean 400 ») couvre 11 formes, vérifie qu'aucun service n'est appelé, qu'aucune écriture n'a lieu et qu'aucun terme technique ne fuit. **Aucune régression trouvée par lecture** (tests non rejoués dans ce lot).
- **Même famille, autres routes :** R6 a déjà couvert `PUT /api/workspaces/[id]` et `POST /api/onboarding` (`r6-routes.test.ts` : body non objet, tableau, `null`, JSON invalide → 400) ; les routes `ai/*`, `stripe/checkout`, `notifications`, `marketplace/connect-manual` lisent le corps avec `.catch(() => null)`.
- **Résiduel (nature exacte, par lecture) :** 12 handlers appellent `await request.json()` sans capture locale : `auth/signup`, `auth/forgot-password`, `auth/reset-password`, `email/verify`, `fulfillment/send`, `fulfillment/simulate`, `listings` (POST), `listings/[id]` (PUT), `orders` (POST), `products` (POST), `products/[id]` (PUT), `products/[id]/images/[imageId]` (PUT). **JSON invalide → 500** : message brut du parseur renvoyé par les 8 routes qui passent par `errorResponse`, message générique pour les 3 routes d'authentification/e-mail. **Corps `null`** : 400 pour les routes à schéma zod (signup, forgot/reset-password, listings, orders, products) ; 500 par `TypeError` pour les routes à déstructuration (`email/verify`, `fulfillment/send`, `fulfillment/simulate`, `images/[imageId]`) ; `listings/[id]` et `products/[id]` PUT : non déterminé par lecture.
- **Qualification :** ni une régression, ni un défaut différent. **Couverture historique limitée à son périmètre initial** (l'audit de routes R6 n'a pas balayé ce défaut sur toutes les routes), **plus une erreur d'étiquetage de l'audit du 2026-11-23** : il présentait R3-C.0.1 comme « OUVERT » et le classait **P1** ; la bonne lecture est « VALIDÉ dans son périmètre » + **nouvelle réserve P2** (robustesse, pas d'accès ni de fuite de données ; fuite limitée au texte du parseur sur 8 routes authentifiées).
- **Statut :** hors périmètre de R3-C.0.1 ; correction **non autorisée**, à traiter seulement par un lot distinct (« JSON body hardening » éventuel).

### R3-C.0.2 — statut et périmètre non autorisé
- **Historique :** réserve R3-C n°13 (« adjacent defect », lot front à planifier après les lots ordonnés). Jamais autorisé, jamais corrigé.
- **Défaut actuel (par lecture) :** `dashboard/products/[id]/images/page.tsx` appelle suppression, réordonnancement et « image principale » sans `?workspaceId=` ; `getVerifiedWorkspaceId` l'exige (`security.ts:40-48`) → 400 « Workspace ID required ». Seuls la liste et l'envoi d'image transmettent `workspaceId`.
- **Impact réel :** fonction du tableau de bord (suppression/réordonnancement/image principale) inutilisable. **Aucune fuite, aucun accès inter-workspace** (échec fermé).
- **Préexistant :** à `a141e95` (état Production rapporté), la page ne contient que 2 occurrences de `workspaceId=` et `security.ts` exige déjà le paramètre depuis le commit initial. Ce n'est pas introduit par les lots récents.
- **Bloque ?** LIV-1 non ; Preview non ; B.11 non (OAuth ne passe pas par cette page) ; audit Production non. À corriger avant activation Production (P1 fonctionnel) ; **hors périmètre tant qu'aucune décision distincte.**

### LIV-1 — blocages réels
- **Aucun blocage technique démontré** lié à R3-C.0.1 résiduel ou à R3-C.0.2 : ce sont des défauts préexistants, hors périmètre, sans lien avec la création locale de branche et de commits.
- Distinctions : *défauts à corriger* = R3-C.0.2, JSON hardening (P2) ; *réserves* = celles du §0 ; *blocage de livraison (LIV-1)* = aucun ; *blocage Preview* = migration S8 à appliquer à la base de test avant déploiement, `next build` sous Node 22.x non prouvé, variables Preview non vérifiées ; *blocage B.11* = les 3 conditions du §14 ; *blocage Production* = B.11, B.12, `npm audit`, Preview du code actuel.
- Préparations utiles à LIV-1 (pas des blocages) : rejeu des suites avant commit (la migration S8 doit d'abord être appliquée à la base **locale** de test, runner gardé), nouveau scan de secrets, fins de ligne (autocrlf).

### Ordre officiel (confirmé, inchangé)
S8 (fait, PASS AVEC RÉSERVES) → **B.11** (précédé de la livraison d'un Preview contenant les correctifs : LIV-1 puis Preview, étape préparatoire de B.11, pas un lot réordonné) → **B.12** → **audit final Production** → **OAuth eBay Production** (autorisation distincte) → **première publication réelle** (autorisation distincte).

## 19. LIV-1 — livraison Git locale contrôlée (2026-11-23)

_Local uniquement : aucun push, déploiement, accès distant, OAuth, migration hors base de test locale. Les sections 0 à 18 ne sont pas modifiées (le §0 reste l'état de l'audit du jour ; ce §19 fait foi pour la livraison)._

### Préflight (conforme)
Branche de départ `security/r3b-public-selects`, HEAD `e1754c1edcab…`, 103 entrées Git (68 modifiés + 56 non suivis = 124 fichiers), empreinte du statut `8d63c6cc…` identique à l'audit ; aucune opération Git en cours, 0 stash, branche cible inexistante, garde de base active (127.0.0.1:5433, `adksy_r3c_test`), migration S8 seule en attente.

### Migration S8 — base LOCALE de test uniquement
`20261121000000_add_order_currency` appliquée via le runner gardé (`prisma migrate deploy`) : « Database schema is up to date ». **Non appliquée à Supabase, Preview ni Production.**

### Commits locaux — branche `preview/b11-sandbox` (depuis `e1754c1`)
| # | SHA | Contenu | Fichiers |
|---|---|---|---|
| 1 | `312834e` | Infra de test gardée, seeds sûrs, Node 22 (R3-C infra, R4/R5, S7) | 40 |
| 2 | `d335eeb` | Sécurité : réponses sans identifiants, isolation, garde SSRF (R3-B, correctifs R3-C, R6, C1) | 41 |
| 3 | `156a67d` | Finance S8 + migration + schéma (C6) + Analytics basic/advanced | 31 |
| 4 | `668f9aa` | OAuth B.11.1 / B.11.1-R (state lié, usage unique, config fail-closed) | 11 |
| 5 | (ce fichier) | Roadmap | 1 |

Fichiers partagés : `schema.prisma` (commentaires C6 + `Order.currency`) est entièrement dans le commit 3 avec la migration ; `c1-stock-decision.test.ts` (lit le schéma) et `r6-routes.test.ts` (importe `analyticsRange`) sont dans le commit 3 pour que chaque dépendance précède son test. **Limite connue :** les commits intermédiaires 1 et 2 n'ont pas été testés isolément (checkout séparé non réalisé) ; seule la validation de l'arbre final est établie.

### Résultats des tests (arbre complet, runner gardé)
- `tsc --noEmit` : propre (avant et après les commits).
- Tests hors base : 3668 passent, 6 échecs **préexistants** (tests de code source cherchant des `\n` sur une copie de travail CRLF : `middleware-cron` ×3, `middleware-password-reset` ×2, `ai/agent/profile` ×1 ; fichiers non modifiés ou index en LF).
- Suites live, une par une : atomicité OAuth 10, image 16, plans/AI 13, routes R6 5, lecture 29, relations 13, seed 10, Stripe/cron/OAuth 28, écriture 23, Etsy sync 4, connexion 5, harness 7, AI gating 3 = **166 passent**.
- **Trois anciens tests live non couverts par R3-C échouent sur la base locale vide** (8 échecs : `listing-duplicate-prevention-live` ×2, `ebay-stock-sync` ×1, `order-fulfillment-data-live` ×5) : fichiers non modifiés ; « Listing/Order limit reached » (aucun plan en base, limite 0) et violation de l'index unique partiel Listing (test incompatible avec l'index). Non attribués aux lots ; **réserve P2 de test** à traiter séparément (base seedée ou test à adapter).
- Incident de procédure : un premier lancement global **en parallèle** de tous les fichiers (live inclus) a laissé des lignes de fixtures (6 workspaces, 6 utilisateurs, 4 plans/abonnements, marketplaces) dans la base de test locale, qui ont fait échouer d'autres suites ; supprimées par motif exact et date de création (toutes de la session), base revenue à 0 ligne ; les suites ont ensuite été rejouées une par une. **À retenir : ne jamais lancer les fichiers live en parallèle.**

### Préservation
Empreintes de contenu des 124 fichiers relevées avant les commits ; après les 4 commits, le répertoire de travail est identique à l'avant (aucun écart), seul `docs/ROADMAP-STATUS.md` restait non suivi. Scan de secrets : uniquement placeholders et fixtures ; le mot de passe réel de la base locale est absent des 124 fichiers.

### Statut
LIV-1 : livraison **locale** faite. **Toujours vrai :** rien n'est poussé ni déployé ; Preview non validé ; B.11 non commencé et toujours bloqué par ses 3 conditions (§14) ; R3-C.0.1 résiduel (P2) et R3-C.0.2 (P1 fonctionnel) intacts, hors périmètre ; migration S8 à appliquer sur la base Preview AVANT le code. Prochaine étape (autorisation distincte) : push de `preview/b11-sandbox` et déploiement Preview.
