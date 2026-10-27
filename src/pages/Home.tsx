import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import UploadForm from "../components/UploadForm";
import { isAdminEmail, PHASES } from "../lib/config";
import { deleteAllEvaluations, phaseSummaries, type PhaseSummary } from "../lib/db";
import { useAuth } from "../components/AuthProvider";

export default function Home() {
  const [params] = useSearchParams();
  const phase = PHASES.some((p) => p.id === Number(params.get("fase"))) ? Number(params.get("fase")) : 1;
  const [rows, setRows] = useState<PhaseSummary[] | null>(null);
  const [error, setError] = useState("");
  const { user } = useAuth();

  const [isDeleting, setIsDeleting] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmInput, setConfirmInput] = useState("");
  const [deleteError, setDeleteError] = useState("");

  const isAdmin = isAdminEmail(user?.email);

  const load = useCallback(() => {
    setRows(null);
    setError("");
    phaseSummaries(phase).then(setRows).catch((e: Error) => setError(e.message));
  }, [phase]);

  useEffect(load, [load]);

  async function handleDeleteDatabase() {
    if (confirmInput.trim().toUpperCase() !== "ELIMINAR") return;
    setIsDeleting(true);
    setDeleteError("");
    try {
      await deleteAllEvaluations();
      setShowConfirmModal(false);
      setConfirmInput("");
      load();
    } catch (e: any) {
      setDeleteError(e?.message || "Ocurrió un error al eliminar los datos.");
    } finally {
      setIsDeleting(false);
    }
  }

  // Métricas rápidas de la fase seleccionada
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
            Supervisión continua, dictamen y telemetría de rendimiento por fase.
          </p>
        </div>

        {isAdmin && (
          <button
            onClick={() => {
              setConfirmInput("");
              setDeleteError("");
              setShowConfirmModal(true);
            }}
            className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-semibold text-rose-700 shadow-sm hover:border-rose-300 hover:bg-rose-100 active:scale-95 transition"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            <span>Vaciar Base de Datos</span>
          </button>
        )}
      </div>

      {/* Selector de fases en Tabs modernos */}
      <div className="space-y-2">
        <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Fases del Programa</label>
        <nav className="flex flex-wrap gap-2">
          {PHASES.map((p) => {
            const active = p.id === phase;
            return (
              <Link
                key={p.id}
                to={`/?fase=${p.id}`}
                className={`group relative flex items-center gap-2.5 rounded-xl border px-3.5 py-2 text-xs font-semibold transition ${
                  active
                    ? "border-indigo-600 bg-indigo-600 text-white shadow-md shadow-indigo-600/20"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
                }`}
              >
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-md text-[10px] font-bold ${
                    active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600 group-hover:bg-slate-200"
                  }`}
                >
                  {p.id}
                </span>
                <span>{p.name}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Carga de Archivos */}
      <UploadForm onDone={load} />

      {/* Tarjetas de métricas rápidas */}
      {rows && rows.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Conductores</span>
            <div className="mt-1 text-2xl font-bold text-slate-900">{totalConductores}</div>
          </div>
          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Promedio Fase</span>
            <div className="mt-1 text-2xl font-bold text-indigo-600">{promedioGeneral}</div>
          </div>
          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Aptos</span>
            <div className="mt-1 text-2xl font-bold text-emerald-600">{aptos}</div>
          </div>
          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">No Aptos</span>
            <div className="mt-1 text-2xl font-bold text-rose-600">{noAptos}</div>
          </div>
        </div>
      )}

      {/* Tabla de Resultados */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-800">
            Resultados — Fase {phase}: {PHASES.find((p) => p.id === phase)?.name}
          </h2>
          {rows && rows.length > 0 && (
            <span className="text-xs text-slate-500">
              {rows.length} {rows.length === 1 ? "registro" : "registros"}
            </span>
          )}
        </div>

        {error && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            {error}
          </div>
        )}

        {!error && rows === null && (
          <div className="flex items-center justify-center rounded-2xl border border-slate-200 bg-white p-12 text-sm text-slate-500 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
              <span>Cargando evaluaciones…</span>
            </div>
          </div>
        )}

        {rows?.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center shadow-sm">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 mb-3">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-slate-800">Aún no hay evaluaciones cargadas para esta fase</p>
            <p className="mt-1 text-xs text-slate-500">Carga un archivo CSV arriba para generar los primeros informes.</p>
          </div>
        )}

        {!!rows?.length && (
          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-3.5">Conductor</th>
                    <th className="px-4 py-3.5">Ejercicios</th>
                    <th className="px-4 py-3.5">Errores Totales</th>
                    <th className="px-4 py-3.5">Críticos</th>
                    <th className="px-4 py-3.5">Calificación</th>
                    <th className="px-4 py-3.5 text-right">Dictamen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r) => (
                    <tr
                      key={r.driverId}
                      className="group hover:bg-slate-50 transition duration-150"
                    >
                      <td className="px-4 py-3.5 font-medium">
                        <Link
                          to={`/drivers/${r.driverId}`}
                          className="flex items-center gap-2.5 text-slate-900 hover:text-indigo-600 transition font-semibold"
                        >
                          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-50 border border-indigo-200/70 text-xs font-bold text-indigo-700">
                            {r.driver.charAt(0).toUpperCase()}
                          </span>
                          <span>{r.driver}</span>
                        </Link>
                      </td>
                      <td className="px-4 py-3.5 text-slate-600">
                        <span className="font-mono font-medium text-slate-900">{r.exercises}</span>
                        <span className="text-slate-400">/{r.expected}</span>
                      </td>
                      <td className="px-4 py-3.5 text-slate-600 font-mono">{r.errors}</td>
                      <td className="px-4 py-3.5">
                        {r.criticalErrors > 0 ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-2 py-0.5 text-xs font-bold text-rose-700 border border-rose-200 font-mono">
                            {r.criticalErrors}
                          </span>
                        ) : (
                          <span className="text-slate-400 font-mono">0</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 font-semibold text-slate-900">
                        <div className="flex items-center gap-2.5">
                          <span className="text-sm font-mono">{r.avgScore}</span>
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
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
          </div>
        )}
      </section>

      {/* Modal de confirmación para eliminar evaluaciones */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl space-y-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 border border-rose-200 text-rose-600">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">¿Vaciar Base de Datos de Evaluaciones?</h2>
              <p className="mt-1 text-xs text-slate-600 leading-relaxed">
                Esta acción eliminará de forma irreversible todas las evaluaciones de la colección <code className="font-mono text-slate-800 bg-slate-100 px-1 py-0.5 rounded">evaluations</code> en Firestore. La tabla de calificaciones volverá a cero.
              </p>
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Escribe <span className="text-rose-600 font-mono font-bold">ELIMINAR</span> para autorizar:
              </label>
              <input
                type="text"
                value={confirmInput}
                onChange={(e) => setConfirmInput(e.target.value)}
                placeholder="ELIMINAR"
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
                onClick={handleDeleteDatabase}
                disabled={confirmInput.trim().toUpperCase() !== "ELIMINAR" || isDeleting}
                className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-rose-600/20 hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                {isDeleting ? "Eliminando evaluaciones…" : "Eliminar Definitivamente"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
