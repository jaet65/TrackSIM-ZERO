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

  useEffect(() => {
    loadExercises().then((c) => setCfg(structuredClone(c))).catch((e: Error) => setMsg(e.message));
  }, []);

  if (!cfg) return <p className="p-6 text-sm text-gray-500">{msg || "Cargando…"}</p>;

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
    try {
      await saveExercises(cfg, user?.email ?? "");
      setDirty(false);
      setMsg("Guardado. Los promedios ya usan este catálogo.");
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  return (
    <main className="mx-auto max-w-3xl space-y-5 p-6">
      <Link to="/" className="text-sm text-blue-700 hover:underline">← Volver</Link>
      <div>
        <h1 className="text-2xl font-bold">Catálogo de ejercicios</h1>
        <p className="text-sm text-gray-600">
          Define los ejercicios de cada fase, con el nombre exacto que trae el CSV (campo «Ejercicio»). El promedio de la fase
          se divide entre el número de ejercicios definidos: un ejercicio sin evaluar cuenta como 0. Si hay varias
          evaluaciones del mismo ejercicio, se toma la más reciente. Una fase sin ejercicios definidos promedia lo que se haya cargado.
        </p>
        {!canEdit && <p className="mt-1 text-sm text-amber-700">Solo los administradores pueden editar.</p>}
      </div>

      {PHASES.map((p) => (
        <section key={p.id} className="rounded-lg border bg-white p-4">
          <h2 className="mb-2 font-semibold">Fase {p.id}: {p.name}</h2>
          {!(cfg[p.id]?.length) && <p className="text-sm text-gray-500">Sin ejercicios definidos.</p>}
          <ul className="space-y-1">
            {(cfg[p.id] ?? []).map((n) => (
              <li key={n} className="flex items-center justify-between rounded bg-gray-50 px-2 py-1 text-sm">
                <span>{n}</span>
                {canEdit && (
                  <button onClick={() => remove(p.id, n)} className="text-red-600 hover:underline">Quitar</button>
                )}
              </li>
            ))}
          </ul>
          {canEdit && (
            <div className="mt-2 flex gap-2">
              <input
                value={drafts[p.id] ?? ""}
                onChange={(e) => setDrafts({ ...drafts, [p.id]: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && add(p.id)}
                placeholder="Ej. 03C - Autopista - T880"
                className="flex-1 rounded border px-2 py-1 text-sm"
              />
              <button onClick={() => add(p.id)} className="rounded border px-3 py-1 text-sm hover:bg-gray-50">Agregar</button>
            </div>
          )}
        </section>
      ))}

      {canEdit && (
        <div className="flex items-center gap-3">
          <button
            onClick={save}
            disabled={!dirty}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            Guardar
          </button>
          {msg && <span className="text-sm text-gray-700">{msg}</span>}
        </div>
      )}
      {!canEdit && msg && <p className="text-sm text-red-600">{msg}</p>}
    </main>
  );
}
