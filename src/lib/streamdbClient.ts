export type StreamDBStatus = {
  service: "running" | "stopped";
  db_connected: boolean;
  config?: {
    host?: string;
    port?: string;
    database?: string;
    user?: string;
  };
  error?: string;
};

export type SessionCountResult = {
  ok: boolean;
  total: number;
  min_date?: string | null;
  max_date?: string | null;
  fecha_inicio: string;
  fecha_fin: string;
  error?: string;
};

export type ExtractedSession = {
  id: number;
  driver: string;
  date: string;
  filename: string;
  csv?: string;
  error?: string;
};

export type ExtractResult = {
  ok: boolean;
  extracted: number;
  sessions: ExtractedSession[];
  error?: string;
};

const STREAMDB_URL = "http://127.0.0.1:5005";

export async function checkStreamDBStatus(): Promise<StreamDBStatus> {
  try {
    const res = await fetch(`${STREAMDB_URL}/api/status`, {
      method: "GET",
      signal: AbortSignal.timeout(3500),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    return {
      service: "stopped",
      db_connected: false,
      error: "El servicio local de TrackSIM no está activo o no responde en el puerto 5005.",
    };
  }
}

export async function saveStreamDBConfig(config: {
  host?: string;
  port?: string;
  database?: string;
  user?: string;
  password?: string;
}): Promise<{ ok: boolean; message?: string; error?: string }> {
  try {
    const res = await fetch(`${STREAMDB_URL}/api/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    return await res.json();
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function countSimulatorSessions(
  startDate: string,
  endDate: string,
  includeAnon: boolean = false
): Promise<SessionCountResult> {
  const query = new URLSearchParams({
    inicio: startDate,
    fin: endDate,
    anon: String(includeAnon),
  });
  const res = await fetch(`${STREAMDB_URL}/api/sessions/count?${query.toString()}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return await res.json();
}

export async function extractSimulatorSessions(
  startDate: string,
  endDate: string,
  includeAnon: boolean = false
): Promise<ExtractResult> {
  const res = await fetch(`${STREAMDB_URL}/api/sessions/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      inicio: startDate,
      fin: endDate,
      anon: includeAnon,
    }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return await res.json();
}
