import { useState, useEffect, useRef } from "react";
import {
  isElectronApp,
  checkStreamDBStatus,
  getLatestSimulatorSessionId,
  extractNewSimulatorSessions,
  type ExtractedSession,
} from "./streamdbClient";
import { parseReport, type ParsedReport, type Mark } from "./parse";
import { saveEvaluation, type EvaluationView } from "./db";
import { loadCatalog } from "./catalogStore";
import { loadExercises, phaseForExercise } from "./exercises";
import { getActiveGroupId, getGroup, type GroupDoc } from "./groups";
import { classify } from "./catalog";

export interface PendingAuditItem {
  id: number;
  driver: string;
  date: string;
  exercise: string;
  phase: number;
  fileName: string;
  score: number;
  errorCount: number;
  criticalCount: number;
  accidents: string[];
  report: ParsedReport;
  timestamp: number;
  savedDocId?: string;
  audited?: boolean;
}

const STORAGE_KEY_LAST_ID = "tracksim_autosync_last_id";
const STORAGE_KEY_PENDING = "tracksim_autosync_pending_queue";
const STORAGE_KEY_ENABLED = "tracksim_autosync_enabled";

export function loadPendingQueue(): PendingAuditItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PENDING);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

export function savePendingQueue(items: PendingAuditItem[]) {
  try {
    localStorage.setItem(STORAGE_KEY_PENDING, JSON.stringify(items));
  } catch {}
}

export function isAutoSyncActive(): boolean {
  return localStorage.getItem(STORAGE_KEY_ENABLED) === "true";
}

export function setAutoSyncActive(enabled: boolean) {
  localStorage.setItem(STORAGE_KEY_ENABLED, enabled ? "true" : "false");
}

export function getLastProcessedSessionId(): number {
  return parseInt(localStorage.getItem(STORAGE_KEY_LAST_ID) || "0", 10);
}

export function setLastProcessedSessionId(id: number) {
  localStorage.setItem(STORAGE_KEY_LAST_ID, String(id));
}

export interface UseAutoSyncOptions {
  userEmail?: string;
  userName?: string;
  pollIntervalMs?: number; // default 10000 (10s)
  onNewSessionAudited?: (item: PendingAuditItem) => void;
}

