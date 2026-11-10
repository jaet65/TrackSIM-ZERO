import { useState, useMemo } from "react";
import { DEFAULT_PHASES, type PhaseItem } from "../lib/config";
import type { ParsedExerciseCsvRow } from "../lib/exerciseCsv";
import { useEscapeKey } from "../lib/useEscapeKey";

export interface PhaseAssignmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  parsedRows: ParsedExerciseCsvRow[];
  onConfirm: (assignments: Array<{ name: string; phase: number; env?: string; descripcion?: string; noEvaluado?: boolean }>) => void;
  phasesList?: PhaseItem[];
}

export default function PhaseAssignmentModal({
  isOpen,
  onClose,
  parsedRows,
  onConfirm,
  phasesList = DEFAULT_PHASES as PhaseItem[],
}: PhaseAssignmentModalProps) {
  const effectivePhases = phasesList && phasesList.length > 0 ? phasesList : (DEFAULT_PHASES as PhaseItem[]);
  const firstPhaseId = effectivePhases[0]?.id || 1;

  // Inicializar mapa de asignación de fase para cada ejercicio parseado
  const [selectedPhases, setSelectedPhases] = useState<Record<number, number>>({});
  const [includeSelection, setIncludeSelection] = useState<Record<number, boolean>>({});
  const [bulkPhase, setBulkPhase] = useState<number>(firstPhaseId);

  // Inicializar estado cuando se abre o cambian las filas
  useState(() => {
    const initPhases: Record<number, number> = {};
    const initInclude: Record<number, boolean> = {};
    parsedRows.forEach((row, idx) => {
      const match = row.fase && effectivePhases.some((p) => p.id === row.fase);
      initPhases[idx] = match ? row.fase! : firstPhaseId;
      initInclude[idx] = true;
    });
    setSelectedPhases(initPhases);
    setIncludeSelection(initInclude);
  });

  useEscapeKey(isOpen, onClose);

  // Cada vez que cambie parsedRows, asegurarse de tener valores iniciales sincronizados
  const rowList = useMemo(() => {
    return parsedRows.map((row, idx) => {
      const match = row.fase && effectivePhases.some((p) => p.id === row.fase);
      const fallback = match ? row.fase! : firstPhaseId;
      const assignedPhase = selectedPhases[idx] ?? fallback;
      const isIncluded = includeSelection[idx] ?? true;
      return {
        idx,
        row,
        phase: assignedPhase,
        included: isIncluded,
      };
    });
  }, [parsedRows, selectedPhases, includeSelection, effectivePhases, firstPhaseId]);

  if (!isOpen) return null;

  const totalIncluded = rowList.filter((r) => r.included).length;

  const handleToggleInclude = (idx: number) => {
    setIncludeSelection((prev) => ({
      ...prev,
      [idx]: prev[idx] !== undefined ? !prev[idx] : false,
    }));
  };

  const handleToggleAll = (include: boolean) => {
    const next: Record<number, boolean> = {};
    parsedRows.forEach((_, idx) => {
      next[idx] = include;
    });
    setIncludeSelection(next);
  };

  const handleChangePhase = (idx: number, phase: number) => {
    setSelectedPhases((prev) => ({
      ...prev,
      [idx]: phase,
    }));
  };

  const handleApplyBulkPhase = () => {
    const next: Record<number, number> = { ...selectedPhases };
    parsedRows.forEach((_, idx) => {
      if (includeSelection[idx] ?? true) {
        next[idx] = bulkPhase;
      }
    });
    setSelectedPhases(next);
  };

  const handleConfirm = () => {
    const confirmed = rowList
      .filter((r) => r.included)
      .map((r) => ({
        name: r.row.nombre,
        phase: r.phase,
        env: r.row.entorno,
        descripcion: r.row.descripcion,
        noEvaluado: r.row.noEvaluado,
      }));
    onConfirm(confirmed);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="flex flex-col w-full max-w-3xl max-h-[90vh] bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
        {/* Encabezado */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 bg-slate-50/70">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600 text-xl font-bold">
              🏫
            </span>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-900">
                Asignación de Fases para Importación (Modalidad Escuela)
              </h2>
              <p className="text-xs text-slate-500">
                Selecciona en qué fase ocurrirá cada ejercicio del archivo CSV antes de agregarlo al catálogo.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-200 hover:text-slate-600 transition"
            aria-label="Cerrar modal"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Barra de herramientas / Asignación masiva */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-indigo-50/40 px-6 py-3 text-xs">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleToggleAll(true)}
              className="text-xs font-semibold text-indigo-600 hover:underline"
            >
              Seleccionar todos
            </button>
            <span className="text-slate-300">|</span>
            <button
              type="button"
              onClick={() => handleToggleAll(false)}
              className="text-xs font-semibold text-slate-600 hover:underline"
            >
              Deseleccionar todos
            </button>
            <span className="text-slate-500 ml-2 font-medium">
              ({totalIncluded} de {parsedRows.length} seleccionados)
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-600 font-medium">Asignar seleccionados a:</span>
            <select
              value={bulkPhase}
              onChange={(e) => setBulkPhase(Number(e.target.value))}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 shadow-xs focus:border-indigo-500 focus:outline-none"
            >
              {effectivePhases.map((p) => (
                <option key={p.id} value={p.id}>
                  Fase {p.id}: {p.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleApplyBulkPhase}
              className="rounded-lg bg-indigo-600 px-3 py-1 font-semibold text-white hover:bg-indigo-700 shadow-xs transition"
            >
              Aplicar
            </button>
          </div>
        </div>

        {/* Lista scrollable de ejercicios */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
          {rowList.map((item) => (
            <div
              key={item.idx}
              className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-xl border transition ${
                item.included
                  ? "border-slate-200 bg-white shadow-xs"
                  : "border-slate-100 bg-slate-50/60 opacity-60"
              }`}
            >
              <div className="flex items-start gap-3 min-w-0">
                <input
                  type="checkbox"
                  checked={item.included}
                  onChange={() => handleToggleInclude(item.idx)}
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                  id={`check-ex-${item.idx}`}
                />
                <div className="min-w-0">
                  <label
                    htmlFor={`check-ex-${item.idx}`}
                    className="font-bold text-slate-900 text-xs sm:text-sm cursor-pointer block truncate"
                  >
                    {item.row.nombre}
                  </label>
                  {item.row.descripcion && (
                    <p className="text-[11px] text-slate-500 line-clamp-2 mt-0.5 leading-relaxed">
                      {item.row.descripcion}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 sm:shrink-0 ml-7 sm:ml-0">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  Fase:
                </span>
                <select
                  value={item.phase}
                  disabled={!item.included}
                  onChange={(e) => handleChangePhase(item.idx, Number(e.target.value))}
                  className="rounded-lg border border-indigo-200 bg-indigo-50/50 px-2.5 py-1 text-xs font-bold text-indigo-900 shadow-xs focus:border-indigo-500 focus:outline-none disabled:bg-slate-100 disabled:text-slate-400"
                >
                  {effectivePhases.map((p) => (
                    <option key={p.id} value={p.id}>
                      Fase {p.id}: {p.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </div>

        {/* Pie de modal con acciones */}
        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-6 py-4">
          <span className="text-xs text-slate-500">
            Se agregarán <strong>{totalIncluded}</strong> ejercicio(s) al catálogo de fases.
          </span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition shadow-xs"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={totalIncluded === 0}
              onClick={handleConfirm}
              className="rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 px-5 py-2 text-xs font-bold text-white shadow-md shadow-indigo-600/20 hover:from-indigo-700 hover:to-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              Confirmar e Importar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

