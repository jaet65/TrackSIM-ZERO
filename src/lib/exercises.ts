import { doc, setDoc, updateDoc } from "firebase/firestore";
import { firestore, safeGetDoc, fastWrite } from "./firebase";
import { DEFAULT_PHASES, type PhaseItem } from "./config";

export type ExerciseEnvironment = "AUTO" | "CARRETERA" | "MONTANA" | "CIUDAD";

// Ejercicios esperados por fase (clave = número de fase).
export type ExerciseConfig = Record<string, string[]>;
export type ExerciseEnvironmentsMap = Record<string, ExerciseEnvironment>; // exerciseKey -> environment
export type ExerciseDescriptionsMap = Record<string, string>; // exerciseKey -> descripción
export type PhaseNamesMap = Record<number, string>; // phaseId -> custom name

export type ExerciseSettingsData = {
  phases: ExerciseConfig;
  environments?: ExerciseEnvironmentsMap;
  descriptions?: ExerciseDescriptionsMap;
  phaseNames?: PhaseNamesMap;
  globalType?: "escuela" | "curso";
  cursoExercises?: {
    phases: ExerciseConfig;
    environments?: ExerciseEnvironmentsMap;
    descriptions?: ExerciseDescriptionsMap;
  };
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
let currentDescriptions: ExerciseDescriptionsMap = {};
let currentPhaseNames: PhaseNamesMap = {};
let currentGlobalType: "escuela" | "curso" = "escuela";

let currentCursoPhases: ExerciseConfig = {};
let currentCursoEnvs: ExerciseEnvironmentsMap = {};
let currentCursoDescriptions: ExerciseDescriptionsMap = {};

let loading: Promise<ExerciseConfig> | null = null;
let savingPromise: Promise<void> = Promise.resolve();

export function waitForExerciseSaves(): Promise<void> {
  return savingPromise;
}

const groupExercises = new Map<
  string,
  {
    phases: ExerciseConfig;
    environments: ExerciseEnvironmentsMap;
    descriptions: ExerciseDescriptionsMap;
    phaseNames: PhaseNamesMap;
  }
>();
const groupTypes = new Map<string, "escuela" | "curso">();

export function setGroupTypeMemory(groupId: string, type: "escuela" | "curso") {
  groupTypes.set(groupId, type);
}

export function setGlobalTypeMemory(type: "escuela" | "curso") {
  currentGlobalType = type;
}

export function getGroupType(groupId?: string | null): "escuela" | "curso" {
  if (groupId && groupTypes.has(groupId)) {
    return groupTypes.get(groupId)!;
  }
  if (!groupId) {
    return currentGlobalType;
  }
  return "escuela";
}

export function setGroupExercises(
  groupId: string,
  phases: ExerciseConfig,
  environments: ExerciseEnvironmentsMap = {},
  descriptions: ExerciseDescriptionsMap = {},
  phaseNames: PhaseNamesMap = {}
) {
  groupExercises.set(groupId, { phases, environments, descriptions, phaseNames });
}

export function removeGroupExercises(groupId: string) {
  groupExercises.delete(groupId);
  groupTypes.delete(groupId);
}

export function hasGroupExercises(groupId: string): boolean {
  return groupExercises.has(groupId);
}

// Grupos con una escritura de ejercicios aún sin confirmar por el servidor: la memoria es más reciente que cualquier lectura
const pendingGroupSaves = new Set<string>();

export function hasPendingExerciseSave(groupId: string): boolean {
  return pendingGroupSaves.has(groupId);
}

export const getExercises = (groupId?: string | null, groupType?: "escuela" | "curso"): ExerciseConfig => {
  if (groupId && groupExercises.has(groupId)) {
    return groupExercises.get(groupId)!.phases;
  }
  const effectiveType = groupType ?? (groupId ? getGroupType(groupId) : currentGlobalType);
  if (!groupId && effectiveType === "curso") {
    return currentCursoPhases;
  }
  return current;
};

export const getExerciseEnvironments = (groupId?: string | null, groupType?: "escuela" | "curso"): ExerciseEnvironmentsMap => {
  if (groupId && groupExercises.has(groupId)) {
    const grp = groupExercises.get(groupId)!;
    return { ...currentEnvs, ...grp.environments };
  }
  const effectiveType = groupType ?? (groupId ? getGroupType(groupId) : currentGlobalType);
  if (!groupId && effectiveType === "curso") {
    return currentCursoEnvs;
  }
  return currentEnvs;
};

export const getExerciseDescriptions = (groupId?: string | null, groupType?: "escuela" | "curso"): ExerciseDescriptionsMap => {
  if (groupId && groupExercises.has(groupId)) {
    const grp = groupExercises.get(groupId)!;
    return { ...currentDescriptions, ...grp.descriptions };
  }
  const effectiveType = groupType ?? (groupId ? getGroupType(groupId) : currentGlobalType);
  if (!groupId && effectiveType === "curso") {
    return currentCursoDescriptions;
  }
  return currentDescriptions;
};

export const getPhaseNames = (groupId?: string | null, groupType?: "escuela" | "curso"): PhaseNamesMap => {
  if (groupId && groupExercises.has(groupId)) {
    const grp = groupExercises.get(groupId)!;
    return { ...currentPhaseNames, ...grp.phaseNames };
  }
  const effectiveType = groupType ?? (groupId ? getGroupType(groupId) : currentGlobalType);
  if (!groupId && effectiveType === "curso") {
    return {};
  }
  return currentPhaseNames;
};

/**
 * Obtiene la lista ordenada de fases configuradas con su nombre personalizado o predeterminado.
 */
export function getPhasesList(groupId?: string | null, customPhasesConfig?: ExerciseConfig): PhaseItem[] {
  const cfg = customPhasesConfig ?? getExercises(groupId);
  const names = getPhaseNames(groupId);

  const phaseKeys = Object.keys(cfg)
    .map((k) => Number(k))
    .filter((id) => !isNaN(id) && id > 0);

  // Ordenar numéricamente
  phaseKeys.sort((a, b) => a - b);

  return phaseKeys.map((id) => {
    const defaultPhase = DEFAULT_PHASES.find((p) => p.id === id);
    const customName = names[id]?.trim();
    const finalName = customName || defaultPhase?.name || `Fase ${id}`;
    return { id, name: finalName };
  });
}

/**
 * Devuelve el nombre de una fase considerando la configuración del grupo o global.
 */
export function getPhaseName(id: number, groupId?: string | null): string {
  if (id === 0) return "Curso";
  const names = getPhaseNames(groupId);
  if (names[id]?.trim()) return names[id].trim();
  const def = DEFAULT_PHASES.find((p) => p.id === id);
  return def?.name ?? `Fase ${id}`;
}

export function getExerciseDescription(name?: string, groupId?: string | null): string | undefined {
  if (!name) return undefined;
  const key = exerciseKey(name);
  const descs = getExerciseDescriptions(groupId);
  return descs[key] || undefined;
}

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

export function sanitizeExercises(raw: unknown): {
  phases: ExerciseConfig;
  environments: ExerciseEnvironmentsMap;
  descriptions: ExerciseDescriptionsMap;
  phaseNames: PhaseNamesMap;
  globalType: "escuela" | "curso";
  cursoExercises?: {
    phases: ExerciseConfig;
    environments?: ExerciseEnvironmentsMap;
    descriptions?: ExerciseDescriptionsMap;
  };
} {
  const outPhases: ExerciseConfig = {};
  const outEnvs: ExerciseEnvironmentsMap = {};
  const outDescriptions: ExerciseDescriptionsMap = {};
  const outPhaseNames: PhaseNamesMap = {};

  const r = raw as {
    phases?: Record<string, unknown>;
    environments?: Record<string, string>;
    descriptions?: Record<string, string>;
    phaseNames?: Record<string | number, string>;
    globalType?: "escuela" | "curso";
    cursoExercises?: {
      phases?: Record<string, unknown>;
      environments?: Record<string, string>;
      descriptions?: Record<string, string>;
    };
  } | undefined;

  if (!raw) {
    DEFAULT_PHASES.forEach((p) => {
      outPhases[String(p.id)] = [];
    });
  }
  const phasesRaw: Record<string, unknown> = { ...r?.phases };
  // Compatibilidad: versiones previas guardaban la lista de un Curso bajo la fase "0"; ahora es la fase 1
  if (Array.isArray(phasesRaw["0"])) {
    const legacy = phasesRaw["0"] as unknown[];
    delete phasesRaw["0"];
    const existing = Array.isArray(phasesRaw["1"]) ? (phasesRaw["1"] as unknown[]) : [];
    phasesRaw["1"] = [...existing, ...legacy];
  }
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

  const descsRaw = r?.descriptions ?? {};
  if (typeof descsRaw === "object" && descsRaw !== null) {
    for (const [k, v] of Object.entries(descsRaw)) {
      if (typeof v === "string" && v.trim()) {
        outDescriptions[k] = v.trim();
      }
    }
  }

  const namesRaw = r?.phaseNames ?? {};
  if (typeof namesRaw === "object" && namesRaw !== null) {
    for (const [k, v] of Object.entries(namesRaw)) {
      const numId = Number(k);
      if (!isNaN(numId) && numId > 0 && typeof v === "string" && v.trim()) {
        outPhaseNames[numId] = v.trim();
      }
    }
  }

  const globalType = r?.globalType === "curso" ? "curso" : "escuela";

  let outCursoExercises:
    | {
        phases: ExerciseConfig;
        environments?: ExerciseEnvironmentsMap;
        descriptions?: ExerciseDescriptionsMap;
      }
    | undefined = undefined;

  if (r?.cursoExercises && typeof r.cursoExercises === "object") {
    const cPhasesRaw = { ...r.cursoExercises.phases };
    const cPhases: ExerciseConfig = {};
    for (const [phase, list] of Object.entries(cPhasesRaw)) {
      if (!Array.isArray(list)) continue;
      const seen = new Set<string>();
      cPhases[phase] = list.filter((n): n is string => {
        if (typeof n !== "string" || !n.trim() || seen.has(exerciseKey(n))) return false;
        seen.add(exerciseKey(n));
        return true;
      });
    }

    const cEnvs: ExerciseEnvironmentsMap = {};
    const cEnvsRaw = r.cursoExercises.environments ?? {};
    if (typeof cEnvsRaw === "object" && cEnvsRaw !== null) {
      for (const [k, v] of Object.entries(cEnvsRaw)) {
        if (v === "AUTO" || v === "CARRETERA" || v === "MONTANA" || v === "CIUDAD") {
          cEnvs[k] = v;
        }
      }
    }

    const cDescs: ExerciseDescriptionsMap = {};
    const cDescsRaw = r.cursoExercises.descriptions ?? {};
    if (typeof cDescsRaw === "object" && cDescsRaw !== null) {
      for (const [k, v] of Object.entries(cDescsRaw)) {
        if (typeof v === "string" && v.trim()) {
          cDescs[k] = v.trim();
        }
      }
    }

    outCursoExercises = {
      phases: cPhases,
      environments: cEnvs,
      descriptions: cDescs,
    };
  }

  return {
    phases: outPhases,
    environments: outEnvs,
    descriptions: outDescriptions,
    phaseNames: outPhaseNames,
    globalType,
    cursoExercises: outCursoExercises,
  };
}

export async function loadExercises(
  force = false,
  groupId?: string | null,
  groupType?: "escuela" | "curso"
): Promise<ExerciseConfig> {
  await savingPromise;

  if (!loading || force) {
    loading = safeGetDoc(ref())
      .then((snap) => {
        const { phases, environments, descriptions, phaseNames, globalType, cursoExercises } = sanitizeExercises(snap.exists() ? snap.data() : undefined);
        current = phases;
        currentEnvs = environments;
        currentDescriptions = descriptions;
        currentPhaseNames = phaseNames;
        currentGlobalType = globalType;

        currentCursoPhases = cursoExercises?.phases ?? {};
        currentCursoEnvs = cursoExercises?.environments ?? {};
        currentCursoDescriptions = cursoExercises?.descriptions ?? {};

        return current;
      })
      .catch((e) => {
        loading = null;
        throw e;
      });
  }
  const basePhases = await loading;

  if (groupId) {
    if (pendingGroupSaves.has(groupId)) {
      return getExercises(groupId, groupType);
    }
    const grpSnap = await safeGetDoc(groupRef(groupId));
    if (grpSnap.exists()) {
      const grpData = grpSnap.data();
      if (grpData?.exercises) {
        const { phases, environments, descriptions, phaseNames } = sanitizeExercises(grpData.exercises);
        setGroupExercises(groupId, phases, environments, descriptions, phaseNames);
        return phases;
      }
    }
    return getExercises(groupId, groupType) || basePhases;
  }

  const effectiveType = groupType ?? currentGlobalType;
  if (effectiveType === "curso") {
    return currentCursoPhases;
  }

  return basePhases;
}

export async function saveExercises(
  cfg: ExerciseConfig,
  editorEmail: string,
  environments?: ExerciseEnvironmentsMap,
  groupId?: string | null,
  descriptions?: ExerciseDescriptionsMap,
  phaseNames?: PhaseNamesMap,
  groupType?: "escuela" | "curso"
) {
  const targetType = groupType ?? (groupId ? getGroupType(groupId) : currentGlobalType);
  const fallbackEnvs = getExerciseEnvironments(groupId, targetType);
  const fallbackDescs = getExerciseDescriptions(groupId, targetType);
  const fallbackNames = getPhaseNames(groupId, targetType);
  const clean = sanitizeExercises({
    phases: cfg,
    environments: environments ?? fallbackEnvs,
    descriptions: descriptions ?? fallbackDescs,
    phaseNames: phaseNames ?? fallbackNames,
    globalType: targetType,
  });

  if (groupId) {
    // Actualizar en memoria de inmediato para evitar lecturas obsoletas al cambiar de pestaña
    setGroupExercises(groupId, clean.phases, clean.environments, clean.descriptions, clean.phaseNames);
    pendingGroupSaves.add(groupId);
    const task = savingPromise.then(() => {
      const write = updateDoc(groupRef(groupId), {
        exercises: {
          phases: clean.phases,
          environments: clean.environments,
          descriptions: clean.descriptions,
          phaseNames: clean.phaseNames,
        },
        exercisesUpdatedAt: Date.now(),
        exercisesUpdatedBy: editorEmail,
      });
      write.then(
        () => pendingGroupSaves.delete(groupId),
        () => pendingGroupSaves.delete(groupId)
      );
      return fastWrite(write);
    });
    savingPromise = task.catch(() => {});
    await task;
    return;
  }

  if (targetType === "curso") {
    currentCursoPhases = clean.phases;
    currentCursoEnvs = clean.environments;
    currentCursoDescriptions = clean.descriptions;
  } else {
    current = clean.phases;
    currentEnvs = clean.environments;
    currentDescriptions = clean.descriptions;
    currentPhaseNames = clean.phaseNames;
  }
  currentGlobalType = targetType;
  loading = Promise.resolve(targetType === "curso" ? currentCursoPhases : current);

  const docPayload = {
    phases: current,
    environments: currentEnvs,
    descriptions: currentDescriptions,
    phaseNames: currentPhaseNames,
    globalType: currentGlobalType,
    cursoExercises: {
      phases: currentCursoPhases,
      environments: currentCursoEnvs,
      descriptions: currentCursoDescriptions,
    },
    updatedAt: Date.now(),
    updatedBy: editorEmail,
  };

  const task = savingPromise.then(() =>
    fastWrite(setDoc(ref(), docPayload))
  );
  savingPromise = task.catch(() => {});
  await task;
}
