import * as Sentry from '@sentry/react'

const dsn = import.meta.env.VITE_SENTRY_DSN?.trim()
const environment = import.meta.env.VITE_SENTRY_ENVIRONMENT ?? 'development'

if (dsn) {
  Sentry.init({
    dsn,
    environment,
    release: import.meta.env.VITE_SENTRY_RELEASE ?? 'local',
    tracesSampleRate: environment === 'production' ? 0.2 : 1,
    integrations: [Sentry.browserTracingIntegration()],
    // Allow Sentry to connect browser fetch spans to the Flask route trace.
    // The matching CORS headers are configured in the backend.
    tracePropagationTargets: [
      'localhost',
      /^https:\/\/dark-forest-flask\.onrender\.com/,
    ],
    initialScope: {
      tags: { service: 'ui' },
    },
    sendDefaultPii: false,
  })
}
