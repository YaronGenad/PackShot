/**
 * Sentry wrapper for the browser — lazy-loads @sentry/react so the module is optional.
 * If not installed or VITE_SENTRY_DSN is not set, falls through to a no-op.
 */

export async function initSentryClient(): Promise<void> {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;

  try {
    // Hide the import from Vite's static resolver so the build doesn't fail
    // when @sentry/react isn't installed. The string is reassembled at runtime.
    const pkg = ['@sentry', 'react'].join('/');
    // @ts-ignore — optional peer
    const Sentry = await import(/* @vite-ignore */ pkg);
    Sentry.init({
      dsn,
      environment: import.meta.env.MODE,
      tracesSampleRate: 0.1,
    });
    console.log('[sentry-client] initialized');
  } catch (_err) {
    console.warn('[sentry-client] @sentry/react not installed — skipping init.');
  }
}
