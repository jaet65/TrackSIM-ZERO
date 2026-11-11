import React, { useState, useMemo } from "react";
import { createPortal } from "react-dom";
import type { PendingAuditItem } from "../lib/useAutoSync";
import type { Mark } from "../lib/parse";
import { classify, getCatalog, SEVERITIES, SEVERITY_ORDER, type Severity } from "../lib/catalog";
import { resolveExerciseEnvironment } from "../lib/exercises";
import { dictamen, updateEvaluationMarks } from "../lib/db";
import { analyzePacing, computeGroupBenchmarks, type ExerciseBenchmark } from "../lib/pacingBenchmark";
import { useAuth } from "./AuthProvider";
import { useEscapeKey } from "../lib/useEscapeKey";

export interface AuditQueueModalProps {
  isOpen: boolean;
  onClose: () => void;
  queue: PendingAuditItem[];
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
  onRemoveItem: (id: number) => void;
  onUpdateItem?: (id: number, updater: (prev: PendingAuditItem) => PendingAuditItem) => void;
  onClearQueue: () => void;
  activeGroupId?: string;
  onEvaluationUpdated?: () => void;
}

// Helper de tiempo fuera de la función de render del componente para pureza de React
const getCurrentTimestamp = () => Date.now();

export default function AuditQueueModal({
  isOpen,
  onClose,
  queue,
  selectedIndex,
  onSelectIndex,
  onRemoveItem,
  onUpdateItem,
  onClearQueue,
  activeGroupId,
  onEvaluationUpdated,
}: AuditQueueModalProps) {
  useEscapeKey(isOpen, onClose);
  const { user } = useAuth();
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [severityFilter, setSeverityFilter] = useState<Severity | "ALL">("ALL");
  const [showAddErrorForm, setShowAddErrorForm] = useState(false);
  const [selectedCatalogError, setSelectedCatalogError] = useState<string>("");
  const [customErrorText, setCustomErrorText] = useState<string>("");
  const [manualErrorTime, setManualErrorTime] = useState<string>("00:00:00");

  const currentItem = isOpen && queue.length > 0 ? (queue[selectedIndex] || queue[0]) : null;
  const total = queue.length;

  const currentEnv = useMemo(() => {
    if (!currentItem) return "CARRETERA";
    return resolveExerciseEnvironment(currentItem.exercise, activeGroupId);
  }, [currentItem, activeGroupId]);

  const errorMarksWithMeta = useMemo(() => {
    if (!currentItem) return [];
    return currentItem.report.marks
      .map((m, originalIdx) => {
        if (m.type !== "ERROR") return null;
        const cl = classify(m.description, currentEnv, activeGroupId);
        return {
          ...m,
          originalIdx,
          severity: cl.severity,
          weight: cl.weight,
        };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);
  }, [currentItem, currentEnv, activeGroupId]);

  const severityCounts = useMemo(() => {
    const counts: Record<Severity, number> = {
      CRITICO: 0,
      GRAVE: 0,
      MODERADO: 0,
      LEVE: 0,
    };
    for (const m of errorMarksWithMeta) {
      if (counts[m.severity] !== undefined) {
        counts[m.severity]++;
      }
    }
    return counts;
  }, [errorMarksWithMeta]);

  const liveCriticalCount = useMemo(() => {
    return errorMarksWithMeta.filter((m) => m.severity === "CRITICO" && !m.ignored).length;
  }, [errorMarksWithMeta]);

  const liveAccidents = useMemo(() => {
    return errorMarksWithMeta
      .filter((m) => m.severity === "CRITICO" && !m.ignored)
      .map((m) => m.description);
  }, [errorMarksWithMeta]);

  const displayedMarks = useMemo(() => {
    if (severityFilter === "ALL") return errorMarksWithMeta;
    return errorMarksWithMeta.filter((m) => m.severity === severityFilter);
  }, [errorMarksWithMeta, severityFilter]);

  const catalogEntriesBySeverity = useMemo(() => {
    const cfg = getCatalog(activeGroupId);
    const grouped: Record<Severity, { name: string; severity: Severity }[]> = {
      CRITICO: [],
      GRAVE: [],
      MODERADO: [],
      LEVE: [],
    };
    for (const entry of cfg.entries) {
      const resolved = classify(entry.name, currentEnv, activeGroupId);
      grouped[resolved.severity].push({ name: entry.name, severity: resolved.severity });
    }
    return grouped;
  }, [currentEnv, activeGroupId]);

  // Computar benchmarks de ritmo/duración con las sesiones presentes en la cola
  const queueBenchmarks = useMemo(() => {
    if (!queue || queue.length === 0) return new Map<string, ExerciseBenchmark>();
    const inputs = queue.map((item) => ({
      exercise: item.exercise,
      unit: item.exercise,
      durationSec: item.report.durationSec,
      telemetry: item.report.telemetry,
      groupId: activeGroupId,
      marks: item.report.marks,
    }));
    return computeGroupBenchmarks(inputs);
  }, [queue, activeGroupId]);

  const livePacing = useMemo(() => {
    if (!currentItem) return undefined;
    if (currentItem.pacing?.isPacingDeficit) return currentItem.pacing;
    return analyzePacing(
      currentItem.exercise,
      currentItem.report.telemetry,
      queueBenchmarks,
      currentItem.report.durationSec
    );
  }, [currentItem, queueBenchmarks]);

  const liveScore = useMemo(() => {
    if (!currentItem) return 0;
    let s = currentItem.score;
    // Si la penalización de ritmo calculada no estaba descontada aún del score:
    if (livePacing?.isPacingDeficit && livePacing.penaltyDeduction > 0 && !currentItem.pacing?.isPacingDeficit) {
      s = Math.max(0, Math.round((s - livePacing.penaltyDeduction) * 10) / 10);
    }
    return s;
  }, [currentItem, livePacing]);

  if (!isOpen || !currentItem || total === 0) return null;

  const handleToggleIgnore = async (markIndex: number) => {
    if (!currentItem || isSaving) return;
    setIsSaving(true);
    setErrorMessage("");

    try {
      const marks = [...currentItem.report.marks];
      const target = marks[markIndex];
      const nextIgnored = !target.ignored;
      const actor = user?.displayName || user?.email || "Instructor";
      const now = getCurrentTimestamp();
      const nextMarks = marks.map((m, idx) => {
        if (idx !== markIndex) return m;
        return {
          ...m,
          ignored: nextIgnored,
          ignoredBy: nextIgnored ? actor : undefined,
          ignoredAt: nextIgnored ? now : undefined,
        };
      });

      const docId = currentItem.savedDocId || "";
      const evalViewStub: any = {
        docId,
        phase: currentItem.phase,
        fileName: currentItem.fileName,
        driverId: "",
        driverName: currentItem.driver,
        lesson: currentItem.report.lesson,
        unit: currentItem.report.unit,
        exercise: currentItem.exercise,
        vehicle: currentItem.report.vehicle,
        instructor: "",
        instructorEmail: "",
        date: currentItem.date,
        durationSec: currentItem.report.durationSec,
        errorCount: currentItem.errorCount,
        score: currentItem.score,
        marks: nextMarks,
        telemetry: currentItem.report.telemetry,
        createdAt: currentItem.timestamp,
        groupId: activeGroupId,
      };

      const updated = await updateEvaluationMarks(evalViewStub, nextMarks, activeGroupId);

      // Recalcular accidentes críticos según el entorno del ejercicio
      const newAccidents: string[] = [];
      for (const m of nextMarks) {
        if (m.type === "ERROR" && !m.ignored) {
          const cl = classify(m.description, currentEnv, activeGroupId);
          if (cl.severity === "CRITICO") newAccidents.push(m.description);
        }
      }

      if (onUpdateItem) {
        onUpdateItem(currentItem.id, (prev) => ({
          ...prev,
          report: { ...prev.report, marks: nextMarks },
          score: updated.score,
          errorCount: updated.errorCount,
          accidents: newAccidents,
          criticalCount: newAccidents.length,
          pacing: updated.pacing,
        }));
      }

      if (onEvaluationUpdated) onEvaluationUpdated();
    } catch (err: any) {
      setErrorMessage(err.message || "Error al actualizar la marca");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteManualMark = async (markIndex: number) => {
    if (!currentItem || isSaving) return;
    setIsSaving(true);
    setErrorMessage("");

    try {
      const marks = currentItem.report.marks.filter((_, idx) => idx !== markIndex);
      const docId = currentItem.savedDocId || "";
      const evalViewStub: any = {
        docId,
        phase: currentItem.phase,
        fileName: currentItem.fileName,
        driverId: "",
        driverName: currentItem.driver,
        lesson: currentItem.report.lesson,
        unit: currentItem.report.unit,
        exercise: currentItem.exercise,
        vehicle: currentItem.report.vehicle,
        instructor: "",
        instructorEmail: "",
        date: currentItem.date,
        durationSec: currentItem.report.durationSec,
        errorCount: currentItem.errorCount,
        score: currentItem.score,
        marks,
        telemetry: currentItem.report.telemetry,
        createdAt: currentItem.timestamp,
        groupId: activeGroupId,
      };

      const updated = await updateEvaluationMarks(evalViewStub, marks, activeGroupId);

      const newAccidents: string[] = [];
      for (const m of marks) {
        if (m.type === "ERROR" && !m.ignored) {
          const cl = classify(m.description, currentEnv, activeGroupId);
          if (cl.severity === "CRITICO") newAccidents.push(m.description);
        }
      }

      if (onUpdateItem) {
        onUpdateItem(currentItem.id, (prev) => ({
          ...prev,
          report: { ...prev.report, marks },
          score: updated.score,
          errorCount: updated.errorCount,
          accidents: newAccidents,
          criticalCount: newAccidents.length,
          pacing: updated.pacing,
        }));
      }

      if (onEvaluationUpdated) onEvaluationUpdated();
    } catch (err: any) {
      setErrorMessage(err.message || "Error al eliminar la infracción manual");
    } finally {
      setIsSaving(false);
    }
  };

  const formatMarkTime = (raw: string): string => {
    const clean = raw.trim();
    if (!clean) return "0:00:00";
    const parts = clean.split(":").map((p) => p.trim());
    if (parts.length === 2) {
      const m = String(Math.max(0, parseInt(parts[0], 10) || 0)).padStart(2, "0");
      const s = String(Math.min(59, Math.max(0, parseInt(parts[1], 10) || 0))).padStart(2, "0");
      return `0:${m}:${s}`;
    }
    if (parts.length === 3) {
      const h = String(Math.max(0, parseInt(parts[0], 10) || 0));
      const m = String(Math.min(59, Math.max(0, parseInt(parts[1], 10) || 0))).padStart(2, "0");
      const s = String(Math.min(59, Math.max(0, parseInt(parts[2], 10) || 0))).padStart(2, "0");
      return `${h}:${m}:${s}`;
    }
    return "0:00:00";
  };

  const handleAddManualError = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentItem || isSaving) return;
    const desc =
      selectedCatalogError === "__CUSTOM__"
        ? customErrorText.trim()
        : selectedCatalogError.trim();

    if (!desc) {
      setErrorMessage("Selecciona o escribe la descripción del error faltante a agregar.");
      return;
    }

    setIsSaving(true);
    setErrorMessage("");

    try {
      const actor = user?.displayName || user?.email || "Instructor";
      const newMark: Mark = {
        time: formatMarkTime(manualErrorTime),
        type: "ERROR",
        description: desc,
        manual: true,
        addedBy: actor,
        addedAt: Date.now(),
      };

      const marks = [...currentItem.report.marks, newMark];
      const docId = currentItem.savedDocId || "";
      const evalViewStub: any = {
        docId,
        phase: currentItem.phase,
        fileName: currentItem.fileName,
        driverId: "",
        driverName: currentItem.driver,
        lesson: currentItem.report.lesson,
        unit: currentItem.report.unit,
        exercise: currentItem.exercise,
        vehicle: currentItem.report.vehicle,
        instructor: "",
        instructorEmail: "",
        date: currentItem.date,
        durationSec: currentItem.report.durationSec,
        errorCount: currentItem.errorCount,
        score: currentItem.score,
        marks,
        telemetry: currentItem.report.telemetry,
        createdAt: currentItem.timestamp,
        groupId: activeGroupId,
      };

      const updated = await updateEvaluationMarks(evalViewStub, marks, activeGroupId);

      const newAccidents: string[] = [];
      for (const m of marks) {
        if (m.type === "ERROR" && !m.ignored) {
          const cl = classify(m.description, currentEnv, activeGroupId);
          if (cl.severity === "CRITICO") newAccidents.push(m.description);
        }
      }

      if (onUpdateItem) {
        onUpdateItem(currentItem.id, (prev) => ({
          ...prev,
          report: { ...prev.report, marks },
          score: updated.score,
          errorCount: updated.errorCount,
          accidents: newAccidents,
          criticalCount: newAccidents.length,
          pacing: updated.pacing,
        }));
      }

      setCustomErrorText("");
      setSelectedCatalogError("");
      setShowAddErrorForm(false);
      if (onEvaluationUpdated) onEvaluationUpdated();
    } catch (err: any) {
      setErrorMessage(err.message || "Error al agregar la infracción");
    } finally {
      setIsSaving(false);
    }
  };

  const handleApproveAndNext = () => {
    const idToRemove = currentItem.id;
    if (selectedIndex >= total - 1) {
      if (total <= 1) {
        onRemoveItem(idToRemove);
        onClose();
        return;
      }
      onSelectIndex(Math.max(0, total - 2));
    }
    onRemoveItem(idToRemove);
  };

  const content = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 p-4 sm:p-6 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="flex h-[88vh] max-h-[850px] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl border border-slate-200">
        {/* Cabecera del Modal */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-slate-50 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white font-bold shadow-md shadow-indigo-600/20">
              ⚡
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900">
                  Cola de Auditoría en Tiempo Real
                </h2>
                <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-bold text-indigo-700">
                  {selectedIndex + 1} de {total} pendiente{total > 1 ? "s" : ""}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Audita y anula falsos positivos antes de entregar resultados al conductor
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClearQueue}
              title="Vaciar toda la cola de auditoría"
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100"
            >
              Vaciar cola
            </button>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Barra de Navegación de Sesiones Pendientes */}
        {total > 1 && (
          <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-slate-100 bg-slate-100/60 px-6 py-2.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mr-2 shrink-0">
              Turnos en cola:
            </span>
            {queue.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              const v = dictamen(item.score, item.criticalCount);
              const isApto = v.label === "APTO";
              const isObservaciones = v.label === "APTO CON OBSERVACIONES";
              const dotColor = isApto
                ? "bg-emerald-500"
                : isObservaciones
                ? "bg-amber-500"
                : "bg-rose-500";

              return (
                <button
                  key={item.id}
                  onClick={() => onSelectIndex(idx)}
                  className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                    isSelected
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "bg-white text-slate-700 border border-slate-200 hover:border-indigo-300"
                  }`}
                >
                  <span className={`h-2 w-2 rounded-full ${dotColor}`} />
                  <span className="font-semibold truncate max-w-[120px]">{item.driver}</span>
                  <span className={`text-[10px] px-1 rounded ${isSelected ? "bg-indigo-700" : "bg-slate-100"}`}>
                    {item.score.toFixed(1)} pts
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Cuerpo Principal */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* Panel Izquierdo: Resumen del Conductor & Calificación */}
          <div className="w-80 shrink-0 border-r border-slate-200 bg-slate-50/50 p-6 flex flex-col justify-between overflow-y-auto">
            <div className="space-y-4">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600">Conductor Evaluado</span>
                <h3 className="text-lg font-bold text-slate-900 leading-tight">{currentItem.driver}</h3>
                <p className="text-xs text-slate-500 mt-0.5">Fecha: {currentItem.date} · {currentItem.exercise}</p>
              </div>

              {/* Tarjeta de Calificación */}
              {(() => {
                const v = dictamen(liveScore, liveCriticalCount);
                const isNoApto = v.label === "NO APTO";
                const isApto = v.label === "APTO";
                return (
                  <div
                    className={`rounded-xl border p-4 text-center ${
                      isNoApto
                        ? "border-rose-200 bg-rose-50/80 text-rose-900"
                        : isApto
                        ? "border-emerald-200 bg-emerald-50/80 text-emerald-900"
                        : "border-amber-200 bg-amber-50/80 text-amber-900"
                    }`}
                  >
                    <div className="text-xs font-semibold uppercase tracking-wider opacity-80">Calificación Actual</div>
                    <div className="text-4xl font-black mt-1">{liveScore.toFixed(1)}</div>
                    <div className="text-xs font-bold mt-1">
                      {isNoApto ? (
                        <span>❌ {v.label} ({liveCriticalCount} Crítico/s)</span>
                      ) : (
                        <span>{isApto ? "✅ " : "⚠️ "}{v.label}</span>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Estadísticas Rápidas */}
              <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3 text-xs">
                <div className="flex justify-between text-slate-600">
                  <span>Errores totales:</span>
                  <span className="font-bold text-slate-900">{currentItem.errorCount}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Accidentes críticos:</span>
                  <span className={`font-bold ${liveCriticalCount > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                    {liveCriticalCount}
                  </span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Duración:</span>
                  <span className="font-bold text-slate-900">
                    {Math.floor(currentItem.report.durationSec / 60)}m {currentItem.report.durationSec % 60}s
                  </span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Fase asignada:</span>
                  <span className="font-bold text-slate-900">Fase {currentItem.phase}</span>
                </div>
              </div>

              {/* Banner de Penalización por Conducción Evasiva / Duración Inconclusa */}
              {livePacing?.isPacingDeficit && (
                <div className="rounded-xl border border-rose-200 bg-rose-50/90 p-3 text-rose-900 shadow-xs">
                  <div className="flex items-start gap-2">
                    <span className="text-base shrink-0">⏱️</span>
                    <div className="text-[11px] leading-tight">
                      <div className="flex items-center justify-between gap-1">
                        <strong className="font-bold text-rose-950">
                          Penalización por Tiempo / Ritmo
                        </strong>
                        <span className="rounded bg-rose-200 px-1.5 py-0.5 font-mono font-bold text-rose-900 shrink-0">
                          -{livePacing.penaltyDeduction} pts
                        </span>
                      </div>
                      <p className="mt-1 text-rose-800">
                        {livePacing.reason}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Lista de Accidentes Detectados */}
              {liveAccidents.length > 0 && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
                  <span className="text-[11px] font-bold text-rose-800 flex items-center gap-1">
                    🚨 Accidentes Registrados:
                  </span>
                  <ul className="mt-1.5 space-y-1 text-xs text-rose-700">
                    {liveAccidents.map((acc, i) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <span className="shrink-0">•</span>
                        <span>{acc}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Botones de acción del conductor */}
            <div className="pt-4 border-t border-slate-200 space-y-2">
              <button
                onClick={handleApproveAndNext}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-600/25 hover:bg-indigo-700 active:scale-[0.98] transition"
              >
                <span>Aprobar y Siguiente</span>
                <span>➔</span>
              </button>
              <button
                onClick={() => onRemoveItem(currentItem.id)}
                className="w-full text-xs text-slate-400 hover:text-slate-600 py-1"
              >
                Omitir sin revisar
              </button>
            </div>
          </div>

          {/* Panel Derecho: Lista de Infracciones y Botón de Falso Positivo */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden bg-white">
            <div className="shrink-0 border-b border-slate-100 px-6 py-3 bg-slate-50/50 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-bold text-slate-800">
                    Desglose de Infracciones y Eventos ({errorMarksWithMeta.length})
                  </h4>
                  <p className="text-xs text-slate-500">
                    Haz clic en <span className="font-semibold text-amber-600">"Falso positivo"</span> para anular fallos del simulador (la calificación se recalcula al instante).
                  </p>
                </div>
                {isSaving ? (
                  <span className="text-xs font-semibold text-indigo-600 animate-pulse">
                    Recalculando calificación...
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowAddErrorForm((prev) => !prev)}
                    className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-indigo-700 transition"
                  >
                    <span>{showAddErrorForm ? "✕ Cancelar" : "+ Agregar falta manual"}</span>
                  </button>
                )}
              </div>

              {/* Formulario para agregar una falta manual faltante */}
              {showAddErrorForm && (() => {
                const previewDesc =
                  selectedCatalogError === "__CUSTOM__" ? customErrorText.trim() : selectedCatalogError.trim();
                const previewCls = previewDesc ? classify(previewDesc, currentEnv, activeGroupId) : null;

                return (
                  <form
                    onSubmit={handleAddManualError}
                    className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-3 space-y-2.5 animate-in fade-in duration-150"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-indigo-950">
                        Registrar infracción o accidente no detectado
                      </span>
                      {previewCls && (
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${SEVERITIES[previewCls.severity].badge}`}>
                          Nivel: {SEVERITIES[previewCls.severity].label} (-{previewCls.weight} pts)
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-12">
                      <div className="sm:col-span-7 space-y-1">
                        <label className="block text-[11px] font-semibold text-slate-700">
                          Falta del catálogo
                        </label>
                        <select
                          value={selectedCatalogError}
                          onChange={(e) => setSelectedCatalogError(e.target.value)}
                          className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:border-indigo-500 focus:outline-none"
                        >
                          <option value="">— Seleccionar infracción —</option>
                          {SEVERITY_ORDER.map((sev) => {
                            const items = catalogEntriesBySeverity[sev];
                            if (!items.length) return null;
                            return (
                              <optgroup key={sev} label={`Nivel ${SEVERITIES[sev].label}`}>
                                {items.map((it) => (
                                  <option key={it.name} value={it.name}>
                                    {it.name}
                                  </option>
                                ))}
                              </optgroup>
                            );
                          })}
                          <option value="__CUSTOM__">✏️ Otra falta personalizada...</option>
                        </select>
                      </div>

                      <div className="sm:col-span-2 space-y-1">
                        <label className="block text-[11px] font-semibold text-slate-700">
                          Minuto
                        </label>
                        <input
                          type="text"
                          value={manualErrorTime}
                          onChange={(e) => setManualErrorTime(e.target.value)}
                          placeholder="0:00:00"
                          className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-800 focus:border-indigo-500 focus:outline-none"
                        />
                      </div>

                      <div className="sm:col-span-3 flex items-end">
                        <button
                          type="submit"
                          disabled={isSaving}
                          className="w-full rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-50 transition"
                        >
                          {isSaving ? "Guardando..." : "Agregar y Recalcular"}
                        </button>
                      </div>
                    </div>

                    {selectedCatalogError === "__CUSTOM__" && (
                      <div className="space-y-1 pt-1">
                        <label className="block text-[11px] font-semibold text-slate-700">
                          Descripción de la falta
                        </label>
                        <input
                          type="text"
                          value={customErrorText}
                          onChange={(e) => setCustomErrorText(e.target.value)}
                          placeholder="Ej: Golpe lateral contra objeto fijo..."
                          className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:border-indigo-500 focus:outline-none"
                        />
                      </div>
                    )}
                  </form>
                );
              })()}

              {/* Filtros por Severidad */}
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <button
                  type="button"
                  onClick={() => setSeverityFilter("ALL")}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                    severityFilter === "ALL"
                      ? "bg-slate-900 text-white shadow-xs"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  Todos ({errorMarksWithMeta.length})
                </button>
                {SEVERITY_ORDER.map((sev) => {
                  const count = severityCounts[sev];
                  const isActive = severityFilter === sev;
                  const cfg = SEVERITIES[sev];
                  return (
                    <button
                      key={sev}
                      type="button"
                      onClick={() => setSeverityFilter(sev)}
                      className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                        isActive
                          ? `${cfg.badge} shadow-xs font-bold ring-2 ring-indigo-500/20`
                          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
                      <span>{cfg.label}</span>
                      <span className="text-[10px] opacity-75 font-mono">({count})</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {errorMessage && (
              <div className="shrink-0 bg-rose-50 border-b border-rose-200 px-6 py-2 text-xs text-rose-700">
                {errorMessage}
              </div>
            )}

            <div className="flex-1 overflow-y-auto overscroll-contain p-6 space-y-2.5">
              {displayedMarks.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center text-center p-8 text-slate-400">
                  <div className="text-4xl mb-2">
                    {severityFilter === "ALL" ? "🎉" : "🔍"}
                  </div>
                  <p className="font-semibold text-slate-700">
                    {severityFilter === "ALL"
                      ? "¡Conducción Impecable!"
                      : `Sin incidencias de nivel ${SEVERITIES[severityFilter].label}`}
                  </p>
                  <p className="text-xs text-slate-500 max-w-sm mt-1">
                    {severityFilter === "ALL"
                      ? "No se registraron errores ni colisiones durante esta sesión del simulador."
                      : "No se encontraron eventos clasificados con esta gravedad en este ejercicio."}
                  </p>
                </div>
              ) : (
                displayedMarks.map((m) => {
                  const isCrit = m.severity === "CRITICO";
                  const isIgnored = Boolean(m.ignored);

                  return (
                    <div
                      key={m.originalIdx}
                      className={`flex items-center justify-between rounded-xl border p-3.5 transition ${
                        isIgnored
                          ? "border-slate-200 bg-slate-50 opacity-60 line-through"
                          : isCrit
                          ? "border-rose-300 bg-rose-50/40 shadow-sm"
                          : "border-slate-200 bg-white hover:border-slate-300"
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0 pr-4">
                        <span className="font-mono text-xs font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded shrink-0">
                          {m.time}
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span
                              className={`text-xs font-bold truncate ${
                                isIgnored ? "text-slate-400" : isCrit ? "text-rose-700" : "text-slate-800"
                              }`}
                            >
                              {m.description}
                            </span>
                            <span
                              className={`text-[10px] px-1.5 py-0.5 rounded font-semibold shrink-0 ${
                                isCrit ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-600"
                              }`}
                            >
                              {m.severity}
                            </span>
                            {m.manual && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded font-bold shrink-0 bg-indigo-100 text-indigo-700 border border-indigo-200">
                                Manual
                              </span>
                            )}
                          </div>
                          {m.manual && m.addedBy && (
                            <p className="text-[11px] text-indigo-600 no-underline font-medium mt-0.5">
                              ✍️ Agregado manualmente por {m.addedBy}
                            </p>
                          )}
                          {isIgnored && m.ignoredBy && (
                            <p className="text-[11px] text-amber-700 no-underline font-medium mt-0.5">
                              ⚠️ Anulado como falso positivo por {m.ignoredBy}
                            </p>
                          )}
                        </div>
                      </div>

                      {m.manual ? (
                        <button
                          type="button"
                          onClick={() => handleDeleteManualMark(m.originalIdx)}
                          disabled={isSaving}
                          className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-bold transition shadow-sm bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-300 disabled:opacity-50"
                          title="Eliminar esta falta agregada manualmente"
                        >
                          ✕ Eliminar
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleToggleIgnore(m.originalIdx)}
                          disabled={isSaving}
                          className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-bold transition shadow-sm ${
                            isIgnored
                              ? "bg-slate-200 text-slate-700 hover:bg-slate-300"
                              : "bg-amber-100 text-amber-800 hover:bg-amber-200 border border-amber-300"
                          }`}
                        >
                          {isIgnored ? "Restaurar" : "⚡ Falso Positivo"}
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(content, document.body) : content;
}

