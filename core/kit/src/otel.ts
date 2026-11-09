import { trace } from "@opentelemetry/api";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { NodeSDK } from "@opentelemetry/sdk-node";

/**
 * OpenTelemetry → Azure Monitor / Grafana via OTLP (blueprint §11). Every span carries tenant_id (tagTenant).
 * Telemetry is opt-in on native installs (packaging non-negotiables): pass enabled=false to skip.
 * DB statement text and HTTP bodies are not captured, so no PHI leaves through telemetry (R6).
 */
export const startTelemetry = (serviceName: string, enabled = Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT)): NodeSDK | null => {
  if (!enabled) return null;
  const sdk = new NodeSDK({
    serviceName,
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [
      getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-fs": { enabled: false },
        "@opentelemetry/instrumentation-pg": { enhancedDatabaseReporting: false, addSqlCommenterCommentToQueries: false },
        "@opentelemetry/instrumentation-http": { ignoreIncomingRequestHook: (req) => (req.url ?? "").startsWith("/health/") }
      })
    ]
  });
  sdk.start();
  return sdk;
};

export const tagTenant = (tenantId: string, moduleKey: string): void => {
  trace.getActiveSpan()?.setAttributes({ "clniq.tenant_id": tenantId, "clniq.module": moduleKey });
};
