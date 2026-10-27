import { PENALTY_PER_ERROR_RATE } from "./config";
import { classify, type Severity } from "./catalog";

export type Mark = { time: string; type: string; description: string };

export type ParsedReport = {
  driver: string;
  date: string;
  durationSec: number;
  lesson: string;
  unit: string;
  exercise: string;
  vehicle: string;
  marks: Mark[];
  errorCount: number;
  criticalCount: number;
  score: number;
  uncataloged: string[];
};

export function decodeCsv(buf: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/^\uFEFF/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(buf);
  }
}

function toSeconds(t: string): number {
  const p = t.split(":").map(Number);
  if (p.some(Number.isNaN)) return 0;
  return p.reduce((acc, n) => acc * 60 + n, 0);
}

export type Evaluation = {
  errorCount: number;
  criticalCount: number;
  penaltyPoints: number;
  score: number;
  bySeverity: Record<Severity, number>;
  uncataloged: string[];
};

// Calificación = 100 - (puntos de penalización por minuto * PENALTY_PER_ERROR_RATE), mínimo 0.
// Los puntos dependen de la gravedad de cada error según el catálogo.
export function evaluateMarks(marks: Mark[], durationSec: number): Evaluation {
  const bySeverity: Record<Severity, number> = { CRITICO: 0, GRAVE: 0, MODERADO: 0, LEVE: 0 };
  const uncataloged = new Set<string>();
  let points = 0;
  let errorCount = 0;
  for (const m of marks) {
    if (m.type !== "ERROR") continue;
    const c = classify(m.description);
    errorCount++;
    points += c.weight;
    bySeverity[c.severity]++;
    if (!c.cataloged) uncataloged.add(m.description);
  }
  const minutes = Math.max(durationSec / 60, 1);
  const raw = 100 - (points / minutes) * PENALTY_PER_ERROR_RATE;
  return {
    errorCount,
    criticalCount: bySeverity.CRITICO,
    penaltyPoints: points,
    score: Math.round(Math.max(0, Math.min(100, raw)) * 10) / 10,
    bySeverity,
    uncataloged: [...uncataloged],
  };
}

export function parseReport(text: string): ParsedReport {
  const lines = text.split(/\r?\n/);
  const cells = (i: number) => (lines[i] ?? "").split(";").map((c) => c.trim());
  const find = (re: RegExp) => lines.findIndex((l) => re.test(l));

  const lessonIdx = find(/^Lecci.n;Unidad;Ejercicio/i);
  const headerIdx = find(/^FECHA;CONDUCTOR/i);
  if (lessonIdx < 0 || headerIdx < 0) throw new Error("Formato de CSV no reconocido");

  const [lesson = "", unit = "", exercise = ""] = cells(lessonIdx + 1);
  // El simulador entrega las columnas invertidas: la columna INSTRUCTOR trae al conductor.
  // El instructor real es quien carga el archivo (sesión de Google), no lo que diga el CSV.
  const [date = "", , driver = "", duration = ""] = cells(headerIdx + 1);
  if (!driver) throw new Error("El CSV no indica el conductor");

  const vehLine = lines.find((l) => /^Veh.culo:/i.test(l));
  const vehicle = vehLine ? vehLine.split(";")[1]?.trim() ?? "" : "";

  const marks: Mark[] = [];
  const markRe = /^(\d+:\d{2}:\d{2});([A-Z ]+);(.*)$/;
  for (const line of lines) {
    const m = markRe.exec(line.trim());
    if (m) marks.push({ time: m[1], type: m[2].trim(), description: m[3].trim() });
  }

  const durationSec = toSeconds(duration);
  const ev = evaluateMarks(marks, durationSec);
  return {
    driver, date, durationSec, lesson, unit, exercise, vehicle,
    marks, errorCount: ev.errorCount, criticalCount: ev.criticalCount, score: ev.score, uncataloged: ev.uncataloged,
  };
}
