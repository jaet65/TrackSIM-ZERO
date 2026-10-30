import { collection, doc, getDoc, getDocs, query, setDoc, where, writeBatch } from "firebase/firestore";
import { firestore, getDb } from "./firebase";
import type { Mark, ParsedReport, TelemetryMetrics } from "./parse";
import { evaluateMarks } from "./parse";
import { classify } from "./catalog";
import { loadCatalog } from "./catalogStore";
import { CRITICAL_LIMIT, verdictFor } from "./config";
import { exerciseKey, getExercises, loadExercises, resolveExerciseEnvironment } from "./exercises";
import { listGroups } from "./groups";

export type EvaluationDoc = {
  phase: number;
  driverId: string;
  driverName: string;
  fileName: string;
  lesson: string;
  unit: string;
  exercise: string;
  vehicle: string;
  instructor: string;
  instructorEmail: string;
  date: string;
  durationSec: number;
  errorCount: number;
  score: number;
  marks: Mark[];
  telemetry?: TelemetryMetrics;
  createdAt: number;
  // Campos de grupos y congelación
  groupId?: string;
  frozen?: boolean;
  frozenAt?: number;
  frozenByEmail?: string;
  frozenScore?: number;
  frozenErrorCount?: number;
  frozenCriticalCount?: number;
  frozenErrorScore?: number;
  frozenTelemetryScore?: number;
  frozenMarks?: Mark[];
};

const evaluations = () => collection(getDb(), "evaluations");

export function driverSlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// ID determinista (grupo + fase + archivo) para que re-cargar el mismo CSV en el mismo grupo no duplique resultados,
// pero permita cargar sesiones en grupos distintos de forma independiente.
function evaluationId(phase: number, fileName: string, groupId?: string) {
  const cleanFile = fileName.replace(/[^\w.-]+/g, "_");
  if (groupId) {
    return `${groupId}_f${phase}_${cleanFile}`;
  }
  return `f${phase}_${cleanFile}`;
}

export type Instructor = { name: string; email: string };

export async function saveEvaluation(
  phase: number,
  fileName: string,
  r: ParsedReport,
  instructor: Instructor,
  groupId?: string,
): Promise<"saved" | "duplicate"> {
  // Verificar también el formato legado sin prefijo de grupo para evitar duplicar registros antiguos del mismo grupo
  const legacyRef = doc(evaluations(), evaluationId(phase, fileName));
  const legacySnap = await getDoc(legacyRef);
  if (legacySnap.exists()) {
    const existingGroup = (legacySnap.data() as EvaluationDoc).groupId || "";
    if (existingGroup === (groupId || "")) {
      return "duplicate";
    }
  }

  const ref = doc(evaluations(), evaluationId(phase, fileName, groupId));
  if (groupId && (await getDoc(ref)).exists()) return "duplicate";

  const data: EvaluationDoc = {
    phase,
    driverId: driverSlug(r.driver),
    driverName: r.driver,
    fileName,
    lesson: r.lesson,
    unit: r.unit,
    exercise: r.exercise,
    vehicle: r.vehicle,
    instructor: instructor.name,
    instructorEmail: instructor.email,
    date: r.date,
    durationSec: r.durationSec,
    errorCount: r.errorCount,
    score: r.score,
    marks: r.marks,
    createdAt: Date.now(),
  };

  if (groupId) {
    data.groupId = groupId;
  }

  if (r.telemetry && Object.keys(r.telemetry).length > 0) {
    // Limpiar claves con valor undefined para cumplir con las restricciones de Firestore
    const cleanTelemetry: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r.telemetry)) {
      if (v !== undefined) {
        cleanTelemetry[k] = v;
      }
    }
    if (Object.keys(cleanTelemetry).length > 0) {
      data.telemetry = cleanTelemetry as TelemetryMetrics;
    }
  }

  await setDoc(ref, data);
  return "saved";
}

export type PhaseSummary = {
  driverId: string;
  driver: string;
  phase: number;
  exercises: number;
  expected: number;
  errors: number;
  criticalErrors: number;
  avgScore: number;
  verdict: string;
  color: string;
};

export type DriverOverallSummary = {
  driverId: string;
  driver: string;
  phasesEvaluated: number;
  totalExercises: number;
  totalErrors: number;
  criticalErrors: number;
  avgScore: number;
  verdict: string;
  color: string;
};

// Con CRITICAL_LIMIT o más errores críticos el dictamen es NO APTO; con menos solo pesan en la calificación.
export function dictamen(score: number, criticalErrors: number) {
  return criticalErrors >= CRITICAL_LIMIT ? verdictFor(0) : verdictFor(score);
}

// Asegura coherencia entre la calificación y el dictamen: un NO APTO nunca debe tener calificación verde/aprobatoria
export function adjustScoreForCritical(score: number, criticalErrors: number): number {
  if (criticalErrors >= CRITICAL_LIMIT) {
    return Math.min(score, 59.0);
  }
  return score;
}

