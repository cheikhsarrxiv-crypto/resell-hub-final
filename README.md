# ResellHub MVP - Seller Management SaaS

Une plateforme complète pour gérer les ventes sur plusieurs marketplaces avec support du fulfillment automatique.

## 🎯 État du MVP

### ✅ Fonctionnalités Réelles (Implémentées)
- **Authentification**: Signup/Login avec NextAuth.js et base de données PostgreSQL
- **Gestion des Produits**: CRUD complet avec photos, SKU, prix, stock
- **Gestion du Stock**: Synchronisation de l'inventaire avec réservation automatique
- **Commandes**: Création, statuts, historique complet
- **Dashboard Analytics**: Métriques de revenue, profit, margin en temps réel
- **Fulfillment Automatique**: Architecture complète avec simulation mock
- **Pricing Flexible**: 5 plans différents avec limites configurables en base de données

### ⚠️ Statut des Intégrations (MOCK pour MVP)
- **Vinted**: MOCK ✓
- **eBay**: MOCK ✓
- **Depop**: MOCK ✓
- **Etsy**: MOCK ✓
- **Fulfillment Partner**: MOCK ✓ (ShipMock France)

Toutes les intégrations ont une architecture propre prête à connecter les vraies APIs.

## 🚀 Installation

### Prérequis
- Node.js 18+
- PostgreSQL 13+
- npm ou yarn

### 1. Cloner et installer les dépendances

```bash
cd reselling-saas
npm install
```

### 2. Configurer les variables d'environnement

```bash
cp .env.example .env.local
```

Éditer `.env.local`:
```env
# Base de données PostgreSQL
DATABASE_URL="postgresql://user:password@localhost:5432/reselling_saas"

# NextAuth
NEXTAUTH_SECRET="your-secret-key-here"
NEXTAUTH_URL="http://localhost:3000"

# Application
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

### 3. Créer la base de données PostgreSQL

```bash
# Créer la base de données
createdb reselling_saas

# Si vous utilisez psql
psql -U postgres
CREATE DATABASE reselling_saas;
\q
```

### 4. Lancer les migrations Prisma

```bash
# Créer les tables
npm run db:push

# Charger les données de démonstration
npm run db:seed
```

### 5. Lancer l'application

```bash
npm run dev
```

L'application est maintenant disponible à `http://localhost:3000`

## 🧪 Tester le MVP

### Parcours Utilisateur Complet (Créé dans la DB de démonstration)

**Accès à la démo:**
- Email: `demo@reselling.local`
- Password: `demo1234`

**Scénario Complet à Tester:**

1. **Login** → Page `/login`
   - Utilisez les credentials de démo

2. **Dashboard** → `/workspace/demo-shop`
   - Voir les métriques: Revenue, Profit, Orders
   - Voir le stock, les listings actifs
   - Voir le statut du fulfillment

3. **Produits** → `/workspace/demo-shop/products`
   - 5 produits réalistes pré-créés
   - Voir SKU, prix, stock, profit estimé
   - (Feature: Ajouter un nouveau produit)

4. **Commandes** → `/workspace/demo-shop/orders`
   - **Ordre 1**: Pending (Attente)
   - **Ordre 2**: Processing with Fulfillment (En préparation au fulfillment)
   - **Ordre 3**: Shipped with Tracking (Expédié avec tracking)

5. **Détail d'une Commande** → `/workspace/demo-shop/orders/[orderId]`
   - Voir les informations du client
   - Voir les articles commandés
   - Voir le profit estimé

6. **Test du Fulfillment Automatique**:
   - Cliquer sur l'ordre en attente
   - Cliquer "Send to Fulfillment"
   - Voir les statuts:
     - "Accept" → Fulfillment accepted
     - "Processing" → Order in preparation
     - "Ship" → Génère tracking number automatiquement
     - "Deliver" → Marque comme livré + events
   - Voir le tracking number et les events en temps réel

7. **Analytics** → `/workspace/demo-shop/analytics`
   - Voir les metrics par marketplace
   - Voir les revenus par produit
   - Voir la performance fulfillment

8. **Subscription** → `/workspace/demo-shop/subscription`
   - Plan actuel: Pro (29,99 €/mois)
   - Voir les limites (produits, listings, commandes)
   - Voir l'utilisation actuelle

