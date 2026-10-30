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

// Detección de Electron (vía puente expuesto en preload)
const getLanderBridge = () => {
  return typeof window !== "undefined" && (window as any).landerBridge
    ? (window as any).landerBridge
    : null;
};

export function isElectronApp(): boolean {
  return Boolean(getLanderBridge());
}

export async function checkStreamDBStatus(): Promise<StreamDBStatus> {
  const bridge = getLanderBridge();
  if (bridge) {
    try {
      return await bridge.checkStatus();
    } catch (err: any) {
      return { service: "stopped", db_connected: false, error: err.message };
    }
  }

  return {
    service: "stopped",
    db_connected: false,
    error: "La sincronización directa con Lander DB solo está disponible en la aplicación de escritorio.",
  };
}

export async function saveStreamDBConfig(config: {
  host?: string;
  port?: string;
  database?: string;
  user?: string;
  password?: string;
}): Promise<{ ok: boolean; message?: string; error?: string }> {
  const bridge = getLanderBridge();
  if (bridge) {
    return await bridge.saveConfig(config);
  }
  return { ok: false, error: "Solo disponible en la aplicación de escritorio." };
}

export async function countSimulatorSessions(
  inicio: string,
  fin: string,
  anon = false
): Promise<SessionCountResult> {
  const bridge = getLanderBridge();
  if (!bridge) {
    throw new Error("Solo disponible en la aplicación de escritorio.");
  }
  const res = await bridge.countSessions({ inicio, fin, anon });
  if (!res.ok) throw new Error(res.error || "Error al contar sesiones");
  return { ...res, fecha_inicio: inicio, fecha_fin: fin };
}

export async function extractSimulatorSessions(
  inicio: string,
  fin: string,
  anon = false,
  limit = 200
): Promise<ExtractResult> {
  const bridge = getLanderBridge();
  if (!bridge) {
    throw new Error("Solo disponible en la aplicación de escritorio.");
  }
  const res = await bridge.extractSessions({ inicio, fin, anon, limit });
  if (!res.ok) throw new Error(res.error || "Error al extraer sesiones");
  return res;
}
