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

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">TrackSIM — Evaluación de conductores</h1>
        {isAdmin && (
          <button
            onClick={() => {
              setConfirmInput("");
              setDeleteError("");
              setShowConfirmModal(true);
            }}
            className="rounded border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 transition"
          >
            🗑️ Eliminar evaluaciones (BD)
          </button>
        )}
      </div>

      <nav className="flex flex-wrap gap-2">
        {PHASES.map((p) => (
          <Link
            key={p.id}
            to={`/?fase=${p.id}`}
            className={`rounded border px-3 py-1.5 text-sm ${p.id === phase ? "bg-blue-600 text-white" : "bg-white hover:bg-gray-50"}`}
          >
            Fase {p.id}: {p.name}
          </Link>
        ))}
      </nav>

      <UploadForm onDone={load} />

      <section>
        <h2 className="mb-2 text-lg font-semibold">Resultados — Fase {phase}</h2>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {!error && rows === null && <p className="text-sm text-gray-500">Cargando…</p>}
        {rows?.length === 0 && <p className="text-sm text-gray-500">Aún no hay evaluaciones cargadas para esta fase.</p>}
        {!!rows?.length && (
          <table className="w-full overflow-hidden rounded-lg border bg-white text-sm">
            <thead className="bg-gray-100 text-left">
              <tr>
                <th className="p-2">Conductor</th>
                <th className="p-2">Ejercicios</th>
                <th className="p-2">Errores</th>
                <th className="p-2">Críticos</th>
                <th className="p-2">Calificación promedio</th>
                <th className="p-2">Dictamen</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.driverId} className="border-t">
                  <td className="p-2">
                    <Link to={`/drivers/${r.driverId}`} className="text-blue-700 hover:underline">{r.driver}</Link>
                  </td>
                  <td className="p-2">{r.exercises}/{r.expected}</td>
                  <td className="p-2">{r.errors}</td>
                  <td className="p-2">{r.criticalErrors > 0 ? <b className="text-red-700">{r.criticalErrors}</b> : 0}</td>
                  <td className="p-2 font-semibold">{r.avgScore}</td>
                  <td className="p-2"><span className={`rounded px-2 py-0.5 text-xs font-semibold ${r.color}`}>{r.verdict}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Modal de confirmación para eliminar la base de datos de evaluaciones */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl space-y-4">
            <h2 className="text-lg font-bold text-red-700">⚠️ ¿Eliminar todas las evaluaciones?</h2>
            <p className="text-sm text-gray-600">
              Esta acción borrará de manera <strong>permanente e irreversible</strong> todas las evaluaciones cargadas en Firestore. La tabla de resultados volverá a quedar en cero.
            </p>
            <p className="text-xs text-gray-500">
              Para confirmar, escribe la palabra <span className="font-mono font-bold text-red-700">ELIMINAR</span> a continuación:
            </p>
            <input
              type="text"
              value={confirmInput}
              onChange={(e) => setConfirmInput(e.target.value)}
              placeholder="ELIMINAR"
              disabled={isDeleting}
              className="w-full rounded border px-3 py-2 text-sm uppercase tracking-wide focus:border-red-500 focus:outline-none"
            />
            {deleteError && <p className="text-xs text-red-600">{deleteError}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                disabled={isDeleting}
                className="rounded border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleDeleteDatabase}
                disabled={confirmInput.trim().toUpperCase() !== "ELIMINAR" || isDeleting}
                className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-40 transition"
              >
                {isDeleting ? "Eliminando evaluaciones…" : "Confirmar eliminación"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
