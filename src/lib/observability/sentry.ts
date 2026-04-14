/**
 * Sentry wrapper — loads @sentry/node lazily so the module is optional.
 * Without `npm install @sentry/node`, the server still starts; Sentry just stays idle.
 *
 * To enable: `npm install @sentry/node` and set SENTRY_DSN.
 */

import type { Express, Request, Response, NextFunction } from 'express';

type SentryModule = {
  init: (opts: any) => void;
  Handlers: {
    requestHandler: () => (req: Request, res: Response, next: NextFunction) => void;
    errorHandler: () => (err: any, req: Request, res: Response, next: NextFunction) => void;
  };
  captureException: (err: any) => void;
};

let sentryModule: SentryModule | null = null;
let initialized = false;

export async function initSentry(): Promise<void> {
  if (initialized) return;
  initialized = true;

  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    return; // No DSN = Sentry disabled (fine for dev)
  }

  try {
    // Reassembled at runtime so bundlers don't try to resolve the optional peer at build time
    const pkg = ['@sentry', 'node'].join('/');
    // @ts-ignore — optional peer
    const mod = await import(pkg);
    sentryModule = mod as unknown as SentryModule;
    sentryModule.init({
      dsn,
      environment: process.env.NODE_ENV || 'development',
      tracesSampleRate: 0.1,
    });
    console.log('[sentry] initialized');
  } catch (err: any) {
    console.warn('[sentry] @sentry/node not installed — skipping init. Run `npm install @sentry/node` to enable.');
  }
}

/** Attach Sentry request + error middleware to the Express app. No-ops if Sentry isn't loaded. */
export function attachSentryMiddleware(app: Express, position: 'early' | 'error'): void {
  if (!sentryModule) return;
  if (position === 'early') {
    app.use(sentryModule.Handlers.requestHandler());
  } else {
    app.use(sentryModule.Handlers.errorHandler());
  }
}

/** Manual exception capture (for async contexts not covered by middleware). */
export function captureException(err: any): void {
  if (!sentryModule) return;
  try {
    sentryModule.captureException(err);
  } catch (_) { /* ignore */ }
}

// Exported for places that want direct access to the module (null if not loaded)
export const Sentry = new Proxy({} as SentryModule, {
  get(_target, prop) {
    if (!sentryModule) {
      if (prop === 'captureException') return () => {};
      if (prop === 'Handlers') return { requestHandler: () => (_r: any, _s: any, n: any) => n(), errorHandler: () => (e: any, _r: any, _s: any, n: any) => n(e) };
      return undefined;
    }
    return (sentryModule as any)[prop];
  },
});
