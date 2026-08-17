# Production Roadmap - De MVP à Production

Ce guide explique comment passer de l'MVP (avec mocks) à la production avec les vraies APIs.

## 🎯 Étapes Avant Production

### 1. Préparer les Credentials

Pour chaque marketplace, vous aurez besoin de:

#### Vinted
- **API Status**: Très limité (Vinted n'a pas d'API publique complète)
- **Alternative**: Web scraping ou partenariats directs
- **Pour MVP**: Mock restera pour Vinted

#### eBay
- **Credentials Nécessaires**:
  - Consumer Key
  - Consumer Secret
  - Redirect URL
- **Documentation**: https://developer.ebay.com
- **Support**: eBay Partner Program

#### Depop
- **Credentials Nécessaires**:
  - API Key
  - User Token
- **Documentation**: Demander accès partenaire
- **Support**: Depop Business

#### Etsy
- **Credentials Nécessaires**:
  - API Key
  - OAuth Token
- **Documentation**: https://www.etsy.com/developers
- **Support**: Etsy Developer Community

#### Fulfillment Partner
- **Choisir un fournisseur**:
  - Colis Privé
  - Sendle
  - Amazon FBA
  - Ou votre propre warehouse
- **API Documentation**: Dépend du partenaire
- **Contract Required**: Oui

### 2. Adapter les Services Marketplace

#### Structure Actuelle
```typescript
// src/services/marketplace/MockAdapters.ts
export class VintedAdapter extends MarketplaceAdapter {
  // Mock implementation
}
```

#### Pour la Production
```typescript
// src/services/marketplace/RealAdapters.ts
export class VintedAdapter extends MarketplaceAdapter {
  async createListing(data: CreateListingData): Promise<ListingResponse> {
    // Appel API Vinted réel
    const response = await fetch(`${this.apiUrl}/listings`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: data.title,
        description: data.description,
        price: data.price,
        // ... autres champs
      }),
    });
    
    const result = await response.json();
    return {
      externalId: result.id,
      url: result.url,
      status: 'active',
    };
  }
  
  // Implémenter tous les autres méthodes...
}
```

### 3. Mise à Jour de l'Interface Admin

Ajouter une page pour gérer les connexions API:

```
/admin/marketplace-connections
- Afficher statut réel vs mock
- Tester les connexions
- Gérer les credentials
- Logs des erreurs API
```

### 4. Database Migrations

```bash
# Ajouter les nouvelles colonnes si nécessaire
npx prisma migrate dev --name add_real_api_fields

# Mettre en place les webhooks réels
# - Table pour stocker les webhooks reçus
# - Validation des signatures webhooks
```

### 5. Gestion des Erreurs

```typescript
// Tous les adapters doivent gérer:
- Erreurs réseau
- Erreurs d'authentification
- Rate limits
- Timeouts
- Données invalides

// Implémenter retry logic:
async createListingWithRetry(data, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await this.createListing(data);
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await delay(Math.pow(2, i) * 1000); // Exponential backoff
    }
  }
}
```

## 🔐 Sécurité en Production

### 1. Stocker les API Keys Sécurisement
```typescript
// ❌ JAMAIS en variables d'environnement hardcoded
// ✅ Utiliser un vault (AWS Secrets Manager, HashiCorp Vault)

import { SecretsManager } from 'aws-sdk';

const secretsManager = new SecretsManager();

async function getVintedApiKey() {
  const secret = await secretsManager.getSecretValue({
    SecretId: 'reselling/vinted/api-key',
  }).promise();
  
  return JSON.parse(secret.SecretString).apiKey;
}
```

### 2. Chiffrer les Données Sensibles
```typescript
// Chiffrer les API keys avant de les stocker en DB
import crypto from 'crypto';

function encryptApiKey(key: string): string {
  const cipher = crypto.createCipher('aes-256-cbc', process.env.ENCRYPTION_KEY!);
  let encrypted = cipher.update(key, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return encrypted;
}

function decryptApiKey(encrypted: string): string {
  const decipher = crypto.createDecipher('aes-256-cbc', process.env.ENCRYPTION_KEY!);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
```

### 3. Webhooks Authentification
```typescript
// Vérifier la signature des webhooks reçus
import crypto from 'crypto';

function verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
  const computed = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(computed)
  );
}
```

## 📊 Monitoring & Logging

### 1. Ajouter de la Télémétrie
```typescript
// Chaque appel API doit être loggé
async createListing(data: CreateListingData) {
  const startTime = Date.now();
  
  try {
    const response = await this.adapter.createListing(data);
    
    logger.info('Listing created', {
      marketplace: this.name,
      duration: Date.now() - startTime,
      externalId: response.externalId,
    });
    
    return response;
  } catch (error) {
    logger.error('Listing creation failed', {
      marketplace: this.name,
      duration: Date.now() - startTime,
      error: error.message,
    });
    throw error;
  }
}
```

