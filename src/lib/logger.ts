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

    // Redaction fix — error.message/error.stack used to go into the log
    // entry verbatim, bypassing filterSensitiveData/maskSensitiveStrings
    // entirely (only `context`, above, ever went through them). A caught
    // error's own message (e.g. a raw provider/DB error string) or stack
    // can just as easily carry a leaked secret as anything in `context` —
    // see this.redactErrorFields's own comment for exactly what is and
    // isn't covered. Deliberately narrow: only the 3 existing plain-string
    // fields (name/message/stack) are extracted and masked, never the
    // error object itself — never passed through filterSensitiveData
    // (built for plain data objects, not Error instances, and no reason to
    // risk it recursing into exotic/non-standard error shapes) and never
    // JSON.stringify'd as a fallback (that could produce an unbounded or
    // circular-reference-unsafe blob for a non-standard error).
    if (error) {
      logEntry.error = this.redactErrorFields(error);
    }

    // Output log
    this.outputLog(logEntry);
  }

  /**
   * Extracts and masks the 3 plain-string fields logEntry.error has always
   * carried (name/message/stack) — never more, so this can never grow into
   * an unbounded serialized dump of an arbitrary error-like value.
   *
   * Defensive by construction, not just by assumption: `error` is typed as
   * `Error` at the call site, but a caught `error` is `unknown` by nature
   * (anyone can `throw` anything), and AiAgentService.ts's own callers
   * already pass `error instanceof Error ? error : String(error)` — so a
   * non-Error can still reach here as a plain string wrapped upstream, or
   * in principle as some other error-like shape (a non-Error class, a
   * plain object with a `message` property, null-prototype objects, a
   * Proxy with a throwing getter). `.name`/`.message`/`.stack` are read
   * through optional chaining and never assumed to be strings — each is
   * passed through safeToString first, which itself never throws (a
   * throwing/circular `.toString()` is caught and replaced with a fixed
   * placeholder, never left to crash the logger or produce a runaway
   * string). No recursion anywhere in this path — safeToString and
   * maskSensitiveStrings are both single-pass, so a self-referential or
   * deeply-aliased error object can never cause unbounded recursion here.
   */
  private redactErrorFields(error: unknown): { name: string; message: string; stack?: string } {
    try {
      const name = this.safeToString((error as { name?: unknown } | null)?.name) || 'Error';
      const message = this.maskSensitiveStrings(this.safeToString((error as { message?: unknown } | null)?.message));
      const rawStack = (error as { stack?: unknown } | null)?.stack;
      // A missing/absent stack (common for a non-Error thrown value, or an
      // Error constructed in an environment that never populated one)
      // stays absent rather than becoming the literal string
      // "undefined" — matches this field's own pre-existing
      // `stack?: string` optionality.
      const stack = typeof rawStack === 'string' && rawStack.length > 0 ? this.maskSensitiveStrings(rawStack) : undefined;
      return { name, message, stack };
    } catch {
      // Belt-and-suspenders: safeToString itself never throws, but merely
      // READING `.name`/`.message`/`.stack` off a hostile value (a Proxy
      // or a plain object with a throwing getter for one of these) can —
      // and that throw happens before safeToString is ever reached.
      // Logging a request's own failure must never itself become a second,
      // unhandled failure — degrade to a fixed, non-sensitive placeholder
      // rather than propagate.
      return { name: 'Error', message: '[error could not be read]' };
    }
  }

  /**
   * Never throws, never returns anything but a string. `null`/`undefined`
   * become `''` (an absent message is not the same as the 4-character
   * string "null"/"undefined"); anything already a string passes through
   * untouched; anything else is coerced via `String(...)`, itself wrapped
   * in try/catch since a hostile/malformed `.toString()` (throws, or is
   * not even a function) must never crash logging — the fallback is a
   * fixed, non-sensitive placeholder, never the raw value re-attempted a
   * different way.
   */
  private safeToString(value: unknown): string {
    if (typeof value === 'string') return value;
    if (value === null || value === undefined) return '';
    try {
      return String(value);
    } catch {
      return '[unserializable value]';
    }
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