export function useAutoSync(options: UseAutoSyncOptions = {}) {
  const { userEmail = "", userName = "", pollIntervalMs = 10000, onNewSessionAudited } = options;
  const [enabled, setEnabled] = useState<boolean>(() => isAutoSyncActive());
  const [isPolling, setIsPolling] = useState(false);
  const [queue, setQueue] = useState<PendingAuditItem[]>(() => loadPendingQueue());
  const [dbConnected, setDbConnected] = useState<boolean | null>(null);
  const [activeGroup, setActiveGroup] = useState<GroupDoc | null>(null);
  const [lastCheckTime, setLastCheckTime] = useState<number>(Date.now());
  const [recentNotification, setRecentNotification] = useState<PendingAuditItem | null>(null);

  const isPollingRef = useRef(false);
  const queueRef = useRef(queue);
  queueRef.current = queue;

  // Actualizar estado del grupo activo
  const checkGroup = async () => {
    const grpId = getActiveGroupId();
    if (grpId) {
      try {
        const g = await getGroup(grpId);
        if (g && g.status === "open") {
          setActiveGroup(g);
          return g;
        }
      } catch {}
    }
    setActiveGroup(null);
    return null;
  };

  useEffect(() => {
    checkGroup();
  }, []);

  const toggleAutoSync = async () => {
    const next = !enabled;
    setEnabled(next);
    setAutoSyncActive(next);

    if (next) {
      // Si activamos por primera vez y no hay lastId guardado, inicializar con el MAX(id) actual
      // para no reimportar todo el pasado histórico por accidente.
      const lastId = getLastProcessedSessionId();
      if (!lastId) {
        try {
          const maxId = await getLatestSimulatorSessionId();
          if (maxId > 0) {
            setLastProcessedSessionId(maxId);
          }
        } catch {}
      }
      // Verificar conexión inicial
      checkStreamDBStatus().then((st) => setDbConnected(st.db_connected)).catch(() => setDbConnected(false));
    }
  };

  const removeQueueItem = (id: number) => {
    const updated = queueRef.current.filter((item) => item.id !== id);
    setQueue(updated);
    savePendingQueue(updated);
  };

  const clearQueue = () => {
    setQueue([]);
    savePendingQueue([]);
  };

  const markAudited = (id: number) => {
    const updated = queueRef.current.map((item) => (item.id === id ? { ...item, audited: true } : item));
    setQueue(updated);
    savePendingQueue(updated);
  };

  // Sonido de notificación suave al terminar un ejercicio
  const playChime = () => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15); // A5
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.45);
    } catch {}
  };

  useEffect(() => {
    if (!enabled || !isElectronApp()) return;

    let timer: NodeJS.Timeout | null = null;
    let isCancelled = false;

    const poll = async () => {
      if (isPollingRef.current) return;
      isPollingRef.current = true;
      setIsPolling(true);

      try {
        const status = await checkStreamDBStatus();
        setDbConnected(status.db_connected);
        setLastCheckTime(Date.now());

        if (!status.db_connected) {
          isPollingRef.current = false;
          setIsPolling(false);
          return;
        }

        const currentGroup = await checkGroup();
        if (!currentGroup) {
          // Si no hay grupo activo abierto, no procesamos ingesta
          isPollingRef.current = false;
          setIsPolling(false);
          return;
        }

        const lastId = getLastProcessedSessionId();
        const res = await extractNewSimulatorSessions(lastId, false, 5);

        if (!isCancelled && res.ok && res.sessions && res.sessions.length > 0) {
          await Promise.all([
            loadCatalog(false, currentGroup.id),
            loadExercises(false, currentGroup.id),
          ]);

          let highestId = lastId;
          const newItems: PendingAuditItem[] = [];

          for (const s of res.sessions) {
            if (s.id > highestId) highestId = s.id;
            if (s.error || !s.csv) continue;

            try {
              const activeGrpId = currentGroup.id;
              const report = parseReport(s.csv, activeGrpId);
              const phase = phaseForExercise(report.exercise, activeGrpId) || 1;

              const saveStatus = await saveEvaluation(
                phase,
                s.filename,
                report,
                {
                  name: userName || "Auto-Sync Lander",
                  email: userEmail,
                },
                activeGrpId
              );

              // Identificar accidentes críticos detectados
              const criticalAccidents: string[] = [];
              for (const m of report.marks) {
                if (m.type === "ERROR" && !m.ignored) {
                  const cl = classify(m.description, activeGrpId);
                  if (cl.severity === "CRITICO") {
                    criticalAccidents.push(m.description);
                  }
                }
              }

              const pendingItem: PendingAuditItem = {
                id: s.id,
                driver: report.driver,
                date: report.date,
                exercise: report.exercise || report.unit,
                phase,
                fileName: s.filename,
                score: report.score,
                errorCount: report.errorCount,
                criticalCount: criticalAccidents.length,
                accidents: criticalAccidents,
                report,
                timestamp: Date.now(),
                savedDocId: `${activeGrpId}_f${phase}_${s.filename.replace(/[^\w.-]+/g, "_")}`,
                audited: false,
              };

              newItems.push(pendingItem);
            } catch (pErr) {
              console.error("Error parseando sesión en Auto-Sync:", pErr);
            }
          }

          if (highestId > lastId) {
            setLastProcessedSessionId(highestId);
          }

          if (newItems.length > 0) {
            playChime();
            const updated = [...queueRef.current, ...newItems];
            setQueue(updated);
            savePendingQueue(updated);
            const latest = newItems[newItems.length - 1];
            setRecentNotification(latest);
            if (onNewSessionAudited) onNewSessionAudited(latest);
          }
        }
      } catch (err) {
        console.warn("Fallo durante ciclo de Auto-Sync:", err);
      } finally {
        isPollingRef.current = false;
        setIsPolling(false);
      }
    };

    // Ejecución inicial rápida al habilitar
    poll();
    timer = setInterval(poll, pollIntervalMs);

    return () => {
      isCancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [enabled, pollIntervalMs, userName, userEmail]);

  return {
    enabled,
    toggleAutoSync,
    isPolling,
    dbConnected,
    queue,
    activeGroup,
    lastCheckTime,
    recentNotification,
    setRecentNotification,
    removeQueueItem,
    clearQueue,
    markAudited,
    isElectron: isElectronApp(),
  };
}

