/**
 * Sentry Error Tracking Configuration
 * 
 * Environment Variables Required:
 * SENTRY_DSN=https://xxxxx@yyyyy.ingest.sentry.io/zzzzzz
 * ENVIRONMENT=development|staging|production
 * 
 * No secrets should be captured
 */

import * as Sentry from '@sentry/nextjs';

export function initializeSentry(): void {
  // Only initialize if DSN is provided
  if (!process.env.SENTRY_DSN) {
    console.warn('[Sentry] No DSN provided, error tracking disabled');
    return;
  }

  const environment = process.env.ENVIRONMENT || 'development';

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment,

    // Performance monitoring (only in production)
    tracesSampleRate: environment === 'production' ? 0.1 : 1.0,

    // Release tracking
    release: process.env.APP_VERSION || 'unknown',

    // Sensitive data filtering
    beforeSend(event, hint) {
      // Remove sensitive information from all events
      if (event.request) {
        event.request.cookies = undefined;
        event.request.headers = undefined;
      }

      // Remove PII from exception messages
      if (event.exception) {
        event.exception.values?.forEach((exception: any) => {
          if (exception.value) {
            // Remove common PII patterns
            exception.value = exception.value
              .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[EMAIL]')
              .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN]')
              .replace(/\b\d{16}\b/g, '[CARD]');
          }
        });
      }

      // Remove sensitive data from messages
      if (event.message) {
        event.message = event.message
          .replace(/password[=:]\s*\S+/gi, 'password=[REDACTED]')
          .replace(/token[=:]\s*\S+/gi, 'token=[REDACTED]')
          .replace(/api[_-]?key[=:]\s*\S+/gi, 'api_key=[REDACTED]')
          .replace(/secret[=:]\s*\S+/gi, 'secret=[REDACTED]');
      }

      // Filter by level in development
      if (environment === 'development' && event.level === 'info') {
        return null; // Don't send info logs in development
      }

      return event;
    },

    // Ignore certain errors
    ignoreErrors: [
      // Ignore network errors (often unreliable)
      'NetworkError',
      'Network request failed',
      // Ignore browser extension errors
      'top.GLOBALS',
      'chrome-extension://',
      // Ignore known third-party errors
      'fb_xd_fragment',
    ],
  });

  console.log(`[Sentry] Initialized for ${environment} environment`);
}

/**
 * Capture exception with context
 * Never pass sensitive data
 */
export function captureException(
  error: Error,
  context?: Record<string, any>
): string {
  if (!process.env.SENTRY_DSN) {
    console.error('[Error]', error.message);
    return '';
  }

  // Filter context for sensitive data
  const safeContext = filterSensitiveData(context || {});

  const eventId = Sentry.captureException(error, {
    tags: {
      environment: process.env.ENVIRONMENT || 'unknown',
    },
    extra: safeContext,
  });

  return eventId;
}

/**
 * Capture message (for non-error events)
 * For warnings, info, etc.
 */
export function captureMessage(
  message: string,
  level: 'info' | 'warning' | 'error' = 'info',
  context?: Record<string, any>
): string {
  if (!process.env.SENTRY_DSN) {
    return '';
  }

  const safeContext = filterSensitiveData(context || {});

  const eventId = Sentry.captureMessage(message, {
    level,
    tags: {
      environment: process.env.ENVIRONMENT || 'unknown',
    },
    extra: safeContext,
  });

  return eventId;
}

/**
 * Filter sensitive data from objects
 * Prevents accidental leakage of passwords, tokens, etc.
 */
function filterSensitiveData(obj: any): any {
  if (typeof obj !== 'object' || obj === null) {
    return obj;
  }

  const filtered = Array.isArray(obj) ? [...obj] : { ...obj };
  const sensitiveKeys = [
    'password',
    'token',
    'secret',
    'api_key',
    'apiKey',
    'authorization',
    'cookie',
    'session',
    'access_token',
    'refresh_token',
    'stripe_key',
    'stripe_token',
    'supabase_key',
    'resend_key',
    'sendgrid_key',
  ];

  for (const key in filtered) {
    const lowerKey = key.toLowerCase();
    
    // Check if key is sensitive
    if (sensitiveKeys.some((sensitive: any) => lowerKey.includes(sensitive))) {
      filtered[key] = '[REDACTED]';
    } else if (typeof filtered[key] === 'object') {
      // Recursively filter nested objects
      filtered[key] = filterSensitiveData(filtered[key]);
    }
  }

  return filtered;
}

/**
 * Set user context for error tracking
 * Only pass userId, not email or other PII
 */
export function setUserContext(userId: string | null, workspaceId?: string): void {
  if (!process.env.SENTRY_DSN) {
    return;
  }

  if (userId) {
    Sentry.setUser({
      id: userId,
      ip_address: '{{auto}}',
    });

    if (workspaceId) {
      Sentry.setContext('workspace', {
        id: workspaceId,
      });
    }
  } else {
    Sentry.setUser(null);
  }
}

/**
 * Add breadcrumb for debugging
 * Helps trace user actions leading to error
 */
export function addBreadcrumb(
  category: string,
  message: string,
  level: 'debug' | 'info' | 'warning' | 'error' = 'info'
): void {
  if (!process.env.SENTRY_DSN) {
    return;
  }

  Sentry.addBreadcrumb({
    category,
    message,
    level,
  });
}
