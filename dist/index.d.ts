export interface EmailerConfig {
    resendApiKey?: string;
    smtp?: {
        host: string;
        port: number;
        secure?: boolean;
        auth: {
            user: string;
            pass: string;
        };
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
    attachments?: Array<{
        filename: string;
        content: string;
    }>;
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
    errors: Array<{
        email: string;
        error: string;
    }>;
}
export declare class Emailer {
    private config;
    constructor(config: EmailerConfig);
    send(opts: SendOptions): Promise<SendResult>;
    sendBulk(opts: BulkSendOptions): Promise<BulkSendResult>;
}
export declare function createEmailer(config: EmailerConfig): Emailer;
//# sourceMappingURL=index.d.ts.map