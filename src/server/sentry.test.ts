import { describe, expect, it } from 'vitest';
import type { Env } from './env';
import { isScannerTransaction, sentryOptions } from './sentry';

describe('Sentry transaction filtering', () => {
  it.each([
    'GET /.docker/config.json',
    'GET /+CSCOT+/oem',
    'GET /actuator/auditevents',
    'GET /api/v1/namespaces/default/pods',
    'GET /db.php.bak',
    'GET /explorer/api-docs',
    'GET /rest/api/2/project',
    'GET /swagger/v2/api-docs',
    'GET /v4/graphql/schema.json',
  ])('drops scanner probe %s', (transaction) => {
    expect(isScannerTransaction(transaction)).toBe(true);
  });

  it.each([
    'GET /',
    'POST /api/matches',
    'GET /leaderboard',
  ])('keeps product transaction %s', (transaction) => {
    expect(isScannerTransaction(transaction)).toBe(false);
  });

  it('installs the filter in production Sentry options', () => {
    const options = sentryOptions({
      SENTRY_DSN: 'https://example.invalid/1',
    } as Env);
    const filter = options?.beforeSendTransaction;

    expect(
      filter?.({ type: 'transaction', transaction: 'GET /db.php.bak' }, {}),
    ).toBeNull();
    expect(
      filter?.({ type: 'transaction', transaction: 'GET /' }, {}),
    ).toMatchObject({
      transaction: 'GET /',
    });
  });
});
