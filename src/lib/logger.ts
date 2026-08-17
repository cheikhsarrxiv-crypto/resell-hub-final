/**
 * Structured Logger Service
 * 
 * Replaces console.log with structured logging
 * Supports: info, warn, error, debug levels
 * No secrets/tokens/passwords in logs
 * 
 * Environment:
 * LOG_LEVEL=debug|info|warn|error (default: info)
 * LOG_FORMAT=json|text (default: text)
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  service: string;
  message: string;
  context?: Record<string, any>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

class StructuredLogger {
  private serviceName: string;
  private logLevel: LogLevel;
  private logFormat: 'json' | 'text';

  constructor(serviceName: string) {
    this.serviceName = serviceName;
    this.logLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';
    this.logFormat = (process.env.LOG_FORMAT as 'json' | 'text') || 'text';
  }

  /**
   * Log at info level
   * General information about application execution
   */
  info(message: string, context?: Record<string, any>): void {
    this.log('info', message, context);
  }

  /**
   * Log at warn level
   * Warning about potential issues
   */
  warn(message: string, context?: Record<string, any>): void {
    this.log('warn', message, context);
  }

  /**
   * Log at error level
   * Error conditions
   */
  error(message: string, error?: Error | string, context?: Record<string, any>): void {
    const errorData = typeof error === 'string' ? { message: error } : error;
    this.log('error', message, context, errorData as Error);
  }

  /**
   * Log at debug level
   * Detailed debugging information (only in development)
   */
  debug(message: string, context?: Record<string, any>): void {
    this.log('debug', message, context);
  }

  /**
   * Internal logging method
   */
  private log(
    level: LogLevel,
    message: string,
    context?: Record<string, any>,
    error?: Error
  ): void {
    // Check if we should log this level
    if (LOG_LEVELS[level] < LOG_LEVELS[this.logLevel]) {
      return;
    }

    // Filter sensitive data from context
    const safeContext = this.filterSensitiveData(context || {});

    const logEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.serviceName,
      message,
      context: Object.keys(safeContext).length > 0 ? safeContext : undefined,
    };

    if (error) {
      logEntry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }

    // Output log
    this.outputLog(logEntry);
  }

  /**
   * Output log in appropriate format
   */
  private outputLog(entry: LogEntry): void {
    const levelColor = this.getLevelColor(entry.level);
    const timestamp = new Date(entry.timestamp).toLocaleTimeString();

    if (this.logFormat === 'json') {
      console.log(JSON.stringify(entry));
    } else {
      // Text format with colors
      const contextStr = entry.context
        ? ` ${JSON.stringify(entry.context)}`
        : '';
      const errorStr = entry.error
        ? `\n  Error: ${entry.error.name} - ${entry.error.message}`
        : '';

      console.log(
        `${levelColor}[${timestamp}] [${entry.service}] ${entry.message}${contextStr}${errorStr}\x1b[0m`
      );
    }
  }

  /**
   * Filter sensitive data from objects
   */
  private filterSensitiveData(obj: any): any {
    if (typeof obj !== 'object' || obj === null) {
      if (typeof obj === 'string') {
        return this.maskSensitiveStrings(obj);
      }
      return obj;
    }

    const filtered = Array.isArray(obj) ? [...obj] : { ...obj };
    const sensitiveKeys = [
      'password',
      'token',
      'secret',
      'api_key',
      'apiKey',
      'key',
      'auth',
      'authorization',
      'cookie',
      'session',
      'access_token',
      'refresh_token',
      'stripe_key',
      'supabase_key',
      'resend_key',
      'sendgrid_key',
      'sentry_dsn',
    ];

    for (const key in filtered) {
      const lowerKey = key.toLowerCase();

      // Check if key is sensitive
      if (sensitiveKeys.some((sensitive) => lowerKey.includes(sensitive))) {
        filtered[key] = '[REDACTED]';
      } else if (typeof filtered[key] === 'object') {
        // Recursively filter nested objects
        filtered[key] = this.filterSensitiveData(filtered[key]);
      } else if (typeof filtered[key] === 'string') {
        filtered[key] = this.maskSensitiveStrings(filtered[key]);
      }
    }

    return filtered;
  }

  /**
   * Mask sensitive patterns in strings
   */
  private maskSensitiveStrings(str: string): string {
    return str
      .replace(/password[=:]\s*\S+/gi, 'password=[REDACTED]')
      .replace(/token[=:]\s*\S+/gi, 'token=[REDACTED]')
      .replace(/api[_-]?key[=:]\s*\S+/gi, 'api_key=[REDACTED]')
      .replace(/secret[=:]\s*\S+/gi, 'secret=[REDACTED]')
      .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[EMAIL]');
  }

  /**
   * Get color code for log level
   */
  private getLevelColor(level: LogLevel): string {
    const colors = {
      debug: '\x1b[36m', // Cyan
      info: '\x1b[32m', // Green
      warn: '\x1b[33m', // Yellow
      error: '\x1b[31m', // Red
    };
    return colors[level] || '';
  }
}

/**
 * Export logger factory
 */
export function createLogger(serviceName: string): StructuredLogger {
  return new StructuredLogger(serviceName);
}

/**
 * Global logger for infrastructure logging
 */
export const logger = new StructuredLogger('resellhub');
