import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { phaseName, CRITICAL_LIMIT } from "../lib/config";
import { SEVERITIES } from "../lib/catalog";
import { driverData } from "../lib/db";

type Data = NonNullable<Awaited<ReturnType<typeof driverData>>>;

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export default function Driver() {
  const { id = "" } = useParams();
  const [data, setData] = useState<Data | null | undefined>(undefined);
  const [error, setError] = useState("");

  useEffect(() => {
    setData(undefined);
    driverData(id).then(setData).catch((e: Error) => setError(e.message));
  }, [id]);

  if (error) return <p className="p-6 text-red-600">{error}</p>;
  if (data === undefined) return <p className="p-6 text-gray-500">Cargando…</p>;
  if (data === null) return <p className="p-6">Conductor no encontrado. <Link to="/" className="text-blue-700 underline">Volver</Link></p>;

  const { name, evals, phases, breakdown, overall, criticalErrors, verdict, color } = data;

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <Link to="/" className="text-sm text-blue-700 hover:underline">← Volver</Link>
      <h1 className="text-2xl font-bold">{name}</h1>

      <div className="flex flex-wrap items-center gap-4 rounded-lg border bg-white p-4">
        <div>
          <div className="text-xs text-gray-500">Calificación global ({phases.length} fase(s) evaluada(s))</div>
          <div className="text-3xl font-bold">{overall}</div>
        </div>
        <span className={`rounded px-3 py-1 text-sm font-semibold ${color}`}>{verdict}</span>
        {criticalErrors > 0 && (
          <span className="text-sm text-red-700">
            {criticalErrors} error(es) crítico(s){criticalErrors >= CRITICAL_LIMIT ? ": dictamen eliminatorio" : ""}
          </span>
        )}
      </div>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Por fase</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {phases.map((p) => (
            <li key={p.phase} className="rounded border bg-white p-3 text-sm">
              <b>Fase {p.phase}: {phaseName(p.phase)}</b>
              <div>{p.exercises} ejercicio(s) · {p.errors} errores · promedio {p.avgScore}</div>
              <span className={`rounded px-2 py-0.5 text-xs font-semibold ${p.color}`}>{p.verdict}</span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Ejercicios</h2>
        <table className="w-full overflow-hidden rounded-lg border bg-white text-sm">
          <thead className="bg-gray-100 text-left">
            <tr><th className="p-2">Fase</th><th className="p-2">Ejercicio</th><th className="p-2">Fecha</th><th className="p-2">Instructor</th><th className="p-2">Duración</th><th className="p-2">Errores</th><th className="p-2">Calif.</th></tr>
          </thead>
          <tbody>
            {evals.map((e) => (
              <tr key={`${e.phase}-${e.fileName}`} className="border-t">
                <td className="p-2">{e.phase}</td><td className="p-2">{e.exercise}</td><td className="p-2">{e.date}</td>
                <td className="p-2">{e.instructor}</td><td className="p-2">{fmt(e.durationSec)}</td>
                <td className="p-2">{e.errorCount}</td><td className="p-2 font-semibold">{e.score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Errores más frecuentes</h2>
        <ul className="space-y-1 text-sm">
          {breakdown.map((b) => <li key={b.description}><b>{b.count}×</b> {b.description}</li>)}
        </ul>
      </section>
    </main>
  );
}
