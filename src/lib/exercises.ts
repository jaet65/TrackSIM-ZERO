import { doc, getDoc, setDoc } from "firebase/firestore";
import { firestore } from "./firebase";

export type ExerciseEnvironment = "AUTO" | "CARRETERA" | "MONTANA" | "CIUDAD";

// Ejercicios esperados por fase (clave = número de fase).
export type ExerciseConfig = Record<string, string[]>;
export type ExerciseEnvironmentsMap = Record<string, ExerciseEnvironment>; // exerciseKey -> environment

export type ExerciseSettingsData = {
  phases: ExerciseConfig;
  environments?: ExerciseEnvironmentsMap;
};

const ref = () => doc(firestore, "settings", "exercises");

export function exerciseKey(name: string) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Detecta automáticamente el tipo de entorno según palabras clave en el nombre del ejercicio.
 */
export function detectEnvironmentFromName(name: string): "CARRETERA" | "MONTANA" | "CIUDAD" {
  const norm = exerciseKey(name);
  if (
    norm.includes("montana") ||
    norm.includes("sierra") ||
    norm.includes("pendiente") ||
    norm.includes("curva") ||
    norm.includes("puerto") ||
    norm.includes("bajada") ||
    norm.includes("subida")
  ) {
    return "MONTANA";
  }
  if (
    norm.includes("ciudad") ||
    norm.includes("urbano") ||
    norm.includes("trafico") ||
    norm.includes("semaforo") ||
    norm.includes("maniobra") ||
    norm.includes("patio")
  ) {
    return "CIUDAD";
  }
  return "CARRETERA";
}

let current: ExerciseConfig = {};
let currentEnvs: ExerciseEnvironmentsMap = {};
let loading: Promise<ExerciseConfig> | null = null;

export const getExercises = () => current;
export const getExerciseEnvironments = () => currentEnvs;

/**
 * Resuelve el entorno efectivo de un ejercicio:
 * Si el usuario configuró explícitamente MONTANA, CIUDAD o CARRETERA, usa ese.
 * Si está en AUTO o no está definido, lo detecta automáticamente por el nombre.
 */
export function resolveExerciseEnvironment(name?: string): "CARRETERA" | "MONTANA" | "CIUDAD" {
  if (!name) return "CARRETERA";
  const key = exerciseKey(name);
  const explicit = currentEnvs[key];
  if (explicit && explicit !== "AUTO") {
    return explicit;
  }
  return detectEnvironmentFromName(name);
}

// Fase a la que pertenece un ejercicio según el catálogo (null si no está definido).
export function phaseForExercise(name: string): number | null {
  const key = exerciseKey(name);
  for (const [phase, list] of Object.entries(current)) if (list.some((n) => exerciseKey(n) === key)) return Number(phase);
  return null;
}

function sanitize(raw: unknown): { phases: ExerciseConfig; environments: ExerciseEnvironmentsMap } {
  const outPhases: ExerciseConfig = {};
  const outEnvs: ExerciseEnvironmentsMap = {};

  const r = (raw as { phases?: Record<string, unknown>; environments?: Record<string, string> } | undefined);
  const phasesRaw = r?.phases ?? {};
  for (const [phase, list] of Object.entries(phasesRaw)) {
    if (!Array.isArray(list)) continue;
    const seen = new Set<string>();
    outPhases[phase] = list.filter((n): n is string => {
      if (typeof n !== "string" || !n.trim() || seen.has(exerciseKey(n))) return false;
      seen.add(exerciseKey(n));
      return true;
    });
  }

  const envsRaw = r?.environments ?? {};
  if (typeof envsRaw === "object" && envsRaw !== null) {
    for (const [k, v] of Object.entries(envsRaw)) {
      if (v === "AUTO" || v === "CARRETERA" || v === "MONTANA" || v === "CIUDAD") {
        outEnvs[k] = v;
      }
    }
  }

  return { phases: outPhases, environments: outEnvs };
}

export function loadExercises(force = false): Promise<ExerciseConfig> {
  if (!loading || force) {
    loading = getDoc(ref())
      .then((snap) => {
        const { phases, environments } = sanitize(snap.exists() ? snap.data() : undefined);
        current = phases;
        currentEnvs = environments;
        return current;
      })
      .catch((e) => {
        loading = null;
        throw e;
      });
  }
  return loading;
}

export async function saveExercises(
  cfg: ExerciseConfig,
  editorEmail: string,
  environments?: ExerciseEnvironmentsMap,
) {
  const clean = sanitize({ phases: cfg, environments: environments ?? currentEnvs });
  await setDoc(ref(), {
    phases: clean.phases,
    environments: clean.environments,
    updatedAt: Date.now(),
    updatedBy: editorEmail,
  });
  current = clean.phases;
  currentEnvs = clean.environments;
  loading = Promise.resolve(clean.phases);
}
