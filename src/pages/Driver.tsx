import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { phaseName, CRITICAL_LIMIT, verdictFor } from "../lib/config";
import { SEVERITIES, SEVERITY_ORDER, classify, type Severity } from "../lib/catalog";
import { driverData, type EvaluationView } from "../lib/db";

type Data = NonNullable<Awaited<ReturnType<typeof driverData>>>;
type BreakdownItem = Data["breakdown"][number];

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

type SortField = "time" | "description" | "severity";
type SortDirection = "asc" | "desc";

export default function Driver() {
  const { id = "" } = useParams();
  const [data, setData] = useState<Data | null | undefined>(undefined);
  const [error, setError] = useState("");
  const [selectedEval, setSelectedEval] = useState<EvaluationView | null>(null);

  // Filtro de severidad para la sección Puntos Débiles (ALL = todas)
  const [activeSeverityTab, setActiveSeverityTab] = useState<Severity | "ALL">("ALL");

  // Estado de ordenamiento para el modal de errores
  const [sortField, setSortField] = useState<SortField>("time");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  useEffect(() => {
    setData(undefined);
    driverData(id).then(setData).catch((e: Error) => setError(e.message));
  }, [id]);

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

    const errors = selectedEval.marks
      .filter((m) => m.type === "ERROR")
      .map((m) => {
        const cls = classify(m.description);
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

  const { name, evals, phases, overall, criticalErrors, verdict, color } = data;

  const displayedSeverities = activeSeverityTab === "ALL"
    ? SEVERITY_ORDER
    : [activeSeverityTab];

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      {/* Top back & title */}
      <div>
        <Link
          to="/"
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
          <span className={`rounded-full px-3.5 py-1 text-xs font-bold ${color}`}>
            {verdict}
          </span>
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
              Calculada sobre {phases.length} fase(s) registradas y ponderada según la gravedad de errores cometidos.
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
            Total de Ejercicios
          </span>
          <div className="mt-2 text-3xl font-extrabold text-slate-900">{evals.length}</div>
          <span className="mt-3 text-xs text-slate-600">
            Fases evaluadas: <strong className="text-slate-900">{phases.length} de 6</strong>
          </span>
        </div>
      </div>

      {/* Resumen por Fase */}
      <section className="space-y-3">
        <h2 className="text-base font-bold text-slate-900">Progreso por Fase</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {phases.map((p) => (
            <div
              key={p.phase}
              className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm space-y-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600">
                    Fase {p.phase}
                  </span>
                  <h3 className="text-sm font-semibold text-slate-900">{phaseName(p.phase)}</h3>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${p.color}`}>
                  {p.verdict}
                </span>
              </div>

              <div className="flex items-center justify-between text-xs text-slate-600 border-t border-slate-100 pt-2.5">
                <div>
                  <span className="text-slate-900 font-semibold">{p.exercises}</span>/{p.expected} ejercicios
                </div>
                <div>
                  <span className="text-slate-900 font-semibold">{p.errors}</span> errores
                </div>
                <div className="text-indigo-600 font-bold font-mono">
                  {p.avgScore} pts
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Historial detallado de ejercicios */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">Desglose de Ejercicios Evaluados</h2>
            <p className="text-xs text-slate-500">Haz clic en el nombre de cualquier ejercicio para ver su reporte de errores detallado.</p>
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
                  <th className="px-4 py-3 text-right">Calif.</th>
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
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                  activeSeverityTab === "ALL"
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
                    className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                      activeSeverityTab === s
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
                      {items.map((b) => {
                        const barWidth = Math.max(8, Math.round((b.count / maxErrorCount) * 100));
                        return (
                          <div
                            key={b.description}
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
                                className={`h-full rounded-full transition-all duration-300 ${
                                  sev === "CRITICO"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/80 px-6 py-4">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-700 font-bold text-xs">
                  F{selectedEval.phase}
                </span>
                <div>
                  <h3 className="text-base font-bold text-slate-900 leading-tight">
                    {selectedEval.exercise}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Fase {selectedEval.phase}: {phaseName(selectedEval.phase)}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedEval(null)}
                className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition"
                title="Cerrar reporte"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Body */}
            <div className="overflow-y-auto p-6 space-y-6">
              {/* Tarjetas informativas principales del ejercicio */}
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    Calificación
                  </span>
                  <div className="mt-1 flex items-baseline gap-1">
                    <span className="text-2xl font-bold font-mono text-indigo-600">{selectedEval.score}</span>
                    <span className="text-xs text-slate-400">/ 100</span>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    Duración
                  </span>
                  <div className="mt-1 text-2xl font-bold font-mono text-slate-900">
                    {fmt(selectedEval.durationSec)}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    Total Errores
                  </span>
                  <div className="mt-1 text-2xl font-bold font-mono text-slate-900">
                    {selectedEval.errorCount}
                  </div>
                </div>
              </div>

              {/* Conteo detallado por Nivel de Gravedad */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Desglose por Gravedad
                </span>
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  {SEVERITY_ORDER.map((sev) => {
                    const count = severityCounts[sev] || 0;
                    return (
                      <div
                        key={sev}
                        className={`rounded-xl border p-2.5 transition flex flex-col justify-between ${
                          count > 0 ? SEVERITIES[sev].badge : "border-slate-200 bg-slate-50/50 text-slate-400"
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

              {/* Metadatos adicionales */}
              <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3.5 text-xs grid grid-cols-2 gap-2 sm:grid-cols-3">
                <div>
                  <span className="text-slate-400">Fecha:</span>{" "}
                  <strong className="text-slate-700">{selectedEval.date || "—"}</strong>
                </div>
                <div>
                  <span className="text-slate-400">Instructor:</span>{" "}
                  <strong className="text-slate-700">{selectedEval.instructor || "—"}</strong>
                </div>
                {selectedEval.vehicle && (
                  <div>
                    <span className="text-slate-400">Vehículo:</span>{" "}
                    <strong className="text-slate-700">{selectedEval.vehicle}</strong>
                  </div>
                )}
                {selectedEval.fileName && (
                  <div className="col-span-2 sm:col-span-3 truncate">
                    <span className="text-slate-400">Archivo origen:</span>{" "}
                    <span className="font-mono text-slate-600">{selectedEval.fileName}</span>
                  </div>
                )}
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
                                className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${
                                  SEVERITIES[m.severity].badge
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
            <div className="flex items-center justify-end border-t border-slate-200 bg-slate-50/80 px-6 py-3">
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
