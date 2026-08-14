export interface EmailerConfig {
  resendApiKey?: string;
  smtp?: {
    host: string;
    port: number;
    secure?: boolean;
    auth: { user: string; pass: string };
  };
  defaultFrom?: string;
}

export interface SendOptions {
  from?: string;
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  headers?: Record<string, string>;
  attachments?: Array<{ filename: string; content: string }>;
}

export interface BulkSendOptions {
  from?: string;
  to: string[];
  subject: string;
  html: string | ((recipient: string) => string);
  text?: string | ((recipient: string) => string);
  replyTo?: string;
  headers?: Record<string, string>;
  batchSize?: number;
  delayMs?: number;
}

export interface SendResult {
  sent: boolean;
  id?: string;
  error?: string;
}

export interface BulkSendResult {
  sent: number;
  failed: number;
  errors: Array<{ email: string; error: string }>;
}

/**
 * Resend reports failures as a flat `{ statusCode, name, message }` body, not
 * the `{ error: ... }` envelope. Reading only `error` turned every rejection
 * into a bare `HTTP 422`, which hides the one thing worth knowing — why.
 */
function resendError(
  body: unknown,
  status: number,
): string {
  const data = (body ?? {}) as {
    error?: string | { message?: string; name?: string };
    message?: string;
    name?: string;
  };
  const envelope = typeof data.error === 'string' ? data.error : data.error?.message;
  const flat = data.message;
  const detail = envelope ?? flat;
  if (!detail) return `HTTP ${status}`;
  const name = typeof data.error === 'object' ? data.error?.name : data.name;
  return name ? `${name}: ${detail}` : detail;
}

const RATE_LIMIT_RETRIES = 5;

/** How long to wait before a retry, preferring what the response tells us. */
function retryDelayMs(res: { headers?: { get(name: string): string | null } }, attempt: number): number {
  // An explicit `0` means "the window is already clear", which is different
  // from the header being absent — so check for the header before converting,
  // or `Number(null)` would silently read as a zero-second wait.
  for (const name of ['retry-after', 'ratelimit-reset']) {
    const raw = res.headers?.get(name);
    if (raw === null || raw === undefined || raw === '') continue;
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  }
  return Math.min(1000 * 2 ** attempt, 8000);
}

/**
 * Resend allows 10 requests a second, and a run of single-address retries
 * outpaces that on its own — measured at ~11.6/s. A 429'd recipient is a
 * recipient who never got the email, so wait out the window and try again
 * rather than reporting a rate limit as a delivery failure.
 */
async function resendFetch(apiKey: string, path: string, payload: unknown): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://api.resend.com${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (res.status !== 429 || attempt >= RATE_LIMIT_RETRIES) return res;
    await new Promise((r) => setTimeout(r, retryDelayMs(res, attempt)));
  }
}

async function resendSend(
  apiKey: string,
  payload: {
    from: string;
    to: string | string[];
    subject: string;
    html: string;
    text?: string;
    reply_to?: string;
    headers?: Record<string, string>;
    attachments?: Array<{ filename: string; content: string }>;
  },
): Promise<{ id?: string; error?: string }> {
  const res = await resendFetch(apiKey, '/emails', payload);
  const data = (await res.json()) as { id?: string };
  if (!res.ok) return { error: resendError(data, res.status) };
  return { id: data.id };
}

async function resendBatch(
  apiKey: string,
  emails: Array<{
    from: string;
    to: string;
    subject: string;
    html: string;
    text?: string;
    reply_to?: string;
    headers?: Record<string, string>;
  }>,
): Promise<
  { ok: true; results: Array<{ id?: string }> } | { ok: false; error: string; status: number }
> {
  const res = await resendFetch(apiKey, '/emails/batch', emails);
  const data = (await res.json()) as { data?: Array<{ id?: string }> };
  if (!res.ok) return { ok: false, error: resendError(data, res.status), status: res.status };
  return { ok: true, results: data.data ?? [] };
}

export class Emailer {
  private config: EmailerConfig;

  constructor(config: EmailerConfig) {
    this.config = config;
  }

  async send(opts: SendOptions): Promise<SendResult> {
    const from = opts.from ?? this.config.defaultFrom;
    if (!from) throw new Error('No from address configured');

    if (this.config.resendApiKey) {
      const result = await resendSend(this.config.resendApiKey, {
        from,
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
        reply_to: opts.replyTo,
        headers: opts.headers,
        attachments: opts.attachments,
      });
      if (result.error) return { sent: false, error: result.error };
      return { sent: true, id: result.id };
    }

    if (this.config.smtp) {
      throw new Error('SMTP send not implemented in this version; use resendApiKey');
    }

    throw new Error('No email provider configured');
  }

  async sendBulk(opts: BulkSendOptions): Promise<BulkSendResult> {
    const from = opts.from ?? this.config.defaultFrom;
    if (!from) throw new Error('No from address configured');
    if (!opts.to.length) return { sent: 0, failed: 0, errors: [] };

    const batchSize = opts.batchSize ?? 100;
    const delayMs = opts.delayMs ?? 0;
    const result: BulkSendResult = { sent: 0, failed: 0, errors: [] };

    if (this.config.resendApiKey) {
      for (let i = 0; i < opts.to.length; i += batchSize) {
        const batch = opts.to.slice(i, i + batchSize);
        const emails = batch.map((email) => ({
          from,
          to: email,
          subject: opts.subject,
          html: typeof opts.html === 'function' ? opts.html(email) : opts.html,
          text:
            opts.text !== undefined
              ? typeof opts.text === 'function'
                ? opts.text(email)
                : opts.text
              : undefined,
          reply_to: opts.replyTo,
          headers: opts.headers,
        }));

        const batchRes = await resendBatch(this.config.resendApiKey, emails);

        if (batchRes.ok) {
          for (let j = 0; j < batch.length; j++) {
            // Resend answers with one id per email, in order. A short array
            // means those recipients were dropped, so count them as failures
            // instead of silently shrinking the tally.
            if (batchRes.results[j]?.id) {
              result.sent++;
            } else {
              result.failed++;
              result.errors.push({ email: batch[j], error: 'Resend returned no id' });
            }
          }
        } else if (batchRes.status === 422) {
          // Resend validates a batch as a unit: one unusable address rejects
          // every email in the request. Retry singly so the good addresses
          // still go out and the error lands on the one that caused it.
          for (let j = 0; j < emails.length; j++) {
            const single = await resendSend(this.config.resendApiKey, emails[j]);
            if (single.error) {
              result.failed++;
              result.errors.push({ email: batch[j], error: single.error });
            } else {
              result.sent++;
            }
          }
        } else {
          // Auth, rate-limit or server errors apply to the whole request;
          // retrying one at a time would just repeat them 100 times.
          for (const email of batch) {
            result.failed++;
            result.errors.push({ email, error: batchRes.error });
          }
        }

        if (delayMs > 0 && i + batchSize < opts.to.length) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
      return result;
    }

    throw new Error('No email provider configured');
  }
}

export function createEmailer(config: EmailerConfig): Emailer {
  return new Emailer(config);
}