## 📊 Données de Démonstration

### Produits
```
1. Nike Air Max 95 OG Neon (40€ → 120€, profit: 60€)
2. Adidas Campus 00s Cream (35€ → 95€, profit: 52€)
3. Levi's 501 Original Blue (35€ → 65€, profit: 22€)
4. Carhartt WIP Detroit Jacket (50€ → 140€, profit: 76€)
5. New Balance 2002R Protection (75€ → 180€, profit: 74€)
```

### Commandes
```
1. Alice Martin → Nike Air Max (120€) → Pending
2. Bob Dupont → Adidas Campus (95€) → Processing + Fulfillment
3. Caroline Petit → Carhartt Jacket (140€) → Shipped + Tracking
```

### Partenaires Fulfillment
```
ShipMock France
- Coût: 5€ par commande
- Délai traitement: 24h
- Délai livraison: 2-4 jours
```

## 🏗️ Architecture

```
reselling-saas/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── (dashboard)/        # Pages du dashboard
│   │   ├── api/                # API routes
│   │   └── auth/               # Pages d'authentification
│   ├── components/             # Composants React réutilisables
│   │   ├── Layout/
│   │   └── UI/
│   ├── services/               # Logique métier
│   │   ├── ProductService.ts
│   │   ├── OrderService.ts
│   │   ├── FulfillmentService.ts
│   │   ├── AnalyticsService.ts
│   │   ├── ListingService.ts
│   │   └── marketplace/        # Adapters marketplace
│   ├── lib/                    # Utilitaires
│   │   ├── validations.ts      # Schémas Zod
│   │   └── utils.ts            # Helpers
│   └── types/                  # Types TypeScript
├── prisma/
│   ├── schema.prisma           # Schéma base de données
│   └── seed.js                 # Données de démo
└── .env.example                # Variables d'environnement
```

## 📝 Fichiers Principaux Créés

### Configuration
- `package.json` - Dépendances
- `tsconfig.json` - Configuration TypeScript
- `next.config.js` - Configuration Next.js
- `tailwind.config.js` - Configuration Tailwind
- `postcss.config.js` - Configuration PostCSS

### Base de Données
- `prisma/schema.prisma` - Schéma complet (25 modèles)
- `prisma/seed.js` - 5 produits + 3 commandes + fulfillment mock

### API Routes (15 endpoints)
- `api/auth/signup` - Inscription
- `api/products` - CRUD produits
- `api/orders` - CRUD commandes
- `api/orders/[orderId]` - Détail commande
- `api/fulfillment/send` - Envoyer au fulfillment
- `api/fulfillment/simulate` - Simuler statuts
- `api/fulfillment/partners` - Lister les partenaires
- `api/analytics/dashboard` - Métriques dashboard
- `api/auth/signin` - Login (NextAuth)

### Services (3000+ lignes)
- `ProductService.ts` - Gestion produits + inventory
- `OrderService.ts` - Gestion commandes
- `FulfillmentService.ts` - Fulfillment complet avec simulation
- `AnalyticsService.ts` - Calcul des metrics
- `ListingService.ts` - Cross-listing avec adapters

### Marketplace Adapters
- `MarketplaceAdapter.ts` - Classe abstraite
- `MockAdapters.ts` - 4 adapters mock (Vinted, eBay, Depop, Etsy)

### Composants UI (500+ lignes)
- `DashboardLayout.tsx` - Layout principal avec sidebar
- `Card.tsx` - Composants Card réutilisables
- `Button.tsx` - Boutons, Badge, Tables

### Pages (1000+ lignes)
- `login/page.tsx` - Page de login
- `(dashboard)/page.tsx` - Dashboard principal
- `products/page.tsx` - Liste des produits
- `orders/page.tsx` - Liste des commandes
- `orders/[orderId]/page.tsx` - Détail + fulfillment

## 🔄 Flux Fulfillment Complet

