async function resendSend(apiKey, payload) {
    const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    });
    const data = (await res.json());
    if (!res.ok) {
        const msg = typeof data.error === 'string'
            ? data.error
            : data.error?.message ?? `HTTP ${res.status}`;
        return { error: msg };
    }
    return { id: data.id };
}
async function resendBatch(apiKey, emails) {
    const res = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(emails),
    });
    const data = (await res.json());
    if (!res.ok) {
        const msg = typeof data.error === 'string'
            ? data.error
            : data.error?.message ?? `HTTP ${res.status}`;
        return emails.map(() => ({ error: msg }));
    }
    return (data.data ?? []).map((r) => ({ id: r.id }));
}
export class Emailer {
    constructor(config) {
        this.config = config;
    }
    async send(opts) {
        const from = opts.from ?? this.config.defaultFrom;
        if (!from)
            throw new Error('No from address configured');
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
            if (result.error)
                return { sent: false, error: result.error };
            return { sent: true, id: result.id };
        }
        if (this.config.smtp) {
            throw new Error('SMTP send not implemented in this version; use resendApiKey');
        }
        throw new Error('No email provider configured');
    }
    async sendBulk(opts) {
        const from = opts.from ?? this.config.defaultFrom;
        if (!from)
            throw new Error('No from address configured');
        if (!opts.to.length)
            return { sent: 0, failed: 0, errors: [] };
        const batchSize = opts.batchSize ?? 100;
        const delayMs = opts.delayMs ?? 0;
        const result = { sent: 0, failed: 0, errors: [] };
        if (this.config.resendApiKey) {
            for (let i = 0; i < opts.to.length; i += batchSize) {
                const batch = opts.to.slice(i, i + batchSize);
                const emails = batch.map((email) => ({
                    from,
                    to: email,
                    subject: opts.subject,
                    html: typeof opts.html === 'function' ? opts.html(email) : opts.html,
                    text: opts.text !== undefined
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
                        result.errors.push({ email: batch[j], error: results[j].error });
                    }
                    else {
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
export function createEmailer(config) {
    return new Emailer(config);
}
//# sourceMappingURL=index.js.map