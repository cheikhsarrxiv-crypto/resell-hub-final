# Guide de Test des API Endpoints

Testez les endpoints avec curl, Postman, ou directement via le dashboard.

## 🔑 Variables Importantes

```bash
# Après login, vous recevrez une session token
WORKSPACE_ID="demo-shop"
USER_EMAIL="demo@reselling.local"
USER_PASSWORD="demo1234"
```

## 📋 Endpoints API

### Authentication

#### 1. Sign Up
```bash
curl -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "email": "newuser@example.com",
    "password": "securepassword123",
    "name": "New User",
    "country": "FR"
  }'
```

**Réponse:**
```json
{
  "success": true,
  "message": "User created successfully",
  "user": {
    "id": "user-id",
    "email": "newuser@example.com",
    "name": "New User"
  },
  "workspace": {
    "id": "workspace-id",
    "name": "New User's Workspace",
    "slug": "newuser"
  }
}
```

### Products

#### 2. Get Products
```bash
curl -X GET "http://localhost:3000/api/products?workspaceId=workspace-id&page=1" \
  -H "Cookie: [session-cookie]"
```

#### 3. Create Product
```bash
curl -X POST "http://localhost:3000/api/products?workspaceId=workspace-id" \
  -H "Content-Type: application/json" \
  -H "Cookie: [session-cookie]" \
  -d '{
    "sku": "PROD-001",
    "title": "Nike Air Max 90",
    "description": "Classic Nike sneaker in excellent condition. Worn once only.",
    "brand": "Nike",
    "category": "Sneakers",
    "size": "42",
    "color": "White/Red",
    "condition": "like-new",
    "purchasePrice": 50,
    "sellingPrice": 120,
    "fulfillmentCost": 5,
    "quantity": 1,
    "location": "Shelf A1"
  }'
```

### Orders

#### 4. Get Orders
```bash
curl -X GET "http://localhost:3000/api/orders?workspaceId=workspace-id&status=pending" \
  -H "Cookie: [session-cookie]"
```

#### 5. Create Order
```bash
curl -X POST "http://localhost:3000/api/orders?workspaceId=workspace-id" \
  -H "Content-Type: application/json" \
  -H "Cookie: [session-cookie]" \
  -d '{
    "listingId": "listing-id",
    "customerName": "John Doe",
    "customerEmail": "john@example.com",
    "totalPrice": 120,
    "marketplaceFees": 15,
    "estimatedProfit": 85,
    "fulfillmentType": "automatic",
    "shippingAddress": "123 Main St",
    "shippingCity": "Paris",
    "shippingPostalCode": "75001",
    "shippingCountry": "FR"
  }'
```

#### 6. Get Order Details
```bash
curl -X GET "http://localhost:3000/api/orders/order-id?workspaceId=workspace-id" \
  -H "Cookie: [session-cookie]"
```

### Fulfillment

#### 7. Get Available Partners
```bash
curl -X GET http://localhost:3000/api/fulfillment/partners \
  -H "Cookie: [session-cookie]"
```

#### 8. Send Order to Fulfillment
```bash
curl -X POST "http://localhost:3000/api/fulfillment/send?workspaceId=workspace-id" \
  -H "Content-Type: application/json" \
  -H "Cookie: [session-cookie]" \
  -d '{
    "orderId": "order-id",
    "partnerId": "partner-id"
  }'
```

#### 9. Simulate Status Change
```bash
# Accept
curl -X POST "http://localhost:3000/api/fulfillment/simulate?workspaceId=workspace-id" \
  -H "Content-Type: application/json" \
  -H "Cookie: [session-cookie]" \
  -d '{
    "fulfillmentOrderId": "fulfillment-order-id",
    "action": "accept"
  }'

# Processing
curl -X POST "http://localhost:3000/api/fulfillment/simulate?workspaceId=workspace-id" \
  -H "Content-Type: application/json" \
  -H "Cookie: [session-cookie]" \
  -d '{
    "fulfillmentOrderId": "fulfillment-order-id",
    "action": "processing"
  }'

# Ship (génère tracking)
curl -X POST "http://localhost:3000/api/fulfillment/simulate?workspaceId=workspace-id" \
  -H "Content-Type: application/json" \
  -H "Cookie: [session-cookie]" \
  -d '{
    "fulfillmentOrderId": "fulfillment-order-id",
    "action": "ship"
  }'

# Deliver
curl -X POST "http://localhost:3000/api/fulfillment/simulate?workspaceId=workspace-id" \
  -H "Content-Type: application/json" \
  -H "Cookie: [session-cookie]" \
  -d '{
    "fulfillmentOrderId": "fulfillment-order-id",
    "action": "deliver"
  }'
```

### Analytics

#### 10. Get Dashboard Metrics
```bash
curl -X GET "http://localhost:3000/api/analytics/dashboard?workspaceId=workspace-id&days=30" \
  -H "Cookie: [session-cookie]"
```

**Réponse:**
```json
{
  "success": true,
  "metrics": {
    "revenue": 355,
    "orders": 3,
    "profit": 251,
    "margin": 70.7,
    "productsCount": 5,
    "activeListings": 15,
    "pendingOrders": 1,
    "fulfillmentOrders": 1,
    "revenueByMarketplace": {
      "Vinted": 120,
      "eBay": 95,
      "Depop": 140
    },
    "fulfillmentRevenue": 140,
    "fulfillmentCost": 6,
    "grossProfit": 245,
    "netRevenue": 495
  }
}
```