```
1. Order Created (DB)
   ↓
2. Send to Fulfillment
   POST /api/fulfillment/send
   ↓
3. FulfillmentOrder Created (pending)
   ↓
4. Simulate Accept
   POST /api/fulfillment/simulate?action=accept
   Status: pending → accepted
   ↓
5. Simulate Processing
   POST /api/fulfillment/simulate?action=processing
   Status: accepted → processing
   ↓
6. Simulate Ship
   POST /api/fulfillment/simulate?action=ship
   - Crée Shipment avec tracking
   - Ajoute 2 TrackingEvents
   - Status: processing → shipped
   - Order status: shipping
   ↓
7. Simulate Deliver
   POST /api/fulfillment/simulate?action=deliver
   - Ajoute event "delivered"
   - Status: shipped → delivered
   - Order status: delivered
```

## 💾 Base de Données

### 25 Modèles Prisma
- **Utilisateurs**: User, Workspace, Plan, Subscription
- **Produits**: Product, ProductImage, Inventory
- **Listings**: Listing, MarketplaceConnection, Marketplace
- **Commandes**: Order, OrderItem, Customer
- **Fulfillment**: FulfillmentOrder, FulfillmentPartner, Shipment, TrackingEvent
- **Système**: Webhook, Notification, ApiKey

### Relations Complètes
- Multi-tenant avec Workspace
- Cascade delete pour la sécurité
- Indexes sur les recherches fréquentes
- Timestamps (createdAt, updatedAt, deletedAt)

## 🔐 Authentification & Autorisation

- NextAuth.js v5 avec credentials
- JWT sessions
- Base de données Prisma
- Hashing bcryptjs pour les passwords
- Protection des API routes

## 🎨 Design & UX

- **Tailwind CSS** pour le styling
- **Sidebar Navigation** pour la navigation principale
- **Cards & Sections** pour l'organisation
- **Responsive Design** (mobile + desktop)
- **Status Badges** avec couleurs cohérentes
- **Loading States** et error handling

## 🧠 Logique Métier

### Pricing Flexible
```javascript
Plans configurables:
- FREE: 0€ (10 produits, 20 listings, 50 commandes)
- STARTER: 14,99€/mois (100 produits, 300 listings)
- PRO: 29,99€/mois (500 produits, fulfillment)
- BUSINESS: 59,99€/mois (5000 produits, multi-user)
- ENTERPRISE: Custom
```

### Inventory Management
```javascript
- Création automatique lors du produit
- Réservation sur création de commande
- Libération en cas d'annulation
- Synchronisation multi-marketplace
- Gestion des ruptures de stock
```

### Profit Calculation
```javascript
Profit = Selling Price - Purchase Price - Fulfillment Cost - Fees
Margin = (Profit / Selling Price) * 100%

Fulfillment Profit = Revenue - Fulfillment Cost
```

## 📈 Prochaines Étapes (Production)

### APIs Réelles
1. **Vinted** - Intégration API officielle
2. **eBay** - Trading API
3. **Depop** - API partenaire
4. **Etsy** - Shop API
5. **Fulfillment** - Intégration 3PL réelle

### Fonctionnalités Supplémentaires
- [ ] Image upload (S3/Supabase)
- [ ] Webhooks fulfillment réels
- [ ] Stripe payments integration
- [ ] Email notifications
- [ ] Bulk operations
- [ ] API keys gestion
- [ ] Advanced analytics (graphs)
- [ ] AI listing generator
- [ ] Multi-language support
- [ ] Mobile app

### Infrastructure
- [ ] Database backups
- [ ] CDN pour images
- [ ] Load balancing
- [ ] Monitoring & logging
- [ ] Rate limiting
- [ ] CORS configuration

## 🐛 Limitation Connues

1. **Mock Data Only**: Pas de vraies APIs marketplaces
2. **No Image Storage**: Images statiques en démo
3. **Demo Data**: Database seed avec données pré-créées
4. **Webhook Simulation**: Changements de statut manuels via UI
5. **Single User**: Multi-tenant implémenté mais pas multi-user par workspace

## 📞 Support

Pour les questions sur l'architecture ou le code:
- Architecture: API-first, microservices ready
- Database: Prisma ORM, PostgreSQL
- Frontend: React/Next.js avec TypeScript
- Validation: Zod schemas
- Error Handling: Try-catch avec messages clairs

## 📄 License

MVP - Reselling SaaS Platform
