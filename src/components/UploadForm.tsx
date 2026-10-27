import { useState } from "react";
import { PHASES } from "../lib/config";
import { decodeCsv, parseReport } from "../lib/parse";
import { saveEvaluation } from "../lib/db";
import { useAuth } from "./AuthProvider";

type Result = { file: string; status: string; driver?: string; errors?: number; score?: number; message?: string; uncataloged?: string[] };

export default function UploadForm({ phase, onDone }: { phase: number; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const { user } = useAuth();
  const [results, setResults] = useState<Result[]>([]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const files = Array.from(new FormData(form).getAll("files")).filter((f): f is File => f instanceof File);
    setBusy(true);
    const out: Result[] = [];
    for (const f of files) {
      try {
        const report = parseReport(decodeCsv(await f.arrayBuffer()));
        const status = await saveEvaluation(phase, f.name, report, {
          name: user?.displayName || user?.email || "",
          email: user?.email ?? "",
        });
        out.push({ file: f.name, status, driver: report.driver, errors: report.errorCount, score: report.score, uncataloged: report.uncataloged });
      } catch (err) {
        out.push({ file: f.name, status: "error", message: (err as Error).message });
      }
    }
    setResults(out);
    form.reset();
    setBusy(false);
    onDone();
  }

  const label = PHASES.find((p) => p.id === phase)?.name;
  return (
    <div className="rounded-lg border bg-white p-4 shadow-sm">
      <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-3">
        <input type="file" name="files" accept=".csv" multiple required className="text-sm" />
        <button disabled={busy} className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {busy ? "Procesando…" : `Cargar CSV en Fase ${phase}`}
        </button>
        <span className="text-xs text-gray-500">{label}</span>
      </form>
      {results.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm">
          {results.map((r) => (
            <li key={r.file}>
              <span className="font-mono text-xs">{r.file}</span> —{" "}
              {r.status === "saved" && `✔ ${r.driver}: ${r.errors} errores, calificación ${r.score}`}
              {r.status === "duplicate" && "ya cargado (omitido)"}
              {r.status === "error" && <span className="text-red-600">{r.message}</span>}
              {!!r.uncataloged?.length && (
                <div className="ml-4 text-xs text-amber-700">Sin catalogar (se tratan como moderados): {r.uncataloged.join("; ")}</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
