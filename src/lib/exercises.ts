import { doc, getDoc, setDoc } from "firebase/firestore";
import { firestore } from "./firebase";

// Ejercicios esperados por fase (clave = número de fase). Si una fase no tiene ejercicios definidos,
// el promedio se calcula sobre los ejercicios que se hayan cargado.
export type ExerciseConfig = Record<string, string[]>;

const ref = () => doc(firestore, "settings", "exercises");

export function exerciseKey(name: string) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

let current: ExerciseConfig = {};
let loading: Promise<ExerciseConfig> | null = null;

export const getExercises = () => current;

// Fase a la que pertenece un ejercicio según el catálogo (null si no está definido).
export function phaseForExercise(name: string): number | null {
  const key = exerciseKey(name);
  for (const [phase, list] of Object.entries(current)) if (list.some((n) => exerciseKey(n) === key)) return Number(phase);
  return null;
}

function sanitize(raw: unknown): ExerciseConfig {
  const out: ExerciseConfig = {};
  const r = (raw as { phases?: Record<string, unknown> } | undefined)?.phases ?? {};
  for (const [phase, list] of Object.entries(r)) {
    if (!Array.isArray(list)) continue;
    const seen = new Set<string>();
    out[phase] = list.filter((n): n is string => {
      if (typeof n !== "string" || !n.trim() || seen.has(exerciseKey(n))) return false;
      seen.add(exerciseKey(n));
      return true;
    });
  }
  return out;
}

export function loadExercises(force = false): Promise<ExerciseConfig> {
  if (!loading || force) {
    loading = getDoc(ref())
      .then((snap) => (current = sanitize(snap.exists() ? snap.data() : undefined)))
      .catch((e) => {
        loading = null;
        throw e;
      });
  }
  return loading;
}

export async function saveExercises(cfg: ExerciseConfig, editorEmail: string) {
  const clean = sanitize({ phases: cfg });
  await setDoc(ref(), { phases: clean, updatedAt: Date.now(), updatedBy: editorEmail });
  current = clean;
  loading = Promise.resolve(clean);
}
