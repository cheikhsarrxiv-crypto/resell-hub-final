import clsx, { type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function formatCurrency(value: number, currency = 'EUR'): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency,
  }).format(value);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('fr-FR').format(value);
}

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('fr-FR').format(date);
}

export function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat('fr-FR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function calculateProfit(
  sellingPrice: number,
  purchasePrice: number,
  fulfillmentCost: number = 0,
  fees: number = 0
): number {
  return sellingPrice - purchasePrice - fulfillmentCost - fees;
}

export function calculateMargin(
  sellingPrice: number,
  cost: number
): number {
  if (cost === 0) return 0;
  return ((sellingPrice - cost) / sellingPrice) * 100;
}

export function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    // Order statuses
    pending: 'bg-yellow-100 text-yellow-800',
    processing: 'bg-blue-100 text-blue-800',
    shipped: 'bg-purple-100 text-purple-800',
    delivered: 'bg-green-100 text-green-800',
    cancelled: 'bg-red-100 text-red-800',
    error: 'bg-red-100 text-red-800',
    
    // Fulfillment statuses
    accepted: 'bg-blue-100 text-blue-800',
    failed: 'bg-red-100 text-red-800',
    
    // Listing statuses
    active: 'bg-green-100 text-green-800',
    delisted: 'bg-gray-100 text-gray-800',
    sold_out: 'bg-red-100 text-red-800',
    paused: 'bg-yellow-100 text-yellow-800',
    
    // Sync statuses
    synced: 'bg-green-100 text-green-800',
    syncing: 'bg-blue-100 text-blue-800',
    not_synced: 'bg-gray-100 text-gray-800',
    
    // Connection statuses
    connected: 'bg-green-100 text-green-800',
    not_connected: 'bg-gray-100 text-gray-800',
    mock: 'bg-orange-100 text-orange-800',
    
    // Subscription statuses  
    expired: 'bg-gray-100 text-gray-800',
  };
  
  return colors[status] || 'bg-gray-100 text-gray-800';
}

export function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: 'En attente',
    processing: 'En préparation',
    shipped: 'Expédié',
    delivered: 'Livré',
    cancelled: 'Annulé',
    error: 'Erreur',
    accepted: 'Accepté',
    failed: 'Échoué',
    active: 'Actif',
    delisted: 'Désactivé',
    sold_out: 'Rupture de stock',
    paused: 'Pause',
    synced: 'Synchronisé',
    syncing: 'Synchronisation...',
    not_synced: 'Non synchronisé',
    connected: 'Connecté',
    not_connected: 'Non connecté',
    mock: 'Mock',
  };
  
  return labels[status] || status;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

export function generateId(prefix: string = ''): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 12; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return prefix ? `${prefix}_${result}` : result;
}

export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function groupBy<T>(array: T[], key: keyof T): Record<string, T[]> {
  return array.reduce(
    (result, item) => {
      const group = String(item[key]);
      if (!result[group]) {
        result[group] = [];
      }
      result[group].push(item);
      return result;
    },
    {} as Record<string, T[]>
  );
}

export function sumBy<T>(array: T[], callback: (item: T) => number): number {
  return array.reduce((sum, item) => sum + callback(item), 0);
}

export function averageBy<T>(array: T[], callback: (item: T) => number): number {
  if (array.length === 0) return 0;
  return sumBy(array, callback) / array.length;
}