// Calificación calculada desde las marcas y telemetría, o respetando la congelada si el grupo está cerrado
export type EvaluationView = EvaluationDoc & {
  criticalCount: number;
  errorScore: number;
  telemetryScore?: number;
};

export function withCurrentScore(d: EvaluationDoc): EvaluationView {
  const exerciseName = d.unit || d.exercise;
  
  // Si la evaluación ya fue congelada, sus métricas son inalterables
  if (d.frozen && typeof d.frozenScore === "number") {
    return {
      ...d,
      exercise: exerciseName,
      errorCount: d.frozenErrorCount ?? d.errorCount,
      criticalCount: d.frozenCriticalCount ?? 0,
      errorScore: d.frozenErrorScore ?? d.score,
      telemetryScore: d.frozenTelemetryScore,
      score: d.frozenScore,
      marks: d.frozenMarks ?? d.marks,
    };
  }

  // Si la telemetría no traía hasSlipperyRoad (ej. guardada antes), detectarlo dinámicamente de d.marks
  let telemetry = d.telemetry;
  if (telemetry) {
    let hasSlipperyRoad = telemetry.hasSlipperyRoad ?? false;
    let slipperyCondition = telemetry.slipperyCondition;
    if (!hasSlipperyRoad && d.marks) {
      for (const m of d.marks) {
        const lower = (m.description || "").toLowerCase();
        if (
          lower.includes("lluvia") ||
          lower.includes("nieve") ||
          lower.includes("hielo") ||
          lower.includes("mojad") ||
          lower.includes("deslizante")
        ) {
          hasSlipperyRoad = true;
          if (!slipperyCondition) {
            slipperyCondition = lower.includes("nieve") ? "Nieve" : lower.includes("hielo") ? "Hielo" : "Lluvia / Pavimento mojado";
          }
          break;
        }
      }
    }
    telemetry = { ...telemetry, hasSlipperyRoad, slipperyCondition };
  }

  const ev = evaluateMarks(d.marks, d.durationSec, telemetry, exerciseName, d.groupId);
  return {
    ...d,
    telemetry,
    exercise: exerciseName,
    errorCount: ev.errorCount,
    criticalCount: ev.criticalCount,
    errorScore: ev.errorScore,
    telemetryScore: ev.telemetryScore,
    score: ev.score,
  };
}

