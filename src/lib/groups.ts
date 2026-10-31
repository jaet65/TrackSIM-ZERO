import {
  collection,
  doc,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  orderBy,
  deleteDoc,
} from "firebase/firestore";
import { firestore, getDb, safeGetDoc, safeGetDocs, fastWrite } from "./firebase";
import type { EvaluationDoc } from "./db";
import { withCurrentScore } from "./db";
import {
  loadExercises,
  getExercises,
  getExerciseEnvironments,
  sanitizeExercises,
  setGroupExercises,
  setGroupTypeMemory,
  removeGroupExercises,
  waitForExerciseSaves,
  type ExerciseSettingsData,
} from "./exercises";
import { loadCatalog, waitForCatalogSaves } from "./catalogStore";
import {
  getCatalog,
  sanitizeCatalog,
  setGroupCatalog,
  removeGroupCatalog,
  type CatalogConfig,
} from "./catalog";

export type GroupStatus = "open" | "closed";

export type GroupType = "escuela" | "curso";

export type GroupDoc = {
  id: string;
  name: string;
  description?: string;
  type?: GroupType; // "escuela" (con 6 fases) | "curso" (evaluación directa sin fases)
  status: GroupStatus;
  createdAt: number;
  createdBy: string;
  createdByEmail: string;
  closedAt?: number;
  closedBy?: string;
  closedByEmail?: string;
  evaluationCount?: number;
  driverCount?: number;
  // Reglas independientes por grupo (catálogo de errores y catálogo de ejercicios)
  catalog?: CatalogConfig;
  catalogUpdatedAt?: number;
  catalogUpdatedBy?: string;
  exercises?: ExerciseSettingsData;
  exercisesUpdatedAt?: number;
  exercisesUpdatedBy?: string;
};

const groupsCol = () => collection(getDb(), "groups");
const evaluationsCol = () => collection(getDb(), "evaluations");

// Clave en localStorage para recordar el grupo actualmente activo / seleccionado
const ACTIVE_GROUP_KEY = "tracksim_active_group_id";

export function getActiveGroupId(): string | null {
  return localStorage.getItem(ACTIVE_GROUP_KEY);
}

export function setActiveGroupId(id: string | null): void {
  if (id) {
    localStorage.setItem(ACTIVE_GROUP_KEY, id);
  } else {
    localStorage.removeItem(ACTIVE_GROUP_KEY);
  }
}

/**
 * Sincroniza en memoria las reglas propias de errores y ejercicios de un grupo
 * para que los cálculos simultáneos de múltiples grupos usen siempre su configuración correspondiente.
 */
export function hydrateGroupRules(g: GroupDoc): void {
  if (g.type) {
    setGroupTypeMemory(g.id, g.type);
  }
  if (g.catalog) {
    setGroupCatalog(g.id, sanitizeCatalog(g.catalog));
  }
  if (g.exercises) {
    const { phases, environments } = sanitizeExercises(g.exercises);
    setGroupExercises(g.id, phases, environments);
  }
}

export async function listGroups(): Promise<GroupDoc[]> {
  await Promise.all([waitForExerciseSaves(), waitForCatalogSaves()]);
  const snap = await safeGetDocs(query(groupsCol(), orderBy("createdAt", "desc")));
  const list = snap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<GroupDoc, "id">),
  }));
  for (const g of list) {
    hydrateGroupRules(g);
  }
  return list;
}

export async function getGroup(groupId: string): Promise<GroupDoc | null> {
  await Promise.all([waitForExerciseSaves(), waitForCatalogSaves()]);
  const snap = await safeGetDoc(doc(groupsCol(), groupId));
  if (!snap.exists()) return null;
  const g: GroupDoc = { id: snap.id, ...(snap.data() as Omit<GroupDoc, "id">) };
  hydrateGroupRules(g);
  return g;
}

