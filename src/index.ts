// Types
export * from '@/types';

// Validation Schemas
export * from '@/lib/validations';

// Utilities
export { 
  cn, 
  formatCurrency, 
  formatNumber, 
  formatDate, 
  formatDateTime,
  calculateProfit,
  calculateMargin,
  getStatusColor,
  getStatusLabel,
  slugify,
  generateId,
  isValidEmail,
  groupBy,
  sumBy,
  averageBy,
} from '@/lib/utils';

// Services
export { ProductService } from '@/services/ProductService';
export { OrderService } from '@/services/OrderService';
export { FulfillmentService } from '@/services/FulfillmentService';
export { AnalyticsService } from '@/services/AnalyticsService';
export { ListingService } from '@/services/ListingService';

// Marketplace Adapters
export { MarketplaceAdapter } from '@/services/marketplace/MarketplaceAdapter';
export {
} from '@/services/marketplace/adapters/EbayAdapter';
export { EtsyAdapter } from '@/services/marketplace/adapters/EtsyAdapter';
export { DepopAdapter } from '@/services/marketplace/adapters/DepopAdapter';
export { VintedAdapter } from '@/services/marketplace/adapters/VintedAdapter';
export { AdapterFactory } from '@/services/marketplace/AdapterFactory';

// Components
export { DashboardLayout } from '@/components/Layout/DashboardLayout';
export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, StatCard } from '@/components/UI/Card';
export { Button, Badge, Table, TableHead, TableBody, TableRow, TableHeaderCell, TableCell } from '@/components/UI/Button';

// Auth
export { handlers, auth, signIn, signOut } from '@/auth';