## 🧪 Scénario de Test Complet

### 1. Créer un nouveau compte
```bash
# Signup
curl -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "email": "testuser@example.com",
    "password": "testpass123",
    "name": "Test User",
    "country": "FR"
  }'

# Récupérez le workspace-id depuis la réponse
```

### 2. Créer un produit
```bash
# Notez le workspace-id de l'étape précédente
curl -X POST "http://localhost:3000/api/products?workspaceId=YOUR-WORKSPACE-ID" \
  -H "Content-Type: application/json" \
  -d '{
    "sku": "TEST-001",
    "title": "Test Sneaker",
    "description": "A test sneaker for demonstration purposes",
    "brand": "TestBrand",
    "category": "Sneakers",
    "condition": "new",
    "purchasePrice": 30,
    "sellingPrice": 80,
    "fulfillmentCost": 5,
    "quantity": 1
  }'

# Récupérez le product-id depuis la réponse
```

### 3. Créer une listing (cross-listing)
```bash
# D'abord, récupérez un listing-id existant
curl -X GET "http://localhost:3000/api/products?workspaceId=YOUR-WORKSPACE-ID"

# Notez un product-id et un marketplace-id
```

### 4. Créer une commande
```bash
# Utilisez le listing-id du produit
curl -X POST "http://localhost:3000/api/orders?workspaceId=YOUR-WORKSPACE-ID" \
  -H "Content-Type: application/json" \
  -d '{
    "listingId": "LISTING-ID-HERE",
    "customerName": "Test Customer",
    "customerEmail": "customer@test.com",
    "totalPrice": 80,
    "marketplaceFees": 12,
    "estimatedProfit": 50,
    "fulfillmentType": "automatic",
    "shippingAddress": "123 Test Street",
    "shippingCity": "Paris",
    "shippingPostalCode": "75001",
    "shippingCountry": "FR"
  }'

# Récupérez l'order-id
```

### 5. Tester le flux fulfillment complet
```bash
# a) Envoyer au fulfillment
FULFILLMENT_ORDER_ID="..."  # Obtenu après envoi au fulfillment

curl -X POST "http://localhost:3000/api/fulfillment/send?workspaceId=YOUR-WORKSPACE-ID" \
  -H "Content-Type: application/json" \
  -d '{
    "orderId": "ORDER-ID-HERE",
    "partnerId": "PARTNER-ID"
  }'

# b) Accepter la commande
curl -X POST "http://localhost:3000/api/fulfillment/simulate?workspaceId=YOUR-WORKSPACE-ID" \
  -H "Content-Type: application/json" \
  -d '{
    "fulfillmentOrderId": "'$FULFILLMENT_ORDER_ID'",
    "action": "accept"
  }'

# c) Marquer en traitement
curl -X POST "http://localhost:3000/api/fulfillment/simulate?workspaceId=YOUR-WORKSPACE-ID" \
  -H "Content-Type: application/json" \
  -d '{
    "fulfillmentOrderId": "'$FULFILLMENT_ORDER_ID'",
    "action": "processing"
  }'

# d) Expédier
curl -X POST "http://localhost:3000/api/fulfillment/simulate?workspaceId=YOUR-WORKSPACE-ID" \
  -H "Content-Type: application/json" \
  -d '{
    "fulfillmentOrderId": "'$FULFILLMENT_ORDER_ID'",
    "action": "ship"
  }'

# e) Livrer
curl -X POST "http://localhost:3000/api/fulfillment/simulate?workspaceId=YOUR-WORKSPACE-ID" \
  -H "Content-Type: application/json" \
  -d '{
    "fulfillmentOrderId": "'$FULFILLMENT_ORDER_ID'",
    "action": "deliver"
  }'
```

### 6. Vérifier les analytics
```bash
curl -X GET "http://localhost:3000/api/analytics/dashboard?workspaceId=YOUR-WORKSPACE-ID&days=30"
```

## 💡 Tips

- Les erreurs d'authentification retournent 401
- Les erreurs de validation retournent 400
- Assurez-vous d'envoyer le header `Content-Type: application/json`
- Les IDs sont en format CUID (toujours valides)
- Vérifiez les logs du serveur pour les erreurs détaillées

## 🔍 Debugging

### Si vous recevez une erreur 401
- Assurez-vous d'être connecté
- Vérifiez que le cookie de session est présent
- Vérifiez que le token n'a pas expiré

### Si vous recevez une erreur de validation
- Vérifiez tous les champs requis
- Vérifiez les types de données
- Vérifiez le format de l'email
- Regardez le message d'erreur détaillé

### Si un ordre n'accepte pas le fulfillment
- Vérifiez que le partenaire existe
- Vérifiez que le type est `automatic`
- Vérifiez qu'un fulfillment order n'existe pas déjà

## 📚 Schémas Zod

Tous les endpoints utilisent Zod pour la validation. Consultez `src/lib/validations.ts` pour les détails exacts.
