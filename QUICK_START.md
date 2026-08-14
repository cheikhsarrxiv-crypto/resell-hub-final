# 🚀 Quick Start - Lancer le MVP en 5 Minutes

## Prérequis
- Node.js 18+
- PostgreSQL 13+ installé et en cours d'exécution
- npm ou yarn

## ⚡ Démarrage Rapide

### 1️⃣ Cloner et installer (1 min)
```bash
cd reselling-saas
npm install
```

### 2️⃣ Configurer la base de données (1 min)
```bash
# Créer la base de données
createdb reselling_saas

# Ou avec psql:
psql -U postgres -c "CREATE DATABASE reselling_saas;"
```

### 3️⃣ Configurer les variables d'environnement (30 sec)
```bash
# Copier l'exemple
cp .env.example .env.local

# Ajouter votre DATABASE_URL si différente
# DATABASE_URL="postgresql://user:password@localhost:5432/reselling_saas"
```

### 4️⃣ Initialiser la base de données (2 min)
```bash
# Créer les tables
npm run db:push

# Charger les données de démo
npm run db:seed
```

### 5️⃣ Lancer l'application (30 sec)
```bash
npm run dev
```

L'application est maintenant disponible à **http://localhost:3000**

## 🎯 Accéder au Dashboard

1. Allez à `http://localhost:3000/login`
2. Utilisez les credentials de démo:
   - **Email**: `demo@reselling.local`
   - **Password**: `demo1234`

3. Cliquez "Sign In"

## ✅ Tester le Flux Complet

### Dashboard Principal
- [ ] Voir les 4 métriques principales (Revenue, Orders, Profit, Margin)
- [ ] Voir les produits et inventaire
- [ ] Voir les commandes en attente et en fulfillment

### Produits
- [ ] Voir les 5 produits pré-créés
- [ ] Voir les SKU, marques, prix, profits

### Commandes
```
Status: Pending
↓ Voir l'ordre 1 en attente

Status: Processing + Fulfillment
↓ Voir l'ordre 2 en préparation au fulfillment

Status: Shipped + Tracking
↓ Voir l'ordre 3 expédié avec tracking
```

### Test du Fulfillment
1. Cliquez sur l'ordre #2 (Processing)
2. Voir la section "Fulfillment Order"
3. Cliquez "Simulate Status":
   - ✅ Accept → Status changes
   - ✅ Processing → Status changes
   - ✅ Ship → Génère tracking number
   - ✅ Deliver → Marque comme livré + events

### Analytics
- [ ] Voir les revenus par marketplace
- [ ] Voir le résumé financier
- [ ] Voir le profit brut et net

### Subscription
- [ ] Voir le plan Pro actuel
- [ ] Voir les limites et l'utilisation

## 🧠 Points Clés à Comprendre

### Architecture
- **Frontend**: React + Next.js 15
- **Backend**: API Routes Next.js
- **Database**: PostgreSQL + Prisma ORM
- **Auth**: NextAuth.js avec credentials

### Services Métier
```
ProductService    → Gestion produits + inventory
OrderService      → Gestion commandes
FulfillmentService → Fulfillment + simulation
AnalyticsService  → Calcul des metrics
ListingService    → Cross-listing + adapters
```

### Marketplace Adapters
```
MarketplaceAdapter (abstract)
├── VintedAdapter (MOCK)
├── EbayAdapter (MOCK)
├── DepopAdapter (MOCK)
└── EtsyAdapter (MOCK)
```

## 📁 Structure des Fichiers

```
src/
├── app/
│   ├── (dashboard)/     # Pages du dashboard
│   ├── api/            # API routes
│   ├── login/          # Page login
│   └── layout.tsx      # Layout root
├── components/
│   ├── Layout/         # DashboardLayout
│   └── UI/            # Card, Button, Badge, etc.
├── services/           # Services métier
│   ├── ProductService.ts
│   ├── OrderService.ts
│   ├── FulfillmentService.ts
│   ├── AnalyticsService.ts
│   ├── ListingService.ts
│   └── marketplace/    # Adapters
├── lib/
│   ├── validations.ts  # Schémas Zod
│   └── utils.ts        # Helpers
└── types/              # TypeScript types

prisma/
├── schema.prisma       # 25 modèles
└── seed.js            # Données de démo
```

## 🔧 Commandes Utiles

