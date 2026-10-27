import { useState } from "react";
import { decodeCsv, parseReport } from "../lib/parse";
import { saveEvaluation } from "../lib/db";
import { loadCatalog } from "../lib/catalogStore";
import { loadExercises, phaseForExercise } from "../lib/exercises";
import { useAuth } from "./AuthProvider";
import SimulatorSyncModal from "./SimulatorSyncModal";

type Result = {
  file: string;
  phase?: number;
  status: string;
  driver?: string;
  errors?: number;
  score?: number;
  message?: string;
  uncataloged?: string[];
};

export default function UploadForm({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const { user } = useAuth();
  const [results, setResults] = useState<Result[]>([]);
  const [fileCount, setFileCount] = useState<number>(0);
  const [showSyncModal, setShowSyncModal] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const files = Array.from(new FormData(form).getAll("files")).filter((f): f is File => f instanceof File);
    if (!files.length) return;

    setBusy(true);
    const out: Result[] = [];
    for (const f of files) {
      try {
        await Promise.all([loadCatalog(), loadExercises()]);
        const report = parseReport(decodeCsv(await f.arrayBuffer()));
        const phase = phaseForExercise(report.exercise);
        if (!phase) throw new Error(`La unidad «${report.exercise}» no está en el catálogo de ejercicios.`);
        const status = await saveEvaluation(phase, f.name, report, {
          name: user?.displayName || user?.email || "",
          email: user?.email ?? "",
        });
        out.push({
          file: f.name,
          phase,
          status,
          driver: report.driver,
          errors: report.errorCount,
          score: report.score,
          uncataloged: report.uncataloged,
        });
      } catch (err) {
        out.push({ file: f.name, status: "error", message: (err as Error).message });
      }
    }
    setResults(out);
    form.reset();
    setFileCount(0);
    setBusy(false);
    onDone();
  }

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
      <form onSubmit={onSubmit} className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-col gap-1.5 sm:flex-row sm:items-center">
          <label className="relative flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50/80 px-4 py-2.5 text-xs font-medium text-slate-700 hover:border-indigo-500 hover:bg-indigo-50/40 transition">
            <svg className="h-4 w-4 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            <span>{fileCount > 0 ? `${fileCount} archivo(s) seleccionado(s)` : "Seleccionar archivos CSV del simulador"}</span>
            <input
              type="file"
              name="files"
              accept=".csv"
              multiple
              required
              className="sr-only"
              onChange={(e) => setFileCount(e.target.files?.length || 0)}
            />
          </label>
          <span className="text-[11px] text-slate-500">
            Detección inteligente de fase automática según el catálogo de ejercicios.
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowSyncModal(true)}
            className="flex items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50/70 px-4 py-2.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 hover:border-indigo-300 transition shadow-xs"
          >
            <svg className="h-4 w-4 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2 1.5 3 3.5 3h9c2 0 3.5-1 3.5-3V7M4 7c0-2 1.5-3 3.5-3h9c2 0 3.5 1 3.5 3M4 7h16m-5 4h.01M9 15h6" />
            </svg>
            <span>Sincronizar Lander DB</span>
          </button>

          <button
            type="submit"
            disabled={busy || fileCount === 0}
            className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 px-5 py-2.5 text-xs font-semibold text-white shadow-sm shadow-indigo-600/20 hover:from-indigo-700 hover:to-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            {busy ? (
              <>
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                <span>Procesando telemetría…</span>
              </>
            ) : (
              <>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>Subir y Evaluar CSV</span>
              </>
            )}
          </button>
        </div>
      </form>

      <SimulatorSyncModal
        isOpen={showSyncModal}
        onClose={() => setShowSyncModal(false)}
        onSyncComplete={() => {
          onDone();
        }}
      />

      {results.length > 0 && (
        <div className="mt-4 border-t border-slate-100 pt-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
            Registro de Carga
          </h3>
          <ul className="space-y-2 text-xs">
            {results.map((r) => (
              <li
                key={r.file}
                className="rounded-xl border border-slate-200 bg-slate-50/70 p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-slate-800 font-medium">{r.file}</span>
                  <div>
                    {r.status === "saved" && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 border border-emerald-200">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        Fase {r.phase} · {r.driver} (Calif: {r.score}, {r.errors} errores)
                      </span>
                    )}
                    {r.status === "duplicate" && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-200/80 px-2.5 py-0.5 text-[11px] text-slate-600">
                        Ya cargado previamente (omitido)
                      </span>
                    )}
                    {r.status === "error" && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-2.5 py-0.5 text-[11px] font-semibold text-rose-700 border border-rose-200">
                        {r.message}
                      </span>
                    )}
                  </div>
                </div>
                {!!r.uncataloged?.length && (
                  <div className="mt-2 rounded-lg bg-amber-50 p-2.5 text-[11px] text-amber-800 border border-amber-200">
                    ⚠️ Errores sin catalogar (evaluados por defecto como moderados): {r.uncataloged.join("; ")}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
