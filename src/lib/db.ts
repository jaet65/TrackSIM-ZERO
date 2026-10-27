import { collection, doc, getDoc, getDocs, query, setDoc, where } from "firebase/firestore";
import { firestore } from "./firebase";
import type { Mark, ParsedReport } from "./parse";
import { evaluateMarks } from "./parse";
import { classify } from "./catalog";
import { verdictFor } from "./config";

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
  await setDoc(ref, data);
  return "saved";
}

export type PhaseSummary = {
  driverId: string;
  driver: string;
  phase: number;
  exercises: number;
  errors: number;
  criticalErrors: number;
  avgScore: number;
  verdict: string;
  color: string;
};

// Un error crítico es eliminatorio: el dictamen es NO APTO sin importar el promedio.
export function dictamen(score: number, criticalErrors: number) {
  return criticalErrors > 0 ? verdictFor(0) : verdictFor(score);
}

// Calificación recalculada desde las marcas para que un cambio en el catálogo aplique a evaluaciones ya cargadas.
export type EvaluationView = EvaluationDoc & { criticalCount: number };

function withCurrentScore(d: EvaluationDoc): EvaluationView {
  const ev = evaluateMarks(d.marks, d.durationSec);
  return { ...d, errorCount: ev.errorCount, criticalCount: ev.criticalCount, score: ev.score };
}

function summarize(docs: EvaluationView[]): PhaseSummary[] {
  const groups = new Map<string, EvaluationView[]>();
  for (const e of docs) {
    const key = `${e.driverId}|${e.phase}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  return [...groups.values()]
    .map((g) => {
      const avgScore = Math.round((g.reduce((a, e) => a + e.score, 0) / g.length) * 10) / 10;
      const criticalErrors = g.reduce((a, e) => a + e.criticalCount, 0);
      const v = dictamen(avgScore, criticalErrors);
      return {
        driverId: g[0].driverId,
        driver: g[0].driverName,
        phase: g[0].phase,
        exercises: g.length,
        errors: g.reduce((a, e) => a + e.errorCount, 0),
        criticalErrors,
        avgScore,
        verdict: v.label,
        color: v.color,
      };
    })
    .sort((a, b) => a.driver.localeCompare(b.driver) || a.phase - b.phase);
}

async function fetchEvaluations(field: "phase" | "driverId", value: number | string) {
  const q = query(evaluations(), where(field, "==", value));
  return (await getDocs(q)).docs.map((d) => withCurrentScore(d.data() as EvaluationDoc));
}

export async function phaseSummaries(phase: number) {
  return summarize(await fetchEvaluations("phase", phase));
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
