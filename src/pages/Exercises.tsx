import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../components/AuthProvider";
import { PHASES, isAdminEmail } from "../lib/config";
import {
  exerciseKey,
  loadExercises,
  saveExercises,
  getExerciseEnvironments,
  detectEnvironmentFromName,
  resolveExerciseEnvironment,
  type ExerciseConfig,
  type ExerciseEnvironment,
  type ExerciseEnvironmentsMap,
} from "../lib/exercises";

export default function Exercises() {
  const { user } = useAuth();
  const canEdit = isAdminEmail(user?.email);
  const [cfg, setCfg] = useState<ExerciseConfig | null>(null);
  const [envs, setEnvs] = useState<ExerciseEnvironmentsMap>({});
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [draftEnvs, setDraftEnvs] = useState<Record<number, ExerciseEnvironment>>({});
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadExercises()
      .then((c) => {
        setCfg(structuredClone(c));
        setEnvs(structuredClone(getExerciseEnvironments()));
      })
      .catch((e: Error) => setMsg(e.message));
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

  const update = (next: ExerciseConfig, nextEnvs?: ExerciseEnvironmentsMap) => {
    setCfg(next);
    if (nextEnvs) setEnvs(nextEnvs);
    setDirty(true);
    setMsg("");
  };

  const add = (phase: number) => {
    const name = (drafts[phase] ?? "").trim();
    if (!name) return;
    const list = cfg[phase] ?? [];
    if (list.some((n) => exerciseKey(n) === exerciseKey(name))) return setMsg("Ese ejercicio ya está en la fase.");
    
    const key = exerciseKey(name);
    const chosenEnv = draftEnvs[phase] || "AUTO";
    const nextEnvs = { ...envs, [key]: chosenEnv };

    update({ ...cfg, [phase]: [...list, name] }, nextEnvs);
    setDrafts({ ...drafts, [phase]: "" });
    setDraftEnvs({ ...draftEnvs, [phase]: "AUTO" });
  };

  const remove = (phase: number, name: string) => {
    const key = exerciseKey(name);
    const nextEnvs = { ...envs };
    delete nextEnvs[key];
    update({ ...cfg, [phase]: (cfg[phase] ?? []).filter((n) => n !== name) }, nextEnvs);
  };

  const setEnvForExercise = (name: string, env: ExerciseEnvironment) => {
    const key = exerciseKey(name);
    const nextEnvs = { ...envs, [key]: env };
    setEnvs(nextEnvs);
    setDirty(true);
    setMsg("");
  };

  const save = async () => {
    setBusy(true);
    try {
      await saveExercises(cfg, user?.email ?? "", envs);
      setDirty(false);
      setMsg("Guardado correctamente. Los cálculos de telemetría ahora usan este catálogo y sus entornos.");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const envBadge = (effectiveEnv: "CARRETERA" | "MONTANA" | "CIUDAD", isAuto: boolean) => {
    if (effectiveEnv === "MONTANA") {
      return (
        <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 border border-amber-200" title={isAuto ? "Auto-detectado por nombre" : "Asignado manualmente"}>
          🏔️ Montaña {isAuto && <span className="text-[9px] text-amber-600 font-normal">(Auto)</span>}
        </span>
      );
    }
    if (effectiveEnv === "CIUDAD") {
      return (
        <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-800 border border-blue-200" title={isAuto ? "Auto-detectado por nombre" : "Asignado manualmente"}>
          🏙️ Ciudad {isAuto && <span className="text-[9px] text-blue-600 font-normal">(Auto)</span>}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 border border-emerald-200" title={isAuto ? "Auto-detectado por nombre" : "Asignado manualmente"}>
        🛣️ Carretera {isAuto && <span className="text-[9px] text-emerald-600 font-normal">(Auto)</span>}
      </span>
    );
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
              Define los ejercicios obligatorios por fase y el entorno operativo (<strong>Carretera</strong>, <strong>Montaña</strong> o <strong>Ciudad</strong>). El sistema detecta el entorno automáticamente por palabras clave o puedes fijarlo manualmente para calibrar las metas de RPM verde, freno auxiliar y consumo.
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
                <ul className="space-y-2">
                  {list.map((n) => {
                    const key = exerciseKey(n);
                    const rawSetting = envs[key] ?? "AUTO";
                    const isAuto = rawSetting === "AUTO";
                    const effective = isAuto ? detectEnvironmentFromName(n) : rawSetting;

                    return (
                      <li
                        key={n}
                        className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 rounded-xl border border-slate-200/80 bg-slate-50/70 p-2.5 text-xs text-slate-800"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="font-semibold text-slate-900 truncate">{n}</span>
                          {envBadge(effective, isAuto)}
                        </div>

                        <div className="flex items-center gap-2 ml-auto">
                          {canEdit ? (
                            <select
                              value={rawSetting}
                              onChange={(e) => setEnvForExercise(n, e.target.value as ExerciseEnvironment)}
                              className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 shadow-xs focus:border-indigo-500 focus:outline-none"
                              title="Configurar tipo de entorno para telemetría"
                            >
                              <option value="AUTO">⚡ Auto-detectar</option>
                              <option value="CARRETERA">🛣️ Carretera / Plano</option>
                              <option value="MONTANA">🏔️ Montaña / Sierra</option>
                              <option value="CIUDAD">🏙️ Ciudad / Maniobras</option>
                            </select>
                          ) : (
                            <span className="text-[11px] text-slate-400 font-medium">
                              {rawSetting === "AUTO" ? "Automático" : rawSetting}
                            </span>
                          )}

                          {canEdit && (
                            <button
                              onClick={() => remove(p.id, n)}
                              className="rounded-lg p-1 text-slate-400 hover:bg-slate-200 hover:text-rose-600 transition"
                              title="Quitar ejercicio"
                            >
                              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              {canEdit && (
                <div className="flex flex-wrap sm:flex-nowrap gap-2 pt-1">
                  <input
                    value={drafts[p.id] ?? ""}
                    onChange={(e) => setDrafts({ ...drafts, [p.id]: e.target.value })}
                    onKeyDown={(e) => e.key === "Enter" && add(p.id)}
                    placeholder="Ej. 02 - Montaña o 03C - Autopista"
                    className="flex-1 min-w-[200px] rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
                  />
                  <select
                    value={draftEnvs[p.id] ?? "AUTO"}
                    onChange={(e) => setDraftEnvs({ ...draftEnvs, [p.id]: e.target.value as ExerciseEnvironment })}
                    className="rounded-xl border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-700 focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="AUTO">⚡ Auto-detectar</option>
                    <option value="CARRETERA">🛣️ Carretera</option>
                    <option value="MONTANA">🏔️ Montaña</option>
                    <option value="CIUDAD">🏙️ Ciudad</option>
                  </select>
                  <button
                    onClick={() => add(p.id)}
                    className="rounded-xl border border-slate-200 bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200 transition"
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