export async function createGroup(
  name: string,
  description: string,
  user: { name: string; email: string },
  sourceGroupId?: string | null,
  type: GroupType = "escuela"
): Promise<GroupDoc> {
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error("El nombre del grupo no puede estar vacío.");

  // Cargar reglas base o del grupo origen para inicializar las reglas propias del nuevo grupo
  await Promise.all([
    loadCatalog(false, sourceGroupId || null),
    loadExercises(false, sourceGroupId || null),
  ]);

  const initialCatalog = JSON.parse(JSON.stringify(getCatalog(sourceGroupId || null))) as CatalogConfig;
  const initialPhases = JSON.parse(JSON.stringify(getExercises(sourceGroupId || null)));
  const initialEnvs = JSON.parse(JSON.stringify(getExerciseEnvironments(sourceGroupId || null)));

  const id = `grp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const now = Date.now();
  const groupData: GroupDoc = {
    id,
    name: trimmedName,
    description: description.trim(),
    type,
    status: "open",
    createdAt: now,
    createdBy: user.name || user.email,
    createdByEmail: user.email,
    evaluationCount: 0,
    driverCount: 0,
    catalog: initialCatalog,
    catalogUpdatedAt: now,
    catalogUpdatedBy: user.email,
    exercises: {
      phases: initialPhases,
      environments: initialEnvs,
    },
    exercisesUpdatedAt: now,
    exercisesUpdatedBy: user.email,
  };

  await fastWrite(setDoc(doc(groupsCol(), id), groupData));
  hydrateGroupRules(groupData);
  // Se establece automáticamente como el grupo activo para nuevas subidas
  setActiveGroupId(id);
  return groupData;
}

/**
 * Cierra un grupo y congela todos los registros de evaluación asociados.
 * Calcula la instantánea final (calificaciones, dictámenes, errores y severidades)
 * usando las reglas propias del grupo y la guarda en cada documento con frozen = true.
 */
export async function closeAndFreezeGroup(
  groupId: string,
  user: { name: string; email: string }
): Promise<{ evaluationsFrozen: number }> {
  await Promise.all([loadCatalog(false, groupId), loadExercises(false, groupId)]);

  const grpRef = doc(groupsCol(), groupId);
  const grpSnap = await safeGetDoc(grpRef);
  if (!grpSnap.exists()) throw new Error("El grupo no existe.");
  const grpData = { id: grpSnap.id, ...(grpSnap.data() as Omit<GroupDoc, "id">) };
  if (grpData.status === "closed") throw new Error("El grupo ya se encuentra cerrado y congelado.");

  hydrateGroupRules(grpData);

  // Obtener todas las evaluaciones asociadas al grupo
  const q = query(evaluationsCol(), where("groupId", "==", groupId));
  const snap = await safeGetDocs(q);

  const chunkSize = 400;
  const docs = snap.docs;
  const driversSet = new Set<string>();

  for (let i = 0; i < docs.length; i += chunkSize) {
    const chunk = docs.slice(i, i + chunkSize);
    const batch = writeBatch(firestore);

    for (const d of chunk) {
      const evalDoc = d.data() as EvaluationDoc;
      driversSet.add(evalDoc.driverId);

      // Calcular el score congelado con los catálogos del grupo en su estado exacto actual
      const computed = withCurrentScore({ ...evalDoc, groupId });

      batch.update(d.ref, {
        frozen: true,
        frozenAt: Date.now(),
        frozenByEmail: user.email,
        frozenScore: computed.score,
        frozenErrorCount: computed.errorCount,
        frozenCriticalCount: computed.criticalCount,
        frozenErrorScore: computed.errorScore,
        frozenTelemetryScore: computed.telemetryScore,
        // Guardamos también las marcas con la severidad resuelta congelada
        frozenMarks: computed.marks,
      });
    }

    await fastWrite(batch.commit());
  }

  // Actualizar el estado del grupo a "closed"
  await fastWrite(
    updateDoc(grpRef, {
      status: "closed",
      closedAt: Date.now(),
      closedBy: user.name || user.email,
      closedByEmail: user.email,
      evaluationCount: docs.length,
      driverCount: driversSet.size,
    })
  );

  return { evaluationsFrozen: docs.length };
}

/**
 * Elimina las evaluaciones correspondientes a un grupo específico.
 * Protege contra borrados accidentales de toda la base de datos.
 */
export async function deleteGroupEvaluations(groupId: string): Promise<number> {
  if (!groupId) throw new Error("Debe indicarse un ID de grupo válido.");

  const q = query(evaluationsCol(), where("groupId", "==", groupId));
  const snap = await safeGetDocs(q);
  if (snap.empty) return 0;

  let totalDeleted = 0;
  const docs = snap.docs;
  const chunkSize = 400;

  for (let i = 0; i < docs.length; i += chunkSize) {
    const chunk = docs.slice(i, i + chunkSize);
    const batch = writeBatch(firestore);
    for (const d of chunk) {
      batch.delete(d.ref);
    }
    await fastWrite(batch.commit());
    totalDeleted += chunk.length;
  }

  // Actualizar contadores del grupo
  const grpRef = doc(groupsCol(), groupId);
  const grpSnap = await safeGetDoc(grpRef);
  if (grpSnap.exists()) {
    await fastWrite(
      updateDoc(grpRef, {
        evaluationCount: 0,
        driverCount: 0,
      })
    );
  }

  return totalDeleted;
}

/**
 * Actualiza el tipo de un grupo existente ("escuela" o "curso").
 */
export async function updateGroupType(groupId: string, type: GroupType): Promise<void> {
  if (!groupId) return;
  setGroupTypeMemory(groupId, type);
  const grpRef = doc(groupsCol(), groupId);
  await fastWrite(updateDoc(grpRef, { type }));
}

/**
 * Actualiza el nombre y opcionalmente la descripción de un grupo.
 */
export async function updateGroupDetails(
  groupId: string,
  name: string,
  description?: string
): Promise<void> {
  if (!groupId) return;
  const trimmed = name.trim();
  if (!trimmed) throw new Error("El nombre del grupo no puede estar vacío.");
  const grpRef = doc(groupsCol(), groupId);
  await fastWrite(
    updateDoc(grpRef, {
      name: trimmed,
      ...(description !== undefined ? { description: description.trim() } : {}),
    })
  );
}
export async function deleteGroup(groupId: string): Promise<void> {
  await deleteGroupEvaluations(groupId);
  const grpRef = doc(groupsCol(), groupId);
  await fastWrite(deleteDoc(grpRef));
  removeGroupCatalog(groupId);
  removeGroupExercises(groupId);
  if (getActiveGroupId() === groupId) {
    setActiveGroupId(null);
  }
}
