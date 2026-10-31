import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PHASES } from "../lib/config";
import {
  getExercises,
  getExerciseEnvironments,
  loadExercises,
  saveExercises,
  exerciseKey,
  getGroupType,
  type ExerciseConfig,
  type ExerciseEnvironment,
  type ExerciseEnvironmentsMap,
} from "../lib/exercises";
import type { GroupDoc } from "../lib/groups";
import { listUploadedExerciseNames } from "../lib/db";
import { useAuth } from "./AuthProvider";

export default function ConfigureExercisesModal({
  isOpen,
  onClose,
  group,
  onSaved,
}: {
  isOpen: boolean;
  onClose: () => void;
  group: GroupDoc | null;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const [cfg, setCfg] = useState<ExerciseConfig>({});
  const [envs, setEnvs] = useState<ExerciseEnvironmentsMap>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [draftEnvs, setDraftEnvs] = useState<Record<number, ExerciseEnvironment>>({});
  const [detectedNames, setDetectedNames] = useState<string[]>([]);

  const isCurso = group ? getGroupType(group.id) === "curso" : false;

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setError("");

    Promise.all([
      loadExercises(true, group?.id),
      listUploadedExerciseNames(group?.id),
    ])
      .then(([loadedPhases, names]) => {
        setCfg({ ...loadedPhases });
        setEnvs({ ...getExerciseEnvironments(group?.id) });
        setDetectedNames(names);
      })
      .catch((err: Error) => {
        setError(err.message);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [isOpen, group?.id]);

  if (!isOpen) return null;

  const totalConfigured = Object.values(cfg).reduce((acc, list) => acc + (list?.length || 0), 0);

  const handleAddExercise = (phaseId: number, explicitName?: string) => {
    const raw = (explicitName ?? drafts[phaseId] ?? "").trim();
    if (!raw) return;

    const key = exerciseKey(raw);
    const updated = { ...cfg };

    // Evitar duplicados eliminando de otras fases primero
    for (const ph of Object.keys(updated)) {
      updated[ph] = (updated[ph] ?? []).filter((n) => exerciseKey(n) !== key);
    }

    const currentList = updated[String(phaseId)] ?? [];
    updated[String(phaseId)] = [...currentList, raw];
    setCfg(updated);

    if (!explicitName) {
      const chosenEnv = draftEnvs[phaseId] || "AUTO";
      setEnvs((prev) => ({ ...prev, [key]: chosenEnv }));
      setDrafts((prev) => ({ ...prev, [phaseId]: "" }));
    }
  };

  const handleRemoveExercise = (phaseId: number, name: string) => {
    const key = exerciseKey(name);
    setCfg((prev) => ({
      ...prev,
      [String(phaseId)]: (prev[String(phaseId)] ?? []).filter((n) => exerciseKey(n) !== key),
    }));
  };

  const handleSave = async () => {
    if (!group) return;
    setSaving(true);
    setError("");
    try {
      await saveExercises(cfg, user?.email || "", envs, group.id);
      onSaved();
      onClose();
    } catch (err: unknown) {
      setError((err as Error).message || "Error al guardar ejercicios");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden">
        {/* Cabecera del Modal */}
        <div className="flex items-start justify-between border-b border-slate-100 bg-gradient-to-r from-amber-50/70 via-white to-indigo-50/40 p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white shadow-md shadow-amber-500/25 text-xl">
              ⚙️
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-amber-100 border border-amber-200 px-2.5 py-0.5 text-[10px] font-bold text-amber-800">
                  Configuración Necesaria
                </span>
                <span className="text-xs text-slate-500">
                  Grupo: <strong className="text-slate-800">{group?.name}</strong>
                </span>
              </div>
              <h3 className="mt-1 text-base font-bold text-slate-900">
                Configurar Ejercicios del Grupo
              </h3>
              <p className="text-xs text-slate-500">
                Para evaluar los CSV subidos, asigna las unidades que corresponden a cada fase o curso.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
          >
            ✕
          </button>
        </div>

        {/* Cuerpo del Modal */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <div className="h-8 w-8 animate-spin rounded-full border-3 border-indigo-600 border-t-transparent" />
              <p className="text-xs font-medium text-slate-500">Cargando catálogo de ejercicios…</p>
            </div>
          ) : (
            <div className="space-y-4">
              {isCurso ? (
                // MODO CURSO (FASE 0)
                <div className="rounded-xl border border-purple-200 bg-purple-50/40 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-purple-900">
                        🎯 Ejercicios del Curso
                      </h4>
                      <p className="text-[11px] text-purple-700">
                        Modalidad de curso intensivo (todas las evaluaciones computan al promedio general).
                      </p>
                    </div>
                    <span className="rounded-full bg-purple-100 px-2.5 py-0.5 text-[10px] font-bold text-purple-800">
                      {(cfg["0"] ?? []).length} ejercicio(s)
                    </span>
                  </div>

                  {/* Lista de ejercicios en Fase 0 */}
                  <div className="flex flex-wrap gap-1.5">
                    {(cfg["0"] ?? []).map((ex) => (
                      <span
                        key={ex}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-purple-200 bg-white px-2.5 py-1 text-xs font-medium text-purple-900 shadow-xs"
                      >
                        {ex}
                        <button
                          type="button"
                          onClick={() => handleRemoveExercise(0, ex)}
                          className="text-purple-400 hover:text-rose-600 font-bold"
                          title="Eliminar ejercicio"
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                    {(cfg["0"] ?? []).length === 0 && (
                      <span className="text-xs text-slate-400 italic">No hay ejercicios asignados al curso.</span>
                    )}
                  </div>

                  {/* Formulario rápido para agregar */}
                  <div className="flex gap-2 pt-1">
                    <input
                      type="text"
                      placeholder="Nombre del ejercicio (ej. 01 - Inspección o 02 - Montaña)"
                      value={drafts[0] ?? ""}
                      onChange={(e) => setDrafts({ ...drafts, 0: e.target.value })}
                      onKeyDown={(e) => e.key === "Enter" && handleAddExercise(0)}
                      className="flex-1 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => handleAddExercise(0)}
                      className="rounded-xl bg-purple-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-purple-700 transition"
                    >
                      + Agregar
                    </button>
                  </div>
                </div>
              ) : (
                // MODO ESCUELA (FASES 1 A 6)
                <div className="space-y-3">
                  {PHASES.map((p) => {
                    const list = cfg[String(p.id)] ?? [];
                    return (
                      <div
                        key={p.id}
                        className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 space-y-2.5"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700 font-black text-xs">
                              F{p.id}
                            </span>
                            <span className="text-xs font-bold text-slate-800">{p.name}</span>
                          </div>
                          <span className="rounded-full bg-slate-200/80 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                            {list.length} ejercicio(s)
                          </span>
                        </div>

                        {/* Chips de ejercicios */}
                        <div className="flex flex-wrap gap-1.5">
                          {list.map((ex) => (
                            <span
                              key={ex}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 shadow-xs"
                            >
                              {ex}
                              <button
                                type="button"
                                onClick={() => handleRemoveExercise(p.id, ex)}
                                className="text-slate-400 hover:text-rose-600 font-bold"
                                title="Eliminar ejercicio"
                              >
                                ✕
                              </button>
                            </span>
                          ))}
                          {list.length === 0 && (
                            <span className="text-[11px] text-slate-400 italic">
                              Sin ejercicios configurados en esta fase.
                            </span>
                          )}
                        </div>

                        {/* Input rápido para agregar */}
                        <div className="flex gap-2 pt-0.5">
                          <input
                            type="text"
                            placeholder={`Agregar ejercicio a Fase ${p.id}...`}
                            value={drafts[p.id] ?? ""}
                            onChange={(e) => setDrafts({ ...drafts, [p.id]: e.target.value })}
                            onKeyDown={(e) => e.key === "Enter" && handleAddExercise(p.id)}
                            className="flex-1 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => handleAddExercise(p.id)}
                            className="rounded-xl bg-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-300 transition"
                          >
                            + Agregar
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Sugerencias de ejercicios detectados en reportes subidos */}
              {detectedNames.length > 0 && (
                <div className="rounded-xl border border-dashed border-indigo-200 bg-indigo-50/40 p-3 space-y-1.5">
                  <span className="text-[11px] font-bold text-indigo-900 block">
                    Unidades encontradas en tus reportes anteriores (haz clic para auto-asignar):
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {detectedNames.map((name) => {
                      const isAssigned = Object.values(cfg).some((list) =>
                        (list ?? []).some((n) => exerciseKey(n) === exerciseKey(name))
                      );
                      if (isAssigned) return null;
                      const targetPhase = isCurso ? 0 : 1;
                      return (
                        <button
                          key={name}
                          type="button"
                          onClick={() => handleAddExercise(targetPhase, name)}
                          className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100 transition shadow-2xs"
                        >
                          + {name} {isCurso ? "" : `(a F1)`}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Pie del modal con botón de Guardar y Enlace Completo */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/80 p-4">
          <Link
            to={group ? `/ejercicios?grupo=${group.id}` : "/ejercicios"}
            onClick={onClose}
            className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 underline"
          >
            Abrir Editor Avanzado Completo ↗
          </Link>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 transition"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || totalConfigured === 0}
              className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 px-5 py-2 text-xs font-semibold text-white shadow-sm hover:from-indigo-700 hover:to-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              {saving ? (
                <>
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  <span>Guardando…</span>
                </>
              ) : (
                <span>Guardar y Continuar</span>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
