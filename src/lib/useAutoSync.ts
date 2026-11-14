import { useState, useEffect, useRef } from "react";
import {
  isElectronApp,
  checkStreamDBStatus,
  getLatestSimulatorSessionId,
  extractNewSimulatorSessions,
} from "./streamdbClient";
import { parseReport, type ParsedReport } from "./parse";
import { notifyEvaluationsUpdated, saveEvaluation, type EvaluationDoc } from "./db";
import { getDb, safeGetDocs } from "./firebase";
import { collection, query, where } from "firebase/firestore";
import { loadCatalog } from "./catalogStore";
import { loadExercises, phaseForExercise, resolveExerciseEnvironment } from "./exercises";
import { getActiveGroupId, getGroup, type GroupDoc } from "./groups";
import { classify } from "./catalog";
import { analyzePacing, computeGroupBenchmarks, type ExerciseBenchmark, type PacingAnalysis } from "./pacingBenchmark";

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
  pacing?: PacingAnalysis;
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
  onUncatalogedErrors?: (groupId: string, groupName: string, errors: string[]) => Promise<void>;
}

export function useAutoSync(options: UseAutoSyncOptions = {}) {
  const { userEmail = "", userName = "", pollIntervalMs = 10000, onNewSessionAudited, onUncatalogedErrors } = options;
  const [enabled, setEnabled] = useState<boolean>(() => isAutoSyncActive());
  const [isPolling, setIsPolling] = useState(false);
  const [queue, setQueue] = useState<PendingAuditItem[]>(() => loadPendingQueue());
  const [dbConnected, setDbConnected] = useState<boolean | null>(null);
  const [activeGroup, setActiveGroup] = useState<GroupDoc | null>(null);
  const [lastCheckTime, setLastCheckTime] = useState<number>(() => Date.now());
  const [recentNotification, setRecentNotification] = useState<PendingAuditItem | null>(null);

  const isPollingRef = useRef(false);
  const queueRef = useRef(queue);
  const onUncatalogedErrorsRef = useRef(onUncatalogedErrors);
  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);
  useEffect(() => {
    onUncatalogedErrorsRef.current = onUncatalogedErrors;
  }, [onUncatalogedErrors]);

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

  const updateQueueItem = (id: number, updater: (prev: PendingAuditItem) => PendingAuditItem) => {
    const updated = queueRef.current.map((item) => (item.id === id ? updater(item) : item));
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

          // Cargar evaluaciones existentes del grupo para calcular benchmarks de ritmo y duración
          let groupBenchmarks: Map<string, ExerciseBenchmark> | undefined;
          try {
            const groupQ = query(collection(getDb(), "evaluations"), where("groupId", "==", currentGroup.id));
            const groupSnap = await safeGetDocs(groupQ);
            if (!groupSnap.empty) {
              const groupRawDocs = groupSnap.docs.map((d) => d.data() as EvaluationDoc);
              groupBenchmarks = computeGroupBenchmarks(groupRawDocs);
            }
          } catch {}

          let highestId = lastId;
          const newItems: PendingAuditItem[] = [];
          const reviewedUncataloged = new Set<string>();

          for (const s of res.sessions) {
            if (s.id > highestId) highestId = s.id;
            if (s.error || !s.csv) continue;

            try {
              const activeGrpId = currentGroup.id;
              let report = parseReport(s.csv, activeGrpId);
              const uncatalogedToReview = report.uncataloged.filter((description) => !reviewedUncataloged.has(description));
              if (uncatalogedToReview.length > 0) {
                uncatalogedToReview.forEach((description) => reviewedUncataloged.add(description));
                await onUncatalogedErrorsRef.current?.(activeGrpId, currentGroup.name, uncatalogedToReview);
                await loadCatalog(true, activeGrpId);
                report = parseReport(s.csv, activeGrpId);
              }
              const phase = phaseForExercise(report.exercise, activeGrpId) || 1;

              await saveEvaluation(
                phase,
                s.filename,
                report,
                {
                  name: userName || "Auto-Sync Lander",
                  email: userEmail,
                },
                activeGrpId,
                { notify: false }
              );

              // Identificar accidentes críticos detectados según el entorno del ejercicio configurado
              const env = resolveExerciseEnvironment(report.exercise || report.unit, activeGrpId);
              const criticalAccidents: string[] = [];
              for (const m of report.marks) {
                if (m.type === "ERROR" && !m.ignored) {
                  const cl = classify(m.description, env, activeGrpId);
                  if (cl.severity === "CRITICO") {
                    criticalAccidents.push(m.description);
                  }
                }
              }

              // Evaluar si existe déficit de ritmo o duración inconclusa por debajo del 50% de la media
              const exerciseName = report.exercise || report.unit;
              const pacing = groupBenchmarks
                ? analyzePacing(exerciseName, report.telemetry, groupBenchmarks, report.durationSec)
                : undefined;
              let finalScore = report.score;
              if (pacing?.isPacingDeficit && pacing.penaltyDeduction > 0) {
                finalScore = Math.max(0, Math.round((finalScore - pacing.penaltyDeduction) * 10) / 10);
              }

              const pendingItem: PendingAuditItem = {
                id: s.id,
                driver: report.driver,
                date: report.date,
                exercise: exerciseName,
                phase,
                fileName: s.filename,
                score: finalScore,
                errorCount: report.errorCount,
                criticalCount: criticalAccidents.length,
                accidents: criticalAccidents,
                report,
                timestamp: Date.now(),
                savedDocId: `${activeGrpId}_f${phase}_${s.filename.replace(/[^\w.-]+/g, "_")}`,
                audited: false,
                pacing,
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
            // Notificar a la aplicación para refrescar vistas en tiempo real (Home, Driver, etc.)
            notifyEvaluationsUpdated();
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
  }, [enabled, pollIntervalMs, userName, userEmail, onNewSessionAudited]);

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
    updateQueueItem,
    clearQueue,
    markAudited,
    isElectron: isElectronApp(),
  };
}

