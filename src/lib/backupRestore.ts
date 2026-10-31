import { collection, doc, query, writeBatch } from "firebase/firestore";
import { getDb, safeGetDoc, safeGetDocs, fastWrite } from "./firebase";
import type { EvaluationDoc } from "./db";
import type { GroupDoc } from "./groups";
import type { CatalogConfig } from "./catalog";
import type { ExerciseSettingsData } from "./exercises";

export type BackupMetadata = {
  version: "1.0.0";
  timestamp: number;
  dateIso: string;
  source: string;
  stats: {
    evaluationsCount: number;
    groupsCount: number;
    settingsIncluded: boolean;
  };
};

export type DatabaseBackupPackage = {
  metadata: BackupMetadata;
  evaluations: Array<{ id: string; data: EvaluationDoc }>;
  groups: Array<{ id: string; data: GroupDoc }>;
  settings: {
    catalog?: CatalogConfig;
    exercises?: ExerciseSettingsData;
  };
};

/**
 * Genera un paquete de respaldo JSON completo de toda la base de datos (Evaluaciones, Grupos, Catálogo y Ejercicios).
 */
export async function createDatabaseBackup(): Promise<DatabaseBackupPackage> {
  const db = getDb();

  // 1. Obtener todas las evaluaciones
  const evalsSnap = await safeGetDocs(query(collection(db, "evaluations")));
  const evaluationsList: Array<{ id: string; data: EvaluationDoc }> = evalsSnap.docs.map((d) => ({
    id: d.id,
    data: d.data() as EvaluationDoc,
  }));

  // 2. Obtener todos los grupos
  const groupsSnap = await safeGetDocs(query(collection(db, "groups")));
  const groupsList: Array<{ id: string; data: GroupDoc }> = groupsSnap.docs.map((d) => ({
    id: d.id,
    data: d.data() as GroupDoc,
  }));

  // 3. Obtener configuraciones globales (catálogo y ejercicios)
  let catalogCfg: CatalogConfig | undefined;
  let exercisesCfg: ExerciseSettingsData | undefined;

  try {
    const catSnap = await safeGetDoc(doc(db, "settings", "catalog"));
    if (catSnap.exists()) catalogCfg = catSnap.data() as CatalogConfig;
  } catch {}

  try {
    const exSnap = await safeGetDoc(doc(db, "settings", "exercises"));
    if (exSnap.exists()) exercisesCfg = exSnap.data() as ExerciseSettingsData;
  } catch {}

  const now = Date.now();
  const backup: DatabaseBackupPackage = {
    metadata: {
      version: "1.0.0",
      timestamp: now,
      dateIso: new Date(now).toISOString(),
      source: "TrackSIM ZERO",
      stats: {
        evaluationsCount: evaluationsList.length,
        groupsCount: groupsList.length,
        settingsIncluded: Boolean(catalogCfg || exercisesCfg),
      },
    },
    evaluations: evaluationsList,
    groups: groupsList,
    settings: {
      catalog: catalogCfg,
      exercises: exercisesCfg,
    },
  };

  return backup;
}

/**
 * Descarga el archivo JSON de respaldo directamente al navegador del usuario.
 */
export async function downloadDatabaseBackup(): Promise<void> {
  const backupData = await createDatabaseBackup();
  const dateStr = new Date().toISOString().slice(0, 10);
  const fileName = `TrackSIM_Respaldo_${dateStr}_${backupData.metadata.stats.evaluationsCount}evals.json`;

  const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export type RestoreProgressCallback = (current: number, total: number, message: string) => void;

/**
 * Restaura los datos desde un paquete de respaldo JSON validado.
 * Procesa en lotes seguros (Batches de Firestore de 450 operaciones) para no saturar la red ni la memoria.
 */
export async function restoreDatabaseBackup(
  backup: DatabaseBackupPackage,
  onProgress?: RestoreProgressCallback
): Promise<{ evaluationsRestored: number; groupsRestored: number }> {
  if (!backup || !backup.metadata || !Array.isArray(backup.evaluations)) {
    throw new Error("El archivo proporcionado no tiene el formato válido de respaldo de TrackSIM ZERO.");
  }

  const db = getDb();
  let evalsCount = 0;
  let groupsCount = 0;

  // 1. Restaurar Grupos
  if (Array.isArray(backup.groups) && backup.groups.length > 0) {
    const totalG = backup.groups.length;
    onProgress?.(0, totalG, "Restaurando grupos de trabajo…");
    for (let i = 0; i < totalG; i += 400) {
      const chunk = backup.groups.slice(i, i + 400);
      const batch = writeBatch(db);
      for (const item of chunk) {
        const ref = doc(db, "groups", item.id);
        batch.set(ref, item.data, { merge: true });
        groupsCount++;
      }
      await fastWrite(batch.commit());
      onProgress?.(Math.min(i + chunk.length, totalG), totalG, `Grupos restaurados: ${Math.min(i + chunk.length, totalG)}/${totalG}`);
    }
  }

  // 2. Restaurar Configuraciones Globales
  if (backup.settings) {
    if (backup.settings.catalog) {
      const catRef = doc(db, "settings", "catalog");
      const batch = writeBatch(db);
      batch.set(catRef, backup.settings.catalog, { merge: true });
      await fastWrite(batch.commit());
    }
    if (backup.settings.exercises) {
      const exRef = doc(db, "settings", "exercises");
      const batch = writeBatch(db);
      batch.set(exRef, backup.settings.exercises, { merge: true });
      await fastWrite(batch.commit());
    }
  }

  // 3. Restaurar Evaluaciones
  const totalE = backup.evaluations.length;
  onProgress?.(0, totalE, "Restaurando evaluaciones y telemetrías…");
  for (let i = 0; i < totalE; i += 400) {
    const chunk = backup.evaluations.slice(i, i + 400);
    const batch = writeBatch(db);
    for (const item of chunk) {
      const ref = doc(db, "evaluations", item.id);
      batch.set(ref, item.data, { merge: true });
      evalsCount++;
    }
    await fastWrite(batch.commit());
    onProgress?.(Math.min(i + chunk.length, totalE), totalE, `Evaluaciones restauradas: ${Math.min(i + chunk.length, totalE)}/${totalE}`);
  }

  return { evaluationsRestored: evalsCount, groupsRestored: groupsCount };
}
