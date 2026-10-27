import { collection, doc, getDoc, getDocs, query, setDoc, where, writeBatch } from "firebase/firestore";
import { firestore } from "./firebase";
import type { Mark, ParsedReport, TelemetryMetrics } from "./parse";
import { evaluateMarks } from "./parse";
import { classify } from "./catalog";
import { loadCatalog } from "./catalogStore";
import { CRITICAL_LIMIT, verdictFor } from "./config";
import { exerciseKey, getExercises, loadExercises } from "./exercises";

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
};

const evaluations = () => collection(firestore, "evaluations");

export function driverSlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// ID determinista (fase + archivo) para que re-cargar el mismo CSV no duplique resultados.
function evaluationId(phase: number, fileName: string) {
  return `f${phase}_${fileName.replace(/[^\w.-]+/g, "_")}`;
}

export type Instructor = { name: string; email: string };

export async function saveEvaluation(
  phase: number,
  fileName: string,
  r: ParsedReport,
  instructor: Instructor,
): Promise<"saved" | "duplicate"> {
  const ref = doc(evaluations(), evaluationId(phase, fileName));
  if ((await getDoc(ref)).exists()) return "duplicate";

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

  if (r.telemetry && Object.keys(r.telemetry).length > 0) {
    data.telemetry = r.telemetry;
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

// Calificación recalculada desde las marcas y telemetría para que cambios en el catálogo o ponderación apliquen inmediatamente.
export type EvaluationView = EvaluationDoc & {
  criticalCount: number;
  errorScore: number;
  telemetryScore?: number;
};

function withCurrentScore(d: EvaluationDoc): EvaluationView {
  const exerciseName = d.unit || d.exercise;
  
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

  const ev = evaluateMarks(d.marks, d.durationSec, telemetry, exerciseName);
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

function summarize(docs: EvaluationView[]): PhaseSummary[] {
  const groups = new Map<string, EvaluationView[]>();
  for (const e of docs) {
    const key = `${e.driverId}|${e.phase}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  return [...groups.values()]
    .map((g) => {
      // Con catálogo de ejercicios, cada ejercicio esperado aporta su última evaluación y los faltantes valen 0.
      const expectedList = getExercises()[String(g[0].phase)] ?? [];
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
      const avgScore = Math.round((total / expected) * 10) / 10;
      const criticalErrors = counted.reduce((a, e) => a + e.criticalCount, 0);
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
};

function matchesDateRange(dateStr: string, filter?: DateFilter): boolean {
  if (!filter || (!filter.startDate && !filter.endDate)) return true;
  const itemDate = dateStr.slice(0, 10);
  if (filter.startDate && itemDate < filter.startDate) return false;
  if (filter.endDate && itemDate > filter.endDate) return false;
  return true;
}

async function fetchEvaluations(field?: "phase" | "driverId", value?: number | string, dateFilter?: DateFilter) {
  await Promise.all([loadCatalog(), loadExercises()]);
  const q = field !== undefined && value !== undefined
    ? query(evaluations(), where(field, "==", value))
    : query(evaluations());
  const docs = (await getDocs(q)).docs.map((d) => withCurrentScore(d.data() as EvaluationDoc));
  return docs.filter((d) => matchesDateRange(d.date, dateFilter));
}

export async function phaseSummaries(phase: number, dateFilter?: DateFilter) {
  return summarize(await fetchEvaluations("phase", phase, dateFilter));
}

// Devuelve los IDs de fases que tienen al menos una evaluación cargada en la BD
export async function getPhasesWithEvaluations(dateFilter?: DateFilter): Promise<number[]> {
  const allDocs = await fetchEvaluations(undefined, undefined, dateFilter);
  const phases = new Set<number>();
  for (const doc of allDocs) {
    if (typeof doc.phase === "number") phases.add(doc.phase);
  }
  return [...phases].sort((a, b) => a - b);
}

// Resumen del Promedio General agrupando todos los conductores en todas las fases con filtro de fecha opcional
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
    const pSummaries = summarize(docs);
    if (!pSummaries.length) continue;

    const totalScore = pSummaries.reduce((acc, p) => acc + p.avgScore, 0);
    const avgScore = Math.round((totalScore / pSummaries.length) * 10) / 10;
    const criticalErrors = pSummaries.reduce((acc, p) => acc + p.criticalErrors, 0);
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

export async function driverData(driverId: string) {
  const evals = (await fetchEvaluations("driverId", driverId)).sort(
    (a, b) => a.phase - b.phase || a.date.localeCompare(b.date) || a.createdAt - b.createdAt,
  );
  if (!evals.length) return null;

  const counts = new Map<string, number>();
  for (const e of evals)
    for (const m of e.marks) if (m.type === "ERROR") counts.set(m.description, (counts.get(m.description) ?? 0) + 1);
  const breakdown = [...counts.entries()]
    .map(([description, count]) => ({ description, count, ...classify(description) }))
    .sort((a, b) => b.weight * b.count - a.weight * a.count || b.count - a.count)
    .slice(0, 20);

  const phases = summarize(evals);
  const overall = Math.round((phases.reduce((a, p) => a + p.avgScore, 0) / phases.length) * 10) / 10;
  const criticalErrors = phases.reduce((a, p) => a + p.criticalErrors, 0);
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
