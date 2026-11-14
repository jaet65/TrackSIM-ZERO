import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import UploadForm from "../components/UploadForm";
import { isAdminEmail } from "../lib/config";
import { getPhasesList, getPhaseName, resolveExerciseEnvironment } from "../lib/exercises";
import {
  getPhasesWithEvaluations,
  listReportExercises,
  overallSummaries,
  phaseSummaries,
  getLatestEvaluation,
  subscribeToLatestEvaluation,
  type DateFilter,
  type DriverOverallSummary,
  type PhaseSummary,
  type EvaluationView,
} from "../lib/db";
import {
  listGroups,
  deleteGroupEvaluations,
  getActiveGroupId,
  setActiveGroupId,
  type GroupDoc,
} from "../lib/groups";
import { useAuth } from "../components/AuthProvider";
import ExecutiveSummaryPreviewModal from "../components/ExecutiveSummaryPreviewModal";
import DriverModal from "../components/DriverModal";
import { downloadBulkReportsZip, downloadExecutiveSummaryPdf } from "../lib/pdfExport";
import { useEscapeKey } from "../lib/useEscapeKey";
import type { ReportExerciseSummary } from "../lib/db";

export type DisplayRow = {
  driverId: string;
  groupId?: string;
  driver: string;
  badgeText: string;
  exercisesText: string;
  progressValue: number;
  isIncomplete?: boolean;
  errors: number;
  criticalErrors: number;
  avgScore: number;
  verdict: string;
  color: string;
  lastDate?: string;
  lastCreatedAt?: number;
};

export type SortField = "driver" | "lastDate" | "progress" | "errors" | "criticalErrors" | "avgScore" | "verdict";
export type SortDirection = "asc" | "desc";

const STORAGE_KEY_HOME_PREFS = "tracksim_home_view_preferences";

interface HomePreferences {
  selectedPhase: number | null;
  groupId: string;
  startDate: string;
  endDate: string;
  sortField: SortField;
  sortDirection: SortDirection;
}

function loadSavedPreferences(): Partial<HomePreferences> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_HOME_PREFS);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {};
}

function saveHomePreferences(prefs: Partial<HomePreferences>) {
  try {
    const prev = loadSavedPreferences();
    localStorage.setItem(STORAGE_KEY_HOME_PREFS, JSON.stringify({ ...prev, ...prefs }));
  } catch {}
}

