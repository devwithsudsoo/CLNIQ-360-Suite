import pino from "pino";

/**
 * R6: no PHI in logs. Bodies and query strings are never logged; auth and identifying headers are redacted.
 * Log ids, never values.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: ["req.headers.authorization", "req.headers.cookie", "req.body", "res.body", "*.phone", "*.email", "*.name", "*.dob", "*.abha", "*.address"],
    remove: true
  },
  serializers: {
    req: (req: { method: string; routeOptions?: { url?: string }; url: string; id: string }) => ({ method: req.method, route: req.routeOptions?.url ?? req.url.split("?")[0], id: req.id })
  }
});
