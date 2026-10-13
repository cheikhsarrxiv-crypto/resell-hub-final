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
   * Filter sensitive data from objects.
   *
   * Circular-reference fix — `seen` tracks every object/array already
   * visited on this call's own recursion (a fresh Set per top-level call,
   * via the default parameter; every recursive call explicitly threads
   * the SAME Set through, never relying on the default again). A context
   * object that references itself, directly or through a longer cycle,
   * would otherwise recurse forever and crash with a stack overflow —
   * logging a request's own failure must never itself become a second,
   * unhandled failure. Deliberate, documented over-approximation: this
   * also flags a harmless SHARED reference (the same sub-object reachable
   * from two different keys, no cycle at all) as `[CIRCULAR]` on its
   * second visit — accepted because it is a logging utility, and being
   * slightly over-cautious about a repeated non-sensitive reference is a
   * far smaller cost than the infinite recursion it prevents.
   */
  private filterSensitiveData(obj: any, seen: Set<any> = new Set()): any {
    if (typeof obj !== 'object' || obj === null) {
      if (typeof obj === 'string') {
        return this.maskSensitiveStrings(obj);
      }
      return obj;
    }

    if (seen.has(obj)) {
      return '[CIRCULAR]';
    }
    seen.add(obj);

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
      } else if (typeof filtered[key] === 'object' && filtered[key] !== null) {
        // Recursively filter nested objects — same `seen` Set passed
        // through, never a fresh one, or the cycle guard above would
        // never see a repeat.
        filtered[key] = this.filterSensitiveData(filtered[key], seen);
      } else if (typeof filtered[key] === 'string') {
        filtered[key] = this.maskSensitiveStrings(filtered[key]);
      }
    }

    return filtered;
  }

  /**
   * Mask sensitive patterns in strings.
   *
   * Redaction fix (audit follow-up) — the original 4 patterns only ever
   * matched an UNQUOTED `keyword[=:]value` shape (`token=abc`,
   * `password: abc`). Proven by direct testing (not assumed) to miss:
   * - A secret serialized as a standard JSON key:value pair with quoted
   *   keys (`"apiKey":"abc"`, `{"token": "abc"}`) — the quote right after
   *   the keyword meant `keyword[=:]` never matched. New pattern #1 below
   *   covers this specifically (quoted key, quoted value, handles an
   *   escaped quote inside the value), independently of the 4 unquoted
   *   patterns which are kept for the exact shapes they already covered.
   * - An `Authorization: Bearer <token>` / `Authorization: Basic <creds>`
   *   header, free-text or JSON-serialized — no prior pattern recognized
   *   the word "Bearer"/"Basic" at all. New pattern #3 requires an
   *   `authorization` key/word immediately before the scheme word
   *   (optionally quoted, with `:` or `=`) — deliberately NOT a bare
   *   `\b(bearer|basic)\b` match anywhere in a string, which was tested
   *   and found to mangle ordinary English ("a basic test", "a basic
   *   configuration mistake", "provide a Bearer token for this request")
   *   by redacting the word right after "basic"/"Bearer". Scoping to the
   *   `authorization` header context is both what this fix was actually
   *   asked to cover and what avoids that false-positive class.
   * - Credentials in a URL's own userinfo (`scheme://user:pass@host`) —
   *   no prior pattern covered this syntax at all; the previous append
   *   risked relying on the EMAIL pattern matching that same shape by
   *   coincidence (it only does so when the password happens to contain
   *   only `[A-Za-z0-9._%+-]` characters AND the host happens to look
   *   like a dotted domain — verified to fail for a password containing
   *   `#`/`!` or a bare host like `localhost`). New pattern #4 matches
   *   the userinfo structure itself (`scheme://user:password@`),
   *   redacting only the password segment and leaving the scheme,
   *   username and host untouched — and, tested explicitly, leaves a
   *   credential-free URL (no userinfo at all, or merely `host:port`)
   *   completely unchanged.
   *
   * All new patterns bound the "value" they consume to
   * `[^\s"',}]+` — stopping at whitespace, a quote, a comma or a closing
   * brace — instead of the old patterns' unbounded `\S+`, specifically so
   * a match inside a larger JSON/structured string never swallows
   * trailing punctuation (tested against values followed immediately by
   * `"`, `,`, `}`).
   *
   * What this still cannot do, by design (see this task's own scope):
   * recognize a bare secret with NO recognizable keyword/header/URL
   * structure anywhere near it (e.g. a raw API key pasted into a message
   * with nothing else around it). No regex can reliably tell a random
   * high-entropy string apart from an ordinary one without an unacceptable
   * false-positive rate — see this.log's own comment on preferring not to
   * log a raw external payload/body in the first place for that case.
   */
  private maskSensitiveStrings(str: string): string {
    // Bounded value: stops at whitespace/quote/comma/closing brace so a
    // match never consumes trailing JSON/structured-text punctuation.
    const VALUE = '[^\\s"\',}]+';
    return str
      // 1. Quoted JSON key:value — "password"/"token"/"secret"/
      // "apiKey"/"api_key"/"api-key" as an actual JSON object key, with a
      // quoted string value (escaped-quote-aware). Keeps the key name and
      // its quotes, redacts only the value.
      .replace(/"(password|token|secret|api[_-]?key)"\s*:\s*"((?:[^"\\]|\\.)*)"/gi, (_m, key: string) => `"${key}":"[REDACTED]"`)
      // 2. Original unquoted key[=:]value shapes — unchanged behavior,
      // now using the same bounded VALUE instead of unbounded `\S+`.
      .replace(new RegExp(`password[=:]\\s*${VALUE}`, 'gi'), 'password=[REDACTED]')
      .replace(new RegExp(`token[=:]\\s*${VALUE}`, 'gi'), 'token=[REDACTED]')
      .replace(new RegExp(`api[_-]?key[=:]\\s*${VALUE}`, 'gi'), 'api_key=[REDACTED]')
      .replace(new RegExp(`secret[=:]\\s*${VALUE}`, 'gi'), 'secret=[REDACTED]')
      // 3. Authorization: Bearer/Basic <credential> — scoped to an actual
      // `authorization` key/word right before the scheme word (never a
      // bare "bearer"/"basic" anywhere, which was tested to false-positive
      // on ordinary English).
      .replace(
        new RegExp(`(["']?authorization["']?\\s*[:=]\\s*["']?)(bearer|basic)(\\s+)${VALUE}`, 'gi'),
        (_m, prefix: string, scheme: string, ws: string) => `${prefix}${scheme}${ws}[REDACTED]`
      )
      // 4. URL userinfo credentials (scheme://user:password@host) — only
      // the password segment is replaced; scheme/username/host untouched,
      // and a URL with no userinfo at all is never matched or altered.
      .replace(/([a-z][a-z0-9+.-]*:\/\/)([^/\s:@"]+):([^/\s@"]+)@/gi, (_m, scheme: string, user: string) => `${scheme}${user}:[REDACTED]@`)
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
