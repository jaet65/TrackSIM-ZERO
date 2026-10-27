import { Link } from "react-router-dom";
import { CATALOG, SEVERITIES, type Severity } from "../lib/catalog";

const ORDER: Severity[] = ["CRITICO", "GRAVE", "MODERADO", "LEVE"];

export default function Catalog() {
  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <Link to="/" className="text-sm text-blue-700 hover:underline">← Volver</Link>
      <h1 className="text-2xl font-bold">Catálogo de errores</h1>
      <p className="text-sm text-gray-600">
        Cada error resta puntos según su gravedad. La calificación del ejercicio es 100 menos los puntos por minuto × 10.
        Un error crítico hace el dictamen NO APTO sin importar el promedio.
      </p>
      {ORDER.map((s) => (
        <section key={s}>
          <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold">
            <span className={`rounded px-2 py-0.5 text-sm ${SEVERITIES[s].badge}`}>{SEVERITIES[s].label}</span>
            <span className="text-sm font-normal text-gray-500">
              {SEVERITIES[s].weight} pts{SEVERITIES[s].eliminatory ? " · eliminatorio" : ""}
            </span>
          </h2>
          <ul className="list-disc space-y-0.5 pl-6 text-sm">
            {CATALOG.filter((e) => e.severity === s).map((e) => <li key={e.name}>{e.name}</li>)}
          </ul>
        </section>
      ))}
    </main>
  );
}