### 2. Monitoring des Rate Limits
```typescript
// Suivre l'usage des APIs
class ApiRateLimiter {
  private calls: Map<string, number[]> = new Map();
  
  async executeWithLimit(
    marketplaceId: string,
    callback: () => Promise<any>,
    maxPerMinute: number
  ) {
    const now = Date.now();
    const minute = Math.floor(now / 60000) * 60000;
    
    const key = `${marketplaceId}:${minute}`;
    const calls = this.calls.get(key) || [];
    
    if (calls.length >= maxPerMinute) {
      throw new Error('Rate limit exceeded');
    }
    
    calls.push(now);
    this.calls.set(key, calls);
    
    return callback();
  }
}
```

## 🚀 Déploiement

### 1. Infrastructure Recommandée
```yaml
# Docker Compose pour la prod
version: '3'
services:
  app:
    image: reselling-saas:latest
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: ${DATABASE_URL}
      NEXTAUTH_SECRET: ${NEXTAUTH_SECRET}
    depends_on:
      - db
  
  db:
    image: postgres:15
    environment:
      POSTGRES_DB: reselling_saas
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
  
  redis:
    image: redis:7
    ports:
      - "6379:6379"

volumes:
  postgres_data:
```

### 2. Variables d'Environnement Production
```bash
# .env.production
DATABASE_URL="postgresql://..."
NEXTAUTH_SECRET="long-random-secret"
NEXTAUTH_URL="https://yourdomain.com"

# API Keys (from secrets manager)
VINTED_API_KEY="from-vault"
EBAY_CONSUMER_KEY="from-vault"
ETSY_API_KEY="from-vault"

# Encryption
ENCRYPTION_KEY="from-vault"

# Webhook secrets
WEBHOOK_SECRET="from-vault"

# Stripe (for payments)
STRIPE_SECRET_KEY="from-vault"
STRIPE_PUBLISHABLE_KEY="from-vault"

# Monitoring
SENTRY_DSN="https://..."
```

### 3. Database Backups
```bash
# Backup automatique
0 2 * * * /usr/bin/pg_dump $DATABASE_URL | gzip > /backups/db-$(date +\%Y\%m\%d).sql.gz

# Restauration
gunzip < backup.sql.gz | psql $DATABASE_URL
```

## 🔄 Migration depuis MVP

### Timeline Recommandée
```
Semaine 1: Configuration & Setup
- Obtenir tous les credentials
- Configurer vault/secrets manager
- Tester les APIs en staging

Semaine 2: Implementation
- Implémenter chaque adapter
- Tests unitaires & intégration
- Gestion des erreurs

Semaine 3: Testing
- Testing en staging
- Audit de sécurité
- Performance testing

Semaine 4: Rollout
- Déployer en production (graduel)
- Monitoring active
- Support 24/7
```

### Stratégie de Déploiement
```
Phase 1: Feature Flag
- Garder les mocks en place
- Ajouter feature flag pour réel APIs
- Tester avec 5% du traffic

Phase 2: Gradual Rollout
- 25% → 50% → 75% → 100%
- Monitorer les erreurs
- Rollback facile

Phase 3: Complet
- Tous les users sur vraies APIs
- Conserver les mocks comme fallback
- Optimiser les performances
```

## 📈 Métriques de Production

### À Monitorer
```typescript
// Latency par marketplace
- Avg response time
- P95 response time
- Error rate

// Business metrics
- Listings created
- Orders received
- Fulfillment success rate
- Revenue per marketplace

// System health
- Database connections
- Memory usage
- API rate limit usage
- Webhook failures
```

## 🆘 Troubleshooting

### Problème: Listing creation fails
```
1. Vérifier les logs
2. Vérifier les credentials
3. Tester manuellement avec l'API du marketplace
4. Vérifier le format des données
5. Vérifier les rate limits
```

### Problème: Orders not syncing
```
1. Vérifier les webhooks sont reçus
2. Vérifier la signature webhook
3. Vérifier les données parsées
4. Vérifier que l'ordre est créé en DB
5. Vérifier les logs fulfillment
```

### Problème: Inventory out of sync
```
1. Vérifier les listings existents
2. Lancer sync manuel via admin
3. Vérifier les erreurs de sync
4. Vérifier les quantities
5. Vérifier les délistages automatiques
```

## 📚 Ressources

### Documentation Officielle
- eBay Trading API: https://developer.ebay.com/develop/apis/business-insights-api
- Etsy APIs: https://www.etsy.com/developers/documentation
- Depop API: https://business.depop.com (demander accès)

### Bibliothèques Utiles
```json
{
  "ebay-api": "^2.0.0",
  "etsy-api": "^1.0.0",
  "axios": "^1.0.0",
  "ioredis": "^5.0.0",
  "node-rate-limiter-flexible": "^2.0.0"
}
```

## ✅ Checklist Before Going Live

- [ ] Tous les credentials obtenus et sécurisés
- [ ] Tous les adapters implémentés et testés
- [ ] Database backups configurés
- [ ] Monitoring et logging en place
- [ ] Error handling robuste
- [ ] Rate limiting implémenté
- [ ] Webhooks fonctionnels
- [ ] Tests d'intégration passent
- [ ] Audit de sécurité complété
- [ ] Plan de rollback préparé
- [ ] Documentation mise à jour
- [ ] Support team formé
