import "dotenv/config";

const isBun = typeof (globalThis as any).Bun !== "undefined";

export let Sentry: typeof import("@sentry/node") | null = null;

async function loadSentry(): Promise<typeof import("@sentry/node") | null> {
  if (Sentry) return Sentry;

  // Under Bun, some transitive OpenTelemetry instrumentations currently crash at import-time
  // (e.g. @opentelemetry/instrumentation-graphql: "The superclass is not a constructor").
  // To keep the server runnable, we lazy-load and gracefully disable Sentry if import fails.
  try {
    Sentry = await import("@sentry/node");
    return Sentry;
  } catch (err) {
    console.warn("⚠️  Sentry could not be loaded; error tracking disabled.", err);
    Sentry = null;
    return null;
  }
}

const SENTRY_DSN = process.env.SENTRY_DSN;
const NODE_ENV = process.env.NODE_ENV || 'development';

export function initializeSentry() {
  // Kept for backward compatibility; prefer awaiting initializeSentryAsync() in Bun/ESM.
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  initializeSentryAsync();
}

export async function initializeSentryAsync() {
  if (!SENTRY_DSN) {
    console.warn("⚠️  Sentry DSN not configured - error tracking disabled");
    return;
  }

  const sentry = await loadSentry();
  if (!sentry) return;

  sentry.init({
    dsn: SENTRY_DSN,
    environment: NODE_ENV,
    
    // Performance monitoring
    tracesSampleRate: NODE_ENV === 'production' ? 0.1 : 1.0,
    profilesSampleRate: NODE_ENV === 'production' ? 0.1 : 1.0,
    
    integrations: [
      // Bun note: avoid @sentry/profiling-node (native addon) which can crash under Bun.
      // Enable profiling only when running under Node.js.
      ...(!isBun
        ? [
            // Lazy import so Bun never tries to load the native addon.
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            require("@sentry/profiling-node").nodeProfilingIntegration(),
          ]
        : []),

      // v10 integrations
      sentry.httpIntegration({ tracing: true }),
      sentry.expressIntegration(),
      sentry.mongoIntegration({ useMongoose: true }),
    ],
    
    // Filter out health check and monitoring endpoints
    beforeSend(event) {
      // Don't send events for health checks or monitoring
      if (event.request?.url?.includes('/health') || 
          event.request?.url?.includes('/metrics') ||
          event.request?.url?.includes('/ping')) {
        return null;
      }
      return event;
    },
    
    // Set user context for better error tracking
    beforeSendTransaction(transaction) {
      // Filter out health check transactions
      if (transaction.name?.includes('GET /health') || 
          transaction.name?.includes('GET /metrics') ||
          transaction.name?.includes('GET /ping')) {
        return null;
      }
      return transaction;
    },
  });

  console.log(`✅ Sentry initialized for ${NODE_ENV} environment${isBun ? " (bun)" : ""}`);
}

/**
 * Middleware to set user context for Sentry
 */
export function setSentryUser(user: any) {
  if (!Sentry) return;
  Sentry.setUser({
    id: user.id || user._id?.toString(),
    email: user.email,
    username: `${user.firstName} ${user.lastName}`.trim() || user.name,
    role: user.role || user.type,
  });
}

/**
 * Middleware to set transaction context
 */
export function setSentryContext(key: string, context: Record<string, any>) {
  if (!Sentry) return;
  Sentry.setContext(key, context);
}

/**
 * Capture exception with additional context
 */
export function captureException(error: Error, context?: Record<string, any>) {
  if (!Sentry) return;
  if (context) {
    Sentry.withScope((scope) => {
      Object.entries(context).forEach(([key, value]) => {
        scope.setTag(key, value);
      });
      Sentry.captureException(error);
    });
  } else {
    Sentry.captureException(error);
  }
}

/**
 * Capture message with severity level
 */
export function captureMessage(message: string, level: Sentry.SeverityLevel = 'info', context?: Record<string, any>) {
  if (!Sentry) return;
  if (context) {
    Sentry.withScope((scope) => {
      Object.entries(context).forEach(([key, value]) => {
        scope.setTag(key, value);
      });
      Sentry.captureMessage(message, level);
    });
  } else {
    Sentry.captureMessage(message, level);
  }
}

/**
 * Create a performance transaction
 */
export function startTransaction(name: string, op: string) {
  if (!Sentry) return null;
  return Sentry.startTransaction({ name, op });
}