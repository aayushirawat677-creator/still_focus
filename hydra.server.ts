// HydraDB raw HTTP client. Server-only — must never be imported by browser code.
// Docs: https://docs.hydradb.com/AGENTS.md
const BASE_URL = "https://api.hydradb.com";

export const HYDRA_TENANT_ID = "still_app";

// In-memory execution-log ring buffer (per server instance). The /app debug
// panel pulls this via getExecutionLog() so judges can see HydraDB activity.
type LogEntry = {
  ts: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  requestId?: string;
  summary?: string;
  error?: string;
};
const LOG_MAX = 100;
const _log: LogEntry[] = [];
export function getExecutionLog(): LogEntry[] {
  return _log.slice().reverse();
}
function pushLog(e: LogEntry) {
  _log.push(e);
  if (_log.length > LOG_MAX) _log.shift();
}

async function hydraFetch<T = unknown>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown,
  summary?: string,
): Promise<T> {
  const apiKey = process.env.HYDRA_DB_API_KEY;
  if (!apiKey) throw new Error("HYDRA_DB_API_KEY is not configured");

  const url = `${BASE_URL}${path}`;
  const started = Date.now();
  let status = 0;
  let requestId: string | undefined;
  try {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "API-Version": "2",
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    status = res.status;
    const text = await res.text();
    let parsed: any = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* keep null */ }
    requestId = parsed?.meta?.request_id;
    if (!res.ok) {
      const code = parsed?.error?.code || parsed?.error || res.statusText;
      const msg = parsed?.error?.message || text || `HTTP ${res.status}`;
      const err = new Error(`HydraDB ${method} ${path} → ${res.status} ${code}: ${msg}`);
      pushLog({ ts: new Date().toISOString(), method, path, status, durationMs: Date.now() - started, requestId, summary, error: err.message });
      throw err;
    }
    pushLog({ ts: new Date().toISOString(), method, path, status, durationMs: Date.now() - started, requestId, summary });
    // Core endpoints wrap payload in { success, data, error, meta }
    return (parsed?.data ?? parsed) as T;
  } catch (e: any) {
    if (status === 0) {
      pushLog({ ts: new Date().toISOString(), method, path, status, durationMs: Date.now() - started, summary, error: String(e?.message ?? e) });
    }
    throw e;
  }
}

// --- Tenant lifecycle -------------------------------------------------------

let _tenantReady: Promise<void> | null = null;
export async function ensureTenant(): Promise<void> {
  if (_tenantReady) return _tenantReady;
  _tenantReady = (async () => {
    // Create (idempotent — swallow 409 / already exists)
    try {
      await hydraFetch("POST", "/tenants", { tenant_id: HYDRA_TENANT_ID }, "ensureTenant.create");
    } catch (e: any) {
      const m = String(e?.message ?? "");
      if (!/409|ALREADY_EXISTS|already exists/i.test(m)) throw e;
    }
    // Poll until ready (bounded — avoid hanging requests)
    for (let i = 0; i < 12; i++) {
      try {
        const status: any = await hydraFetch("GET", `/tenants/status?tenant_id=${encodeURIComponent(HYDRA_TENANT_ID)}`, undefined, "ensureTenant.status");
        if (status?.infra?.ready_for_ingestion) return;
      } catch { /* retry */ }
      await new Promise((r) => setTimeout(r, 1500));
    }
  })();
  return _tenantReady;
}

// --- Ingest -----------------------------------------------------------------

export type MemoryKind = "task" | "task_complete" | "block" | "park";

export interface IngestMemoryInput {
  subTenantId: string;
  id: string;
  title?: string;
  text: string;
  kind: MemoryKind;
  extra?: Record<string, unknown>;
  infer?: boolean;
}

export async function ingestMemory(input: IngestMemoryInput) {
  await ensureTenant();
  const memories = [
    {
      id: input.id,
      title: input.title,
      text: input.text,
      infer: input.infer ?? false,
      additional_metadata: {
        kind: input.kind,
        created_at: new Date().toISOString(),
        ...(input.extra ?? {}),
      },
    },
  ];
  return hydraFetch<{ results: Array<{ id: string }> }>(
    "POST",
    "/context/ingest",
    {
      type: "memory",
      tenant_id: HYDRA_TENANT_ID,
      sub_tenant_id: input.subTenantId,
      memories: JSON.stringify(memories),
    },
    `ingest:${input.kind}`,
  );
}

// --- List -------------------------------------------------------------------

export interface ListMemoriesInput {
  subTenantId: string;
  kind?: MemoryKind;
  pageSize?: number;
}
export interface MemorySource {
  id: string;
  title?: string;
  type?: string;
  timestamp?: string;
  metadata?: Record<string, unknown>;
  additional_metadata?: Record<string, unknown>;
}

export async function listMemories(input: ListMemoriesInput): Promise<MemorySource[]> {
  await ensureTenant();
  const body: any = {
    tenant_id: HYDRA_TENANT_ID,
    sub_tenant_id: input.subTenantId,
    type: "memory",
    page: 1,
    page_size: Math.min(input.pageSize ?? 50, 100),
  };
  if (input.kind) {
    body.filters = { additional_metadata: { kind: input.kind } };
  }
  const data = await hydraFetch<any>("POST", "/context/list", body, `list:${input.kind ?? "all"}`);
  // Response shape: { sources: [...] } or similar; be defensive
  const sources: MemorySource[] = data?.sources ?? data?.items ?? data?.results ?? [];
  return sources;
}

// --- Query (semantic) -------------------------------------------------------

export async function queryMemory(subTenantId: string, query: string, maxResults = 5) {
  await ensureTenant();
  return hydraFetch<{ chunks: Array<{ chunk_content: string; source_title?: string; relevancy_score?: number; additional_metadata?: any }> }>(
    "POST",
    "/query",
    {
      tenant_id: HYDRA_TENANT_ID,
      sub_tenant_id: subTenantId,
      query,
      type: "memory",
      query_by: "hybrid",
      mode: "fast",
      max_results: maxResults,
      graph_context: false,
    },
    `query:${query.slice(0, 30)}`,
  );
}
