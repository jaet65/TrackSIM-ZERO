import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { phaseName, CRITICAL_LIMIT, verdictFor } from "../lib/config";
import { SEVERITIES, SEVERITY_ORDER, classify, type Severity } from "../lib/catalog";
import { driverData, type DateFilter, type EvaluationView } from "../lib/db";
import { resolveExerciseEnvironment } from "../lib/exercises";
import { computeTelemetryAxes } from "../lib/telemetryRadar";
import { downloadDriverPdf } from "../lib/pdfExport";

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

  useEffect(() => {
    setData(undefined);
    driverData(id, dateFilter).then(setData).catch((e: Error) => setError(e.message));
  }, [id, dateFilter]);

  // Al cambiar de ejercicio seleccionado, reiniciar al orden por defecto cronológico
  useEffect(() => {
    setSortField("time");
    setSortDirection("asc");
  }, [selectedEval]);

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

  // Filtrar exclusivamente los eventos de tipo ERROR y calcular conteos por severidad para el modal
  const { sortedErrorMarks, severityCounts } = useMemo(() => {
    const counts: Record<Severity, number> = {
      CRITICO: 0,
      GRAVE: 0,
      MODERADO: 0,
      LEVE: 0,
    };

    if (!selectedEval) {
      return { sortedErrorMarks: [], severityCounts: counts };
    }

    const evalGroupId = selectedEval.groupId || groupParam || null;
    const evalEnv = resolveExerciseEnvironment(selectedEval.exercise || selectedEval.unit, evalGroupId);

    const errors = selectedEval.marks
      .filter((m) => m.type === "ERROR")
      .map((m) => {
        const cls = classify(m.description, evalEnv, evalGroupId);
        counts[cls.severity] = (counts[cls.severity] || 0) + 1;
        return {
          ...m,
          severity: cls.severity,
          weight: cls.weight,
        };
      });

    const sorted = [...errors].sort((a, b) => {
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

    return { sortedErrorMarks: sorted, severityCounts: counts };
  }, [selectedEval, sortField, sortDirection]);

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

  const { name, evals, phases, overall, completedExercises, expectedExercises, criticalErrors, verdict, color } = data;
  const phasesWithActivity = phases.filter((p) => p.exercises > 0).length;

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
              <span className="text-sm text-slate-500">/ 100 pts</span>
            </div>
            <p className="mt-2 text-xs text-slate-600">
              Calculada sobre {expectedExercises} ejercicio(s) esperados en {phases.length} fase(s) configuradas (70% seguridad y errores + 30% eficiencia y telemetría).
            </p>
          </div>

          <div className="mt-4 pt-4 border-t border-slate-100">
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

      {/* Resumen por Fase */}
      <section className="space-y-3">
        <h2 className="text-base font-bold text-slate-900">Progreso por Fase</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {phases.map((p) => {
            // Evaluaciones correspondientes a esta fase para promediar ejes de telemetría
            const phaseEvals = evals.filter((e) => e.phase === p.phase);
            const telemetries = phaseEvals.map((e) => e.telemetry);
            const firstExerciseName = phaseEvals[0]?.exercise || "";
            const phaseGroupId = phaseEvals[0]?.groupId || groupParam || null;
            const radarSummary = computeTelemetryAxes(telemetries, firstExerciseName, phaseGroupId);
            const axes = radarSummary.axes;

            // Coordenadas para radar en layout horizontal (size: 210x170, radius: 46)
            const miniW = 210;
            const miniH = 165;
            const cX = miniW / 2;
            const cY = miniH / 2;
            const r = 44;

            const getCoord = (index: number, val: number, customR = r) => {
              const angle = (Math.PI * 2 / 5) * index - Math.PI / 2;
              const rad = (val / 100) * customR;
              return {
                x: cX + rad * Math.cos(angle),
                y: cY + rad * Math.sin(angle),
              };
            };

            const miniPolygonPoints = axes
              .map((a, i) => {
                const c = getCoord(i, a.value);
                return `${c.x.toFixed(1)},${c.y.toFixed(1)}`;
              })
              .join(" ");

            return (
              <div
                key={p.phase}
                className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4"
              >
                {/* Lado Izquierdo: Información de la Fase */}
                <div className="flex-1 space-y-3 w-full">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600">
                        Fase {p.phase}
                      </span>
                      <h3 className="text-base font-bold text-slate-900 leading-snug">{phaseName(p.phase)}</h3>
                    </div>
                    <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${p.color}`}>
                      {p.verdict}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs border-t border-slate-100 pt-3">
                    <div className="rounded-xl bg-slate-50 p-2 border border-slate-100">
                      <span className="text-[10px] text-slate-400 block font-medium">Ejercicios</span>
                      <span className="text-sm font-bold text-slate-900">{p.exercises}</span>
                      <span className="text-slate-500 text-[11px]"> de {p.expected}</span>
                    </div>

                    <div className="rounded-xl bg-slate-50 p-2 border border-slate-100">
                      <span className="text-[10px] text-slate-400 block font-medium">Infracciones</span>
                      <span className={`text-sm font-bold ${p.errors > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                        {p.errors}
                      </span>
                      <span className="text-slate-500 text-[11px]"> error(es)</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between rounded-xl bg-indigo-50/60 p-2.5 border border-indigo-100">
                    <div>
                      <span className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider block">
                        Calificación
                      </span>
                      <span className="text-xl font-black font-mono text-indigo-600">{p.avgScore}</span>
                      <span className="text-xs text-indigo-500"> / 100</span>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider block">
                        Puntaje Eco
                      </span>
                      <span className="text-base font-extrabold font-mono text-indigo-700">
                        {radarSummary.ecoScore}/100
                      </span>
                    </div>
                  </div>
                </div>

                {/* Lado Derecho: Gráfico Radar */}
                <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-2 flex flex-col items-center shrink-0">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                    Radar Telemetría
                  </span>

                  <svg width={miniW} height={miniH} className="overflow-visible select-none">
                    {/* Círculos / Guías (50% y 100%) */}
                    {[0.5, 1.0].map((step) => {
                      const gridPts = axes
                        .map((_, i) => {
                          const c = getCoord(i, step * 100);
                          return `${c.x.toFixed(1)},${c.y.toFixed(1)}`;
                        })
                        .join(" ");
                      return (
                        <polygon
                          key={step}
                          points={gridPts}
                          fill={step === 1.0 ? "#ffffff" : "transparent"}
                          stroke="#e2e8f0"
                          strokeWidth="1"
                        />
                      );
                    })}

                    {/* Ejes radiales */}
                    {axes.map((_, i) => {
                      const c = getCoord(i, 100);
                      return (
                        <line
                          key={i}
                          x1={cX}
                          y1={cY}
                          x2={c.x}
                          y2={c.y}
                          stroke="#e2e8f0"
                          strokeWidth="1"
                        />
                      );
                    })}

                    {/* Polígono del conductor en esta fase */}
                    <polygon
                      points={miniPolygonPoints}
                      fill="rgba(79, 70, 229, 0.20)"
                      stroke="#4f46e5"
                      strokeWidth="2"
                    />

                    {/* Vértices y Etiquetas */}
                    {axes.map((a, i) => {
                      const c = getCoord(i, a.value);
                      const labelPos = getCoord(i, 130);
                      return (
                        <g key={i}>
                          <circle cx={c.x} cy={c.y} r="2.5" fill="#4f46e5" stroke="#ffffff" strokeWidth="1" />
                          <text
                            x={labelPos.x}
                            y={labelPos.y + 3}
                            textAnchor="middle"
                            fontSize="8"
                            fontWeight="600"
                            fill="#475569"
                          >
                            {a.label}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                </div>
              </div>
            );
          })}
        </div>
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
                {evals.map((e) => (
                  <tr
                    key={`${e.phase}-${e.fileName}`}
                    className="group hover:bg-indigo-50/30 transition cursor-pointer"
                    onClick={() => setSelectedEval(e)}
                  >
                    <td className="px-4 py-3">
                      <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-700">
                        F{e.phase}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-900">
                      <span className="text-indigo-600 group-hover:text-indigo-700 underline decoration-indigo-200 group-hover:decoration-indigo-500 underline-offset-2 transition">
                        {e.exercise}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{e.date}</td>
                    <td className="px-4 py-3 text-slate-700">{e.instructor}</td>
                    <td className="px-4 py-3 text-slate-500 font-mono">{fmt(e.durationSec)}</td>
                    <td className="px-4 py-3 font-mono text-slate-700">
                      {e.errorCount > 0 ? (
                        <span className="font-semibold text-rose-600">{e.errorCount}</span>
                      ) : (
                        <span className="text-emerald-600">0</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-indigo-600">
                      {e.score}
                    </td>
                  </tr>
                ))}
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
                    <span className="text-xs text-indigo-400">/ 100</span>
                  </div>
                  <span className="block text-[10px] text-indigo-600/80 mt-0.5">
                    {selectedEval.telemetryScore !== undefined ? "70% destreza + 30% eco" : "100% destreza"}
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

              {/* Indicadores Genéricos de Telemetría (con Gráfico de Radar) */}
              {selectedEval.telemetry && Object.keys(selectedEval.telemetry).length > 0 && (() => {
                const tel = selectedEval.telemetry;
                const env = resolveExerciseEnvironment(selectedEval.exercise, selectedEval.groupId || groupParam || null);

                // Ejes normalizados de 0 a 100 para el gráfico de radar según el entorno
                // 1. Rango RPM (Zona verde vs meta del entorno)
                const greenTarget = env === "MONTANA" ? 48 : env === "CIUDAD" ? 58 : 75;
                const rawRpmRatio = ((tel.pctGreenZone || 0) / greenTarget) * 100;
                const axisRpm = Math.max(0, Math.min(100, Math.round(rawRpmRatio - ((tel.pctRedZone || 0) * 20))));

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

                // 3. Freno Auxiliar / Retarder
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
                } else {
                  // Pavimento seco: en montaña la meta es 45s, en carretera/ciudad 20s
                  const retarderTarget = env === "MONTANA" ? 45 : 20;
                  const sec = tel.auxBrakeTimeSec || 0;
                  if (env === "MONTANA" && sec < 5) {
                    axisRetarder = 25;
                    retarderRaw = `${sec}s (Riesgo cristalización ⚠️)`;
                  } else {
                    axisRetarder = Math.min(100, Math.round((sec / retarderTarget) * 100));
                    retarderRaw = `${sec}s (meta ${retarderTarget}s)`;
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

                const axes = [
                  { label: "Zona Verde", value: axisRpm, raw: `${tel.pctGreenZone || 0}% (meta ${greenTarget}%)` },
                  { label: "Freno Suave", value: axisBrake, raw: `${harshBrakes} f. bruscas (${brakeTargetLabel})` },
                  { label: tel.hasSlipperyRoad ? "Retarder Seguro" : "Retarder", value: axisRetarder, raw: retarderRaw },
                  { label: "Inercia", value: axisInertia, raw: `${inRatioPct}% (${Math.round(tel.coastDistanceMeters || 0)}m, meta ≥${optInertiaPct}%)` },
                  { label: "Acel. Suave", value: axisAccel, raw: accelRaw },
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
                        Puntaje Eco: {selectedEval.telemetryScore ?? "—"}/100
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

                        <div className="mt-2 flex items-center gap-2 text-[10px] text-slate-500">
                          <span className="inline-block h-2 w-2 rounded-full bg-emerald-500"></span>
                          <span>Área verde = Nivel de destreza operativa</span>
                        </div>
                      </div>

                      {/* Tarjetas complementarias con los valores reales */}
                      <div className="md:col-span-6 grid grid-cols-2 gap-2 text-xs">
                        {axes.map((axis, idx) => (
                          <div key={idx} className="rounded-lg bg-white p-2.5 border border-slate-200/80">
                            <div className="flex items-center justify-between text-[10px] text-slate-400">
                              <span className="truncate">{axis.label}</span>
                              <span className="font-bold text-slate-600">{axis.value}%</span>
                            </div>
                            <div className="mt-1 flex items-baseline justify-between">
                              <strong className="text-slate-800 font-mono text-sm">
                                {axis.raw}
                              </strong>
                            </div>
                            {/* Barra de progreso miniatura */}
                            <div className="mt-1.5 h-1 w-full rounded-full bg-slate-100 overflow-hidden">
                              <div
                                className={`h-full rounded-full ${axis.value >= 75 ? "bg-emerald-500" : axis.value >= 50 ? "bg-amber-500" : "bg-rose-500"
                                  }`}
                                style={{ width: `${axis.value}%` }}
                              />
                            </div>
                          </div>
                        ))}

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
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                    Registro de Errores ({sortedErrorMarks.length})
                  </h4>
                  <span className="text-[11px] text-slate-400">
                    Haz clic en los encabezados para ordenar
                  </span>
                </div>

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
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {sortedErrorMarks.map((m, idx) => (
                          <tr
                            key={idx}
                            className="bg-rose-50/20 hover:bg-rose-50/40 transition"
                          >
                            <td className="px-3.5 py-2.5 font-mono text-slate-600 font-medium whitespace-nowrap">
                              {m.time}
                            </td>
                            <td className="px-3.5 py-2.5 font-medium text-slate-800">
                              {m.description}
                            </td>
                            <td className="px-3.5 py-2.5 text-right whitespace-nowrap">
                              <span
                                className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${SEVERITIES[m.severity].badge
                                  }`}
                              >
                                {SEVERITIES[m.severity].label}
                              </span>
                            </td>
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
