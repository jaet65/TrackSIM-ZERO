import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  orderBy,
  deleteDoc,
} from "firebase/firestore";
import { firestore } from "./firebase";
import type { EvaluationDoc, EvaluationView } from "./db";
import { withCurrentScore } from "./db";
import { loadExercises } from "./exercises";
import { loadCatalog } from "./catalogStore";

export type GroupStatus = "open" | "closed";

export type GroupDoc = {
  id: string;
  name: string;
  description?: string;
  status: GroupStatus;
  createdAt: number;
  createdBy: string;
  createdByEmail: string;
  closedAt?: number;
  closedBy?: string;
  closedByEmail?: string;
  evaluationCount?: number;
  driverCount?: number;
};

const groupsCol = () => collection(firestore, "groups");
const evaluationsCol = () => collection(firestore, "evaluations");

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

export async function listGroups(): Promise<GroupDoc[]> {
  const snap = await getDocs(query(groupsCol(), orderBy("createdAt", "desc")));
  return snap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<GroupDoc, "id">),
  }));
}

export async function getGroup(groupId: string): Promise<GroupDoc | null> {
  const snap = await getDoc(doc(groupsCol(), groupId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() as Omit<GroupDoc, "id">) };
}

export async function createGroup(
  name: string,
  description: string,
  user: { name: string; email: string }
): Promise<GroupDoc> {
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error("El nombre del grupo no puede estar vacío.");

  const id = `grp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const groupData: GroupDoc = {
    id,
    name: trimmedName,
    description: description.trim(),
    status: "open",
    createdAt: Date.now(),
    createdBy: user.name || user.email,
    createdByEmail: user.email,
    evaluationCount: 0,
    driverCount: 0,
  };

  await setDoc(doc(groupsCol(), id), groupData);
  // Se establece automáticamente como el grupo activo para nuevas subidas
  setActiveGroupId(id);
  return groupData;
}

/**
 * Cierra un grupo y congela todos los registros de evaluación asociados.
 * Calcula la instantánea final (calificaciones, dictámenes, errores y severidades)
 * y la guarda en cada documento con frozen = true.
 */
export async function closeAndFreezeGroup(
  groupId: string,
  user: { name: string; email: string }
): Promise<{ evaluationsFrozen: number }> {
  await Promise.all([loadCatalog(), loadExercises()]);

  const grpRef = doc(groupsCol(), groupId);
  const grpSnap = await getDoc(grpRef);
  if (!grpSnap.exists()) throw new Error("El grupo no existe.");
  const grpData = grpSnap.data() as GroupDoc;
  if (grpData.status === "closed") throw new Error("El grupo ya se encuentra cerrado y congelado.");

  // Obtener todas las evaluaciones asociadas al grupo
  const q = query(evaluationsCol(), where("groupId", "==", groupId));
  const snap = await getDocs(q);

  const chunkSize = 400;
  const docs = snap.docs;
  const driversSet = new Set<string>();

  for (let i = 0; i < docs.length; i += chunkSize) {
    const chunk = docs.slice(i, i + chunkSize);
    const batch = writeBatch(firestore);

    for (const d of chunk) {
      const evalDoc = d.data() as EvaluationDoc;
      driversSet.add(evalDoc.driverId);

      // Calcular el score congelado con los catálogos en su estado exacto actual
      const computed = withCurrentScore(evalDoc);

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

    await batch.commit();
  }

  // Actualizar el estado del grupo a "closed"
  await updateDoc(grpRef, {
    status: "closed",
    closedAt: Date.now(),
    closedBy: user.name || user.email,
    closedByEmail: user.email,
    evaluationCount: docs.length,
    driverCount: driversSet.size,
  });

  return { evaluationsFrozen: docs.length };
}

/**
 * Elimina las evaluaciones correspondientes a un grupo específico.
 * Protege contra borrados accidentales de toda la base de datos.
 */
export async function deleteGroupEvaluations(groupId: string): Promise<number> {
  if (!groupId) throw new Error("Debe indicarse un ID de grupo válido.");

  const q = query(evaluationsCol(), where("groupId", "==", groupId));
  const snap = await getDocs(q);
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
    await batch.commit();
    totalDeleted += chunk.length;
  }

  // Actualizar contadores del grupo
  const grpRef = doc(groupsCol(), groupId);
  const grpSnap = await getDoc(grpRef);
  if (grpSnap.exists()) {
    await updateDoc(grpRef, {
      evaluationCount: 0,
      driverCount: 0,
    });
  }

  return totalDeleted;
}

/**
 * Elimina un grupo y sus evaluaciones asociadas.
 */
export async function deleteGroup(groupId: string): Promise<void> {
  await deleteGroupEvaluations(groupId);
  const grpRef = doc(groupsCol(), groupId);
  await deleteDoc(grpRef);
  if (getActiveGroupId() === groupId) {
    setActiveGroupId(null);
  }
}
