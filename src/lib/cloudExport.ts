import {
  collection,
  doc,
  query,
  setDoc,
  updateDoc,
  deleteDoc,
  where,
  writeBatch,
  orderBy,
} from "firebase/firestore";
import { getDb, firestore, safeGetDoc, safeGetDocs, fastWrite } from "./firebase";
import type { EvaluationDoc, EvaluationView, DriverData } from "./db";
import { withCurrentScore, buildDriverDataFromEvals } from "./db";
import { computeGroupBenchmarks } from "./pacingBenchmark";
import { generateDeterministicFolio } from "./pdfExport";
import { hydrateGroupRules, type GroupDoc } from "./groups";

// ============================================================================
// CONTRATO DE EXPORTACIÓN HACIA TrackSIM-CLOUD (Version 1.0.0)
// ============================================================================

export type CloudExportStatus = "pending" | "complete" | "error";

export interface CloudExportDoc {
  schemaVersion: "1.0.0";
  groupId: string; // ID identificador amigable del export (ej. "Almex_2026_Prueba_l1dka")
  sourceGroupId?: string; // ID interno original del grupo en ZERO (ej. "grp_1793743986790_l1dka")
  groupName: string;
  groupFolio: string | null;
  status: CloudExportStatus;
  expectedCount: number;
  exportedCount: number;
  createdAt: number;
  closedAt: number;
  exportedAt: number;
  completedAt?: number | null;
  errorMessage?: string | null;
  sourceSystem: "TrackSIM-ZERO";
  createdBy: string;
  createdByEmail: string;
  closedBy?: string;
  closedByEmail?: string;
}

export interface CloudExportExerciseItem {
  numero: number;
  nombre: string;
  modulo?: string;
  fecha?: string | null;
  instructor?: string | null;
  tiempo?: string | null;
  distancia?: string | null;
  calificacion?: number;
  score?: number;
  colisiones: number;
  infracciones: number;
  estado: "Realizado" | "No Realizado";
  noRealizado: boolean;
}

export interface CloudExportFrequentMistakeItem {
  error: string;
  errorRaw?: string;
  repeticiones: number;
  severidad?: "CRITICO" | "GRAVE" | "MODERADO" | "LEVE" | string;
  ejeNombre?: string;
  ejeId?: number | null;
}

/**
 * Expediente individual exportado para TrackSIM-CLOUD.
 * Compatible semánticamente y en campos con la interfaz `Evaluation` de TrackSIM-CLOUD.
 */
export interface CloudExportEvaluationDoc {
  schemaVersion: "1.0.0";
  // Identidad
  id: string; // Formato determinista: eval_{groupId}_{driverIdSanitizado}
  folio: string; // Formato idéntico al PDF: EXP-YYYYMMDD-XXXX-YYYY
  conductor: string;
  operador: string;
  groupId: string;
  groupName: string;
  folioGrupo: string | null;

  // Contexto operativo
  empresa: string | null;
  sede: string | null;
  ciudad: string | null;
  instructor: string | null;
  fecha: string | null;
  fechaCapacitacion: string | null;
  fechaCapacitacionFormato: string | null;
  fechaReporte: string;
  tipoEvaluacion: string;
  tipoLicencia: string | null;
  cursoCodigo: string | null;
  cursoNombre: string;

  // Resultado
  evaluacionFinalPuntos: number;
  calificacionExacta: number;
  promedioScore: number;
  estado: "Sobresaliente" | "Aprobado" | "Reforzar" | "Requiere Refuerzo" | "No Aprobado" | "Pendiente" | string;
  clasificacion: string;

  // Métricas reales verificables de TrackSIM-ZERO
  destrezaPuntos: number;
  destrezaMax: number;
  ecoDrivingPuntos: number;
  ecoDrivingMax: number;
  habilidadesManejoPct: number | null;
  practicaSimuladorPct: number | null;

  // Incidentes cuantificables
  colisiones: number;
  totalColisiones: number;
  accidentesCriticos: number;
  fatalidades: number;
  vehiculoFueraVia: number;
  totalInfracciones: number;

  // Desglose de simulaciones y debilidades
  ejercicios: CloudExportExerciseItem[];
  simulacionesDetalle: Record<string, number>;
  nombresSimulaciones: Record<string | number, string>;
  erroresFrecuentes: CloudExportFrequentMistakeItem[];

