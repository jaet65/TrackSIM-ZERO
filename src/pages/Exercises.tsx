import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../components/AuthProvider";
import { PHASES, isAdminEmail } from "../lib/config";
import { exerciseKey, loadExercises, saveExercises, type ExerciseConfig } from "../lib/exercises";

export default function Exercises() {
  const { user } = useAuth();
  const canEdit = isAdminEmail(user?.email);
  const [cfg, setCfg] = useState<ExerciseConfig | null>(null);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadExercises().then((c) => setCfg(structuredClone(c))).catch((e: Error) => setMsg(e.message));
  }, []);

  if (!cfg) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-slate-500">
        <div className="flex items-center gap-3">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
          <span className="text-sm">{msg || "Cargando catálogo de ejercicios…"}</span>
        </div>
      </div>
    );
  }

  const update = (next: ExerciseConfig) => {
    setCfg(next);
    setDirty(true);
    setMsg("");
  };

  const add = (phase: number) => {
    const name = (drafts[phase] ?? "").trim();
    if (!name) return;
    const list = cfg[phase] ?? [];
    if (list.some((n) => exerciseKey(n) === exerciseKey(name))) return setMsg("Ese ejercicio ya está en la fase.");
    update({ ...cfg, [phase]: [...list, name] });
    setDrafts({ ...drafts, [phase]: "" });
  };

  const remove = (phase: number, name: string) =>
    update({ ...cfg, [phase]: (cfg[phase] ?? []).filter((n) => n !== name) });

  const save = async () => {
    setBusy(true);
    try {
      await saveExercises(cfg, user?.email ?? "");
      setDirty(false);
      setMsg("Guardado correctamente. Los cálculos ahora usan este catálogo.");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
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
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900">Catálogo de Ejercicios</h1>
            <p className="mt-1 text-xs text-slate-600 max-w-2xl leading-relaxed">
              Define los ejercicios obligatorios por fase con el nombre exacto que emite el simulador en el campo «Ejercicio». Un ejercicio sin evaluar equivale a 0 y penaliza el promedio.
            </p>
          </div>
          {!canEdit && (
            <span className="rounded-full bg-amber-50 border border-amber-200 px-3 py-1 text-xs font-semibold text-amber-800">
              Modo solo lectura
            </span>
          )}
        </div>
      </div>

      <div className="grid gap-4">
        {PHASES.map((p) => {
          const list = cfg[p.id] ?? [];
          return (
            <section
              key={p.id}
              className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-bold">
                    {p.id}
                  </span>
                  <h2 className="text-sm font-bold text-slate-900">
                    Fase {p.id}: {p.name}
                  </h2>
                </div>
                <span className="text-[11px] text-slate-500 font-mono">
                  {list.length} ejercicio(s)
                </span>
              </div>

              {list.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-200 p-3 text-xs text-slate-500 bg-slate-50/50">
                  Sin ejercicios esperados. (La fase promediará los que se carguen).
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {list.map((n) => (
                    <li
                      key={n}
                      className="flex items-center justify-between rounded-xl border border-slate-200/80 bg-slate-50/70 px-3 py-2 text-xs text-slate-800"
                    >
                      <span className="font-medium">{n}</span>
                      {canEdit && (
                        <button
                          onClick={() => remove(p.id, n)}
                          className="text-slate-400 hover:text-rose-600 transition"
                          title="Quitar ejercicio"
                        >
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {canEdit && (
                <div className="flex gap-2 pt-1">
                  <input
                    value={drafts[p.id] ?? ""}
                    onChange={(e) => setDrafts({ ...drafts, [p.id]: e.target.value })}
                    onKeyDown={(e) => e.key === "Enter" && add(p.id)}
                    placeholder="Ej. 03C - Autopista - T880"
                    className="flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
                  />
                  <button
                    onClick={() => add(p.id)}
                    className="rounded-xl border border-slate-200 bg-slate-100 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200 transition"
                  >
                    Agregar
                  </button>
                </div>
              )}
            </section>
          );
        })}
      </div>

      {canEdit && (
        <div className="sticky bottom-4 z-20 flex items-center justify-between rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-xl backdrop-blur-md">
          <div className="flex items-center gap-3">
            <button
              onClick={save}
              disabled={!dirty || busy}
              className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 px-5 py-2.5 text-xs font-semibold text-white shadow-md shadow-indigo-600/20 hover:from-indigo-700 hover:to-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              {busy ? "Guardando…" : "Guardar Catálogo"}
            </button>
            {dirty && (
              <span className="text-xs text-amber-700 font-medium flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                Cambios pendientes sin guardar
              </span>
            )}
          </div>
          {msg && <span className="text-xs text-slate-600">{msg}</span>}
        </div>
      )}
    </main>
  );
}
