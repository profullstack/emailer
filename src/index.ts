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
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as { id?: string; error?: { message?: string } | string };
  if (!res.ok) {
    const msg =
      typeof data.error === 'string'
        ? data.error
        : (data.error as { message?: string })?.message ?? `HTTP ${res.status}`;
    return { error: msg };
  }
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
): Promise<Array<{ id?: string; error?: string }>> {
  const res = await fetch('https://api.resend.com/emails/batch', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(emails),
  });
  const data = (await res.json()) as {
    data?: Array<{ id?: string }>;
    error?: string | { message?: string };
  };
  if (!res.ok) {
    const msg =
      typeof data.error === 'string'
        ? data.error
        : (data.error as { message?: string })?.message ?? `HTTP ${res.status}`;
    return emails.map(() => ({ error: msg }));
  }
  return (data.data ?? []).map((r) => ({ id: r.id }));
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

        const results = await resendBatch(this.config.resendApiKey, emails);
        for (let j = 0; j < results.length; j++) {
          if (results[j].error) {
            result.failed++;
            result.errors.push({ email: batch[j], error: results[j].error! });
          } else {
            result.sent++;
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