  // Metadatos de procedencia y trazabilidad
  origen: "TrackSIM-ZERO-V2";
  sourceGroupId: string;
  sourceDriverId: string;
  sourceEvaluationIds: string[];
  creadoEn: number;
  createdAt: string;
  actualizadoEn: number;
  updatedAt: string;
}

export interface CloudExportResult {
  groupId: string; // ID identificador amigable del export
  exportId: string; // Alias explícito
  sourceGroupId: string; // ID interno original del grupo en ZERO
  status: CloudExportStatus;
  exportedCount: number;
  expectedCount: number;
}

// ============================================================================
// HELPERS DE TRANSFORMACIÓN Y NORMALIZACIÓN
// ============================================================================

const cloudExportsCol = () => collection(getDb(), "cloud_exports");
const groupEvaluationsSubcol = (groupId: string) =>
  collection(getDb(), "cloud_exports", groupId, "evaluations");

/**
 * Genera un ID de exportación amigable, identificable y legible para humanos
 * (ej. "Almex_2026_Prueba_l1dka" en lugar de "grp_1793743986790_l1dka").
 */
export function toFriendlyExportId(group: { name: string; id: string }): string {
  const cleanName = (group.name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (group.id && cleanName && group.id.startsWith(cleanName)) {
    return group.id;
  }

  const suffix = group.id.replace(/^grp_/, "").split("_").pop() || group.id.slice(-5);
  return `${cleanName || "grupo"}_${suffix}`;
}

/**
 * Genera un ID de documento determinista y seguro para Firestore.
 */
export function toCloudEvaluationId(groupId: string, driverId: string): string {
  const sanitizedGroup = groupId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const sanitizedDriver = driverId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `eval_${sanitizedGroup}_${sanitizedDriver}`;
}

/**
 * Traduce el veredicto oficial de ZERO a los estados estándar consumidos por CLOUD.
 */
export function mapZeroVerdictToCloudEstado(
  verdict: string
): "Sobresaliente" | "Aprobado" | "Reforzar" | "No Aprobado" | "Pendiente" {
  const norm = verdict
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
  if (norm.includes("OBSERVACIONES")) return "Reforzar";
  if (norm.includes("NO APTO") || norm.includes("NO REALIZADO")) return "No Aprobado";
  if (norm.includes("INCOMPLETO") || norm.includes("SIN CONFIGURAR")) return "Pendiente";
  if (norm.includes("APTO")) return "Aprobado";
  return "Pendiente";
}

/**
 * Nombres canónicos de faltas de colisión reconocidos en TrackSIM.
 */
const COLLISION_MISTAKE_PATTERNS = [
  /colisi[oó]n/i,
  /atropello\s+de\s+un\s+perro/i,
  /impacto/i,
  /choque/i,
];

export function isCollisionMark(description: string): boolean {
  return COLLISION_MISTAKE_PATTERNS.some((pattern) => pattern.test(description));
}

/**
 * Calcula Destreza (70%) y Eco-Driving (30%) de forma idéntica a la carátula del PDF V2.
 */
export function calculateDestrezaAndEco(
  evalsList: EvaluationView[],
  overall: number
): { destrezaPuntos: number; destrezaMax: number; ecoDrivingPuntos: number; ecoDrivingMax: number } {
  const destrezaMax = 7.0;
  const ecoDrivingMax = 3.0;

  if (!evalsList.length) {
    return { destrezaPuntos: 0, destrezaMax, ecoDrivingPuntos: 0, ecoDrivingMax };
  }

  const totalDestrezaVal = evalsList.reduce((acc, e) => acc + (e.errorScore ?? e.score), 0);
  let destrezaPonderadaNum = Math.round((totalDestrezaVal / evalsList.length) * 0.7 * 10) / 10;

  const evalsWithEco = evalsList.filter((e) => e.telemetryScore !== undefined);
  let ecoPonderadoNum =
    evalsWithEco.length > 0
      ? Math.round(
          (evalsWithEco.reduce((acc, e) => acc + (e.telemetryScore ?? 0), 0) / evalsWithEco.length) * 0.3 * 10
        ) / 10
      : 0;

  // Ajuste proporcional si la calificación global fue afectada o topada por faltas críticas
  if (overall !== undefined && evalsWithEco.length > 0) {
    const rawSum = Math.round((destrezaPonderadaNum + ecoPonderadoNum) * 10) / 10;
    if (rawSum !== overall && rawSum > 0) {
      const ratio = overall / rawSum;
      destrezaPonderadaNum = Math.round(destrezaPonderadaNum * ratio * 10) / 10;
      ecoPonderadoNum = Math.round((overall - destrezaPonderadaNum) * 10) / 10;
    }
  }

  return {
    destrezaPuntos: Math.max(0, destrezaPonderadaNum),
    destrezaMax,
    ecoDrivingPuntos: Math.max(0, ecoPonderadoNum),
    ecoDrivingMax,
  };
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Calcula el conteo de incidentes respetando la taxonomía y definiciones de ZERO y CLOUD.
 */
export function countIncidents(
  breakdown: DriverData["breakdown"],
  evals: EvaluationView[],
  criticalAccidents: number
): {
  colisiones: number;
  totalColisiones: number;
  accidentesCriticos: number;
  fatalidades: number;
  vehiculoFueraVia: number;
  totalInfracciones: number;
} {
  let colisiones = 0;
  let fatalidades = 0;
  let vehiculoFueraVia = 0;

  for (const item of breakdown) {
    const desc = item.rawDescription || item.description;
    const count = Number.isSafeInteger(item.count) && item.count > 0 ? item.count : 0;
    const lower = normalizeText(desc);

    if (lower.includes("salirse de la via") || lower.includes("fuera de la via")) {
      if (item.severity === "CRITICO" || item.environment === "MONTANA") {
        fatalidades += count;
      } else {
        vehiculoFueraVia += count;
      }
    } else if (
      lower.includes("atropello de un peaton") ||
      lower.includes("peaton") ||
      lower.includes("vuelco")
    ) {
      fatalidades += count;
    } else if (isCollisionMark(desc)) {
      colisiones += count;
    }
  }

  const totalInfracciones = evals.reduce((sum, e) => sum + (e.errorCount || 0), 0);

  return {
    colisiones,
    totalColisiones: colisiones,
    accidentesCriticos: criticalAccidents,
    fatalidades,
    vehiculoFueraVia,
    totalInfracciones,
  };
}

/**
 * Construye el objeto `CloudExportEvaluationDoc` para un conductor a partir de sus datos congelados.
 */
export function buildCloudExportEvaluation(
  groupDoc: GroupDoc,
  driverData: DriverData,
  folio: string,
  now = Date.now(),
  exportId = toFriendlyExportId(groupDoc)
): CloudExportEvaluationDoc {
  const driverId = driverData.evals[0]?.driverId || "unknown";
  const id = toCloudEvaluationId(exportId, driverId);

  // Fechas de las evaluaciones
  const sortedDates = driverData.evals
    .map((e) => e.date)
    .filter((d): d is string => typeof d === "string" && d.trim().length > 0)
    .sort();
  const latestDate = sortedDates.length ? sortedDates[sortedDates.length - 1] : null;
  const firstInstructor = driverData.evals[0]?.instructor || null;

  // Destreza y Eco-Drive
  const { destrezaPuntos, destrezaMax, ecoDrivingPuntos, ecoDrivingMax } = calculateDestrezaAndEco(
    driverData.evals,
    driverData.overall
  );

  // Incidentes
  const incidentCounts = countIncidents(driverData.breakdown, driverData.evals, driverData.criticalErrors);

  // Desglose de ejercicios
  const combinedRows = [
    ...driverData.evals.map((e) => ({ type: "done" as const, phase: e.phase, eval: e })),
    ...(driverData.missingExercises || []).map((m) => ({
      type: "missing" as const,
      phase: m.phase,
      exercise: m.exercise,
    })),
  ].sort((a, b) => {
    if (a.phase !== b.phase) return a.phase - b.phase;
    if (a.type === "done" && b.type === "missing") return -1;
    if (a.type === "missing" && b.type === "done") return 1;
    return 0;
  });

  const ejercicios: CloudExportExerciseItem[] = combinedRows.map((row, idx) => {
    const numero = idx + 1;
    if (row.type === "done") {
      const e = row.eval;
      const min = Math.floor(e.durationSec / 60);
      const sec = String(e.durationSec % 60).padStart(2, "0");
      const durationStr = `${min}:${sec}`;
      const colisionesEjercicio = (e.marks || []).filter(
        (m) => m.type === "ERROR" && !m.ignored && isCollisionMark(m.description)
      ).length;

      return {
        numero,
        nombre: e.exercise,
        modulo: e.phase === 0 ? "Curso" : `Fase ${e.phase}`,
        fecha: e.date || null,
        instructor: e.instructor || null,
        tiempo: durationStr,
        distancia: null, // ZERO no provee odómetro exacto en telemetría base
        calificacion: e.score,
        score: e.score,
        colisiones: colisionesEjercicio,
        infracciones: e.errorCount,
        estado: "Realizado",
        noRealizado: false,
      };
    } else {
      return {
        numero,
        nombre: row.exercise,
        modulo: row.phase === 0 ? "Curso" : `Fase ${row.phase}`,
        fecha: null,
        instructor: null,
        tiempo: null,
        distancia: null,
        calificacion: undefined,
        score: undefined,
        colisiones: 0,
        infracciones: 0,
        estado: "No Realizado",
        noRealizado: true,
      };
    }
  });

  const simulacionesDetalle: Record<string, number> = {};
  const nombresSimulaciones: Record<string | number, string> = {};
  ejercicios.forEach((ex, idx) => {
    simulacionesDetalle[`simulacion_${idx + 1}`] = ex.calificacion ?? 0;
    nombresSimulaciones[idx + 1] = ex.nombre;
  });

  // Errores frecuentes / debilidades
  const erroresFrecuentes: CloudExportFrequentMistakeItem[] = driverData.breakdown.map((item) => ({
    error: item.description,
    errorRaw: item.rawDescription,
    repeticiones: item.count,
    severidad: item.severity,
    ejeNombre: item.environment,
    ejeId: null,
  }));

  const nowIso = new Date(now).toISOString();
  const sourceEvaluationIds = driverData.evals.map((e) => e.docId || e.fileName);

  return {
    schemaVersion: "1.0.0",
    id,
    folio,
    conductor: driverData.name,
    operador: driverData.name,
    groupId: exportId,
    groupName: groupDoc.name,
    folioGrupo: null, // null para no ensuciar la identificación con IDs crudos

    // Contexto
    empresa: null, // Limitación documentada: ZERO no almacena campo de empresa en las evaluaciones
    sede: null,    // Limitación documentada: ZERO no almacena campo de sede
    ciudad: null,
    instructor: firstInstructor,
    fecha: latestDate,
    fechaCapacitacion: latestDate,
    fechaCapacitacionFormato: latestDate,
    fechaReporte: nowIso.slice(0, 10),
    tipoEvaluacion: "Expediente individual V2",
    tipoLicencia: null,
    cursoCodigo: null,
    cursoNombre: groupDoc.name,

    // Resultado
    evaluacionFinalPuntos: driverData.overall,
    calificacionExacta: driverData.overall,
    promedioScore: driverData.overall,
    estado: mapZeroVerdictToCloudEstado(driverData.verdict),
    clasificacion: driverData.verdict,

    // Métricas verificables
    destrezaPuntos,
    destrezaMax,
    ecoDrivingPuntos,
    ecoDrivingMax,
    habilidadesManejoPct: null,
    practicaSimuladorPct: null,

    // Incidentes
    colisiones: incidentCounts.colisiones,
    totalColisiones: incidentCounts.totalColisiones,
    accidentesCriticos: incidentCounts.accidentesCriticos,
    fatalidades: incidentCounts.fatalidades,
    vehiculoFueraVia: incidentCounts.vehiculoFueraVia,
    totalInfracciones: incidentCounts.totalInfracciones,

    // Desglose
    ejercicios,
    simulacionesDetalle,
    nombresSimulaciones,
    erroresFrecuentes,

    // Procedencia
    origen: "TrackSIM-ZERO-V2",
    sourceGroupId: groupDoc.id,
    sourceDriverId: driverId,
    sourceEvaluationIds,
    creadoEn: now,
    createdAt: nowIso,
    actualizadoEn: now,
    updatedAt: nowIso,
  };
}

// ============================================================================
// EXPORTACIÓN A FIRESTORE CON BATCHING E IDEMPOTENCIA
// ============================================================================

/**
 * Genera la exportación inmutable y completa de un grupo cerrado a la colección `cloud_exports`.
 * Si el grupo no está cerrado, rechaza la operación.
 * Utiliza los resultados congelados como fuente de verdad inmutable.
 */
export async function exportClosedGroupToCloud(
  groupId: string,
  user: { name: string; email: string },
  chunkSize = 200
): Promise<CloudExportResult> {
  const grpRef = doc(collection(getDb(), "groups"), groupId);
  const grpSnap = await safeGetDoc(grpRef);
  if (!grpSnap.exists()) {
    throw new Error(`El grupo "${groupId}" no existe.`);
  }

  const groupDoc: GroupDoc = {
    id: grpSnap.id,
    ...(grpSnap.data() as Omit<GroupDoc, "id">),
  };

  if (groupDoc.status !== "closed") {
    throw new Error(
      `El grupo "${groupDoc.name}" no está cerrado. Solo se pueden exportar a CLOUD grupos cerrados y congelados.`
    );
  }

  hydrateGroupRules(groupDoc);

  // Obtener todas las evaluaciones del grupo
  const q = query(collection(getDb(), "evaluations"), where("groupId", "==", groupId));
  const snap = await safeGetDocs(q);
  const rawDocs = snap.docs.map((d) => ({
    ...(d.data() as EvaluationDoc),
    docId: d.id,
  }));

  // Resolver con los scores congelados sin recalcular con catálogos externos actuales
  const groupBenchmarks = computeGroupBenchmarks(rawDocs);
  const evalsWithScore = rawDocs.map((d) => withCurrentScore(d, groupId, d.docId, groupBenchmarks));

  // Agrupar evaluaciones por conductor
  const evalsByDriver = new Map<string, EvaluationView[]>();
  for (const ev of evalsWithScore) {
    const list = evalsByDriver.get(ev.driverId) || [];
    list.push(ev);
    evalsByDriver.set(ev.driverId, list);
  }

  const now = Date.now();
  const dossiers: CloudExportEvaluationDoc[] = [];

  const exportId = toFriendlyExportId(groupDoc);

  for (const [driverId, driverEvals] of evalsByDriver.entries()) {
    const sortedEvals = [...driverEvals].sort(
      (a, b) => a.phase - b.phase || a.date.localeCompare(b.date) || a.createdAt - b.createdAt
    );
    const dData = buildDriverDataFromEvals(driverId, sortedEvals, { groupId }, evalsWithScore);
    if (dData) {
      const folio = generateDeterministicFolio(driverId, dData);
      const cloudDoc = buildCloudExportEvaluation(groupDoc, dData, folio, now, exportId);
      dossiers.push(cloudDoc);
    }
  }

  // Si existía una exportación previa con un ID distinto (ej. con el ID crudo grp_...),
  // limpiarla para evitar duplicados huérfanos en la base de datos
  if (exportId !== groupId) {
    try {
      const oldSubcol = await safeGetDocs(collection(getDb(), "cloud_exports", groupId, "evaluations"));
      if (!oldSubcol.empty) {
        const delBatch = writeBatch(firestore);
        for (const d of oldSubcol.docs) {
          delBatch.delete(d.ref);
        }
        await fastWrite(delBatch.commit());
      }
      await fastWrite(deleteDoc(doc(cloudExportsCol(), groupId)));
    } catch {
      // Ignorar si no existía documento anterior
    }
  }

  const exportRef = doc(cloudExportsCol(), exportId);

  // 1. Marcar estado como 'pending' antes de escribir la subcolección
  const exportMetaPending: CloudExportDoc = {
    schemaVersion: "1.0.0",
    groupId: exportId,
    sourceGroupId: groupDoc.id,
    groupName: groupDoc.name,
    groupFolio: null, // Dejar null para que CLOUD muestre limpiamente el nombre del grupo
    status: "pending",
    expectedCount: dossiers.length,
    exportedCount: 0,
    createdAt: groupDoc.createdAt,
    closedAt: groupDoc.closedAt ?? now,
    exportedAt: now,
    sourceSystem: "TrackSIM-ZERO",
    createdBy: groupDoc.createdBy,
    createdByEmail: groupDoc.createdByEmail,
    closedBy: groupDoc.closedBy || user.name || user.email,
    closedByEmail: groupDoc.closedByEmail || user.email,
  };

  await fastWrite(setDoc(exportRef, exportMetaPending));

  // Actualizar grupo en estado pending
  await fastWrite(
    updateDoc(grpRef, {
      cloudExportId: exportId,
      cloudExportStatus: "pending",
      cloudExportError: null,
    }).catch(() => {})
  );

  let writtenCount = 0;
  const safeChunk = Math.min(Math.max(1, chunkSize), 400);

  try {
    for (let i = 0; i < dossiers.length; i += safeChunk) {
      const chunk = dossiers.slice(i, i + safeChunk);
      const batch = writeBatch(firestore);

      for (const item of chunk) {
        const itemRef = doc(groupEvaluationsSubcol(exportId), item.id);
        batch.set(itemRef, item);
      }

      await fastWrite(batch.commit());
      writtenCount += chunk.length;
    }

    // 2. Marcar como 'complete' solo tras completar todas las escrituras
    const completedAt = Date.now();
    await fastWrite(
      updateDoc(exportRef, {
        status: "complete",
        exportedCount: writtenCount,
        completedAt,
        errorMessage: null,
      })
    );

    await fastWrite(
      updateDoc(grpRef, {
        cloudExportId: exportId,
        cloudExportStatus: "complete",
        cloudExportedAt: completedAt,
        cloudExportCount: writtenCount,
        cloudExportError: null,
      })
    );

    return {
      groupId: exportId,
      exportId,
      sourceGroupId: groupDoc.id,
      status: "complete",
      exportedCount: writtenCount,
      expectedCount: dossiers.length,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);

    // Si falló alguna escritura, marcar explícitamente como 'error'
    await fastWrite(
      updateDoc(exportRef, {
        status: "error",
        errorMessage: errorMsg,
      }).catch(() => {})
    );

    await fastWrite(
      updateDoc(grpRef, {
        cloudExportStatus: "error",
        cloudExportError: errorMsg,
      }).catch(() => {})
    );

    throw new Error(
      `Fallo en la exportación a CLOUD del grupo "${groupDoc.name}": ${errorMsg}. Puedes reintentar la operación de forma segura.`
    );
  }
}

/**
 * Consulta el documento maestro de exportación de un grupo buscando por exportId o groupId interno.
 */
export async function getCloudExport(exportOrGroupId: string): Promise<CloudExportDoc | null> {
  const directSnap = await safeGetDoc(doc(cloudExportsCol(), exportOrGroupId));
  if (directSnap.exists()) return directSnap.data() as CloudExportDoc;

  // Si se consultó por el ID interno del grupo en ZERO (grp_...), buscar el export amigable correspondiente
  const grpSnap = await safeGetDoc(doc(collection(getDb(), "groups"), exportOrGroupId));
  if (grpSnap && grpSnap.exists && grpSnap.exists()) {
    const g = grpSnap.data() as GroupDoc;
    const friendlyId = g.cloudExportId || toFriendlyExportId({ name: g.name, id: exportOrGroupId });
    const friendlySnap = await safeGetDoc(doc(cloudExportsCol(), friendlyId));
    if (friendlySnap && friendlySnap.exists && friendlySnap.exists()) return friendlySnap.data() as CloudExportDoc;
  }

  return null;
}

/**
 * Consulta las exportaciones terminadas (`status == 'complete'`).
 */
export async function listCompleteCloudExports(): Promise<CloudExportDoc[]> {
  const q = query(
    cloudExportsCol(),
    where("status", "==", "complete"),
    orderBy("closedAt", "desc")
  );
  const snap = await safeGetDocs(q);
  return snap.docs.map((d) => d.data() as CloudExportDoc);
}

/**
 * Lee los expedientes de una exportación completa.
 * Si la exportación no existe o está incompleta/con error, devuelve un array vacío.
 */
export async function getCloudExportEvaluations(
  exportOrGroupId: string
): Promise<CloudExportEvaluationDoc[]> {
  const exportDoc = await getCloudExport(exportOrGroupId);
  if (!exportDoc || exportDoc.status !== "complete") {
    return [];
  }

  const snap = await safeGetDocs(groupEvaluationsSubcol(exportDoc.groupId));
  return snap.docs.map((d) => d.data() as CloudExportEvaluationDoc);
}