function summarize(docs: EvaluationView[], fallbackGroupId?: string | null): PhaseSummary[] {
  const groups = new Map<string, EvaluationView[]>();
  for (const e of docs) {
    const key = `${e.driverId}|${e.phase}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  return [...groups.values()]
    .map((g) => {
      // Con catálogo de ejercicios del grupo correspondiente, cada ejercicio esperado aporta su última evaluación y los faltantes valen 0.
      const grpId = fallbackGroupId || g[0]?.groupId;
      const expectedList = getExercises(grpId)[String(g[0].phase)] ?? [];
      let counted = g;
      let expected = g.length;
      let total = g.reduce((a, e) => a + e.score, 0);
      if (expectedList.length) {
        const latest = [...g].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
        counted = expectedList.flatMap((name) => {
          const m = latest.filter((e) => exerciseKey(e.exercise) === exerciseKey(name)).pop();
          return m ? [m] : [];
        });
        expected = expectedList.length;
        total = counted.reduce((a, e) => a + e.score, 0);
      }
      const rawAvg = Math.round((total / expected) * 10) / 10;
      const criticalErrors = counted.reduce((a, e) => a + e.criticalCount, 0);
      const avgScore = adjustScoreForCritical(rawAvg, criticalErrors);
      const v = dictamen(avgScore, criticalErrors);
      return {
        driverId: g[0].driverId,
        driver: g[0].driverName,
        phase: g[0].phase,
        exercises: counted.length,
        expected,
        errors: counted.reduce((a, e) => a + e.errorCount, 0),
        criticalErrors,
        avgScore,
        verdict: v.label,
        color: v.color,
      };
    })
    .sort((a, b) => a.driver.localeCompare(b.driver) || a.phase - b.phase);
}

export type DateFilter = {
  startDate?: string; // YYYY-MM-DD
  endDate?: string;   // YYYY-MM-DD
  groupId?: string | null;
};

function matchesDateRange(dateStr: string, filter?: DateFilter): boolean {
  if (!filter || (!filter.startDate && !filter.endDate)) return true;
  const itemDate = dateStr.slice(0, 10);
  if (filter.startDate && itemDate < filter.startDate) return false;
  if (filter.endDate && itemDate > filter.endDate) return false;
  return true;
}

async function fetchEvaluations(field?: "phase" | "driverId", value?: number | string, filter?: DateFilter) {
  await Promise.all([loadCatalog(), loadExercises(), listGroups()]);
  const q = field !== undefined && value !== undefined
    ? query(evaluations(), where(field, "==", value))
    : query(evaluations());
  const docs = (await getDocs(q)).docs.map((d) => withCurrentScore(d.data() as EvaluationDoc));
  
  return docs.filter((d) => {
    if (!matchesDateRange(d.date, filter)) return false;
    // Si se especifica un filtro de grupo:
    if (filter?.groupId) {
      if (d.groupId !== filter.groupId) return false;
    }
    return true;
  });
}

export async function phaseSummaries(phase: number, dateFilter?: DateFilter) {
  return summarize(await fetchEvaluations("phase", phase, dateFilter), dateFilter?.groupId);
}

// Devuelve los IDs de fases que tienen al menos una evaluación cargada en la BD (respetando filtros)
export async function getPhasesWithEvaluations(dateFilter?: DateFilter): Promise<number[]> {
  const allDocs = await fetchEvaluations(undefined, undefined, dateFilter);
  const phases = new Set<number>();
  for (const doc of allDocs) {
    if (typeof doc.phase === "number") phases.add(doc.phase);
  }
  return [...phases].sort((a, b) => a - b);
}

// Resumen del Promedio General agrupando todos los conductores en todas las fases con filtros
export async function overallSummaries(dateFilter?: DateFilter): Promise<DriverOverallSummary[]> {
  const allDocs = await fetchEvaluations(undefined, undefined, dateFilter);
  const driverMap = new Map<string, EvaluationView[]>();
  for (const doc of allDocs) {
    const list = driverMap.get(doc.driverId) || [];
    list.push(doc);
    driverMap.set(doc.driverId, list);
  }

  const results: DriverOverallSummary[] = [];

  for (const [driverId, docs] of driverMap.entries()) {
    const pSummaries = summarize(docs, dateFilter?.groupId);
    if (!pSummaries.length) continue;

    const totalScore = pSummaries.reduce((acc, p) => acc + p.avgScore, 0);
    const rawAvg = Math.round((totalScore / pSummaries.length) * 10) / 10;
    const criticalErrors = pSummaries.reduce((acc, p) => acc + p.criticalErrors, 0);
    const avgScore = adjustScoreForCritical(rawAvg, criticalErrors);
    const totalErrors = pSummaries.reduce((acc, p) => acc + p.errors, 0);
    const totalExercises = docs.length;
    const v = dictamen(avgScore, criticalErrors);

    results.push({
      driverId,
      driver: docs[0].driverName,
      phasesEvaluated: pSummaries.length,
      totalExercises,
      totalErrors,
      criticalErrors,
      avgScore,
      verdict: v.label,
      color: v.color,
    });
  }

  return results.sort((a, b) => a.driver.localeCompare(b.driver));
}

export async function driverData(driverId: string, filter?: DateFilter) {
  const evals = (await fetchEvaluations("driverId", driverId, filter)).sort(
    (a, b) => a.phase - b.phase || a.date.localeCompare(b.date) || a.createdAt - b.createdAt,
  );
  if (!evals.length) return null;

  // Agrupar incidencias considerando el entorno del ejercicio donde ocurrieron y las reglas del grupo
  const incidentMap = new Map<string, { description: string; environment: string; groupId?: string; count: number }>();

  for (const e of evals) {
    const env = resolveExerciseEnvironment(e.exercise || e.unit, e.groupId);
    for (const m of e.marks) {
      if (m.type !== "ERROR") continue;
      const key = `${m.description}|${env}`;
      const existing = incidentMap.get(key);
      if (existing) {
        existing.count++;
      } else {
        incidentMap.set(key, { description: m.description, environment: env, groupId: e.groupId, count: 1 });
      }
    }
  }

  const breakdown = [...incidentMap.values()]
    .map((item) => {
      const cls = classify(item.description, item.environment, filter?.groupId || item.groupId);
      const isOffRoad = item.description.toLowerCase().includes("salirse de la via");
      // Si es salida de vía, aclarar en el texto del desglose el contexto de peligro
      const displayDescription = isOffRoad
        ? item.environment === "MONTANA"
          ? `${item.description} (en montaña / riesgo de precipicio)`
          : `${item.description} (en carretera / ciudad)`
        : item.description;

      return {
        description: displayDescription,
        rawDescription: item.description,
        count: item.count,
        environment: item.environment,
        ...cls,
      };
    })
    .sort((a, b) => b.weight * b.count - a.weight * a.count || b.count - a.count)
    .slice(0, 20);

  const phases = summarize(evals, filter?.groupId);
  const rawOverall = Math.round((phases.reduce((a, p) => a + p.avgScore, 0) / phases.length) * 10) / 10;
  const criticalErrors = phases.reduce((a, p) => a + p.criticalErrors, 0);
  const overall = adjustScoreForCritical(rawOverall, criticalErrors);
  const v = dictamen(overall, criticalErrors);

  return { name: evals[0].driverName, evals, phases, breakdown, overall, criticalErrors, verdict: v.label, color: v.color };
}

// Elimina todas las evaluaciones en lotes de hasta 400 documentos por batch.
export async function deleteAllEvaluations(): Promise<number> {
  const snap = await getDocs(evaluations());
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

  return totalDeleted;
}
