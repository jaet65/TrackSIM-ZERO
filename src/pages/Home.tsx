import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import UploadForm from "../components/UploadForm";
import { PHASES } from "../lib/config";
import { phaseSummaries, type PhaseSummary } from "../lib/db";

export default function Home() {
  const [params] = useSearchParams();
  const phase = PHASES.some((p) => p.id === Number(params.get("fase"))) ? Number(params.get("fase")) : 1;
  const [rows, setRows] = useState<PhaseSummary[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setRows(null);
    setError("");
    phaseSummaries(phase).then(setRows).catch((e: Error) => setError(e.message));
  }, [phase]);

  useEffect(load, [load]);

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <h1 className="text-2xl font-bold">TrackSIM — Evaluación de conductores</h1>

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

      <UploadForm phase={phase} onDone={load} />

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
    </main>
  );
}
