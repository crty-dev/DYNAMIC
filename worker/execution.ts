/**
 * The execution context of the request that is being handled.
 *
 * The mail adapter sends the message in the background (so the response time
 * does not reveal whether an account exists). On Workers that needs the
 * execution context of the very request that triggered the mail, so it is
 * remembered per request object.
 */

/** The part of the execution context the mailer needs. */
export interface BackgroundRunner {
  waitUntil(promise: Promise<unknown>): void;
}

const contexts = new WeakMap<Request, BackgroundRunner>();

export function rememberExecutionContext(
  request: Request,
  context: BackgroundRunner,
): void {
  contexts.set(request, context);
}

export function executionContextFor(request?: Request): BackgroundRunner | undefined {
  return request ? contexts.get(request) : undefined;
}
