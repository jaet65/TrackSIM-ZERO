import React, { useState } from "react";
import { createPortal } from "react-dom";
import type { PendingAuditItem } from "../lib/useAutoSync";
import type { Mark } from "../lib/parse";
import { classify } from "../lib/catalog";
import { dictamen, updateEvaluationMarks } from "../lib/db";
import { useAuth } from "./AuthProvider";
import { useEscapeKey } from "../lib/useEscapeKey";

export interface AuditQueueModalProps {
  isOpen: boolean;
  onClose: () => void;
  queue: PendingAuditItem[];
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
  onRemoveItem: (id: number) => void;
  onClearQueue: () => void;
  activeGroupId?: string;
  onEvaluationUpdated?: () => void;
}

export default function AuditQueueModal({
  isOpen,
  onClose,
  queue,
  selectedIndex,
  onSelectIndex,
  onRemoveItem,
  onClearQueue,
  activeGroupId,
  onEvaluationUpdated,
}: AuditQueueModalProps) {
  useEscapeKey(isOpen, onClose);
  const { user } = useAuth();
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  if (!isOpen || queue.length === 0) return null;

  const currentItem = queue[selectedIndex] || queue[0];
  const total = queue.length;

  const handleToggleIgnore = async (markIndex: number) => {
    if (!currentItem || isSaving) return;
    setIsSaving(true);
    setErrorMessage("");

    try {
      const marks = [...currentItem.report.marks];
      const target = marks[markIndex];
      const nextIgnored = !target.ignored;
      const actor = user?.displayName || user?.email || "Instructor";

      marks[markIndex] = {
        ...target,
        ignored: nextIgnored,
        ignoredBy: nextIgnored ? actor : undefined,
        ignoredAt: nextIgnored ? Date.now() : undefined,
      };

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

      // Actualizar localmente el item
      currentItem.report.marks = marks;
      currentItem.score = updated.score;
      currentItem.errorCount = updated.errorCount;
      // Recalcular accidentes críticos
      const newAccidents: string[] = [];
      for (const m of marks) {
        if (m.type === "ERROR" && !m.ignored) {
          const cl = classify(m.description, activeGroupId);
          if (cl.severity === "CRITICO") newAccidents.push(m.description);
        }
      }
      currentItem.accidents = newAccidents;
      currentItem.criticalCount = newAccidents.length;

      if (onEvaluationUpdated) onEvaluationUpdated();
    } catch (err: any) {
      setErrorMessage(err.message || "Error al actualizar la marca");
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

  const errorMarks = currentItem.report.marks
    .map((m, originalIdx) => ({ ...m, originalIdx }))
    .filter((m) => m.type === "ERROR");

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
              const hasCritical = item.criticalCount > 0;
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
                  <span className={`h-2 w-2 rounded-full ${hasCritical ? "bg-rose-500" : "bg-emerald-500"}`} />
                  <span className="font-semibold truncate max-w-[120px]">{item.driver}</span>
                  <span className={`text-[10px] px-1 rounded ${isSelected ? "bg-indigo-700" : "bg-slate-100"}`}>
                    {Math.round(item.score)} pts
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
                const v = dictamen(currentItem.score, currentItem.criticalCount);
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
                    <div className="text-4xl font-black mt-1">{currentItem.score.toFixed(1)}</div>
                    <div className="text-xs font-bold mt-1">
                      {isNoApto ? (
                        <span>❌ {v.label} ({currentItem.criticalCount} Crítico/s)</span>
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
                  <span className={`font-bold ${currentItem.criticalCount > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                    {currentItem.criticalCount}
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

              {/* Lista de Accidentes Detectados */}
              {currentItem.accidents.length > 0 && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
                  <span className="text-[11px] font-bold text-rose-800 flex items-center gap-1">
                    🚨 Accidentes Registrados:
                  </span>
                  <ul className="mt-1.5 space-y-1 text-xs text-rose-700">
                    {currentItem.accidents.map((acc, i) => (
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
            <div className="shrink-0 border-b border-slate-100 px-6 py-3 bg-slate-50/50 flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold text-slate-800">
                  Desglose de Infracciones y Eventos ({errorMarks.length})
                </h4>
                <p className="text-xs text-slate-500">
                  Haz clic en <span className="font-semibold text-amber-600">"Falso positivo"</span> para anular fallos del simulador (la calificación se recalcula al instante).
                </p>
              </div>
              {isSaving && (
                <span className="text-xs font-semibold text-indigo-600 animate-pulse">
                  Recalculando calificación...
                </span>
              )}
            </div>

            {errorMessage && (
              <div className="shrink-0 bg-rose-50 border-b border-rose-200 px-6 py-2 text-xs text-rose-700">
                {errorMessage}
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-6 space-y-2.5">
              {errorMarks.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center text-center p-8 text-slate-400">
                  <div className="text-4xl mb-2">🎉</div>
                  <p className="font-semibold text-slate-700">¡Conducción Impecable!</p>
                  <p className="text-xs text-slate-500 max-w-sm mt-1">
                    No se registraron errores ni colisiones durante esta sesión del simulador.
                  </p>
                </div>
              ) : (
                errorMarks.map((m) => {
                  const cl = classify(m.description, activeGroupId);
                  const isCrit = cl.severity === "CRITICO";
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
                              {cl.severity}
                            </span>
                          </div>
                          {isIgnored && m.ignoredBy && (
                            <p className="text-[11px] text-amber-700 no-underline font-medium mt-0.5">
                              ⚠️ Anulado como falso positivo por {m.ignoredBy}
                            </p>
                          )}
                        </div>
                      </div>

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

