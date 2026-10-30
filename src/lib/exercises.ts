import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
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
const groupRef = (groupId: string) => doc(firestore, "groups", groupId);

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

const groupExercises = new Map<string, { phases: ExerciseConfig; environments: ExerciseEnvironmentsMap }>();

export function setGroupExercises(
  groupId: string,
  phases: ExerciseConfig,
  environments: ExerciseEnvironmentsMap = {}
) {
  groupExercises.set(groupId, { phases, environments });
}

export function removeGroupExercises(groupId: string) {
  groupExercises.delete(groupId);
}

export function hasGroupExercises(groupId: string): boolean {
  return groupExercises.has(groupId);
}

export const getExercises = (groupId?: string | null): ExerciseConfig => {
  if (groupId && groupExercises.has(groupId)) {
    const grpPhases = groupExercises.get(groupId)!.phases;
    const hasAny = Object.values(grpPhases).some((list) => Array.isArray(list) && list.length > 0);
    if (hasAny) {
      return grpPhases;
    }
  }
  return current;
};

export const getExerciseEnvironments = (groupId?: string | null): ExerciseEnvironmentsMap => {
  if (groupId && groupExercises.has(groupId)) {
    const grp = groupExercises.get(groupId)!;
    const hasAny = Object.values(grp.phases).some((list) => Array.isArray(list) && list.length > 0);
    if (hasAny || Object.keys(grp.environments).length > 0) {
      return { ...currentEnvs, ...grp.environments };
    }
  }
  return currentEnvs;
};

/**
 * Resuelve el entorno efectivo de un ejercicio:
 * Si el usuario configuró explícitamente MONTANA, CIUDAD o CARRETERA (en el grupo o global), usa ese.
 * Si está en AUTO o no está definido, lo detecta automáticamente por el nombre.
 */
export function resolveExerciseEnvironment(
  name?: string,
  groupId?: string | null
): "CARRETERA" | "MONTANA" | "CIUDAD" {
  if (!name) return "CARRETERA";
  const key = exerciseKey(name);
  const envsMap = getExerciseEnvironments(groupId);
  const explicit = envsMap[key];
  if (explicit && explicit !== "AUTO") {
    return explicit;
  }
  return detectEnvironmentFromName(name);
}

// Fase a la que pertenece un ejercicio según el catálogo del grupo o global (null si no está definido).
export function phaseForExercise(name: string, groupId?: string | null): number | null {
  const key = exerciseKey(name);
  const phasesMap = getExercises(groupId);
  for (const [phase, list] of Object.entries(phasesMap)) {
    if (list.some((n) => exerciseKey(n) === key)) return Number(phase);
  }
  return null;
}

export function sanitizeExercises(raw: unknown): { phases: ExerciseConfig; environments: ExerciseEnvironmentsMap } {
  const outPhases: ExerciseConfig = {};
  const outEnvs: ExerciseEnvironmentsMap = {};

  const r = raw as { phases?: Record<string, unknown>; environments?: Record<string, string> } | undefined;
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

export async function loadExercises(force = false, groupId?: string | null): Promise<ExerciseConfig> {
  if (!loading || force) {
    loading = getDoc(ref())
      .then((snap) => {
        const { phases, environments } = sanitizeExercises(snap.exists() ? snap.data() : undefined);
        current = phases;
        currentEnvs = environments;
        return current;
      })
      .catch((e) => {
        loading = null;
        throw e;
      });
  }
  const basePhases = await loading;

  if (groupId) {
    const grpSnap = await getDoc(groupRef(groupId));
    if (grpSnap.exists()) {
      const grpData = grpSnap.data();
      if (grpData?.exercises) {
        const { phases, environments } = sanitizeExercises(grpData.exercises);
        setGroupExercises(groupId, phases, environments);
        return phases;
      }
    }
    return getExercises(groupId) || basePhases;
  }

  return basePhases;
}

export async function saveExercises(
  cfg: ExerciseConfig,
  editorEmail: string,
  environments?: ExerciseEnvironmentsMap,
  groupId?: string | null
) {
  const fallbackEnvs = getExerciseEnvironments(groupId);
  const clean = sanitizeExercises({ phases: cfg, environments: environments ?? fallbackEnvs });

  if (groupId) {
    await updateDoc(groupRef(groupId), {
      exercises: {
        phases: clean.phases,
        environments: clean.environments,
      },
      exercisesUpdatedAt: Date.now(),
      exercisesUpdatedBy: editorEmail,
    });
    setGroupExercises(groupId, clean.phases, clean.environments);
    return;
  }

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
