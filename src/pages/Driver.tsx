import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { phaseName, CRITICAL_LIMIT } from "../lib/config";
import { SEVERITIES, SEVERITY_ORDER, classify, getCatalog, type Severity } from "../lib/catalog";
import { driverData, updateEvaluationMarks, type DateFilter, type EvaluationView } from "../lib/db";
import { resolveExerciseEnvironment } from "../lib/exercises";
import { computeTelemetryAxes } from "../lib/telemetryRadar";
import { generatePedagogicalRecommendations } from "../lib/recommendations";
import { downloadDriverPdf } from "../lib/pdfExport";
import { useAuth } from "../components/AuthProvider";
import type { Mark } from "../lib/parse";

type Data = NonNullable<Awaited<ReturnType<typeof driverData>>>;
type BreakdownItem = Data["breakdown"][number];

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

type SortField = "time" | "description" | "severity";
type SortDirection = "asc" | "desc";

export default function Driver() {
  const { id = "" } = useParams();
  const [searchParams] = useSearchParams();
  const groupParam = searchParams.get("grupo") || "";
  const startDateParam = searchParams.get("desde") || "";
  const endDateParam = searchParams.get("hasta") || "";

  const dateFilter = useMemo<DateFilter>(
    () => ({
      groupId: groupParam || undefined,
      startDate: startDateParam || undefined,
      endDate: endDateParam || undefined,
    }),
    [groupParam, startDateParam, endDateParam]
  );

  const [data, setData] = useState<Data | null | undefined>(undefined);
  const [error, setError] = useState("");
  const [selectedEval, setSelectedEval] = useState<EvaluationView | null>(null);

  // Filtro de severidad para la sección Puntos Débiles (ALL = todas)
  const [activeSeverityTab, setActiveSeverityTab] = useState<Severity | "ALL">("ALL");

  // Estado de ordenamiento para el modal de errores
  const [sortField, setSortField] = useState<SortField>("time");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  // Estados para agregar o anular errores manualmente
  const { user } = useAuth();
  const [isSavingMarks, setIsSavingMarks] = useState(false);
  const [marksActionError, setMarksActionError] = useState("");
  const [showAddErrorForm, setShowAddErrorForm] = useState(false);
  const [selectedCatalogError, setSelectedCatalogError] = useState<string>("");
  const [customErrorText, setCustomErrorText] = useState<string>("");
  const [manualErrorTime, setManualErrorTime] = useState<string>("00:00:00");

  useEffect(() => {
    setData(undefined);
    driverData(id, dateFilter).then(setData).catch((e: Error) => setError(e.message));
  }, [id, dateFilter]);

  // Al cambiar de ejercicio seleccionado, reiniciar al orden por defecto cronológico
  useEffect(() => {
    setSortField("time");
    setSortDirection("asc");
    setMarksActionError("");
    setShowAddErrorForm(false);
    setCustomErrorText("");
    setManualErrorTime("00:00:00");
  }, [selectedEval?.docId, selectedEval?.fileName]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const breakdownList: BreakdownItem[] = useMemo(() => data?.breakdown ?? [], [data]);

  // Agrupamiento y cálculos de Puntos Débiles para los gráficos y pestañas
  const { totalErrorsCount, breakdownBySeverity, maxErrorCount } = useMemo(() => {
    const bySev: Record<Severity, BreakdownItem[]> = {
      CRITICO: [],
      GRAVE: [],
      MODERADO: [],
      LEVE: [],
    };

    let total = 0;
    let maxCount = 1;

    for (const item of breakdownList) {
      bySev[item.severity].push(item);
      total += item.count;
      if (item.count > maxCount) maxCount = item.count;
    }

    return {
      totalErrorsCount: total,
      breakdownBySeverity: bySev,
      maxErrorCount: maxCount,
    };
  }, [breakdownList]);

  // Generar recomendaciones automáticas inteligentes
  const recommendations = useMemo(() => {
    if (!data) return [];
    // Si hay fases, recolectar los ejes de todas las fases
    const allAxes = data.phases.flatMap((p) => {
      const phaseEvals = (data.evals || []).filter((e) => e.phase === p.phase);
      return computeTelemetryAxes(phaseEvals, "", phaseEvals[0]?.groupId || groupParam || null).axes;
    });
    return generatePedagogicalRecommendations({
      overall: data.overall,
      verdict: data.verdict,
      criticalErrors: data.criticalErrors,
      breakdown: data.breakdown,
      radarAxes: allAxes,
      completedExercises: data.completedExercises,
      expectedExercises: data.expectedExercises,
    });
  }, [data, groupParam]);

  // Filtrar exclusivamente los eventos de tipo ERROR y calcular conteos por severidad para el modal
  const { sortedErrorMarks, severityCounts, ignoredErrorCount } = useMemo(() => {
    const counts: Record<Severity, number> = {
      CRITICO: 0,
      GRAVE: 0,
      MODERADO: 0,
      LEVE: 0,
    };

    if (!selectedEval) {
      return { sortedErrorMarks: [], severityCounts: counts, ignoredErrorCount: 0 };
    }

    const evalGroupId = selectedEval.groupId || groupParam || null;
    const evalEnv = resolveExerciseEnvironment(selectedEval.exercise || selectedEval.unit, evalGroupId);
    let ignoredCount = 0;

    const errors = selectedEval.marks
      .map((m, markIndex) => ({ ...m, markIndex }))
      .filter((m) => m.type === "ERROR")
      .map((m) => {
        const cls = classify(m.description, evalEnv, evalGroupId);
        if (m.ignored) {
          ignoredCount++;
        } else {
          counts[cls.severity] = (counts[cls.severity] || 0) + 1;
        }
        return {
          ...m,
          severity: cls.severity,
          weight: cls.weight,
        };
      });

    const sorted = [...errors].sort((a, b) => {
      // Mostrar primero los errores activos y al final los anulados como falso positivo
      if (Boolean(a.ignored) !== Boolean(b.ignored)) {
        return a.ignored ? 1 : -1;
      }
      let comparison = 0;
      if (sortField === "time") {
        comparison = a.time.localeCompare(b.time);
      } else if (sortField === "description") {
        comparison = a.description.localeCompare(b.description);
      } else if (sortField === "severity") {
        const rankA = SEVERITY_ORDER.indexOf(a.severity);
        const rankB = SEVERITY_ORDER.indexOf(b.severity);
        comparison = rankA - rankB || b.weight - a.weight;
      }
      return sortDirection === "asc" ? comparison : -comparison;
    });

    return { sortedErrorMarks: sorted, severityCounts: counts, ignoredErrorCount: ignoredCount };
  }, [selectedEval, sortField, sortDirection, groupParam]);

  // Catálogo de errores agrupado por severidad para el selector de error manual
  const catalogEntriesBySeverity = useMemo(() => {
    const evalGroupId = selectedEval?.groupId || groupParam || null;
    const evalEnv = selectedEval
      ? resolveExerciseEnvironment(selectedEval.exercise || selectedEval.unit, evalGroupId)
      : "CARRETERA";
    const cfg = getCatalog(evalGroupId);
    const grouped: Record<Severity, { name: string; severity: Severity }[]> = {
      CRITICO: [],
      GRAVE: [],
      MODERADO: [],
      LEVE: [],
    };
    for (const entry of cfg.entries) {
      const resolved = classify(entry.name, evalEnv, evalGroupId);
      grouped[resolved.severity].push({ name: entry.name, severity: resolved.severity });
    }
    return grouped;
  }, [selectedEval, groupParam]);

  // Normaliza formato de tiempo (ej. "03:15" -> "0:03:15" o "0:05:10")
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

  const applyMarksUpdate = async (newMarks: Mark[]) => {
    if (!selectedEval || isSavingMarks) return;
    setIsSavingMarks(true);
    setMarksActionError("");
    try {
      const evalGroupId = selectedEval.groupId || groupParam || null;
      const updatedEval = await updateEvaluationMarks(selectedEval, newMarks, evalGroupId);
      setSelectedEval(updatedEval);
      const refreshedData = await driverData(id, dateFilter);
      if (refreshedData) {
        setData(refreshedData);
      }
    } catch (e: unknown) {
      setMarksActionError(e instanceof Error ? e.message : "No se pudieron guardar los cambios.");
    } finally {
      setIsSavingMarks(false);
    }
  };

  const handleToggleIgnoreMark = async (markIndex: number) => {
    if (!selectedEval || selectedEval.frozen) return;
    const actor = user?.displayName || user?.email || "Instructor";
    const nextMarks = selectedEval.marks.map((m, idx) => {
      if (idx !== markIndex) return m;
      const nextIgnored = !m.ignored;
      return {
        ...m,
        ignored: nextIgnored,
        ignoredBy: nextIgnored ? actor : undefined,
        ignoredAt: nextIgnored ? Date.now() : undefined,
      };
    });
    await applyMarksUpdate(nextMarks);
  };

  const handleDeleteManualMark = async (markIndex: number) => {
    if (!selectedEval || selectedEval.frozen) return;
    const nextMarks = selectedEval.marks.filter((_, idx) => idx !== markIndex);
    await applyMarksUpdate(nextMarks);
  };

  const handleAddManualError = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEval || selectedEval.frozen) return;
    const desc =
      selectedCatalogError === "__CUSTOM__"
        ? customErrorText.trim()
        : selectedCatalogError.trim();

    if (!desc) {
      setMarksActionError("Selecciona o escribe la descripción del error a agregar.");
      return;
    }

    const actor = user?.displayName || user?.email || "Instructor";
    const newMark: Mark = {
      time: formatMarkTime(manualErrorTime),
      type: "ERROR",
      description: desc,
      manual: true,
      addedBy: actor,
      addedAt: Date.now(),
    };

    await applyMarksUpdate([...selectedEval.marks, newMark]);
    setCustomErrorText("");
    setShowAddErrorForm(false);
  };

  if (error) {
    return (
      <main className="mx-auto max-w-6xl p-6">
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-rose-700 text-sm">
          {error}
        </div>
      </main>
    );
  }

  if (data === undefined) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-slate-500">
        <div className="flex items-center gap-3">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
          <span className="text-sm">Cargando expediente del conductor…</span>
        </div>
      </div>
    );
  }

  if (data === null) {
    return (
      <main className="mx-auto max-w-6xl p-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center space-y-3 shadow-sm">
          <p className="text-slate-600">Conductor no encontrado en el sistema.</p>
          <Link to="/" className="inline-block rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 transition">
            ← Volver al listado
          </Link>
        </div>
      </main>
    );
  }

  const { name, evals, missingExercises = [], phases, overall, completedExercises, expectedExercises, criticalErrors, verdict, color } = data;
  const phasesWithActivity = phases.filter((p) => p.exercises > 0).length;

  // Combinar ejercicios evaluados y ejercicios no realizados ordenados por fase
  const allExerciseRows = [
    ...evals.map((e) => ({ type: "done" as const, phase: e.phase, eval: e })),
    ...missingExercises.map((m, idx) => ({ type: "missing" as const, phase: m.phase, exercise: m.exercise, key: `missing-${m.phase}-${idx}-${m.exercise}` })),
  ].sort((a, b) => a.phase - b.phase || (a.type === "done" && b.type === "missing" ? -1 : a.type === "missing" && b.type === "done" ? 1 : 0));

  const displayedSeverities = activeSeverityTab === "ALL"
    ? SEVERITY_ORDER
    : [activeSeverityTab];

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      {/* Top back & title */}
      <div>
        <Link
          to={groupParam ? `/?grupo=${groupParam}` : "/"}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-700 transition mb-3"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Volver a resultados
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-tr from-indigo-600 to-blue-600 text-lg font-bold text-white shadow-md shadow-indigo-600/20">
              {name.charAt(0).toUpperCase()}
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900">{name}</h1>
              <p className="text-xs text-slate-500">Expediente de Desempeño y Telemetría</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={async () => {
                if (isExportingPdf || !data) return;
                try {
                  setIsExportingPdf(true);
                  await downloadDriverPdf(id, name, dateFilter);
                } catch (e: any) {
                  console.error("Error al exportar expediente PDF:", e);
                  window.print();
                } finally {
                  setIsExportingPdf(false);
                }
              }}
              disabled={isExportingPdf}
              className="no-print inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50 hover:text-indigo-600 disabled:opacity-50 transition cursor-pointer"
              title="Descargar el expediente oficial en formato PDF"
            >
              {isExportingPdf ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
              ) : (
                <svg className="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                </svg>
              )}
              <span>{isExportingPdf ? "Generando PDF..." : "Exportar Expediente PDF"}</span>
            </button>
            {completedExercises < expectedExercises && (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">
                Ejercicios incompletos
              </span>
            )}
            <span className={`rounded-full px-3.5 py-1 text-xs font-bold ${color}`}>
              {verdict}
            </span>
          </div>
        </div>
      </div>

      {/* Main Score Card */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="sm:col-span-2 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm flex flex-col justify-between">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Calificación Global Promediada
            </span>
            <div className="mt-2 flex items-baseline gap-3">
              <span className="text-5xl font-black text-slate-900 tracking-tight">{overall}</span>
              <span className="text-sm text-slate-500">/ 10 pts</span>
            </div>
            <p className="mt-2 text-xs text-slate-600">
              Calculada sobre {expectedExercises} ejercicio(s) esperados en {phases.length} fase(s) configuradas (70% seguridad y errores + 30% eficiencia y telemetría).
            </p>
          </div>

          <div className="mt-4 pt-4 border-t border-slate-100 space-y-1.5">
            {criticalErrors > 0 ? (
              <div className="flex items-center gap-2 text-xs text-rose-700">
                <span className="flex h-2 w-2 rounded-full bg-rose-500"></span>
                <span>
                  <strong>{criticalErrors} error(es) crítico(s) acumulados</strong>
                  {criticalErrors >= CRITICAL_LIMIT ? " — Causa dictamen eliminatorio" : ""}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs text-emerald-700">
                <span className="flex h-2 w-2 rounded-full bg-emerald-500"></span>
                <span>Sin faltas críticas en su historial</span>
              </div>
            )}
            {completedExercises < expectedExercises && (
              <div className="flex items-center gap-2 text-xs text-amber-700">
                <span className="flex h-2 w-2 rounded-full bg-amber-500"></span>
                <span>
                  <strong>Ejercicios incompletos</strong> — Faltan {expectedExercises - completedExercises} de {expectedExercises} ejercicio(s) por realizar
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm flex flex-col justify-center">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Ejercicios Realizados
          </span>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-3xl font-extrabold text-slate-900">{completedExercises}</span>
            <span className="text-base font-semibold text-slate-400">/ {expectedExercises}</span>
          </div>
          <span className="mt-3 text-xs text-slate-600">
            Fases con avance: <strong className="text-slate-900">{phasesWithActivity} de {phases.length}</strong>
          </span>
        </div>
      </div>

      {/* Tarjeta de Recomendaciones Automatizadas para el Instructor */}
      {recommendations.length > 0 && (
        <section className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/60 via-white to-blue-50/40 p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-xs">
                💡
              </span>
              <div>
                <h3 className="text-sm font-bold text-slate-900">Recomendaciones Automatizadas del Expediente</h3>
                <p className="text-[11px] text-slate-500">
                  Directrices pedagógicas calculadas según las incidencias y la telemetría del operador
                </p>
              </div>
            </div>
            <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-[10px] font-bold text-indigo-700">
              {recommendations.length} {recommendations.length === 1 ? "observación" : "observaciones"}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
            {recommendations.map((rec) => {
              const badgeColors =
                rec.priority === "ALTA"
                  ? "bg-rose-50 text-rose-700 border-rose-200"
                  : rec.priority === "MEDIA"
                  ? "bg-amber-50 text-amber-700 border-amber-200"
                  : "bg-emerald-50 text-emerald-700 border-emerald-200";

              return (
                <div
                  key={rec.id}
                  className="rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-xs flex flex-col justify-between hover:border-indigo-300 transition"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm">{rec.icon}</span>
                      <span className={`rounded-md border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider ${badgeColors}`}>
                        {rec.category} · Prioridad {rec.priority}
                      </span>
                    </div>
                    <h4 className="mt-1.5 text-xs font-bold text-slate-900">{rec.title}</h4>
                    <p className="mt-1 text-[11px] text-slate-600 leading-relaxed">{rec.description}</p>
                  </div>
                  <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-start gap-1.5 text-[11px] text-indigo-900 bg-indigo-50/50 -mx-1 -mb-1 p-2 rounded-lg">
                    <span className="font-bold text-indigo-700 shrink-0">Acción:</span>
                    <span className="text-slate-700">{rec.actionItem}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Resumen por Fase */}
      <section className="space-y-3">
        <h2 className="text-base font-bold text-slate-900">Progreso por Fase</h2>
        {phases.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center space-y-2 shadow-xs">
            <p className="text-xs font-semibold text-slate-700">
              No hay fases ni ejercicios configurados para este grupo.
            </p>
            <p className="text-xs text-slate-500">
              Asigna los ejercicios esperados de cada fase en la pestaña{" "}
              <Link
                to={groupParam ? `/ejercicios?grupo=${groupParam}` : "/ejercicios"}
                className="font-bold text-indigo-600 underline hover:text-indigo-700"
              >
                Ejercicios
              </Link>{" "}
              para calcular el progreso y las calificaciones del conductor.
            </p>
          </div>
        ) : (
          <div className="grid gap-6 grid-cols-1">
            {phases.map((p) => {
              // Evaluaciones correspondientes a esta fase para promediar ejes de telemetría
              const phaseEvals = evals.filter((e) => e.phase === p.phase);
              const phaseGroupId = phaseEvals[0]?.groupId || groupParam || null;
              // Pasamos las evaluaciones completas con su ejercicio específico para que se calibre cada entorno individualmente
              const radarSummary = computeTelemetryAxes(phaseEvals, "", phaseGroupId);
              const axes = radarSummary.axes;
              const envLabel = radarSummary.environmentLabel;

              // Calcular benchmark del grupo o flota para esta misma fase o curso completo
              // En modalidad Curso (p.phase === 0), emparejar con todas las evaluaciones de la flota o grupo
              const groupPhaseEvals = (data.groupEvals || []).filter(
                (ge) => p.phase === 0 || ge.phase === p.phase || (data.groupType === "curso")
              );
              const groupRadarSummary = groupPhaseEvals.length > 0 ? computeTelemetryAxes(groupPhaseEvals, "", phaseGroupId) : null;
              const groupAxes = groupRadarSummary?.axes;

              // Coordenadas para radar en layout visual completo (size: 340x290, radius: 80)
              const width = 340;
              const height = 290;
              const centerX = width / 2;
              const centerY = height / 2;
              const radius = 80;

              const getCoords = (index: number, val: number, customRadius = radius) => {
                const angle = (Math.PI * 2 / axes.length) * index - Math.PI / 2;
                const r = (val / 100) * customRadius;
                return {
                  x: centerX + r * Math.cos(angle),
                  y: centerY + r * Math.sin(angle),
                };
              };

              const radarPolygonPoints = axes
                .map((a, i) => {
                  const c = getCoords(i, a.value);
                  return `${c.x.toFixed(1)},${c.y.toFixed(1)}`;
                })
                .join(" ");

              const groupPolygonPoints = groupAxes
                ? groupAxes
                    .map((ga, i) => {
                      const c = getCoords(i, ga.value);
                      return `${c.x.toFixed(1)},${c.y.toFixed(1)}`;
                    })
                    .join(" ")
                : "";

              return (
                <div
                  key={p.phase}
                  className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm space-y-4"
                >
                  {/* Encabezado Principal de la Fase o del Curso */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
                    <div className="flex items-center gap-3">
                      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-black text-sm ${
                        p.phase === 0 ? "bg-purple-100 text-purple-700" : "bg-indigo-50 text-indigo-600"
                      }`}>
                        {p.phase === 0 ? "🎯" : `F${p.phase}`}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] font-bold uppercase tracking-wider ${
                            p.phase === 0 ? "text-purple-700" : "text-indigo-600"
                          }`}>
                            {p.phase === 0 ? "Curso Completo" : `Fase ${p.phase}`}
                          </span>
                          <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${p.color}`}>
                            {p.verdict}
                          </span>
                        </div>
                        <h3 className="text-base font-bold text-slate-900 leading-snug">
                          {p.phase === 0 ? "Evaluación Integral del Curso" : phaseName(p.phase)}
                        </h3>
                      </div>
                    </div>

                    {/* Resumen rápido de métricas de la fase */}
                    <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs">
                      <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-1.5 flex items-center gap-1.5">
                        <span className="text-[11px] text-slate-400 font-medium">Ejercicios:</span>
                        <strong className="text-slate-800 font-bold">{p.exercises}</strong>
                        <span className="text-slate-400 text-[10px]">/ {p.expected}</span>
                      </div>

                      <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-1.5 flex items-center gap-1.5">
                        <span className="text-[11px] text-slate-400 font-medium">Infracciones:</span>
                        <strong className={p.errors > 0 ? "text-rose-600 font-bold" : "text-emerald-600 font-bold"}>
                          {p.errors}
                        </strong>
                      </div>

                      <div className="rounded-xl bg-indigo-50/70 border border-indigo-100 px-3 py-1.5 flex items-center gap-1.5">
                        <span className="text-[11px] text-indigo-600 font-medium">Calif. Promedio:</span>
                        <strong className="text-sm font-black font-mono text-indigo-700">{p.avgScore}</strong>
                        <span className="text-indigo-400 text-[10px]">/ 10</span>
                      </div>
                    </div>
                  </div>

                  {/* Sección de Indicadores de Telemetría · Perfil Radar (Idéntica al ejercicio) */}
                  <div className="space-y-3 rounded-2xl border border-slate-200/80 bg-slate-50/60 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
                            <svg className="h-4 w-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                            Indicadores de Telemetría · Perfil Radar
                          </h4>
                          <span className="rounded-full bg-slate-200/80 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                            {envLabel}
                          </span>
                          {radarSummary.hasSlipperyRoad && (
                            <span className="rounded-full bg-sky-100 border border-sky-300 px-2 py-0.5 text-[10px] font-bold text-sky-800 flex items-center gap-1">
                              🌧️ Pavimento mojado (Retarder off)
                              {radarSummary.slipperyCount < radarSummary.totalExercises && (
                                <span className="font-normal text-sky-700">
                                  ({radarSummary.slipperyCount}/{radarSummary.totalExercises} ej.)
                                </span>
                              )}
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-400">
                          {radarSummary.environment === "MIXTO"
                            ? `Calibrado dinámicamente por ejercicio (${radarSummary.environments
                                .map((e) => (e === "MONTANA" ? "Montaña" : e === "CIUDAD" ? "Ciudad" : "Carretera"))
                                .join(" / ")}) · Meta Verde media: ${radarSummary.greenTarget}%`
                            : `Calibrado para ${radarSummary.environment.toLowerCase()} (Meta Verde: ${radarSummary.greenTarget}%)`} · Promedio de la fase
                        </span>
                      </div>
                      <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-700 border border-emerald-200">
                        Puntaje Eco: {p.exercises > 0 ? `${radarSummary.ecoScore}/10` : "—"}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
                      {/* Gráfico de Radar SVG */}
                      <div className="md:col-span-6 flex flex-col items-center justify-center p-3 rounded-xl bg-white border border-slate-200/80 shadow-xs overflow-hidden">
                        <svg width={width} height={height} className="overflow-visible select-none">
                          {/* Círculos / Polígonos de cuadrícula guía (25%, 50%, 75%, 100%) */}
                          {[0.25, 0.5, 0.75, 1.0].map((step) => {
                            const gridPoints = axes
                              .map((_, i) => {
                                const c = getCoords(i, step * 100);
                                return `${c.x.toFixed(1)},${c.y.toFixed(1)}`;
                              })
                              .join(" ");
                            return (
                              <polygon
                                key={step}
                                points={gridPoints}
                                fill={step === 1.0 ? "#f8fafc" : "transparent"}
                                stroke="#e2e8f0"
                                strokeWidth="1"
                                strokeDasharray={step < 1.0 ? "2,2" : undefined}
                              />
                            );
                          })}

                          {/* Ejes radiales desde el centro */}
                          {axes.map((_, i) => {
                            const c = getCoords(i, 100);
                            return (
                              <line
                                key={i}
                                x1={centerX}
                                y1={centerY}
                                x2={c.x}
                                y2={c.y}
                                stroke="#e2e8f0"
                                strokeWidth="1"
                              />
                            );
                          })}

                          {/* Polígono del Grupo / Flota (Azul punteado tenue de Benchmark Comparativo) */}
                          {groupPolygonPoints && groupPhaseEvals.length > 0 && (
                            <polygon
                              points={groupPolygonPoints}
                              fill="rgba(191, 219, 254, 0.12)"
                              stroke="#93c5fd"
                              strokeWidth="1.8"
                              strokeDasharray="4,4"
                            />
                          )}

                          {/* Polígono del Operador (Relleno y Borde) */}
                          {p.exercises > 0 ? (
                            <polygon
                              points={radarPolygonPoints}
                              fill="rgba(16, 185, 129, 0.22)"
                              stroke="#059669"
                              strokeWidth="2.5"
                            />
                          ) : (
                            <text
                              x={centerX}
                              y={centerY + 4}
                              textAnchor="middle"
                              fontSize="11"
                              fontWeight="600"
                              fill="#94a3b8"
                            >
                              Sin ejercicios evaluados
                            </text>
                          )}

                          {/* Nodos de datos en cada eje con etiquetas de concepto y porcentaje */}
                          {axes.map((a, i) => {
                            const c = getCoords(i, a.value);
                            const labelCoords = getCoords(i, 100, radius + 32);
                            return (
                              <g key={i}>
                                {p.exercises > 0 && (
                                  <circle
                                    cx={c.x}
                                    cy={c.y}
                                    r="4"
                                    className="fill-emerald-600 stroke-white stroke-2"
                                  />
                                )}
                                <text
                                  x={labelCoords.x}
                                  y={labelCoords.y - 7}
                                  textAnchor="middle"
                                  dominantBaseline="central"
                                  className="text-[10px] font-bold fill-slate-800"
                                >
                                  {a.label}
                                </text>
                                <text
                                  x={labelCoords.x}
                                  y={labelCoords.y + 7}
                                  textAnchor="middle"
                                  dominantBaseline="central"
                                  className={`text-[9px] font-semibold font-mono ${
                                    p.exercises === 0
                                      ? "fill-slate-400"
                                      : a.value >= 75
                                      ? "fill-emerald-600"
                                      : a.value >= 50
                                      ? "fill-amber-600"
                                      : "fill-rose-600"
                                  }`}
                                >
                                  {p.exercises > 0 ? `${a.value}%` : "—"}
                                </text>
                              </g>
                            );
                          })}
                        </svg>

                        <div className="mt-2 flex flex-wrap items-center justify-center gap-3 text-[10px] text-slate-500">
                          <div className="flex items-center gap-1.5">
                            <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
                            <span className="font-semibold text-slate-700">Operador</span>
                          </div>
                          {groupPolygonPoints && groupPhaseEvals.length > 0 && (
                            <div className="flex items-center gap-1.5">
                              <span className="inline-block h-2 w-4 rounded-sm border-b-2 border-indigo-500 border-dashed bg-indigo-50"></span>
                              <span className="font-semibold text-indigo-700">Promedio Grupo ({groupPhaseEvals.length} ej.)</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Tarjetas complementarias con los valores reales */}
                      <div className="md:col-span-6 grid grid-cols-2 gap-2 text-xs">
                        {axes.map((axis, idx) => {
                          const isGreenAxis = axis.label === "Zona Verde" && "breakdown" in axis;
                          return (
                            <div
                              key={idx}
                              className={`rounded-lg bg-white p-2.5 border border-slate-200/80 ${
                                isGreenAxis ? "col-span-2" : ""
                              }`}
                            >
                              <div className="flex items-center justify-between text-[10px] text-slate-400">
                                <span className="font-semibold text-slate-700">{axis.label}</span>
                                <div className="flex items-center gap-1.5">
                                  {axis.meta && (
                                    <span className="text-[10px] text-slate-400 font-mono">
                                      ({axis.meta})
                                    </span>
                                  )}
                                  <span
                                    className={`font-bold font-mono ${
                                      p.exercises === 0
                                        ? "text-slate-400"
                                        : axis.value >= 75
                                        ? "text-emerald-600"
                                        : axis.value >= 50
                                        ? "text-amber-600"
                                        : "text-rose-600"
                                    }`}
                                  >
                                    {p.exercises > 0 ? `${axis.value}%` : "—"}
                                  </span>
                                </div>
                              </div>

                              {isGreenAxis && axis.breakdown ? (
                                <div className="mt-1.5 space-y-1.5">
                                  {/* Desglose de las 4 Zonas de RPM con colores diferenciados */}
                                  <div className="grid grid-cols-4 gap-1.5 text-center">
                                    <div className="rounded bg-slate-50 border border-slate-100 p-1">
                                      <span className="block text-[9px] text-slate-400 uppercase font-medium">Bajas RPM</span>
                                      <strong className="block text-[11px] font-mono text-slate-700 font-bold">
                                        {axis.breakdown.low}%
                                      </strong>
                                    </div>
                                    <div className="rounded bg-emerald-50 border border-emerald-200/60 p-1">
                                      <span className="block text-[9px] text-emerald-700 uppercase font-medium">Verde (Óptima)</span>
                                      <strong className="block text-[11px] font-mono text-emerald-800 font-bold">
                                        {axis.breakdown.green}%
                                      </strong>
                                    </div>
                                    <div className="rounded bg-amber-50 border border-amber-200/60 p-1">
                                      <span className="block text-[9px] text-amber-700 uppercase font-medium">Amarilla</span>
                                      <strong className="block text-[11px] font-mono text-amber-800 font-bold">
                                        {axis.breakdown.yellow}%
                                      </strong>
                                    </div>
                                    <div className="rounded bg-rose-50 border border-rose-200/60 p-1">
                                      <span className="block text-[9px] text-rose-700 uppercase font-medium">Roja</span>
                                      <strong className="block text-[11px] font-mono text-rose-800 font-bold">
                                        {axis.breakdown.red}%
                                      </strong>
                                    </div>
                                  </div>

                                  {/* Explicación de la condición y penalización */}
                                  <div className="text-[10px] flex items-center justify-between px-1 text-slate-500">
                                    <span>
                                      {axis.breakdown.isSlippery ? (
                                        <span className="text-sky-700 font-medium">
                                          ❄️ Clima adverso: se permite zona amarilla hasta 25% para retención por compresión segura.
                                        </span>
                                      ) : (
                                        <span>
                                          Retención en seco: la zona amarilla solo se admite con freno motor activo.
                                        </span>
                                      )}
                                    </span>
                                    {axis.breakdown.penalty > 0 ? (
                                      <span className="text-rose-600 font-bold font-mono">
                                        Penalización: -{axis.breakdown.penalty}%
                                      </span>
                                    ) : (
                                      <span className="text-emerald-600 font-semibold font-mono">
                                        ✓ Sin penalización
                                      </span>
                                    )}
                                  </div>
                                </div>
                              ) : (
                                <div className="mt-1 flex items-baseline justify-between gap-1">
                                  <strong className="text-slate-800 font-mono text-sm">
                                    {axis.raw}
                                  </strong>
                                </div>
                              )}

                              {/* Barra de progreso miniatura */}
                              <div className="mt-1.5 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${
                                    p.exercises === 0
                                      ? "bg-slate-200"
                                      : axis.value >= 75
                                      ? "bg-emerald-500"
                                      : axis.value >= 50
                                      ? "bg-amber-500"
                                      : "bg-rose-500"
                                  }`}
                                  style={{ width: `${axis.value}%` }}
                                />
                              </div>
                            </div>
                          );
                        })}

                        <div className="rounded-lg bg-white p-2.5 border border-slate-200/80 col-span-2 grid grid-cols-3 gap-2 text-center">
                          <div>
                            <span className="text-[10px] text-slate-400 block truncate">Consumo Reportado</span>
                            <span className="font-mono text-xs text-slate-800 font-semibold">
                              {radarSummary.metrics.avgConsumption !== undefined
                                ? `${radarSummary.metrics.avgConsumption} l/100km`
                                : "—"}
                            </span>
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-400 block truncate">Velocidad Med/Max</span>
                            <span className="font-mono text-xs text-slate-800 font-semibold">
                              {radarSummary.metrics.avgSpeed || "—"} / {radarSummary.metrics.maxSpeed || "—"} km/h
                            </span>
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-400 block truncate">RPM Max / Cambios</span>
                            <span className="font-mono text-xs text-slate-800 font-semibold">
                              {radarSummary.metrics.maxRpm || "—"} rpm · {radarSummary.metrics.gearChanges ?? "—"} c.
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Historial detallado de ejercicios */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">Desglose de Ejercicios Evaluados</h2>
            <p className="text-xs text-slate-500">Haz clic en el nombre de cualquier ejercicio para ver su reporte de errores y telemetría.</p>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">Fase</th>
                  <th className="px-4 py-3">Ejercicio / Unidad</th>
                  <th className="px-4 py-3">Fecha</th>
                  <th className="px-4 py-3">Instructor</th>
                  <th className="px-4 py-3">Duración</th>
                  <th className="px-4 py-3">Errores</th>
                  <th className="px-4 py-3 text-right">Calif. Final</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {allExerciseRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-xs text-slate-500">
                      Sin ejercicios asignados en el catálogo de este grupo.
                    </td>
                  </tr>
                ) : (
                  allExerciseRows.map((row) =>
                    row.type === "done" ? (
                      <tr
                        key={`${row.eval.phase}-${row.eval.fileName}`}
                        className="group hover:bg-indigo-50/30 transition cursor-pointer"
                        onClick={() => setSelectedEval(row.eval)}
                      >
                        <td className="px-4 py-3">
                          <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-700">
                            F{row.eval.phase}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-semibold text-slate-900">
                          <span className="text-indigo-600 group-hover:text-indigo-700 underline decoration-indigo-200 group-hover:decoration-indigo-500 underline-offset-2 transition">
                            {row.eval.exercise}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-500">{row.eval.date}</td>
                        <td className="px-4 py-3 text-slate-700">{row.eval.instructor}</td>
                        <td className="px-4 py-3 text-slate-500 font-mono">{fmt(row.eval.durationSec)}</td>
                        <td className="px-4 py-3 font-mono text-slate-700">
                          {row.eval.errorCount > 0 ? (
                            <span className="font-semibold text-rose-600">{row.eval.errorCount}</span>
                          ) : (
                            <span className="text-emerald-600">0</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-indigo-600">
                          {row.eval.score}
                        </td>
                      </tr>
                    ) : (
                      <tr key={row.key} className="bg-slate-50/60 text-slate-400">
                        <td className="px-4 py-3">
                          <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-500">
                            F{row.phase}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-500">
                          <div className="flex flex-wrap items-center gap-2">
                            <span>{row.exercise}</span>
                            <span className="inline-flex items-center rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600">
                              No realizado
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-400">—</td>
                        <td className="px-4 py-3 text-slate-400">—</td>
                        <td className="px-4 py-3 font-mono text-slate-400">—</td>
                        <td className="px-4 py-3 font-mono text-slate-400">—</td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-slate-400">0</td>
                      </tr>
                    )
                  )
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Puntos Débiles (Agrupados por Gravedad con Visualización Gráfica) */}
      <section className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">Puntos Débiles (Análisis por Gravedad)</h2>
            <p className="text-xs text-slate-500">Distribución porcentual e incidencias acumuladas en todas las fases.</p>
          </div>

          {/* Selector de pestañas por severidad */}
          {breakdownList.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
              <button
                onClick={() => setActiveSeverityTab("ALL")}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${activeSeverityTab === "ALL"
                  ? "bg-slate-900 text-white shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
                  }`}
              >
                Todos ({breakdownList.length})
              </button>
              {SEVERITY_ORDER.map((s) => {
                const count = breakdownBySeverity[s].length;
                return (
                  <button
                    key={s}
                    onClick={() => setActiveSeverityTab(s)}
                    disabled={count === 0}
                    className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition ${activeSeverityTab === s
                      ? "bg-indigo-50 text-indigo-700 border border-indigo-200"
                      : count === 0
                        ? "text-slate-300 cursor-not-allowed"
                        : "text-slate-600 hover:text-slate-900"
                      }`}
                  >
                    <span>{SEVERITIES[s].label}</span>
                    <span className="text-[10px] opacity-75 font-mono">({count})</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Gráfico de Distribución Visual (Stacked Bar) */}
        {totalErrorsCount > 0 && (
          <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm space-y-3">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
              <span>Proporción de Incidencias Totales ({totalErrorsCount} eventos acumulados)</span>
            </div>

            {/* Barra compuesta */}
            <div className="flex h-3.5 w-full overflow-hidden rounded-full bg-slate-100 p-0.5 border border-slate-200">
              {SEVERITY_ORDER.map((s) => {
                const totalInSev = breakdownBySeverity[s].reduce((sum, item) => sum + item.count, 0);
                const pct = totalErrorsCount > 0 ? (totalInSev / totalErrorsCount) * 100 : 0;
                if (pct === 0) return null;
                const barColor =
                  s === "CRITICO"
                    ? "bg-rose-500"
                    : s === "GRAVE"
                      ? "bg-orange-500"
                      : s === "MODERADO"
                        ? "bg-amber-500"
                        : "bg-slate-400";
                return (
                  <div
                    key={s}
                    style={{ width: `${pct}%` }}
                    className={`${barColor} transition-all duration-300 first:rounded-l-full last:rounded-r-full`}
                    title={`${SEVERITIES[s].label}: ${totalInSev} (${pct.toFixed(1)}%)`}
                  />
                );
              })}
            </div>

            {/* Leyenda interactiva */}
            <div className="grid grid-cols-2 gap-2 pt-1 sm:grid-cols-4">
              {SEVERITY_ORDER.map((s) => {
                const totalInSev = breakdownBySeverity[s].reduce((sum, item) => sum + item.count, 0);
                const pct = totalErrorsCount > 0 ? ((totalInSev / totalErrorsCount) * 100).toFixed(1) : "0";
                return (
                  <div key={s} className="flex items-center gap-2 text-xs">
                    <span className={`h-2.5 w-2.5 rounded-full ${SEVERITIES[s].dot}`} />
                    <span className="font-medium text-slate-700">{SEVERITIES[s].label}:</span>
                    <span className="font-bold font-mono text-slate-900">{totalInSev}</span>
                    <span className="text-[10px] text-slate-400 font-mono">({pct}%)</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Tarjetas agrupadas por nivel de gravedad con barras de frecuencia */}
        {breakdownList.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500 shadow-sm">
            Sin incidencias registradas en este expediente.
          </div>
        ) : (
          <div className="space-y-4">
            {displayedSeverities.map((sev) => {
              const items = breakdownBySeverity[sev];
              if (items.length === 0 && activeSeverityTab === "ALL") return null;

              return (
                <div
                  key={sev}
                  className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm space-y-3"
                >
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                    <div className="flex items-center gap-2">
                      <span className={`h-2.5 w-2.5 rounded-full ${SEVERITIES[sev].dot}`} />
                      <h3 className="text-sm font-bold text-slate-900">
                        Nivel {SEVERITIES[sev].label}
                      </h3>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${SEVERITIES[sev].badge}`}>
                        {items.length} {items.length === 1 ? "tipo de error" : "tipos de error"}
                      </span>
                    </div>
                    <span className="text-xs text-slate-400 font-mono">
                      {items.reduce((acc, i) => acc + i.count, 0)} incidencias en total
                    </span>
                  </div>

                  {items.length === 0 ? (
                    <p className="py-2 text-xs text-slate-400 italic">No hay faltas registradas en esta gravedad.</p>
                  ) : (
                    <div className="space-y-2.5">
                      {items.map((b, bIdx) => {
                        const barWidth = Math.max(8, Math.round((b.count / maxErrorCount) * 100));
                        return (
                          <div
                            key={`${b.description}_${b.environment || ""}_${bIdx}`}
                            className="group rounded-xl border border-slate-100 bg-slate-50/60 p-3 hover:border-slate-200 hover:bg-slate-50 transition"
                          >
                            <div className="flex items-center justify-between gap-3 text-xs mb-1.5">
                              <span className="font-semibold text-slate-800">{b.description}</span>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <span className="font-mono font-extrabold text-slate-900">{b.count}×</span>
                                <span className="text-[10px] text-slate-400">veces</span>
                              </div>
                            </div>

                            {/* Barra visual proporcional */}
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200/80">
                              <div
                                style={{ width: `${barWidth}%` }}
                                className={`h-full rounded-full transition-all duration-300 ${sev === "CRITICO"
                                  ? "bg-rose-500"
                                  : sev === "GRAVE"
                                    ? "bg-orange-500"
                                    : sev === "MODERADO"
                                      ? "bg-amber-500"
                                      : "bg-slate-400"
                                  }`}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Modal de Reporte Detallado del Ejercicio */}
      {selectedEval && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm modal-open-for-print">
          <div className="flex max-h-[92vh] w-full max-w-4xl flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden print-modal-content">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/80 px-6 py-4">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-700 font-bold text-xs shadow-xs">
                  F{selectedEval.phase}
                </span>
                <div>
                  <h3 className="text-base font-bold text-slate-900 leading-tight">
                    {selectedEval.exercise}
                  </h3>
                  <p className="text-xs text-slate-500 flex items-center gap-2 mt-0.5">
                    <span className="font-semibold text-slate-700">{selectedEval.driverName || data?.name || "Conductor"}</span>
                    <span>·</span>
                    <span>Fase {selectedEval.phase}: {phaseName(selectedEval.phase)}</span>
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="no-print inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition shadow-xs"
                  title="Exportar esta hoja a PDF"
                >
                  <svg className="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                  </svg>
                  <span>Imprimir / PDF</span>
                </button>
                <button
                  onClick={() => setSelectedEval(null)}
                  className="no-print rounded-xl p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition"
                  title="Cerrar reporte"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="overflow-y-auto p-6 space-y-6 print-modal-scroll">
              {/* Metadatos principales de la prueba */}
              <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-3.5 text-xs grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="col-span-2 sm:col-span-2">
                  <span className="text-slate-400">Conductor:</span>{" "}
                  <strong className="text-slate-900 font-bold">{selectedEval.driverName || data?.name || "—"}</strong>
                </div>
                <div>
                  <span className="text-slate-400">Fecha:</span>{" "}
                  <strong className="text-slate-700">{selectedEval.date || "—"}</strong>
                </div>
                <div>
                  <span className="text-slate-400">Instructor:</span>{" "}
                  <strong className="text-slate-700">{selectedEval.instructor || "—"}</strong>
                </div>
                {selectedEval.vehicle && (
                  <div className="col-span-2 sm:col-span-4 pt-1 border-t border-slate-200/50 mt-1">
                    <span className="text-slate-400">Vehículo:</span>{" "}
                    <strong className="text-slate-700">{selectedEval.vehicle}</strong>
                  </div>
                )}
                {selectedEval.fileName && (
                  <div className="col-span-2 sm:col-span-4 truncate text-[11px]">
                    <span className="text-slate-400">Archivo origen:</span>{" "}
                    <span className="font-mono text-slate-600">{selectedEval.fileName}</span>
                  </div>
                )}
              </div>

              {/* Tarjetas de Calificación Compuesta */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-3">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-700">
                    Nota Final
                  </span>
                  <div className="mt-1 flex items-baseline gap-1">
                    <span className="text-2xl font-black font-mono text-indigo-600">{selectedEval.score}</span>
                    <span className="text-xs text-indigo-400">/ 10</span>
                  </div>
                  <span className="block text-[10px] text-indigo-600/80 mt-0.5">
                    {selectedEval.pacing?.isPacingDeficit ? (
                      <span className="text-rose-600 font-semibold" title={selectedEval.pacing.reason}>
                        ⚠️ -{selectedEval.pacing.penaltyDeduction} pts (ritmo lento)
                      </span>
                    ) : selectedEval.telemetryScore !== undefined ? (
                      "70% destreza + 30% eco"
                    ) : (
                      "100% destreza"
                    )}
                  </span>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    Destreza Operativa (70%)
                  </span>
                  <div className="mt-1 text-2xl font-bold font-mono text-slate-900">
                    {selectedEval.errorScore}
                  </div>
                  <span className="block text-[10px] text-slate-400 mt-0.5">
                    {selectedEval.errorCount} error(es)
                  </span>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    Eco-Drive (30%)
                  </span>
                  <div className="mt-1 text-2xl font-bold font-mono text-slate-900">
                    {selectedEval.telemetryScore !== undefined ? selectedEval.telemetryScore : "—"}
                  </div>
                  <span className="block text-[10px] text-slate-400 mt-0.5 truncate" title="Ponderado: RPM, Freno, Inercia y Consumo">
                    {selectedEval.telemetry?.pctGreenZone !== undefined ? `RPM verde ${selectedEval.telemetry.pctGreenZone}%` : "No disponible"}
                  </span>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    Duración
                  </span>
                  <div className="mt-1 text-2xl font-bold font-mono text-slate-900">
                    {fmt(selectedEval.durationSec)}
                  </div>
                  <span className="block text-[10px] text-slate-400 mt-0.5">
                    {selectedEval.criticalCount > 0 ? `${selectedEval.criticalCount} crítico(s)` : "Sin críticos"}
                  </span>
                </div>
              </div>

              {/* Banner de Penalización por Conducción Evasiva / Ritmo Lento */}
              {selectedEval.pacing?.isPacingDeficit && (
                <div className="rounded-xl border border-rose-200 bg-rose-50/80 p-3.5 text-rose-900 shadow-sm">
                  <div className="flex items-start gap-2.5">
                    <span className="text-xl">⚠️</span>
                    <div className="flex-1 text-xs">
                      <div className="flex items-center justify-between">
                        <strong className="font-bold text-rose-950">
                          Penalización por Conducción Evasiva / Velocidad Anormalmente Reducida
                        </strong>
                        <span className="rounded bg-rose-200 px-2 py-0.5 font-mono font-bold text-rose-900">
                          -{selectedEval.pacing.penaltyDeduction} pts
                        </span>
                      </div>
                      <p className="mt-1 text-rose-800">
                        {selectedEval.pacing.reason}.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Indicadores Genéricos de Telemetría (con Gráfico de Radar) */}
              {selectedEval.telemetry && Object.keys(selectedEval.telemetry).length > 0 && (() => {
                const tel = selectedEval.telemetry;
                const env = resolveExerciseEnvironment(selectedEval.exercise, selectedEval.groupId || groupParam || null);

                // Ejes normalizados de 0 a 100 para el gráfico de radar según el entorno
                // 1. Rango RPM (Zona verde vs meta del entorno, penalizado por zona roja y zona amarilla sin freno de motor)
                const greenTarget = env === "MONTANA" ? 48 : env === "CIUDAD" ? 58 : 75;
                const rawRpmRatio = ((tel.pctGreenZone || 0) / greenTarget) * 100;
                let rpmPenalty = (tel.pctRedZone || 0) * 25;
                const yellowZone = tel.pctYellowZone || 0;
                const auxBrakeSec = tel.auxBrakeTimeSec || 0;
                const hasSlippery = Boolean(tel.hasSlipperyRoad);
                if (yellowZone > 0) {
                  if (hasSlippery) {
                    // En lluvia/nieve: permisivo por técnica de retención por marcha/compresión (sin retarder para evitar tijera)
                    if (yellowZone > 25) rpmPenalty += (yellowZone - 25) * 1.5;
                  } else if (auxBrakeSec <= 1) {
                    rpmPenalty += yellowZone * 5; // Castigo en seco por amarilla sin freno de motor
                  } else {
                    if (env === "MONTANA") {
                      if (yellowZone > 20) rpmPenalty += (yellowZone - 20) * 3;
                    } else {
                      if (yellowZone > 8) rpmPenalty += (yellowZone - 8) * 3;
                    }
                  }
                }
                const axisRpm = Math.max(0, Math.min(100, Math.round(rawRpmRatio - rpmPenalty)));

                // 2. Control de Frenado Suave con escala diferenciada por entorno:
                const harshBrakes = tel.brakeAbove60Uses || 0;
                const brakeTolerance = env === "CIUDAD" ? 3 : env === "MONTANA" ? 1 : 0;
                let brakePenalty = 0;
                if (env === "CIUDAD") {
                  if (harshBrakes > 3) brakePenalty = (harshBrakes - 3) * 5;
                } else if (env === "MONTANA") {
                  if (harshBrakes > 1) brakePenalty = (harshBrakes - 1) * 8;
                } else {
                  brakePenalty = harshBrakes * 10;
                }
                const axisBrake = Math.max(0, 100 - brakePenalty);
                const brakeTargetLabel = brakeTolerance > 0 ? `meta ≤${brakeTolerance}` : "meta 0";

                // Tiempo de freno de servicio en segundos
                let serviceBrakeSec = 0;
                if (tel.brakeTime && tel.brakeTime !== "00:00") {
                  const bParts = tel.brakeTime.split(":").map(Number);
                  serviceBrakeSec = (bParts[0] || 0) * 60 + (bParts[1] || 0);
                }
                const totalBrakingSec = (tel.auxBrakeTimeSec || 0) + serviceBrakeSec;

                // 3. Freno Auxiliar / Retarder (Relación Asistencia vs Freno de Servicio)
                let axisRetarder = 100;
                let retarderRaw = `${tel.auxBrakeTimeSec || 0}s`;
                if (tel.hasSlipperyRoad) {
                  // Con piso resbaladizo (lluvia/nieve), NO usar retarder es lo correcto y seguro
                  if (!tel.auxBrakeTimeSec || tel.auxBrakeTimeSec <= 3) {
                    axisRetarder = 100;
                    retarderRaw = `${tel.auxBrakeTimeSec || 0}s (Desactivado ✓)`;
                  } else {
                    axisRetarder = Math.max(10, Math.round(100 - Math.min(90, (tel.auxBrakeTimeSec || 0) * 4)));
                    retarderRaw = `${tel.auxBrakeTimeSec}s (Riesgo tijera ⚠️)`;
                  }
                } else if (env === "CIUDAD") {
                  // En zonas urbanas y maniobras el retarder está prohibido por ruido y no aplica
                  if (!tel.auxBrakeTimeSec || tel.auxBrakeTimeSec <= 3) {
                    axisRetarder = 100;
                    retarderRaw = `${tel.auxBrakeTimeSec || 0}s (Urbano/Prohibido ✓)`;
                  } else {
                    axisRetarder = Math.max(20, Math.round(100 - (tel.auxBrakeTimeSec || 0) * 3));
                    retarderRaw = `${tel.auxBrakeTimeSec}s (Uso indebido ⚠️)`;
                  }
                } else {
                  // Pavimento seco en carretera o montaña: Ratio = Retarder / (Retarder + Servicio)
                  const targetRatio = env === "MONTANA" ? 0.60 : 0.40;
                  const sec = tel.auxBrakeTimeSec || 0;
                  if (totalBrakingSec <= 5) {
                    axisRetarder = 100;
                    retarderRaw = `${sec}s (Sin exigencia)`;
                  } else {
                    const actualRatio = sec / totalBrakingSec;
                    const actualRatioPct = Math.round(actualRatio * 100);
                    if (actualRatio >= targetRatio) {
                      axisRetarder = 100;
                      retarderRaw = `${sec}s (Ratio ${actualRatioPct}% ✓)`;
                    } else if (env === "MONTANA" && sec < 5 && serviceBrakeSec > 15) {
                      axisRetarder = 25;
                      retarderRaw = `${sec}s (Riesgo cristalización ⚠️)`;
                    } else {
                      axisRetarder = Math.max(20, Math.min(100, Math.round((actualRatio / targetRatio) * 100)));
                      retarderRaw = `${sec}s (Ratio ${actualRatioPct}% / meta ${Math.round(targetRatio * 100)}%)`;
                    }
                  }
                }

                // 4. Aprovechamiento de Inercia (meta según terreno)
                const optInertia = env === "MONTANA" ? 0.25 : env === "CIUDAD" ? 0.20 : 0.35;
                const inRatio = (tel.distanceMeters && tel.distanceMeters > 50 && tel.coastDistanceMeters !== undefined)
                  ? (tel.coastDistanceMeters / tel.distanceMeters)
                  : 0.25;
                const axisInertia = Math.min(100, Math.round((inRatio / optInertia) * 100));
                const inRatioPct = Math.round(inRatio * 100);
                const optInertiaPct = Math.round(optInertia * 100);

                // 5. Aceleración Suave (Técnica de Ahorro: evitar acelerador a fondo >60%)
                let axisAccel = 100;
                let accelRaw = "0s (meta 0s)";
                if (tel.throttleAbove60Time && tel.throttleAbove60Time !== "00:00") {
                  const parts = tel.throttleAbove60Time.split(":").map(Number);
                  const sec = (parts[0] || 0) * 60 + (parts[1] || 0);
                  if (sec > 0) {
                    axisAccel = Math.max(20, 100 - sec * 5);
                    accelRaw = `${tel.throttleAbove60Time} (>60% ⚠️)`;
                  }
                }

                // Obtener evaluaciones del mismo ejercicio en el grupo para benchmark en el modal individual
                const exerciseKeyVal = (selectedEval.exercise || selectedEval.unit || "").trim().toLowerCase();
                const groupExerciseEvals = (data?.groupEvals || []).filter(
                  (ge) => (ge.exercise || ge.unit || "").trim().toLowerCase() === exerciseKeyVal && ge.telemetry
                );
                const groupExerciseSummary = groupExerciseEvals.length > 0 ? computeTelemetryAxes(groupExerciseEvals, selectedEval.exercise, selectedEval.groupId || groupParam || null) : null;
                const groupExerciseAxes = groupExerciseSummary?.axes;

                const groupExercisePolygonPoints = groupExerciseAxes
                  ? groupExerciseAxes
                      .map((ga, i) => {
                        const c = getCoords(i, ga.value);
                        return `${c.x.toFixed(1)},${c.y.toFixed(1)}`;
                      })
                      .join(" ")
                  : "";

                const axes = [
                  { 
                    label: "Zona Verde", 
                    value: axisRpm, 
                    raw: `${tel.pctGreenZone || 0}%`,
                    meta: `meta ≥${greenTarget}%`,
                    breakdown: {
                      green: tel.pctGreenZone || 0,
                      yellow: yellowZone,
                      red: tel.pctRedZone || 0,
                      low: tel.pctLowRpmZone ?? Math.max(0, 100 - (tel.pctGreenZone || 0) - yellowZone - (tel.pctRedZone || 0)),
                      isSlippery: hasSlippery,
                      penalty: rpmPenalty > 0 ? Math.round(rpmPenalty) : 0,
                    }
                  },
                  { label: "Freno Suave", value: axisBrake, raw: `${harshBrakes} f. bruscas`, meta: brakeTargetLabel },
                  { label: tel.hasSlipperyRoad ? "Retarder Seguro" : "Retarder", value: axisRetarder, raw: retarderRaw },
                  { label: "Inercia", value: axisInertia, raw: `${inRatioPct}%`, meta: `meta ≥${optInertiaPct}%` },
                  { label: "Acel. Suave", value: axisAccel, raw: accelRaw, meta: "meta 0s" },
                ];

                const totalAxes = axes.length;
                const width = 340;
                const height = 290;
                const centerX = width / 2;
                const centerY = height / 2;
                const radius = 80;

                // Función trigonométrica para calcular coordenadas en el radar
                const getCoords = (index: number, val: number, customRadius = radius) => {
                  const angle = (Math.PI * 2 / totalAxes) * index - Math.PI / 2;
                  const r = (val / 100) * customRadius;
                  return {
                    x: centerX + r * Math.cos(angle),
                    y: centerY + r * Math.sin(angle),
                  };
                };

                const radarPolygonPoints = axes
                  .map((a, i) => {
                    const c = getCoords(i, a.value);
                    return `${c.x.toFixed(1)},${c.y.toFixed(1)}`;
                  })
                  .join(" ");

                const envLabel = env === "MONTANA" ? "🏔️ Entorno Montaña / Sierra" : env === "CIUDAD" ? "🏙️ Entorno Ciudad / Maniobras" : "🛣️ Entorno Carretera / Plano";

                return (
                  <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
                            <svg className="h-4 w-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                            Indicadores de Telemetría · Perfil Radar
                          </h4>
                          <span className="rounded-full bg-slate-200/80 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                            {envLabel}
                          </span>
                          {tel.hasSlipperyRoad && (
                            <span className="rounded-full bg-sky-100 border border-sky-300 px-2 py-0.5 text-[10px] font-bold text-sky-800 flex items-center gap-1">
                              🌧️ {tel.slipperyCondition || "Pavimento mojado"} (Retarder off)
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-400">
                          Calibrado para {env.toLowerCase()} (Meta Verde: {greenTarget}%)
                        </span>
                      </div>
                      <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-700 border border-emerald-200">
                        Puntaje Eco: {selectedEval.telemetryScore ?? "—"}/10
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
                      {/* Gráfico de Radar SVG */}
                      <div className="md:col-span-6 flex flex-col items-center justify-center p-3 rounded-xl bg-white border border-slate-200/80 shadow-xs overflow-hidden">
                        <svg width={width} height={height} className="overflow-visible select-none">
                          {/* Círculos / Polígonos de cuadrícula guía (25%, 50%, 75%, 100%) */}
                          {[0.25, 0.5, 0.75, 1.0].map((step) => {
                            const gridPoints = axes
                              .map((_, i) => {
                                const c = getCoords(i, step * 100);
                                return `${c.x.toFixed(1)},${c.y.toFixed(1)}`;
                              })
                              .join(" ");
                            return (
                              <polygon
                                key={step}
                                points={gridPoints}
                                fill={step === 1.0 ? "#f8fafc" : "transparent"}
                                stroke="#e2e8f0"
                                strokeWidth="1"
                                strokeDasharray={step < 1.0 ? "2,2" : undefined}
                              />
                            );
                          })}

                          {/* Ejes radiales desde el centro */}
                          {axes.map((_, i) => {
                            const c = getCoords(i, 100);
                            return (
                              <line
                                key={i}
                                x1={centerX}
                                y1={centerY}
                                x2={c.x}
                                y2={c.y}
                                stroke="#e2e8f0"
                                strokeWidth="1"
                              />
                            );
                          })}

                          {/* Polígono del Grupo / Flota (Azul punteado tenue de Benchmark Comparativo del Ejercicio) */}
                          {groupExercisePolygonPoints && groupExerciseEvals.length > 0 && (
                            <polygon
                              points={groupExercisePolygonPoints}
                              fill="rgba(191, 219, 254, 0.12)"
                              stroke="#93c5fd"
                              strokeWidth="1.8"
                              strokeDasharray="4,4"
                            />
                          )}

                          {/* Polígono del Operador (Relleno y Borde) */}
                          <polygon
                            points={radarPolygonPoints}
                            fill="rgba(16, 185, 129, 0.22)"
                            stroke="#059669"
                            strokeWidth="2.5"
                          />

                          {/* Nodos de datos en cada eje con etiquetas de concepto y porcentaje */}
                          {axes.map((a, i) => {
                            const c = getCoords(i, a.value);
                            // Calculamos posición de la etiqueta hacia afuera del vértice
                            const labelCoords = getCoords(i, 100, radius + 32);
                            return (
                              <g key={i}>
                                <circle
                                  cx={c.x}
                                  cy={c.y}
                                  r="4"
                                  className="fill-emerald-600 stroke-white stroke-2"
                                />
                                <text
                                  x={labelCoords.x}
                                  y={labelCoords.y - 7}
                                  textAnchor="middle"
                                  dominantBaseline="central"
                                  className="text-[10px] font-bold fill-slate-800"
                                >
                                  {a.label}
                                </text>
                                <text
                                  x={labelCoords.x}
                                  y={labelCoords.y + 7}
                                  textAnchor="middle"
                                  dominantBaseline="central"
                                  className={`text-[9px] font-semibold font-mono ${a.value >= 75 ? "fill-emerald-600" : a.value >= 50 ? "fill-amber-600" : "fill-rose-600"
                                    }`}
                                >
                                  {a.value}%
                                </text>
                              </g>
                            );
                          })}
                        </svg>

                        <div className="mt-2 flex flex-wrap items-center justify-center gap-3 text-[10px] text-slate-500">
                          <div className="flex items-center gap-1.5">
                            <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
                            <span className="font-semibold text-slate-700">Operador</span>
                          </div>
                          {groupExercisePolygonPoints && groupExerciseEvals.length > 0 && (
                            <div className="flex items-center gap-1.5">
                              <span className="inline-block h-2 w-4 rounded-sm border-b-2 border-indigo-500 border-dashed bg-indigo-50"></span>
                              <span className="font-semibold text-indigo-700">Media del Grupo ({groupExerciseEvals.length} {groupExerciseEvals.length === 1 ? "ej." : "ej."})</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Tarjetas complementarias con los valores reales */}
                      <div className="md:col-span-6 grid grid-cols-2 gap-2 text-xs">
                        {axes.map((axis, idx) => {
                          const isGreenAxis = axis.label === "Zona Verde" && "breakdown" in axis;
                          return (
                            <div key={idx} className={`rounded-lg bg-white p-2.5 border border-slate-200/80 ${isGreenAxis ? "col-span-2" : ""}`}>
                              <div className="flex items-center justify-between text-[10px] text-slate-400">
                                <span className="font-semibold text-slate-700">{axis.label}</span>
                                <div className="flex items-center gap-1.5">
                                  {axis.meta && (
                                    <span className="text-[10px] text-slate-400 font-mono">
                                      ({axis.meta})
                                    </span>
                                  )}
                                  <span className={`font-bold font-mono ${axis.value >= 75 ? "text-emerald-600" : axis.value >= 50 ? "text-amber-600" : "text-rose-600"}`}>
                                    {axis.value}%
                                  </span>
                                </div>
                              </div>

                              {isGreenAxis && axis.breakdown ? (
                                <div className="mt-1.5 space-y-1.5">
                                  {/* Desglose de las 4 Zonas de RPM con colores diferenciados */}
                                  <div className="grid grid-cols-4 gap-1.5 text-center">
                                    <div className="rounded bg-slate-50 border border-slate-100 p-1">
                                      <span className="block text-[9px] text-slate-400 uppercase font-medium">Bajas RPM</span>
                                      <strong className="block text-[11px] font-mono text-slate-700 font-bold">{axis.breakdown.low}%</strong>
                                    </div>
                                    <div className="rounded bg-emerald-50 border border-emerald-200/60 p-1">
                                      <span className="block text-[9px] text-emerald-700 uppercase font-medium">Verde (Óptima)</span>
                                      <strong className="block text-[11px] font-mono text-emerald-800 font-bold">{axis.breakdown.green}%</strong>
                                    </div>
                                    <div className="rounded bg-amber-50 border border-amber-200/60 p-1">
                                      <span className="block text-[9px] text-amber-700 uppercase font-medium">Amarilla</span>
                                      <strong className="block text-[11px] font-mono text-amber-800 font-bold">{axis.breakdown.yellow}%</strong>
                                    </div>
                                    <div className="rounded bg-rose-50 border border-rose-200/60 p-1">
                                      <span className="block text-[9px] text-rose-700 uppercase font-medium">Roja</span>
                                      <strong className="block text-[11px] font-mono text-rose-800 font-bold">{axis.breakdown.red}%</strong>
                                    </div>
                                  </div>

                                  {/* Explicación de la condición y penalización */}
                                  <div className="text-[10px] flex items-center justify-between px-1 text-slate-500">
                                    <span>
                                      {axis.breakdown.isSlippery ? (
                                        <span className="text-sky-700 font-medium">
                                          ❄️ Clima adverso: se permite zona amarilla hasta 25% para retención por compresión segura.
                                        </span>
                                      ) : (
                                        <span>
                                          Retención en seco: la zona amarilla solo se admite con freno motor activo.
                                        </span>
                                      )}
                                    </span>
                                    {axis.breakdown.penalty > 0 ? (
                                      <span className="text-rose-600 font-bold font-mono">
                                        Penalización: -{axis.breakdown.penalty}%
                                      </span>
                                    ) : (
                                      <span className="text-emerald-600 font-semibold font-mono">
                                        ✓ Sin penalización
                                      </span>
                                    )}
                                  </div>
                                </div>
                              ) : (
                                <div className="mt-1 flex items-baseline justify-between gap-1">
                                  <strong className="text-slate-800 font-mono text-sm">
                                    {axis.raw}
                                  </strong>
                                </div>
                              )}

                              {/* Barra de progreso miniatura */}
                              <div className="mt-1.5 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${axis.value >= 75 ? "bg-emerald-500" : axis.value >= 50 ? "bg-amber-500" : "bg-rose-500"}`}
                                  style={{ width: `${axis.value}%` }}
                                />
                              </div>
                            </div>
                          );
                        })}

                        <div className="rounded-lg bg-white p-2.5 border border-slate-200/80 col-span-2 grid grid-cols-3 gap-2 text-center">
                          <div>
                            <span className="text-[10px] text-slate-400 block truncate">Consumo Reportado</span>
                            <span className="font-mono text-xs text-slate-800 font-semibold">
                              {tel.averageConsumption !== undefined ? `${tel.averageConsumption} l/100km` : "—"}
                            </span>
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-400 block truncate">Velocidad Med/Max</span>
                            <span className="font-mono text-xs text-slate-800 font-semibold">
                              {tel.averageSpeed || "—"} / {tel.maxSpeed || "—"} km/h
                            </span>
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-400 block truncate">RPM Max / Cambios</span>
                            <span className="font-mono text-xs text-slate-800 font-semibold">
                              {tel.maxRpm || "—"} rpm · {tel.gearChanges ?? "—"} c.
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Conteo detallado por Nivel de Gravedad */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Desglose de Errores por Gravedad
                </span>
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  {SEVERITY_ORDER.map((sev) => {
                    const count = severityCounts[sev] || 0;
                    return (
                      <div
                        key={sev}
                        className={`rounded-xl border p-2.5 transition flex flex-col justify-between ${count > 0 ? SEVERITIES[sev].badge : "border-slate-200 bg-slate-50/50 text-slate-400"
                          }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-bold uppercase tracking-wider">
                            {SEVERITIES[sev].label}
                          </span>
                          <span className={`h-2 w-2 rounded-full ${count > 0 ? SEVERITIES[sev].dot : "bg-slate-300"}`} />
                        </div>
                        <div className="mt-1.5 text-xl font-extrabold font-mono">
                          {count}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Registro exclusivo de Errores cometidos en la prueba */}
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                      Registro de Errores ({selectedEval.errorCount} vigentes
                      {ignoredErrorCount > 0 ? ` · ${ignoredErrorCount} falso(s) positivo(s) anulado(s)` : ""})
                    </h4>
                    {selectedEval.frozen && (
                      <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                        🔒 Grupo congelado (solo lectura)
                      </span>
                    )}
                  </div>

                  <div className="no-print flex items-center gap-2">
                    {!selectedEval.frozen && (
                      <button
                        type="button"
                        onClick={() => {
                          setMarksActionError("");
                          setShowAddErrorForm((prev) => !prev);
                        }}
                        disabled={isSavingMarks}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-indigo-700 disabled:opacity-50 transition cursor-pointer"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                        </svg>
                        <span>{showAddErrorForm ? "Cancelar" : "Agregar error manual"}</span>
                      </button>
                    )}
                  </div>
                </div>

                {marksActionError && (
                  <div className="no-print rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs text-rose-700">
                    {marksActionError}
                  </div>
                )}

                {/* Formulario para agregar un error manualmente */}
                {showAddErrorForm && !selectedEval.frozen && (() => {
                  const evalGroupId = selectedEval.groupId || groupParam || null;
                  const evalEnv = resolveExerciseEnvironment(selectedEval.exercise || selectedEval.unit, evalGroupId);
                  const previewDesc =
                    selectedCatalogError === "__CUSTOM__" ? customErrorText.trim() : selectedCatalogError.trim();
                  const previewCls = previewDesc ? classify(previewDesc, evalEnv, evalGroupId) : null;

                  return (
                    <form
                      onSubmit={handleAddManualError}
                      className="no-print rounded-xl border border-indigo-200 bg-indigo-50/40 p-3.5 space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-indigo-950">
                          Registrar infracción o error manual en la prueba
                        </span>
                        {previewCls && (
                          <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${SEVERITIES[previewCls.severity].badge}`}>
                            Gravedad: {SEVERITIES[previewCls.severity].label} (-{previewCls.weight} pts)
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
                        <div className="sm:col-span-7 space-y-1">
                          <label className="block text-[11px] font-semibold text-slate-700">
                            Error del catálogo del grupo
                          </label>
                          <select
                            value={selectedCatalogError}
                            onChange={(e) => setSelectedCatalogError(e.target.value)}
                            className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:border-indigo-500 focus:outline-none"
                          >
                            <option value="">— Selecciona un error del catálogo —</option>
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
                            <option value="__CUSTOM__">✏️ Escribir otro error personalizado...</option>
                          </select>
                        </div>

                        <div className="sm:col-span-2 space-y-1">
                          <label className="block text-[11px] font-semibold text-slate-700">
                            Minuto (H:MM:SS)
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
                            disabled={isSavingMarks}
                            className="w-full rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-50 transition cursor-pointer"
                          >
                            {isSavingMarks ? "Guardando..." : "Guardar y Recalcular"}
                          </button>
                        </div>
                      </div>

                      {selectedCatalogError === "__CUSTOM__" && (
                        <div className="space-y-1">
                          <label className="block text-[11px] font-semibold text-slate-700">
                            Descripción personalizada del error
                          </label>
                          <input
                            type="text"
                            value={customErrorText}
                            onChange={(e) => setCustomErrorText(e.target.value)}
                            placeholder="Ej. Invadir carril contrario en curva cerrada"
                            className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:border-indigo-500 focus:outline-none"
                          />
                        </div>
                      )}
                    </form>
                  );
                })()}

                {sortedErrorMarks.length === 0 ? (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-6 text-center text-xs text-emerald-800">
                    🎉 ¡Excelente! No se registraron eventos de tipo <strong>ERROR</strong> en este ejercicio.
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-xl border border-slate-200">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-slate-200 bg-slate-50 text-[10px] font-semibold uppercase tracking-wider text-slate-600 select-none">
                        <tr>
                          {/* Columna Tiempo */}
                          <th
                            onClick={() => toggleSort("time")}
                            className="px-3.5 py-2.5 cursor-pointer hover:bg-slate-100 transition"
                          >
                            <div className="flex items-center gap-1.5">
                              <span>Tiempo</span>
                              <span className="text-slate-400">
                                {sortField === "time" ? (
                                  sortDirection === "asc" ? "▲" : "▼"
                                ) : (
                                  "↕"
                                )}
                              </span>
                            </div>
                          </th>

                          {/* Columna Descripción */}
                          <th
                            onClick={() => toggleSort("description")}
                            className="px-3.5 py-2.5 cursor-pointer hover:bg-slate-100 transition"
                          >
                            <div className="flex items-center gap-1.5">
                              <span>Descripción del Error</span>
                              <span className="text-slate-400">
                                {sortField === "description" ? (
                                  sortDirection === "asc" ? "▲" : "▼"
                                ) : (
                                  "↕"
                                )}
                              </span>
                            </div>
                          </th>

                          {/* Columna Gravedad */}
                          <th
                            onClick={() => toggleSort("severity")}
                            className="px-3.5 py-2.5 text-right cursor-pointer hover:bg-slate-100 transition"
                          >
                            <div className="flex items-center justify-end gap-1.5">
                              <span>Gravedad</span>
                              <span className="text-slate-400">
                                {sortField === "severity" ? (
                                  sortDirection === "asc" ? "▲" : "▼"
                                ) : (
                                  "↕"
                                )}
                              </span>
                            </div>
                          </th>

                          {/* Columna Acciones (solo en grupos abiertos y oculta al imprimir) */}
                          {!selectedEval.frozen && (
                            <th className="no-print px-3.5 py-2.5 text-right">
                              Acción
                            </th>
                          )}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {sortedErrorMarks.map((m) => (
                          <tr
                            key={m.markIndex}
                            className={
                              m.ignored
                                ? "no-print bg-slate-50/80 text-slate-400 transition"
                                : "bg-rose-50/20 hover:bg-rose-50/40 transition"
                            }
                          >
                            <td className="px-3.5 py-2.5 font-mono text-slate-600 font-medium whitespace-nowrap">
                              <span className={m.ignored ? "line-through text-slate-400" : ""}>{m.time}</span>
                            </td>
                            <td className="px-3.5 py-2.5 font-medium text-slate-800">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className={m.ignored ? "line-through text-slate-400" : ""}>
                                  {m.description}
                                </span>
                                {m.manual && (
                                  <span
                                    className="rounded-md bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700"
                                    title={m.addedBy ? `Agregado manualmente por ${m.addedBy}` : "Agregado manualmente"}
                                  >
                                    Manual
                                  </span>
                                )}
                                {m.ignored && (
                                  <span
                                    className="rounded-md bg-slate-200/80 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600"
                                    title={m.ignoredBy ? `Anulado como falso positivo por ${m.ignoredBy}` : "Anulado como falso positivo"}
                                  >
                                    Falso positivo anulado
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-3.5 py-2.5 text-right whitespace-nowrap">
                              <span
                                className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${m.ignored
                                  ? "bg-slate-100 text-slate-400 border border-slate-200 line-through"
                                  : SEVERITIES[m.severity].badge
                                  }`}
                              >
                                {SEVERITIES[m.severity].label}
                              </span>
                            </td>
                            {!selectedEval.frozen && (
                              <td className="no-print px-3.5 py-2.5 text-right whitespace-nowrap">
                                {m.manual ? (
                                  <button
                                    type="button"
                                    disabled={isSavingMarks}
                                    onClick={() => handleDeleteManualMark(m.markIndex)}
                                    className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-white px-2 py-1 text-[11px] font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50 transition cursor-pointer"
                                    title="Eliminar este error agregado manualmente"
                                  >
                                    Eliminar
                                  </button>
                                ) : m.ignored ? (
                                  <button
                                    type="button"
                                    disabled={isSavingMarks}
                                    onClick={() => handleToggleIgnoreMark(m.markIndex)}
                                    className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-white px-2 py-1 text-[11px] font-semibold text-indigo-600 hover:bg-indigo-50 disabled:opacity-50 transition cursor-pointer"
                                    title="Restaurar este error para que vuelva a contar en la calificación"
                                  >
                                    Restaurar
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    disabled={isSavingMarks}
                                    onClick={() => handleToggleIgnoreMark(m.markIndex)}
                                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-800 disabled:opacity-50 transition cursor-pointer"
                                    title="Anular este evento como falso positivo del simulador (no afectará la calificación)"
                                  >
                                    Falso positivo
                                  </button>
                                )}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="no-print flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50/80 px-6 py-3">
              <button
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition shadow-xs"
              >
                <svg className="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                </svg>
                <span>Imprimir Hoja (PDF)</span>
              </button>
              <button
                onClick={() => setSelectedEval(null)}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition shadow-sm"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
