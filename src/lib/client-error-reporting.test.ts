import { expect, it } from 'vitest';
import { clientErrorReport } from './client-error-reporting';
it('redacts query strings, URLs and email addresses from error reports', () => {
  const report = clientErrorReport(new Error('Failed https://example.com/?token=secret for person@example.com'), '/customer-service/leads/rf?email=person@example.com');
  expect(JSON.stringify(report)).not.toMatch(/secret|person@example/);
  expect(report.path).toBe('/customer-service/leads/rf');
});
it('identifies stale asset failures separately from ordinary render failures', () => {
  expect(clientErrorReport(new Error('Loading chunk 123 failed'), '/customer-service/leads/rf').assetLoadFailure).toBe(true);
  expect(clientErrorReport(new TypeError('Cannot read properties of undefined'), '/customer-service/leads/rf').assetLoadFailure).toBe(false);
});
