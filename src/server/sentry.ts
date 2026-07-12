import type {
  CloudflareOptions,
  ErrorEvent,
  EventHint,
} from '@sentry/cloudflare';
import type { Env } from './env';

type RuntimeCloudflareOptions = CloudflareOptions & Record<string, unknown>;
type BeforeSendTransaction = NonNullable<
  CloudflareOptions['beforeSendTransaction']
>;
type TransactionEvent = Parameters<BeforeSendTransaction>[0];

const SENSITIVE_EXTRA_KEYS = [
  'agentToken',
  'apiKey',
  'authorization',
  'cookie',
  'gameState',
  'ipHash',
  'matchToken',
  'moves',
  'playerKey',
  'prompt',
  'requestBody',
  'response',
  'roomCode',
  'text',
  'token',
];

function redactHeaders(headers: Record<string, string> | undefined) {
  if (!headers) {
    return headers;
  }

  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => {
      const lowerKey = key.toLowerCase();
      if (lowerKey.includes('authorization') || lowerKey.includes('cookie')) {
        return [key, '[Filtered]'];
      }
      return [key, value];
    }),
  );
}

function beforeSend(event: ErrorEvent, _hint: EventHint): ErrorEvent {
  if (event.request) {
    const headers = redactHeaders(event.request.headers);
    if (headers) {
      event.request.headers = headers;
    } else {
      event.request.headers = undefined;
    }
    event.request.cookies = undefined;
    event.request.data = undefined;
  }

  if (event.extra) {
    for (const key of SENSITIVE_EXTRA_KEYS) {
      if (key in event.extra) {
        event.extra[key] = '[Filtered]';
      }
    }
  }

  return event;
}

const SCANNER_TRANSACTION_PATTERNS = [
  /^GET \/\./,
  /^GET \/\+CSCOT\+\//,
  /^GET \/(?:actuator|application\/logs|explorer|rest\/api|swagger)\//,
  /^GET \/api\/v1\/namespaces\//,
  /^GET \/v\d+\/graphql\//,
  /^GET \/auth\.html$/,
  /^GET \/.*\.(?:bak|sql)$/,
];

export function isScannerTransaction(transaction: string | undefined): boolean {
  return Boolean(
    transaction &&
      SCANNER_TRANSACTION_PATTERNS.some((pattern) => pattern.test(transaction)),
  );
}

function beforeSendTransaction(
  event: TransactionEvent,
): TransactionEvent | null {
  return isScannerTransaction(event.transaction) ? null : event;
}

export function sentryOptions(env: Env): RuntimeCloudflareOptions | undefined {
  if (!env.SENTRY_DSN) {
    return undefined;
  }

  return {
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT ?? 'production',
    release:
      env.SENTRY_RELEASE ?? env.CF_VERSION_METADATA?.id ?? env.GIT_COMMIT_SHA,
    sendDefaultPii: false,
    tracesSampleRate: env.SENTRY_ENVIRONMENT === 'production' ? 0.01 : 0,
    enableRpcTracePropagation: true,
    beforeSend,
    beforeSendTransaction,
  };
}
