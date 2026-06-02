# @profullstack/emailer

Mass emailer for Profullstack apps. Wraps [Resend](https://resend.com)'s batch API with a simple interface for sending bulk emails. Zero runtime dependencies.

## Installation

```bash
npm install @profullstack/emailer
```

## Usage

```typescript
import { createEmailer } from '@profullstack/emailer';

const emailer = createEmailer({
  resendApiKey: process.env.RESEND_API_KEY,
});
```

### Send a single email

```typescript
const result = await emailer.send({
  from: 'App <noreply@example.com>',
  to: 'user@example.com',
  subject: 'Hello',
  html: '<p>Hello world</p>',
  text: 'Hello world',
});

// { sent: true, id: 're_...' }
```

### Send a bulk email

```typescript
const result = await emailer.sendBulk({
  from: 'App <noreply@example.com>',
  to: ['alice@example.com', 'bob@example.com', ...],
  subject: 'Big announcement',
  html: '<p>Something exciting</p>',
  text: 'Something exciting',
  batchSize: 100,  // default: 100 (Resend's batch limit)
  delayMs: 500,    // optional delay between batches
});

// { sent: 2, failed: 0, errors: [] }
```

### Per-recipient personalization

Pass a function for `html` or `text` to customize per recipient:

```typescript
await emailer.sendBulk({
  from: 'App <noreply@example.com>',
  to: emails,
  subject: 'Your weekly digest',
  html: (email) => `<p>Hi ${email}, here's your digest…</p>`,
});
```

## API

### `createEmailer(config)`

| Option | Type | Description |
|---|---|---|
| `resendApiKey` | `string` | Resend API key (required) |
| `defaultFrom` | `string` | Default `from` address used when not provided per-call |

### `emailer.send(opts)`

| Option | Type | Description |
|---|---|---|
| `from` | `string` | Sender (falls back to `defaultFrom`) |
| `to` | `string` | Recipient |
| `subject` | `string` | Subject line |
| `html` | `string` | HTML body |
| `text` | `string?` | Plain-text body |
| `replyTo` | `string?` | Reply-to address |
| `headers` | `Record<string,string>?` | Extra headers (e.g. `List-Unsubscribe`) |
| `attachments` | `Array<{filename,content}>?` | Base64-encoded attachments |

Returns `{ sent: boolean, id?: string, error?: string }`.

### `emailer.sendBulk(opts)`

Same as `send` but `to` is `string[]`, `html`/`text` can be a `(email: string) => string` function, plus:

| Option | Type | Default | Description |
|---|---|---|---|
| `batchSize` | `number` | `100` | Recipients per Resend batch call |
| `delayMs` | `number` | `0` | Delay between batch calls |

Returns `{ sent: number, failed: number, errors: Array<{email, error}> }`.

## License

MIT © [Profullstack Inc](https://profullstack.com)