export default function Home() {
  const [params, setParams] = useSearchParams();
  const savedPrefs = useMemo(() => loadSavedPreferences(), []);

  const phaseParam = params.get("fase");
  const selectedPhase = phaseParam !== null && !isNaN(Number(phaseParam))
    ? Number(phaseParam)
    : phaseParam === null && savedPrefs.selectedPhase !== undefined
      ? savedPrefs.selectedPhase
      : null;

  // Filtro de grupo: toma URL param, si no hay toma savedPrefs, o el grupo activo actual
  const [selectedGroupId, setSelectedGroupId] = useState<string>(() => {
    const fromUrl = params.get("grupo");
    if (fromUrl !== null) return fromUrl === "ALL" ? "" : fromUrl;
    if (savedPrefs.groupId !== undefined) return savedPrefs.groupId;
    return getActiveGroupId() || "";
  });
  const [allGroups, setAllGroups] = useState<GroupDoc[]>([]);

  // Filtro de fechas (Desde / Hasta)
  const [startDate, setStartDate] = useState(
    params.get("desde") ?? savedPrefs.startDate ?? ""
  );
  const [endDate, setEndDate] = useState(
    params.get("hasta") ?? savedPrefs.endDate ?? ""
  );

  // Filtro de búsqueda por nombre de conductor
  const [driverSearchQuery, setDriverSearchQuery] = useState("");

  // Ordenamiento interactivo por columna
  const [sortField, setSortField] = useState<SortField>(
    savedPrefs.sortField || "driver"
  );
  const [sortDirection, setSortDirection] = useState<SortDirection>(
    savedPrefs.sortDirection || "asc"
  );

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
  useEscapeKey(showConfirmModal && !isDeleting, () => setShowConfirmModal(false));
  const [exportProgress, setExportProgress] = useState<{ current: number; total: number; name: string } | null>(null);
  const [isLoadingExecutivePreview, setIsLoadingExecutivePreview] = useState(false);
  const [executivePreview, setExecutivePreview] = useState<{
    groupName: string;
    rows: DisplayRow[];
    filterSubtitle: string;
    metrics: { total: number; promedio: number; aptos: number; noAptos: number };
    exercises: ReportExerciseSummary[];
  } | null>(null);

  // Modal interactivo de expediente de conductor
  const [activeDriverId, setActiveDriverId] = useState<string | null>(null);
  const [activeDriverGroupId, setActiveDriverGroupId] = useState<string | null>(null);

  // Última evaluación registrada
  const [latestEval, setLatestEval] = useState<EvaluationView | null>(null);

  const isAdmin = isAdminEmail(user?.email);

  // Cargar grupos registrados y validar que el grupo seleccionado exista
  useEffect(() => {
    listGroups()
      .then((list) => {
        setAllGroups(list);
        setSelectedGroupId((prev) => {
          if (prev && !list.some((g) => g.id === prev)) {
            const fallback = getActiveGroupId() && list.some((g) => g.id === getActiveGroupId())
              ? getActiveGroupId()!
              : "";
            saveHomePreferences({ groupId: fallback });
            return fallback;
          }
          return prev;
        });
      })
      .catch(() => { });
  }, []);

  // Sincronizar el estado del filtro con el param de la URL
  useEffect(() => {
    const fromUrl = params.get("grupo");
    if (fromUrl !== null) {
      setSelectedGroupId(fromUrl === "ALL" ? "" : fromUrl);
    }
  }, [params]);

  const currentGroupObj = useMemo(() => {
    return allGroups.find((g) => g.id === selectedGroupId) || null;
  }, [allGroups, selectedGroupId]);

  const phasesList = useMemo(() => getPhasesList(selectedGroupId || null), [selectedGroupId]);

  const dateFilter: DateFilter = {
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    groupId: selectedGroupId || undefined,
  };

  const load = useCallback(() => {
    const filter: DateFilter = {
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      groupId: selectedGroupId || undefined,
    };
    setError("");

    // Cargar las fases que tienen resultados que cumplan los filtros
    getPhasesWithEvaluations(filter).then(setAvailablePhases).catch(() => { });

    // Cargar la última evaluación registrada
    getLatestEvaluation(filter).then(setLatestEval).catch(() => setLatestEval(null));

    if (selectedPhase === null) {
      // Promedio General por defecto
      overallSummaries(filter)
        .then((data: DriverOverallSummary[]) => {
          setRows(
            data.map((d) => ({
              driverId: d.driverId,
              groupId: d.groupId,
              driver: d.driver,
              badgeText: `${d.phasesEvaluated} de ${d.expectedPhases} fases`,
              exercisesText: `${d.totalExercises}/${d.expectedExercises} ejercicio(s)`,
              progressValue: d.totalExercises,
              isIncomplete: d.totalExercises < d.expectedExercises,
              errors: d.totalErrors,
              criticalErrors: d.criticalErrors,
              avgScore: d.avgScore,
              verdict: d.verdict,
              color: d.color,
              lastDate: d.lastDate,
              lastCreatedAt: d.lastCreatedAt,
            }))
          );
        })
        .catch((e: Error) => setError(e.message));
    } else {
      // Filtrado por Fase específica seleccionada
      phaseSummaries(selectedPhase, filter)
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
              lastDate: d.lastDate,
              lastCreatedAt: d.lastCreatedAt,
            }))
          );
        })
        .catch((e: Error) => setError(e.message));
    }
  }, [selectedPhase, startDate, endDate, selectedGroupId]);

  useEffect(load, [load]);

  // Suscripción en tiempo real a la última evaluación para que se actualice de inmediato en pantalla
  useEffect(() => {
    const filter: DateFilter = {
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      groupId: selectedGroupId || undefined,
    };
    const unsubscribe = subscribeToLatestEvaluation((latest) => {
      setLatestEval(latest);
    }, filter);
    return () => {
      unsubscribe();
    };
  }, [selectedGroupId, startDate, endDate]);

  // Actualizar la lista en tiempo real cuando AutoSync ingiere una nueva sesión o se audita
  useEffect(() => {
    const handleSyncUpdate = () => {
      load();
    };
    window.addEventListener("tracksim:evaluations-updated", handleSyncUpdate);
    return () => {
      window.removeEventListener("tracksim:evaluations-updated", handleSyncUpdate);
    };
  }, [load]);

  const handleSort = (field: SortField) => {
    let nextDirection: SortDirection;
    if (sortField === field) {
      nextDirection = sortDirection === "asc" ? "desc" : "asc";
      setSortDirection(nextDirection);
    } else {
      setSortField(field);
      if (field === "errors" || field === "criticalErrors" || field === "avgScore" || field === "progress") {
        nextDirection = "desc";
      } else {
        nextDirection = "asc";
      }
      setSortDirection(nextDirection);
    }
    saveHomePreferences({
      sortField: field,
      sortDirection: nextDirection,
    });
  };

  const sortedRows = useMemo(() => {
    if (!rows) return null;
    let list = rows;
    const rawQ = driverSearchQuery.trim();
    if (rawQ) {
      // Normalizar quitando acentos y diacríticos para búsqueda insensible a tildes
      const normalizedQ = rawQ
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();

      list = list.filter((r) => {
        const normalizedDriver = (r.driver || "")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase();
        return normalizedDriver.includes(normalizedQ);
      });
    }
    const sorted = [...list];
    sorted.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case "driver":
          comparison = a.driver.localeCompare(b.driver, "es", { sensitivity: "base" });
          break;
        case "lastDate": {
          const dateA = a.lastDate || "";
          const dateB = b.lastDate || "";
          const createdA = a.lastCreatedAt || 0;
          const createdB = b.lastCreatedAt || 0;
          comparison = dateA.localeCompare(dateB) || createdA - createdB;
          break;
        }
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
          const rank = (v: string) => {
            const up = v.toUpperCase();
            if (up.includes("NO REALIZADO")) return 0;
            if (up.includes("INCOMPLETO")) return 1;
            if (up.includes("NO APTO")) return 2;
            return 3;
          };
          comparison = rank(a.verdict) - rank(b.verdict) || a.verdict.localeCompare(b.verdict);
          break;
        }
      }
      return sortDirection === "asc" ? comparison : -comparison;
    });
    return sorted;
  }, [rows, driverSearchQuery, sortField, sortDirection]);

  const groupedGlobalRows = useMemo(() => {
    if (!sortedRows) return [];

    const groups = new Map<string, DisplayRow[]>();
    for (const row of sortedRows) {
      const groupKey = row.groupId || "";
      const groupRows = groups.get(groupKey) || [];
      groupRows.push(row);
      groups.set(groupKey, groupRows);
    }

    return [...groups.entries()]
      .map(([groupId, groupRows]) => ({
        groupId,
        groupName: allGroups.find((group) => group.id === groupId)?.name || (groupId ? "Grupo archivado" : "Sin grupo"),
        rows: groupRows,
      }))
      .sort((a, b) => a.groupName.localeCompare(b.groupName, "es", { sensitivity: "base" }));
  }, [sortedRows, allGroups]);

  const showGroupSections = !selectedGroupId && selectedPhase === null;
  const tableItems = showGroupSections
    ? groupedGlobalRows.flatMap(({ groupId, groupName, rows: groupRows }) => [
        { type: "group" as const, key: `group:${groupId || "unassigned"}`, groupName, count: groupRows.length },
        ...groupRows.map((row) => ({
          type: "driver" as const,
          key: `driver:${groupId}:${row.driverId}`,
          row,
        })),
      ])
    : (sortedRows || []).map((row) => ({
        type: "driver" as const,
        key: `driver:${row.groupId || selectedGroupId}:${row.driverId}`,
        row,
      }));

  // Actualizar URL params y persistir cuando cambian filtros
  const updateUrl = (newPhase: number | null, start: string, end: string, newGroup: string) => {
    const next: Record<string, string> = {};
    if (newPhase !== null) next.fase = String(newPhase);
    if (start) next.desde = start;
    if (end) next.hasta = end;
    if (newGroup) {
      next.grupo = newGroup;
    } else if (getActiveGroupId()) {
      // Si hay un grupo activo pero el usuario eligió explícitamente "Todos los Grupos"
      next.grupo = "ALL";
    }
    setParams(next);

    saveHomePreferences({
      selectedPhase: newPhase,
      startDate: start,
      endDate: end,
      groupId: newGroup,
    });
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
        : `Fase ${selectedPhase}: ${getPhaseName(selectedPhase, selectedGroupId || null)}`;
      const groupTitle = currentGroupObj ? `Grupo: ${currentGroupObj.name}` : "Todos los grupos";
      const dateSubtitle = hasDateFilter
        ? (startDate && endDate ? `${startDate} al ${endDate}` : startDate ? `Desde ${startDate}` : `Hasta ${endDate}`)
        : "Histórico completo";
      const filterSubtitle = `${groupTitle} · ${phaseTitle} · ${dateSubtitle}`;
      const reportExercises = await listReportExercises(dateFilter, selectedPhase ?? undefined);

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
        },
        dateFilter,
        currentGroupObj?.name || "Todos los Grupos",
        reportExercises
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

  const handleExportExecutiveSummary = async () => {
    if (!sortedRows || sortedRows.length === 0 || isLoadingExecutivePreview) return;
    const phaseTitle = selectedPhase === null
      ? "Promedio General (Todas las fases)"
      : `Fase ${selectedPhase}: ${getPhaseName(selectedPhase, selectedGroupId || null)}`;
    const groupTitle = currentGroupObj ? currentGroupObj.name : "Todos los Grupos";
    const dateSubtitle = hasDateFilter
      ? (startDate && endDate ? `${startDate} al ${endDate}` : startDate ? `Desde ${startDate}` : `Hasta ${endDate}`)
      : "Histórico completo";
    const filterSubtitle = `${groupTitle} · ${phaseTitle} · ${dateSubtitle}`;

    try {
      setIsLoadingExecutivePreview(true);
      const reportExercises = await listReportExercises(dateFilter, selectedPhase ?? undefined);
      setExecutivePreview({
        groupName: groupTitle,
        rows: sortedRows,
        filterSubtitle,
        metrics: {
          total: totalConductores,
          promedio: promedioGeneral,
          aptos,
          noAptos,
        },
        exercises: reportExercises,
      });
    } catch (err: any) {
      console.error("Error al cargar los ejercicios del resumen ejecutivo:", err);
      alert("No se pudieron cargar los ejercicios del reporte: " + (err?.message || "Error desconocido"));
    } finally {
      setIsLoadingExecutivePreview(false);
    }
  };

  const handleDownloadExecutiveSummary = () => {
    if (!executivePreview) return;
    try {
      downloadExecutiveSummaryPdf(
        executivePreview.groupName,
        executivePreview.rows,
        executivePreview.filterSubtitle,
        executivePreview.metrics,
        executivePreview.exercises
      );
      setExecutivePreview(null);
    } catch (err: any) {
      console.error("Error al generar el PDF del resumen ejecutivo:", err);
      alert("No se pudo generar el PDF del reporte: " + (err?.message || "Error desconocido"));
    }
  };

  // Navegación entre conductores en el modal
  const openDriver = (driverId: string, groupId?: string) => {
    setActiveDriverId(driverId);
    setActiveDriverGroupId(groupId ?? selectedGroupId);
  };

  const navigableRows = showGroupSections
    ? groupedGlobalRows.flatMap((group) => group.rows)
    : sortedRows || [];

  const activeDriverIndex = useMemo(() => {
    if (!activeDriverId) return -1;
    return navigableRows.findIndex(
      (row) => row.driverId === activeDriverId && (row.groupId ?? selectedGroupId) === (activeDriverGroupId ?? selectedGroupId)
    );
  }, [activeDriverId, activeDriverGroupId, selectedGroupId, navigableRows]);

  const hasPrevDriver = activeDriverIndex > 0;
  const hasNextDriver = activeDriverIndex >= 0 && activeDriverIndex < navigableRows.length - 1;

  const handlePrevDriver = () => {
    if (hasPrevDriver) {
      const row = navigableRows[activeDriverIndex - 1];
      openDriver(row.driverId, row.groupId);
    }
  };

  const handleNextDriver = () => {
    if (hasNextDriver) {
      const row = navigableRows[activeDriverIndex + 1];
      openDriver(row.driverId, row.groupId);
    }
  };

  return (
    <main className="w-full space-y-4 px-4 py-4 sm:px-6 xl:px-8">
      {/* Header Compacto */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200 pb-3">
        <h1 className="text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl">
          Evaluación de Conductores
        </h1>

        {/* Botón de Limpiar Grupo: Solo visible si hay un grupo seleccionado, es admin y NO está cerrado */}
        {isAdmin && selectedGroupId && currentGroupObj?.status !== "closed" && (
          <button
            onClick={() => {
              setConfirmInput("");
              setDeleteError("");
              setShowConfirmModal(true);
            }}
            className="inline-flex items-center gap-1.5 self-start sm:self-auto rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 shadow-2xs hover:border-rose-300 hover:bg-rose-100 active:scale-95 transition"
            title="Limpiar únicamente las evaluaciones asociadas a este grupo"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            <span>Limpiar Evaluaciones del Grupo</span>
          </button>
        )}
      </div>

      {/* Barra de Filtros Compacta: Grupos, Fases y Fechas */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2.5 rounded-xl border border-slate-200/80 bg-white px-3.5 py-2.5 shadow-2xs">
        <div className="flex flex-wrap items-center gap-3">
          {/* Selector de Grupo */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 whitespace-nowrap">
              Grupo:
            </span>
            <select
              id="group-select"
              value={selectedGroupId}
              onChange={(e) => {
                const val = e.target.value;
                setSelectedGroupId(val);
                setActiveGroupId(val || null);
                updateUrl(selectedPhase, startDate, endDate, val);
              }}
              className="rounded-lg border border-slate-300 bg-slate-50/50 px-2.5 py-1 text-xs font-semibold text-slate-800 shadow-2xs focus:border-indigo-600 focus:bg-white focus:outline-none transition cursor-pointer"
            >
              <option value="">🌐 Todos los Grupos</option>
              {allGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.status === "closed" ? "🔒" : "🟢"} {g.name}
                </option>
              ))}
            </select>
          </div>

          {/* Selector de Fase (Solo si no es modalidad Curso) */}
          {currentGroupObj?.type !== "curso" ? (
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 whitespace-nowrap">
                Fase:
              </span>
              <select
                id="phase-select"
                value={selectedPhase === null ? "ALL" : String(selectedPhase)}
                onChange={(e) => {
                  const val = e.target.value;
                  const nextPhase = val === "ALL" ? null : Number(val);
                  updateUrl(nextPhase, startDate, endDate, selectedGroupId);
                }}
                className="w-full sm:w-52 rounded-lg border border-slate-300 bg-slate-50/50 px-2.5 py-1 text-xs font-semibold text-slate-800 shadow-2xs focus:border-indigo-600 focus:bg-white focus:outline-none transition cursor-pointer"
              >
                <option value="ALL">🌐 Promedio General (Todas)</option>
                {phasesList.filter((p) => availablePhases.includes(p.id)).map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    Fase {p.id}: {p.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <span className="rounded-lg bg-purple-50 border border-purple-200 px-2 py-0.5 text-[11px] font-bold text-purple-700 flex items-center gap-1">
                🎯 Modalidad Curso
              </span>
            </div>
          )}
        </div>

        {/* Selector de Rango de Fechas */}
        <div className="flex flex-wrap items-center gap-1.5 border-t lg:border-t-0 pt-2 lg:pt-0 border-slate-100">
          <div className="flex items-center gap-1 text-slate-600">
            <svg className="h-3.5 w-3.5 text-indigo-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 whitespace-nowrap">
              Fechas:
            </span>
          </div>

          <input
            type="date"
            value={startDate}
            onChange={(e) => {
              const val = e.target.value;
              setStartDate(val);
              updateUrl(selectedPhase, val, endDate, selectedGroupId);
            }}
            className="rounded-lg border border-slate-300 bg-slate-50/50 px-2 py-1 text-xs font-medium text-slate-800 shadow-2xs focus:border-indigo-600 focus:bg-white focus:outline-none transition"
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
            className="rounded-lg border border-slate-300 bg-slate-50/50 px-2 py-1 text-xs font-medium text-slate-800 shadow-2xs focus:border-indigo-600 focus:bg-white focus:outline-none transition"
            title="Fecha final (Hasta)"
          />

          {hasDateFilter && (
            <button
              onClick={clearDateFilter}
              className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100 transition shadow-2xs"
              title="Limpiar filtro de fechas"
            >
              Limpiar fechas
            </button>
          )}
        </div>
      </div>

      {/* Carga de Archivos */}
      <UploadForm
        selectedGroupId={selectedGroupId}
        onDone={() => {
          listGroups().then(setAllGroups).catch(() => { });
          const activeId = getActiveGroupId();
          if (activeId && activeId !== selectedGroupId) {
            setSelectedGroupId(activeId);
            updateUrl(selectedPhase, startDate, endDate, activeId);
          } else {
            load();
          }
        }}
      />

      {/* Tarjetas de métricas rápidas compactas */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
        <div className="rounded-xl border border-slate-200/80 bg-white px-3.5 py-2.5 shadow-2xs">
          <span className="text-[11px] font-semibold text-slate-500">Conductores Evaluados</span>
          <p className="mt-0.5 text-xl font-black text-slate-900">{totalConductores}</p>
          <span className="text-[10px] text-slate-400">Total en vista</span>
        </div>

        <div className="rounded-xl border border-slate-200/80 bg-white px-3.5 py-2.5 shadow-2xs">
          <span className="text-[11px] font-semibold text-slate-500">Promedio General</span>
          <p className="mt-0.5 text-xl font-black text-slate-900">{promedioGeneral}</p>
          <div className="mt-0.5 flex items-center gap-1.5">
            <span
              className={`h-2 w-2 rounded-full ${promedioGeneral >= 8 ? "bg-emerald-500" : promedioGeneral >= 6 ? "bg-amber-500" : "bg-rose-500"
                }`}
            />
            <span className="text-[10px] font-medium text-slate-600">
              {promedioGeneral >= 8 ? "Satisfactorio" : promedioGeneral >= 6 ? "Regular" : "No Apto"}
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 px-3.5 py-2.5 shadow-2xs">
          <span className="text-[11px] font-semibold text-emerald-700">Aptos</span>
          <p className="mt-0.5 text-xl font-black text-emerald-700">{aptos}</p>
          <span className="text-[10px] text-emerald-600/80">
            {totalConductores > 0 ? `${Math.round((aptos / totalConductores) * 100)}% aprobación` : "Sin datos"}
          </span>
        </div>

        <div className="rounded-xl border border-rose-100 bg-rose-50/50 px-3.5 py-2.5 shadow-2xs">
          <span className="text-[11px] font-semibold text-rose-700">No Aptos</span>
          <p className="mt-0.5 text-xl font-black text-rose-700">{noAptos}</p>
          <span className="text-[10px] text-rose-600/80">
            {totalConductores > 0 ? `${Math.round((noAptos / totalConductores) * 100)}% en riesgo` : "Sin datos"}
          </span>
        </div>
      </div>

      {/* Tarjeta de Última Evaluación Registrada */}
      {latestEval && (() => {
        const latestEnv = resolveExerciseEnvironment(
          latestEval.exercise || latestEval.unit,
          latestEval.groupId || selectedGroupId || null
        );

        const envAvatar =
          latestEnv === "MONTANA"
            ? {
                bg: "bg-gradient-to-tr from-amber-600 to-orange-500 text-white border-amber-200/60 shadow-amber-600/20",
                icon: (
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m8 3 4 8 5-5 5 11H2L8 3z" />
                  </svg>
                ),
                title: "Entorno Montaña / Sierra",
              }
            : latestEnv === "CIUDAD"
              ? {
                  bg: "bg-gradient-to-tr from-blue-600 to-cyan-500 text-white border-blue-200/60 shadow-blue-600/20",
                  icon: (
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                    </svg>
                  ),
                  title: "Entorno Ciudad / Maniobras Urbanas",
                }
              : {
                  bg: "bg-gradient-to-tr from-emerald-600 to-teal-500 text-white border-emerald-200/60 shadow-emerald-600/20",
                  icon: (
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 19L9 5m11 14l-5-14M12 5v3m0 4v3m0 4v2" />
                    </svg>
                  ),
                  title: "Entorno Carretera / Autopista",
                };

        return (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-indigo-100 bg-gradient-to-r from-indigo-50/70 via-white to-blue-50/40 px-4 py-2.5 shadow-2xs">
            <div className="flex items-center gap-3 min-w-0">
              <div
                className={`relative flex h-10 w-10 items-center justify-center rounded-xl border shadow-sm shrink-0 ${envAvatar.bg}`}
                title={`${envAvatar.title} · Fase ${latestEval.phase}`}
              >
                {envAvatar.icon}
                <span className="absolute -bottom-1 -right-1 rounded-md bg-slate-900/80 px-1 py-0.2 text-[9px] font-mono font-bold text-white shadow-2xs leading-none">
                  F{latestEval.phase}
                </span>
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600">
                    Última Evaluación
                  </span>
                  <span className="text-slate-300">·</span>
                  <span className="text-xs font-bold text-slate-900 truncate">
                    {latestEval.driverName}
                  </span>
                  <span className="text-slate-300">·</span>
                  <span className="text-xs text-slate-600 font-medium truncate">
                    {latestEval.exercise || latestEval.unit}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 truncate flex items-center gap-2 mt-0.5">
                  <span>Fecha: <strong className="text-slate-700">{latestEval.date || "—"}</strong></span>
                  {latestEval.instructor && (
                    <>
                      <span>·</span>
                      <span>Instructor: <strong className="text-slate-700">{latestEval.instructor}</strong></span>
                    </>
                  )}
                  {latestEval.durationSec > 0 && (
                    <>
                      <span>·</span>
                      <span>Duración: <strong className="text-slate-700 font-mono">{Math.floor(latestEval.durationSec / 60)}:{String(latestEval.durationSec % 60).padStart(2, "0")}</strong></span>
                    </>
                  )}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 shrink-0 self-end sm:self-auto">
              <div className="flex items-center gap-2">
                <div className="text-right">
                  <span className="block text-[10px] uppercase font-semibold text-slate-400">Calificación</span>
                  <span className="text-base font-black font-mono text-indigo-700">{latestEval.score}</span>
                  <span className="text-[10px] text-slate-400">/10</span>
                </div>
                <div className="text-right pl-2 border-l border-slate-200">
                  <span className="block text-[10px] uppercase font-semibold text-slate-400">Errores</span>
                  <span className={`text-base font-bold font-mono ${latestEval.errorCount > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                    {latestEval.errorCount}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => openDriver(latestEval.driverId, latestEval.groupId)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 hover:border-indigo-300 transition shadow-2xs cursor-pointer"
                title="Abrir expediente del conductor"
              >
                <span>Ver Expediente</span>
                <svg className="h-3.5 w-3.5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>
        );
      })()}

      {/* Tabla Principal de Conductores */}
      <section className="rounded-xl border border-slate-200/80 bg-white shadow-2xs overflow-hidden">
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 px-4 py-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              {selectedPhase === null ? "Resultados Globales de Conductores" : `Conductores en Fase ${selectedPhase}`}
            </h2>
            <p className="text-[11px] text-slate-500">
              Haz clic sobre el encabezado de cualquier columna para ordenar.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Buscador de conductor */}
            <div className="relative min-w-[200px] sm:min-w-[240px]">
              <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2.5 text-slate-400">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </span>
              <input
                type="text"
                value={driverSearchQuery}
                onChange={(e) => setDriverSearchQuery(e.target.value)}
                placeholder="Buscar conductor por nombre..."
                className="w-full rounded-xl border border-slate-300 bg-slate-50/50 py-1.5 pl-8 pr-7 text-xs text-slate-800 placeholder-slate-400 focus:border-indigo-600 focus:bg-white focus:outline-none transition shadow-xs"
              />
              {driverSearchQuery && (
                <button
                  type="button"
                  onClick={() => setDriverSearchQuery("")}
                  className="absolute inset-y-0 right-0 flex items-center pr-2 text-slate-400 hover:text-slate-600"
                  title="Limpiar búsqueda"
                >
                  <span className="text-xs">✕</span>
                </button>
              )}
            </div>

            <button
              onClick={handleExportExecutiveSummary}
              disabled={!sortedRows || sortedRows.length === 0 || isLoadingExecutivePreview}
              className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 hover:text-slate-900 disabled:opacity-40 disabled:cursor-not-allowed transition"
              title="Revisar el Resumen Ejecutivo antes de generar el PDF"
            >
              {isLoadingExecutivePreview ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-500 border-t-transparent" />
              ) : (
                <svg className="h-4 w-4 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              )}
              <span>{isLoadingExecutivePreview ? "Preparando vista previa…" : "Resumen Ejecutivo (PDF)"}</span>
            </button>

            <button
              onClick={handleExportZip}
              disabled={!rows || rows.length === 0 || isExportingZip}
              className="flex items-center gap-2 rounded-xl bg-linear-to-r from-indigo-600 to-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm shadow-indigo-600/20 hover:from-indigo-700 hover:to-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
              title={selectedGroupId ? "Descargar reportes, expedientes y diplomas de todos los conductores del grupo" : "Descargar reportes y expedientes; selecciona un grupo para incluir sus diplomas"}
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
            {driverSearchQuery.trim()
              ? `No se encontraron conductores que coincidan con "${driverSearchQuery}".`
              : "No se encontraron evaluaciones con los filtros seleccionados."}
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
                    onClick={() => handleSort("lastDate")}
                    className="cursor-pointer py-3.5 px-4 hover:bg-slate-100 transition text-center"
                    title="Fecha de la última conducción registrada"
                  >
                    <div className="flex items-center justify-center gap-1.5">
                      <span>Última Conducción</span>
                      {sortField === "lastDate" && (
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
                {tableItems.map((item) => {
                  if (item.type === "group") {
                    return (
                      <tr key={item.key} className="border-y border-slate-200 bg-slate-50/90">
                        <td colSpan={7} className="px-4 py-2.5">
                          <div className="flex items-center justify-between gap-3">
                            <span className="font-bold text-slate-800">{item.groupName}</span>
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                              {item.count} {item.count === 1 ? "conductor" : "conductores"}
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  const r = item.row;
                  return (
                  <tr
                    key={item.key}
                    onClick={() => openDriver(r.driverId, r.groupId)}
                    className="hover:bg-slate-50/60 transition group cursor-pointer"
                  >
                    <td className="px-4 py-3.5">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openDriver(r.driverId, r.groupId);
                        }}
                        className="text-left font-bold text-slate-900 group-hover:text-indigo-600 transition cursor-pointer"
                      >
                        {r.driver}
                      </button>
                    </td>
                    <td className="px-4 py-3.5 text-center font-mono text-slate-600">
                      {r.lastDate || "—"}
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
                            className={`h-full rounded-full ${r.avgScore >= 8 ? "bg-emerald-500" : r.avgScore >= 6 ? "bg-amber-500" : "bg-rose-500"
                              }`}
                            style={{ width: `${Math.min(100, Math.max(0, r.avgScore * 10))}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                        {r.isIncomplete && r.verdict !== "INCOMPLETO" && r.verdict !== "NO REALIZADO" && (
                          <span className="inline-block rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[10px] font-bold tracking-wide text-amber-700">
                            Ejercicios incompletos
                          </span>
                        )}
                        <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold tracking-wide ${r.color}`}>
                          {r.verdict}
                        </span>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Modal de confirmación para vaciar evaluaciones del grupo seleccionado */}
      {activeDriverId && (
        <DriverModal
          isOpen={!!activeDriverId}
          driverId={activeDriverId}
          groupId={activeDriverGroupId ?? selectedGroupId}
          startDate={startDate}
          endDate={endDate}
          onClose={() => setActiveDriverId(null)}
          onNavigatePrev={handlePrevDriver}
          onNavigateNext={handleNextDriver}
          hasPrev={hasPrevDriver}
          hasNext={hasNextDriver}
          currentIndex={activeDriverIndex >= 0 ? activeDriverIndex : undefined}
          totalDrivers={sortedRows?.length}
        />
      )}

      {executivePreview && (
        <ExecutiveSummaryPreviewModal
          {...executivePreview}
          onClose={() => setExecutivePreview(null)}
          onDownload={handleDownloadExecutiveSummary}
        />
      )}

      {showConfirmModal && currentGroupObj && (
        <div
          onClick={() => {
            if (!isDeleting) setShowConfirmModal(false);
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl space-y-4"
          >
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
