import test from 'node:test';
import assert from 'node:assert/strict';

import { createEmailer } from '../dist/index.js';

const BATCH_URL = 'https://api.resend.com/emails/batch';
const SEND_URL = 'https://api.resend.com/emails';

/** Stand in for fetch, answering each URL from a queue of canned responses. */
function stubFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    const { status, json, headers = {} } = handler(url, body);
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name) => headers[name] ?? null },
      json: async () => json,
    };
  };
  return calls;
}

const emailer = () =>
  createEmailer({ resendApiKey: 're_test', defaultFrom: 'Test <hello@example.test>' });

const bulk = (to) => ({ to, subject: 's', html: '<p>h</p>', text: 't' });

test('a batch-wide 422 retries singly so one bad address only fails itself', async () => {
  const calls = stubFetch((url, body) => {
    if (url === BATCH_URL) {
      return {
        status: 422,
        json: {
          statusCode: 422,
          name: 'validation_error',
          message: 'Invalid `to` field. Please use our testing email address instead of domains like `example.com`.',
        },
      };
    }
    // Singly, only the example.com address is rejected.
    return body.to.endsWith('@example.com')
      ? { status: 422, json: { statusCode: 422, name: 'validation_error', message: 'Invalid `to` field.' } }
      : { status: 200, json: { id: `id-${body.to}` } };
  });

  const res = await emailer().sendBulk(bulk(['a@real.test', 'plus-e2e@example.com', 'b@real.test']));

  assert.equal(res.sent, 2, 'the two good addresses still go out');
  assert.deepEqual(res.errors.map((e) => e.email), ['plus-e2e@example.com']);
  assert.equal(res.failed, 1);
  assert.equal(calls.filter((c) => c.url === SEND_URL).length, 3, 'each address retried once');
});

test('the real Resend message survives instead of a bare HTTP 422', async () => {
  stubFetch(() => ({
    status: 422,
    json: { statusCode: 422, name: 'validation_error', message: 'Invalid `to` field.' },
  }));

  const res = await emailer().sendBulk(bulk(['x@example.com']));

  assert.equal(res.errors[0].error, 'validation_error: Invalid `to` field.');
});

test('a non-422 batch failure is not retried one address at a time', async () => {
  const calls = stubFetch(() => ({
    status: 401,
    json: { statusCode: 401, name: 'restricted_api_key', message: 'This API key is restricted.' },
  }));

  const res = await emailer().sendBulk(bulk(['a@real.test', 'b@real.test']));

  assert.equal(res.failed, 2);
  assert.equal(res.errors[0].error, 'restricted_api_key: This API key is restricted.');
  assert.equal(calls.filter((c) => c.url === SEND_URL).length, 0, 'no per-address retry storm');
});

test('a rate-limited request is waited out, not reported as a delivery failure', async () => {
  let seen = 0;
  const calls = stubFetch(() => {
    seen++;
    // 429 twice, then succeed — the sender must not give up on the recipient.
    return seen <= 2
      ? { status: 429, json: { message: 'Too many requests' }, headers: { 'ratelimit-reset': '0' } }
      : { status: 200, json: { data: [{ id: 'ok' }] } };
  });

  const res = await emailer().sendBulk(bulk(['a@real.test']));

  assert.equal(res.sent, 1);
  assert.equal(res.failed, 0);
  assert.equal(calls.length, 3, 'retried until the window cleared');
});

test('rate limiting gives up eventually rather than looping forever', async () => {
  const calls = stubFetch(() => ({
    status: 429,
    json: { message: 'Too many requests' },
    headers: { 'ratelimit-reset': '0' },
  }));

  const res = await emailer().sendBulk(bulk(['a@real.test']));

  assert.equal(res.failed, 1);
  assert.match(res.errors[0].error, /Too many requests/);
  assert.equal(calls.length, 6, 'initial attempt plus RATE_LIMIT_RETRIES');
});

test('a short data array counts the dropped recipients as failures', async () => {
  stubFetch(() => ({ status: 200, json: { data: [{ id: 'only-one' }] } }));

  const res = await emailer().sendBulk(bulk(['a@real.test', 'b@real.test']));

  assert.equal(res.sent, 1);
  assert.equal(res.failed, 1);
  assert.equal(res.errors[0].email, 'b@real.test');
});
