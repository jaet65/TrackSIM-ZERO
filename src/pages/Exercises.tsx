import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../components/AuthProvider";
import { PHASES, isAdminEmail } from "../lib/config";
import {
  exerciseKey,
  loadExercises,
  saveExercises,
  getExercises,
  getExerciseEnvironments,
  detectEnvironmentFromName,
  type ExerciseConfig,
  type ExerciseEnvironment,
  type ExerciseEnvironmentsMap,
} from "../lib/exercises";
import { listGroups, getActiveGroupId, setActiveGroupId, type GroupDoc } from "../lib/groups";
import { listUploadedExerciseNames } from "../lib/db";

export default function Exercises() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();

  const [groups, setGroups] = useState<GroupDoc[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string>(() => {
    const fromUrl = params.get("grupo");
    if (fromUrl !== null) return fromUrl;
    return getActiveGroupId() || "";
  });

  const [cfg, setCfg] = useState<ExerciseConfig | null>(null);
  const [envs, setEnvs] = useState<ExerciseEnvironmentsMap>({});
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [draftEnvs, setDraftEnvs] = useState<Record<number, ExerciseEnvironment>>({});
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingRules, setLoadingRules] = useState(true);
  const [copySourceId, setCopySourceId] = useState<string>("");
  const [uploadedNames, setUploadedNames] = useState<string[]>([]);

  const selectedGroup = useMemo(
    () => groups.find((g) => g.id === selectedGroupId) || null,
    [groups, selectedGroupId]
  );

  const isClosedGroup = selectedGroup?.status === "closed";
  const canEdit = selectedGroupId
    ? !isClosedGroup
    : isAdminEmail(user?.email);

  useEffect(() => {
    listGroups()
      .then((list) => {
        setGroups(list);
        if (selectedGroupId && !list.some((g) => g.id === selectedGroupId)) {
          setSelectedGroupId("");
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoadingRules(true);
    setMsg("");
    setDirty(false);
    Promise.all([
      loadExercises(false, selectedGroupId || null),
      listUploadedExerciseNames(selectedGroupId || null).catch(() => [] as string[]),
    ])
      .then(([c, detected]) => {
        setCfg(structuredClone(c));
        setEnvs(structuredClone(getExerciseEnvironments(selectedGroupId || null)));
        setUploadedNames(detected);
      })
      .catch((e: Error) => setMsg(e.message))
      .finally(() => setLoadingRules(false));
  }, [selectedGroupId]);

  const handleGroupChange = (nextGroupId: string) => {
    if (dirty && !window.confirm("Tienes cambios sin guardar. ¿Deseas cambiar de grupo y descartarlos?")) {
      return;
    }
    setSelectedGroupId(nextGroupId);
    if (nextGroupId) {
      setActiveGroupId(nextGroupId);
      setParams({ grupo: nextGroupId });
    } else {
      setParams({});
    }
  };

  const handleCopyFrom = async (sourceId: string) => {
    if (!sourceId) return;
    const targetId = sourceId === "__GLOBAL__" ? null : sourceId;
    const sourceLabel =
      sourceId === "__GLOBAL__"
        ? "la Plantilla Global"
        : `el grupo «${groups.find((g) => g.id === sourceId)?.name || sourceId}»`;

    try {
      await loadExercises(false, targetId);
      setCfg(structuredClone(getExercises(targetId)));
      setEnvs(structuredClone(getExerciseEnvironments(targetId)));
      setDirty(true);
      setCopySourceId("");
      setMsg(
        `Ejercicios copiados desde ${sourceLabel}. Haz clic en «Guardar Catálogo» para aplicarlos a ${
          selectedGroup ? `«${selectedGroup.name}»` : "la Plantilla Global"
        }.`
      );
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  if (!cfg || loadingRules) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-slate-500">
        <div className="flex items-center gap-3">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
          <span className="text-sm">{msg || "Cargando catálogo de ejercicios…"}</span>
        </div>
      </div>
    );
  }

  const persistImmediately = async (nextCfg: ExerciseConfig, nextEnvs: ExerciseEnvironmentsMap) => {
    try {
      await saveExercises(nextCfg, user?.email ?? "", nextEnvs, selectedGroupId || null);
      setDirty(false);
    } catch {
      setDirty(true);
    }
  };

  const update = (next: ExerciseConfig, nextEnvs?: ExerciseEnvironmentsMap) => {
    const targetEnvs = nextEnvs ?? envs;
    setCfg(next);
    if (nextEnvs) setEnvs(nextEnvs);
    setDirty(true);
    setMsg("");
    void persistImmediately(next, targetEnvs);
  };

  const add = (phase: number, explicitName?: string) => {
    const name = (explicitName ?? drafts[phase] ?? "").trim();
    if (!name) return;
    const list = cfg[phase] ?? [];
    if (list.some((n) => exerciseKey(n) === exerciseKey(name))) return setMsg("Ese ejercicio ya está en la fase.");

    const key = exerciseKey(name);
    const chosenEnv = draftEnvs[phase] || envs[key] || "AUTO";
    const nextEnvs = { ...envs, [key]: chosenEnv };

    // Quitar de cualquier otra fase donde estuviera asignado previamente para evitar duplicados entre fases
    const nextCfg: ExerciseConfig = {};
    for (const [p, pList] of Object.entries(cfg)) {
      if (Number(p) === phase) continue;
      nextCfg[p] = (pList ?? []).filter((n) => exerciseKey(n) !== key);
    }
    nextCfg[phase] = [...list, name];

    update(nextCfg, nextEnvs);
    if (!explicitName) {
      setDrafts({ ...drafts, [phase]: "" });
      setDraftEnvs({ ...draftEnvs, [phase]: "AUTO" });
    }
  };

  const movePhase = (fromPhase: number, toPhase: number, name: string) => {
    if (fromPhase === toPhase) return;
    const key = exerciseKey(name);
    const nextCfg: ExerciseConfig = { ...cfg };
    nextCfg[fromPhase] = (cfg[fromPhase] ?? []).filter((n) => exerciseKey(n) !== key);
    const targetList = (cfg[toPhase] ?? []).filter((n) => exerciseKey(n) !== key);
    nextCfg[toPhase] = [...targetList, name];
    update(nextCfg, envs);
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
    void persistImmediately(cfg, nextEnvs);
  };

  const save = async () => {
    setBusy(true);
    try {
      await saveExercises(cfg, user?.email ?? "", envs, selectedGroupId || null);
      setDirty(false);
      setMsg(
        selectedGroup
          ? `Catálogo de ejercicios guardado para el grupo «${selectedGroup.name}».`
          : "Plantilla global de ejercicios guardada correctamente."
      );
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
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
      <div>
        <Link
          to={selectedGroupId ? `/?grupo=${selectedGroupId}` : "/"}
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
              Define los ejercicios obligatorios por fase y el entorno operativo (<strong>Carretera</strong>, <strong>Montaña</strong> o <strong>Ciudad</strong>) para cada grupo de evaluación de forma independiente.
            </p>
          </div>
          {isClosedGroup ? (
            <span className="rounded-full bg-slate-100 border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700">
              🔒 Grupo Cerrado — Solo lectura
            </span>
          ) : !canEdit ? (
            <span className="rounded-full bg-amber-50 border border-amber-200 px-3 py-1 text-xs font-semibold text-amber-800">
              Modo solo lectura
            </span>
          ) : null}
        </div>
      </div>

      {/* Selector de Grupo / Ámbito de Ejercicios */}
      <section className="rounded-2xl border border-indigo-100 bg-gradient-to-r from-indigo-50/70 via-white to-blue-50/50 p-4 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-xs shrink-0">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
            <div>
              <label htmlFor="exercises-group-select" className="block text-[11px] font-bold uppercase tracking-wider text-indigo-700">
                Configurando Ejercicios por Fase para:
              </label>
              <select
                id="exercises-group-select"
                value={selectedGroupId}
                onChange={(e) => handleGroupChange(e.target.value)}
                className="mt-1 rounded-xl border border-indigo-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-900 shadow-xs focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="">🌐 Plantilla Global (Base para nuevos grupos)</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.status === "closed" ? "🔒" : "🟢"} Grupo: {g.name}
                    {g.id === getActiveGroupId() ? " (Activo)" : ""}
                    {g.status === "closed" ? " (Cerrado)" : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {canEdit && (
            <div className="flex flex-wrap items-center gap-2 border-t lg:border-t-0 pt-3 lg:pt-0 border-indigo-100">
              <span className="text-xs font-semibold text-slate-600">Copiar ejercicios desde:</span>
              <select
                value={copySourceId}
                onChange={(e) => handleCopyFrom(e.target.value)}
                className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-xs focus:border-indigo-500 focus:outline-none"
              >
                <option value="">-- Seleccionar origen para importar --</option>
                {selectedGroupId !== "" && (
                  <option value="__GLOBAL__">🌐 Plantilla Global</option>
                )}
                {groups
                  .filter((g) => g.id !== selectedGroupId)
                  .map((g) => (
                    <option key={g.id} value={g.id}>
                      📋 Grupo: {g.name}
                    </option>
                  ))}
              </select>
            </div>
          )}
        </div>
      </section>

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
                  Sin ejercicios asignados a esta fase.
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
                          {canEdit && (
                            <select
                              value={p.id}
                              onChange={(e) => movePhase(p.id, Number(e.target.value), n)}
                              className="rounded-lg border border-indigo-200 bg-indigo-50/70 px-2 py-1 text-[11px] font-bold text-indigo-700 shadow-xs focus:border-indigo-500 focus:outline-none"
                              title="Mover ejercicio a otra fase"
                            >
                              {PHASES.map((ph) => (
                                <option key={ph.id} value={ph.id}>
                                  Fase {ph.id}
                                </option>
                              ))}
                            </select>
                          )}

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
                <div className="space-y-2 pt-1">
                  <div className="flex flex-wrap sm:flex-nowrap gap-2">
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

                  {uploadedNames.filter((u) => !list.some((n) => exerciseKey(n) === exerciseKey(u))).length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <span className="text-[11px] font-medium text-slate-400">
                        Ejercicios detectados en reportes (clic para asignar a Fase {p.id}):
                      </span>
                      {uploadedNames
                        .filter((u) => !list.some((n) => exerciseKey(n) === exerciseKey(u)))
                        .map((u) => {
                          const assignedPhase = Object.entries(cfg).find(
                            ([ph, phList]) => Number(ph) !== p.id && (phList ?? []).some((n) => exerciseKey(n) === exerciseKey(u))
                          )?.[0];
                          return (
                            <button
                              key={u}
                              type="button"
                              onClick={() => add(p.id, u)}
                              className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50/60 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100 transition cursor-pointer"
                              title={assignedPhase ? `Mover de Fase ${assignedPhase} a Fase ${p.id}` : `Agregar a Fase ${p.id}`}
                            >
                              <span>+ {u}</span>
                              {assignedPhase && (
                                <span className="text-[9px] font-normal text-indigo-500">(en F{assignedPhase})</span>
                              )}
                            </button>
                          );
                        })}
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {canEdit && (
        <div className="sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-xl backdrop-blur-md">
          <div className="flex items-center gap-3">
            <button
              onClick={save}
              disabled={!dirty || busy}
              className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 px-5 py-2.5 text-xs font-semibold text-white shadow-md shadow-indigo-600/20 hover:from-indigo-700 hover:to-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              {busy
                ? "Guardando…"
                : selectedGroup
                ? `Guardar Ejercicios de «${selectedGroup.name}»`
                : "Guardar Plantilla Global"}
            </button>
            {dirty && (
              <span className="text-xs text-amber-700 font-medium flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                Cambios pendientes sin guardar
              </span>
            )}
          </div>
          {msg && <span className="text-xs text-emerald-700 font-medium">{msg}</span>}
        </div>
      )}
    </main>
  );
}