```bash
# Développement
npm run dev                 # Lancer le dev server
npm run build              # Build pour production
npm run lint               # Lancer ESLint

# Base de données
npm run db:push            # Créer/mettre à jour les tables
npm run db:seed            # Charger les données de démo
npm run db:reset           # Réinitialiser complètement
npm run db:studio          # Ouvrir Prisma Studio (GUI)
```

## 🧪 Tester les APIs

### Avec curl
```bash
# Get orders
curl -X GET "http://localhost:3000/api/orders?workspaceId=demo-workspace-id"

# Create order
curl -X POST "http://localhost:3000/api/orders?workspaceId=demo-workspace-id" \
  -H "Content-Type: application/json" \
  -d '{
    "listingId": "...",
    "customerName": "Test",
    "customerEmail": "test@example.com",
    "totalPrice": 100,
    "marketplaceFees": 15,
    "estimatedProfit": 70,
    "fulfillmentType": "automatic",
    "shippingAddress": "123 Main St",
    "shippingCity": "Paris",
    "shippingPostalCode": "75001",
    "shippingCountry": "FR"
  }'
```

## ⚠️ Dépannage

### "createdb: command not found"
→ Installez PostgreSQL: `brew install postgresql` (Mac) ou `apt-get install postgresql` (Linux)

### "connect ECONNREFUSED"
→ PostgreSQL n'est pas en cours d'exécution
```bash
# Mac
brew services start postgresql

# Linux
sudo systemctl start postgresql

# Ou
sudo service postgresql start
```

### "ENOENT: no such file or directory, open '.env.local'"
→ Créez le fichier: `cp .env.example .env.local`

### "Error: P1002: the database server at `localhost:5432` couldn't be reached"
→ Vérifiez que PostgreSQL est accessible et que la DATABASE_URL est correcte

### "error: password authentication failed"
→ Mettez à jour DATABASE_URL avec les bonnes credentials

## 📊 Données Pré-créées

### 5 Produits
```
Nike Air Max 95      → 120€ (profit: 65€)
Adidas Campus 00s    → 95€ (profit: 52€)
Levi's 501           → 65€ (profit: 22€)
Carhartt Jacket      → 140€ (profit: 76€)
New Balance 2002R    → 180€ (profit: 74€)
```

### 3 Commandes
```
Alice Martin  (Nike)      → Pending
Bob Dupont    (Adidas)    → Processing + Fulfillment
Caroline P.   (Carhartt)  → Shipped + Tracking
```

### 3 Marketplaces Connectées
```
Vinted  (MOCK)
eBay    (MOCK)
Depop   (MOCK)
```

### 1 Partenaire Fulfillment
```
ShipMock France
- Cost: 5€ per order
- Processing: 24h
- Delivery: 2-4 days
```

## 🎓 Prochaines Étapes

1. **Lire le README.md** pour comprendre l'architecture complète
2. **Explorer le code** pour comprendre comment ça fonctionne
3. **Consulter API_TESTING.md** pour tester les endpoints
4. **Lire PRODUCTION_ROADMAP.md** pour savoir comment passer en prod

## 💬 Questions Fréquentes

**Q: Où sont stockées les images de produits?**
A: Pour le MVP, les images sont statiques. En production, utilisez S3/Supabase.

**Q: Comment connecter les vraies APIs?**
A: Voir PRODUCTION_ROADMAP.md pour les détails complets.

**Q: Les données de démo persistent après redémarrage?**
A: Oui, elles sont dans PostgreSQL. Pour réinitialiser: `npm run db:reset`

**Q: Comment activer/changer les plans?**
A: La DB a 5 plans. Modifiez la subscription dans Prisma Studio.

**Q: Est-ce prêt pour la production?**
A: Non, c'est un MVP. Voir PRODUCTION_ROADMAP.md pour les étapes manquantes.

## 🚨 Support

Si vous rencontrez des problèmes:

1. **Vérifiez les logs du serveur**: Console du terminal
2. **Vérifiez Prisma Studio**: `npm run db:studio`
3. **Vérifiez la base de données**: 
   ```bash
   psql reselling_saas
   \dt  # Voir toutes les tables
   ```
4. **Consultez le README.md** pour plus de détails

---

**Bienvenue dans ResellHub! 🎉**

Vous avez maintenant une application SaaS complètement fonctionnelle pour gérer les ventes sur plusieurs marketplaces avec fulfillment automatique.
