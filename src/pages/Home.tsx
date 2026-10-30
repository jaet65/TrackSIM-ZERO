import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import UploadForm from "../components/UploadForm";
import { isAdminEmail, PHASES } from "../lib/config";
import {
  getPhasesWithEvaluations,
  overallSummaries,
  phaseSummaries,
  type DateFilter,
  type DriverOverallSummary,
  type PhaseSummary,
} from "../lib/db";
import {
  listGroups,
  deleteGroupEvaluations,
  getActiveGroupId,
  setActiveGroupId,
  type GroupDoc,
} from "../lib/groups";
import { useAuth } from "../components/AuthProvider";
import { downloadBulkReportsZip } from "../lib/pdfExport";

export type DisplayRow = {
  driverId: string;
  driver: string;
  badgeText: string;
  exercisesText: string;
  progressValue: number;
  errors: number;
  criticalErrors: number;
  avgScore: number;
  verdict: string;
  color: string;
};

export type SortField = "driver" | "progress" | "errors" | "criticalErrors" | "avgScore" | "verdict";
export type SortDirection = "asc" | "desc";

export default function Home() {
  const [params, setParams] = useSearchParams();
  const phaseParam = params.get("fase");
  const selectedPhase = phaseParam && PHASES.some((p) => p.id === Number(phaseParam))
    ? Number(phaseParam)
    : null;

  // Filtro de grupo (desde URL param o local)
  const groupParam = params.get("grupo") || "";
  const [selectedGroupId, setSelectedGroupId] = useState<string>(groupParam);
  const [allGroups, setAllGroups] = useState<GroupDoc[]>([]);

  // Filtro de fechas (Desde / Hasta)
  const [startDate, setStartDate] = useState(params.get("desde") || "");
  const [endDate, setEndDate] = useState(params.get("hasta") || "");

  // Ordenamiento interactivo por columna
  const [sortField, setSortField] = useState<SortField>("driver");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const [availablePhases, setAvailablePhases] = useState<number[]>([]);
  const [rows, setRows] = useState<DisplayRow[] | null>(null);
  const [error, setError] = useState("");
  const { user } = useAuth();

  const [isDeleting, setIsDeleting] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmInput, setConfirmInput] = useState("");
  const [deleteError, setDeleteError] = useState("");

  // Estado de exportación de reporte global + expedientes ZIP
  const [isExportingZip, setIsExportingZip] = useState(false);
  const [exportProgress, setExportProgress] = useState<{ current: number; total: number; name: string } | null>(null);

  const isAdmin = isAdminEmail(user?.email);

  // Cargar grupos registrados
  useEffect(() => {
    listGroups().then(setAllGroups).catch(() => {});
  }, []);

  // Sincronizar el estado del filtro con el param
  useEffect(() => {
    if (params.get("grupo") !== null) {
      setSelectedGroupId(params.get("grupo") || "");
    }
  }, [params]);

  const currentGroupObj = useMemo(() => {
    return allGroups.find((g) => g.id === selectedGroupId) || null;
  }, [allGroups, selectedGroupId]);

  const dateFilter: DateFilter = {
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    groupId: selectedGroupId || undefined,
  };

  const load = useCallback(() => {
    setRows(null);
    setError("");

    // Cargar las fases que tienen resultados que cumplan los filtros
    getPhasesWithEvaluations(dateFilter).then(setAvailablePhases).catch(() => {});

    if (selectedPhase === null) {
      // Promedio General por defecto
      overallSummaries(dateFilter)
        .then((data: DriverOverallSummary[]) => {
          setRows(
            data.map((d) => ({
              driverId: d.driverId,
              driver: d.driver,
              badgeText: `${d.phasesEvaluated} de 6 fases`,
              exercisesText: `${d.totalExercises} ejercicio(s)`,
              progressValue: d.phasesEvaluated * 1000 + d.totalExercises,
              errors: d.totalErrors,
              criticalErrors: d.criticalErrors,
              avgScore: d.avgScore,
              verdict: d.verdict,
              color: d.color,
            }))
          );
        })
        .catch((e: Error) => setError(e.message));
    } else {
      // Filtrado por Fase específica seleccionada
      phaseSummaries(selectedPhase, dateFilter)
        .then((data: PhaseSummary[]) => {
          setRows(
            data.map((d) => ({
              driverId: d.driverId,
              driver: d.driver,
              badgeText: `Fase ${d.phase}`,
              exercisesText: `${d.exercises}/${d.expected}`,
              progressValue: d.exercises,
              errors: d.errors,
              criticalErrors: d.criticalErrors,
              avgScore: d.avgScore,
              verdict: d.verdict,
              color: d.color,
            }))
          );
        })
        .catch((e: Error) => setError(e.message));
    }
  }, [selectedPhase, startDate, endDate, selectedGroupId]);

  useEffect(load, [load]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      if (field === "errors" || field === "criticalErrors" || field === "avgScore" || field === "progress") {
        setSortDirection("desc");
      } else {
        setSortDirection("asc");
      }
    }
  };

  const sortedRows = useMemo(() => {
    if (!rows) return null;
    const sorted = [...rows];
    sorted.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case "driver":
          comparison = a.driver.localeCompare(b.driver, "es", { sensitivity: "base" });
          break;
        case "progress":
          comparison = a.progressValue - b.progressValue;
          break;
        case "errors":
          comparison = a.errors - b.errors;
          break;
        case "criticalErrors":
          comparison = a.criticalErrors - b.criticalErrors;
          break;
        case "avgScore":
          comparison = a.avgScore - b.avgScore;
          break;
        case "verdict": {
          const rank = (v: string) => (v.toUpperCase().includes("NO APTO") ? 0 : 1);
          comparison = rank(a.verdict) - rank(b.verdict) || a.verdict.localeCompare(b.verdict);
          break;
        }
      }
      return sortDirection === "asc" ? comparison : -comparison;
    });
    return sorted;
  }, [rows, sortField, sortDirection]);

  // Actualizar URL params cuando cambian filtros
  const updateUrl = (newPhase: number | null, start: string, end: string, newGroup: string) => {
    const next: Record<string, string> = {};
    if (newPhase !== null) next.fase = String(newPhase);
    if (start) next.desde = start;
    if (end) next.hasta = end;
    if (newGroup) next.grupo = newGroup;
    setParams(next);
  };

  // Vaciado seguro: Únicamente del grupo seleccionado
  async function handleDeleteCurrentGroup() {
    if (!selectedGroupId || !currentGroupObj) return;
    if (confirmInput.trim().toUpperCase() !== "LIMPIAR") return;

    setIsDeleting(true);
    setDeleteError("");
    try {
      await deleteGroupEvaluations(selectedGroupId);
      setShowConfirmModal(false);
      setConfirmInput("");
      load();
    } catch (e: any) {
      setDeleteError(e?.message || "Ocurrió un error al limpiar los datos del grupo.");
    } finally {
      setIsDeleting(false);
    }
  }

  const clearDateFilter = () => {
    setStartDate("");
    setEndDate("");
    updateUrl(selectedPhase, "", "", selectedGroupId);
  };

  const hasDateFilter = Boolean(startDate || endDate);

  const handleExportZip = async () => {
    if (!rows || rows.length === 0 || isExportingZip) return;
    try {
      setIsExportingZip(true);
      const phaseTitle = selectedPhase === null
        ? "Promedio General (Todas las fases)"
        : `Fase ${selectedPhase}: ${PHASES.find((p) => p.id === selectedPhase)?.name || ""}`;
      const groupTitle = currentGroupObj ? `Grupo: ${currentGroupObj.name}` : "Todos los grupos";
      const dateSubtitle = hasDateFilter
        ? (startDate && endDate ? `${startDate} al ${endDate}` : startDate ? `Desde ${startDate}` : `Hasta ${endDate}`)
        : "Sin filtro de fecha (Histórico completo)";
      const filterSubtitle = `${groupTitle} · ${phaseTitle} · Rango: ${dateSubtitle}`;

      await downloadBulkReportsZip(
        rows,
        filterSubtitle,
        {
          total: totalConductores,
          promedio: promedioGeneral,
          aptos,
          noAptos,
        },
        (current, total, name) => {
          setExportProgress({ current, total, name });
        }
      );
    } catch (err: any) {
      console.error("Error al exportar lote PDF/ZIP:", err);
      alert("Hubo un error al generar los reportes: " + (err?.message || "Error desconocido"));
    } finally {
      setIsExportingZip(false);
      setExportProgress(null);
    }
  };

  // Métricas rápidas
  const totalConductores = rows?.length ?? 0;
  const aptos = rows?.filter((r) => r.verdict.toUpperCase().includes("APTO") && !r.verdict.toUpperCase().includes("NO")).length ?? 0;
  const noAptos = rows?.filter((r) => r.verdict.toUpperCase().includes("NO APTO")).length ?? 0;
  const promedioGeneral = totalConductores > 0
    ? Math.round((rows!.reduce((acc, r) => acc + r.avgScore, 0) / totalConductores) * 10) / 10
    : 0;

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      {/* Hero Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200 pb-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_6px_#10b981]"></span>
            <span className="text-xs font-semibold tracking-wider uppercase text-slate-500">Panel de Control</span>
          </div>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
            Evaluación de Conductores
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            {selectedGroupId && currentGroupObj
              ? `Filtrando por el grupo: «${currentGroupObj.name}» ${currentGroupObj.status === "closed" ? "(🔒 Cerrado/Congelado)" : "(Abierto)"}`
              : selectedPhase === null
              ? "Vista global: Calificaciones promediadas de todo el programa de capacitación."
              : `Vista focalizada: Resultados detallados de la Fase ${selectedPhase}.`}
          </p>
        </div>

        {/* Botón de Limpiar Grupo: Solo visible si hay un grupo seleccionado y es admin */}
        {isAdmin && selectedGroupId && (
          <button
            onClick={() => {
              setConfirmInput("");
              setDeleteError("");
              setShowConfirmModal(true);
            }}
            className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-semibold text-rose-700 shadow-sm hover:border-rose-300 hover:bg-rose-100 active:scale-95 transition"
            title="Limpiar únicamente las evaluaciones asociadas a este grupo"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            <span>Limpiar Evaluaciones del Grupo</span>
          </button>
        )}
      </div>

      {/* Barra de Filtros: Grupos, Fases y Fechas */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-4">
          {/* Selector de Grupo */}
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-50 border border-indigo-200/70 text-indigo-600">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
            <label htmlFor="group-select" className="text-xs font-bold uppercase tracking-wider text-slate-700 whitespace-nowrap">
              Grupo:
            </label>
            <select
              id="group-select"
              value={selectedGroupId}
              onChange={(e) => {
                const val = e.target.value;
                setSelectedGroupId(val);
                updateUrl(selectedPhase, startDate, endDate, val);
              }}
              className="rounded-xl border border-slate-300 bg-slate-50/50 px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-sm focus:border-indigo-600 focus:bg-white focus:outline-none transition cursor-pointer"
            >
              <option value="">🌐 Todos los Grupos</option>
              {allGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.status === "closed" ? "🔒" : "🟢"} {g.name}
                </option>
              ))}
            </select>
          </div>

          {/* Selector de Fase */}
          <div className="flex items-center gap-2">
            <label htmlFor="phase-select" className="text-xs font-bold uppercase tracking-wider text-slate-700 whitespace-nowrap">
              Fase:
            </label>
            <select
              id="phase-select"
              value={selectedPhase === null ? "ALL" : String(selectedPhase)}
              onChange={(e) => {
                const val = e.target.value;
                const nextPhase = val === "ALL" ? null : Number(val);
                updateUrl(nextPhase, startDate, endDate, selectedGroupId);
              }}
              className="w-full sm:w-56 rounded-xl border border-slate-300 bg-slate-50/50 px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-sm focus:border-indigo-600 focus:bg-white focus:outline-none transition cursor-pointer"
            >
              <option value="ALL">🌐 Promedio General (Todas)</option>
              {PHASES.filter((p) => availablePhases.includes(p.id)).map((p) => (
                <option key={p.id} value={String(p.id)}>
                  Fase {p.id}: {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Selector de Rango de Fechas */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 border-t lg:border-t-0 pt-3 lg:pt-0 border-slate-100">
          <div className="flex items-center gap-1.5 text-slate-600">
            <svg className="h-4 w-4 text-indigo-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span className="text-xs font-bold uppercase tracking-wider text-slate-700 whitespace-nowrap">
              Fechas:
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                const val = e.target.value;
                setStartDate(val);
                updateUrl(selectedPhase, val, endDate, selectedGroupId);
              }}
              className="rounded-xl border border-slate-300 bg-slate-50/50 px-2.5 py-1.5 text-xs font-medium text-slate-800 shadow-sm focus:border-indigo-600 focus:bg-white focus:outline-none transition"
              title="Fecha inicial (Desde)"
            />
            <span className="text-xs text-slate-400 font-medium">—</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => {
                const val = e.target.value;
                setEndDate(val);
                updateUrl(selectedPhase, startDate, val, selectedGroupId);
              }}
              className="rounded-xl border border-slate-300 bg-slate-50/50 px-2.5 py-1.5 text-xs font-medium text-slate-800 shadow-sm focus:border-indigo-600 focus:bg-white focus:outline-none transition"
              title="Fecha final (Hasta)"
            />

            {hasDateFilter && (
              <button
                onClick={clearDateFilter}
                className="rounded-xl border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 transition shadow-sm"
                title="Limpiar filtro de fechas"
              >
                Limpiar fechas
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Carga de Archivos */}
      <UploadForm onDone={load} />

      {/* Tarjetas de métricas rápidas */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
          <span className="text-xs font-semibold text-slate-500">Conductores Evaluados</span>
          <p className="mt-1 text-2xl font-black text-slate-900">{totalConductores}</p>
          <span className="text-[11px] text-slate-400">Total en vista actual</span>
        </div>

        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
          <span className="text-xs font-semibold text-slate-500">Promedio General</span>
          <p className="mt-1 text-2xl font-black text-slate-900">{promedioGeneral}</p>
          <div className="mt-1 flex items-center gap-1.5">
            <span
              className={`h-2 w-2 rounded-full ${
                promedioGeneral >= 80 ? "bg-emerald-500" : promedioGeneral >= 60 ? "bg-amber-500" : "bg-rose-500"
              }`}
            />
            <span className="text-[11px] font-medium text-slate-600">
              {promedioGeneral >= 80 ? "Nivel Satisfactorio" : promedioGeneral >= 60 ? "En Riesgo / Regular" : "No Apto"}
            </span>
          </div>
        </div>

        <div className="rounded-2xl border border-emerald-100 bg-emerald-50/50 p-4 shadow-sm">
          <span className="text-xs font-semibold text-emerald-700">Aptos</span>
          <p className="mt-1 text-2xl font-black text-emerald-700">{aptos}</p>
          <span className="text-[11px] text-emerald-600/80">
            {totalConductores > 0 ? `${Math.round((aptos / totalConductores) * 100)}% de aprobación` : "Sin datos"}
          </span>
        </div>

        <div className="rounded-2xl border border-rose-100 bg-rose-50/50 p-4 shadow-sm">
          <span className="text-xs font-semibold text-rose-700">No Aptos</span>
          <p className="mt-1 text-2xl font-black text-rose-700">{noAptos}</p>
          <span className="text-[11px] text-rose-600/80">
            {totalConductores > 0 ? `${Math.round((noAptos / totalConductores) * 100)}% en riesgo` : "Sin datos"}
          </span>
        </div>
      </div>

      {/* Tabla Principal de Conductores */}
      <section className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 p-5">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              {selectedPhase === null ? "Resultados Globales de Conductores" : `Conductores en Fase ${selectedPhase}`}
            </h2>
            <p className="text-xs text-slate-500">
              Haz clic sobre el encabezado de cualquier columna para ordenar ascendentemente o descendentemente.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleExportZip}
              disabled={!rows || rows.length === 0 || isExportingZip}
              className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm shadow-indigo-600/20 hover:from-indigo-700 hover:to-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
              title="Descargar ZIP con el reporte global y expedientes individuales de cada conductor"
            >
              {isExportingZip ? (
                <>
                  <div className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  <span>
                    Exportando ({exportProgress?.current || 0}/{exportProgress?.total || totalConductores})…
                  </span>
                </>
              ) : (
                <>
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  <span>Descargar Expedientes (ZIP)</span>
                </>
              )}
            </button>
          </div>
        </div>

        {error && (
          <div className="m-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs font-medium text-rose-700">
            {error}
          </div>
        )}

        {rows === null ? (
          <div className="py-20 text-center text-xs text-slate-500">
            <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent mb-3" />
            Cargando evaluaciones…
          </div>
        ) : sortedRows?.length === 0 ? (
          <div className="py-20 text-center text-xs text-slate-500">
            No se encontraron evaluaciones con los filtros seleccionados.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-bold uppercase tracking-wider text-slate-500 select-none">
                <tr>
                  <th
                    onClick={() => handleSort("driver")}
                    className="cursor-pointer py-3.5 px-4 hover:bg-slate-100 transition"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Conductor</span>
                      {sortField === "driver" && (
                        <span>{sortDirection === "asc" ? "▲" : "▼"}</span>
                      )}
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort("progress")}
                    className="cursor-pointer py-3.5 px-4 hover:bg-slate-100 transition"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>{selectedPhase === null ? "Progreso" : "Ejercicios"}</span>
                      {sortField === "progress" && (
                        <span>{sortDirection === "asc" ? "▲" : "▼"}</span>
                      )}
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort("errors")}
                    className="cursor-pointer py-3.5 px-4 hover:bg-slate-100 transition text-right"
                  >
                    <div className="flex items-center justify-end gap-1.5">
                      <span>Faltas</span>
                      {sortField === "errors" && (
                        <span>{sortDirection === "asc" ? "▲" : "▼"}</span>
                      )}
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort("criticalErrors")}
                    className="cursor-pointer py-3.5 px-4 hover:bg-slate-100 transition text-right"
                  >
                    <div className="flex items-center justify-end gap-1.5">
                      <span>Faltas Críticas</span>
                      {sortField === "criticalErrors" && (
                        <span>{sortDirection === "asc" ? "▲" : "▼"}</span>
                      )}
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort("avgScore")}
                    className="cursor-pointer py-3.5 px-4 hover:bg-slate-100 transition text-right"
                  >
                    <div className="flex items-center justify-end gap-1.5">
                      <span>Calificación</span>
                      {sortField === "avgScore" && (
                        <span>{sortDirection === "asc" ? "▲" : "▼"}</span>
                      )}
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort("verdict")}
                    className="cursor-pointer py-3.5 px-4 hover:bg-slate-100 transition text-right"
                  >
                    <div className="flex items-center justify-end gap-1.5">
                      <span>Dictamen</span>
                      {sortField === "verdict" && (
                        <span>{sortDirection === "asc" ? "▲" : "▼"}</span>
                      )}
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {sortedRows?.map((r) => (
                  <tr key={r.driverId} className="hover:bg-slate-50/60 transition group">
                    <td className="px-4 py-3.5">
                      <Link
                        to={`/drivers/${r.driverId}`}
                        className="font-bold text-slate-900 group-hover:text-indigo-600 transition"
                      >
                        {r.driver}
                      </Link>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2">
                        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                          {r.badgeText}
                        </span>
                        <span className="text-[11px] text-slate-400 font-normal">
                          {r.exercisesText}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-right font-mono text-slate-700">
                      {r.errors}
                    </td>
                    <td className="px-4 py-3.5 text-right font-mono">
                      {r.criticalErrors > 0 ? (
                        <span className="inline-flex items-center gap-1 text-rose-600 font-bold bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200">
                          ⚠️ {r.criticalErrors}
                        </span>
                      ) : (
                        <span className="text-slate-400">0</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <div className="inline-flex flex-col items-end">
                        <span className="text-sm font-black text-slate-900">
                          {r.avgScore}
                        </span>
                        <div className="h-1.5 w-16 rounded-full bg-slate-100 overflow-hidden mt-0.5">
                          <div
                            className={`h-full rounded-full ${
                              r.avgScore >= 80 ? "bg-emerald-500" : r.avgScore >= 60 ? "bg-amber-500" : "bg-rose-500"
                            }`}
                            style={{ width: `${Math.min(100, Math.max(0, r.avgScore))}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold tracking-wide ${r.color}`}>
                        {r.verdict}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Modal de confirmación para vaciar evaluaciones del grupo seleccionado */}
      {showConfirmModal && currentGroupObj && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl space-y-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 border border-rose-200 text-rose-600">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">¿Limpiar Evaluaciones del Grupo?</h2>
              <p className="mt-1 text-xs text-slate-600 leading-relaxed">
                Esta acción eliminará <strong>únicamente</strong> las evaluaciones asociadas al grupo <strong className="text-slate-900">«{currentGroupObj.name}»</strong>. Las evaluaciones de otros grupos y catálogos no se verán afectadas.
              </p>
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Escribe <span className="text-rose-600 font-mono font-bold">LIMPIAR</span> para autorizar:
              </label>
              <input
                type="text"
                value={confirmInput}
                onChange={(e) => setConfirmInput(e.target.value)}
                placeholder="LIMPIAR"
                disabled={isDeleting}
                className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm uppercase tracking-wider text-slate-900 placeholder-slate-400 focus:border-rose-500 focus:outline-none"
              />
            </div>
            {deleteError && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-700">
                {deleteError}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                disabled={isDeleting}
                className="rounded-xl border border-slate-200 bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200 transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleDeleteCurrentGroup}
                disabled={confirmInput.trim().toUpperCase() !== "LIMPIAR" || isDeleting}
                className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-rose-600/20 hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                {isDeleting ? "Limpiando evaluaciones…" : "Limpiar Grupo"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
