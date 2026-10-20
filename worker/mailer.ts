import { config, type Bindings } from "./env";

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export type MailResult = { delivered: boolean; provider: "console" | "http" | "none"; error?: string };

/**
 * Local development outbox.
 *
 * In development the mails are printed to the Worker log and kept in a small
 * in-memory ring buffer that `GET /api/dev/mailbox` can read. The route only
 * exists when DEV_MODE=1, so nothing is exposed in production.
 */
const outbox: (MailMessage & { sentAt: number })[] = [];
const MAX_OUTBOX = 25;

export function readOutbox(): (MailMessage & { sentAt: number })[] {
  // oxlint-disable-next-line unicorn/no-array-reverse
  return [...outbox].reverse();
}

export function clearOutbox(): void {
  outbox.length = 0;
}

/**
 * Transactional mail adapter.
 *
 * The provider is pluggable through environment variables so the project
 * never depends on a paid service:
 *   MAIL_PROVIDER_URL   e.g. https://api.resend.com/emails
 *   MAIL_PROVIDER_TOKEN bearer token of that provider
 *   MAIL_FROM           sender address
 *
 * Without a provider the mail is only logged (development) and never sent.
 */
export async function sendMail(env: Bindings, message: MailMessage): Promise<MailResult> {
  const { mail, isDev } = config(env);

  if (isDev) {
    outbox.push({ ...message, sentAt: Date.now() });
    if (outbox.length > MAX_OUTBOX) outbox.shift();
    console.log(
      `[mail] to=${message.to} subject=${message.subject}\n${message.text}\n--- end of mail (dev outbox) ---`,
    );
    return { delivered: false, provider: "console" };
  }

  if (!mail.providerUrl || !mail.providerToken) {
    // No provider configured: never fail the request, but say so in the log.
    console.warn(
      "[mail] MAIL_PROVIDER_URL / MAIL_PROVIDER_TOKEN are not set - the message was not sent.",
    );
    return { delivered: false, provider: "none" };
  }

  try {
    const response = await fetch(mail.providerUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${mail.providerToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: mail.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error("[mail] provider error", response.status, body.slice(0, 200));
      return { delivered: false, provider: "http", error: `provider_error_${response.status}` };
    }
    return { delivered: true, provider: "http" };
  } catch (error) {
    console.error("[mail] provider request failed", error);
    return { delivered: false, provider: "http", error: "provider_unreachable" };
  }
}
