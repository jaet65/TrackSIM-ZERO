import { PENALTY_PER_ERROR_RATE } from "./config";
import { classify, type Severity } from "./catalog";

export type Mark = { time: string; type: string; description: string };

export type TelemetryMetrics = {
  distanceMeters?: number;
  averageConsumption?: number;      // l/100km
  throttleNormalTime?: string;
  throttleAbove60Time?: string;
  throttleUses?: number;
  brakeTime?: string;
  brakeTotalUses?: number;
  brakeAbove60Uses?: number;
  clutchUses?: number;
  gearChanges?: number;
  averageSpeed?: number;            // km/h
  maxSpeed?: number;                // km/h
  maxRpm?: number;                  // rpm
  pctGreenZone?: number;            // %
  pctYellowZone?: number;           // %
  pctRedZone?: number;              // %
  coastDistanceMeters?: number;     // m sin freno ni acelerador
  auxBrakeTimeSec?: number;         // s (retarder / freno motor)
};

export type ParsedReport = {
  driver: string;
  date: string;
  durationSec: number;
  lesson: string;
  unit: string;
  exercise: string;
  vehicle: string;
  marks: Mark[];
  telemetry?: TelemetryMetrics;
  errorCount: number;
  criticalCount: number;
  errorScore: number;
  telemetryScore?: number;
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
  errorScore: number;
  telemetryScore?: number;
  score: number;
  bySeverity: Record<Severity, number>;
  uncataloged: string[];
};

/**
 * Calcula el puntaje de eficiencia y telemetría (0 a 100).
 * Ponderación multidimensional:
 * 1. Rango de RPM (40%):
 *    - Base del % en zona verde (0-100%).
 *    - Penalización severa por zona roja (-20 pts por cada 1%) y zona amarilla (-5 pts por cada 1%).
 * 2. Frenado eficiente y Retarder (25%):
 *    - Base de 100 pts.
 *    - Penalización por frenadas bruscas >60% (-3 pts por evento tras tolerancia de 2).
 *    - Bonificación o confirmación de uso de freno auxiliar / retarder cuando se requirió frenado prolongado.
 * 3. Aprovechamiento de Inercia / Rodadura Libre (20%):
 *    - Ratio entre distancia recorrida sin acelerar ni frenar y distancia total.
 *    - Se normaliza a escala 0-100 considerando óptimo un rango entre 30% y 50% de inercia.
 * 4. Consumo y Progresividad del acelerador (15%):
 *    - Penalización si el tiempo de acelerador >60% es alto o si el consumo excede el estándar operativo.
 */
export function calculateTelemetryScore(telemetry?: TelemetryMetrics): number | undefined {
  if (!telemetry || telemetry.pctGreenZone === undefined) return undefined;

  // --- 1. Sub-puntaje RPM (40%) ---
  let rpmScore = telemetry.pctGreenZone;
  if (telemetry.pctRedZone && telemetry.pctRedZone > 0) {
    rpmScore -= telemetry.pctRedZone * 20;
  }
  if (telemetry.pctYellowZone && telemetry.pctYellowZone > 0) {
    rpmScore -= telemetry.pctYellowZone * 5;
  }
  rpmScore = Math.max(0, Math.min(100, rpmScore));

  // --- 2. Sub-puntaje Frenado & Retarder (25%) ---
  let brakeScore = 100;
  // Penalización por frenados bruscos excesivos (>60%)
  if (telemetry.brakeAbove60Uses && telemetry.brakeAbove60Uses > 2) {
    brakeScore -= (telemetry.brakeAbove60Uses - 2) * 4;
  }
  // Valorar uso de freno auxiliar: si hubo uso de freno auxiliar (>10s), premia la anticipación
  if (telemetry.auxBrakeTimeSec && telemetry.auxBrakeTimeSec > 10) {
    brakeScore = Math.min(100, brakeScore + 5);
  }
  brakeScore = Math.max(0, Math.min(100, brakeScore));

  // --- 3. Sub-puntaje Inercia / Rodadura Libre (20%) ---
  let inertiaScore = 80; // Puntuación base en caso de que no haya distancia suficiente
  if (telemetry.distanceMeters && telemetry.distanceMeters > 100 && telemetry.coastDistanceMeters !== undefined) {
    const inertiaRatio = telemetry.coastDistanceMeters / telemetry.distanceMeters;
    // Un ratio de 35% o más de inercia es excelente (100 pts). Por debajo de 10% es pobre.
    inertiaScore = Math.min(100, Math.max(20, Math.round((inertiaRatio / 0.35) * 100)));
  }

  // --- 4. Sub-puntaje Consumo y Progresividad (15%) ---
  let fuelScore = 90;
  // Si el consumo medio reportado supera 35 l/100km penaliza progresivamente
  if (telemetry.averageConsumption && telemetry.averageConsumption > 35) {
    fuelScore -= Math.min(60, (telemetry.averageConsumption - 35) * 2);
  }
  // Penalizar tiempo excesivo en acelerador a fondo (>60%)
  if (telemetry.throttleAbove60Time && telemetry.throttleAbove60Time !== "00:00") {
    fuelScore -= 10;
  }
  fuelScore = Math.max(0, Math.min(100, fuelScore));

  // Ponderación total compuesta: 40% RPM + 25% Freno + 20% Inercia + 15% Consumo
  const totalScore = (rpmScore * 0.40) + (brakeScore * 0.25) + (inertiaScore * 0.20) + (fuelScore * 0.15);

  return Math.round(Math.max(0, Math.min(100, totalScore)) * 10) / 10;
}

// Calificación compuesta: 70% Errores de maniobra + 30% Telemetría y Eco-Driving.
// Si no hay telemetría disponible en el reporte, se toma el 100% de la nota de errores.
export function evaluateMarks(
  marks: Mark[],
  durationSec: number,
  telemetry?: TelemetryMetrics,
): Evaluation {
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
  const rawError = 100 - (points / minutes) * PENALTY_PER_ERROR_RATE;
  const errorScore = Math.round(Math.max(0, Math.min(100, rawError)) * 10) / 10;

  const telemetryScore = calculateTelemetryScore(telemetry);

  let finalScore = errorScore;
  if (telemetryScore !== undefined) {
    // 70% Errores + 30% Telemetría (Eco-Driving)
    finalScore = Math.round((errorScore * 0.7 + telemetryScore * 0.3) * 10) / 10;
  }

  return {
    errorCount,
    criticalCount: bySeverity.CRITICO,
    penaltyPoints: points,
    errorScore,
    telemetryScore,
    score: finalScore,
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

  const [lesson = "", unit = ""] = cells(lessonIdx + 1);
  const exercise = unit;
  const [date = "", , driver = "", duration = ""] = cells(headerIdx + 1);
  if (!driver) throw new Error("El CSV no indica el conductor");

  const vehLine = lines.find((l) => /^Veh.culo:/i.test(l));
  const vehicle = vehLine ? vehLine.split(";")[1]?.trim() ?? "" : "";

  // Extracción de marcas
  const marks: Mark[] = [];
  const markRe = /^(\d+:\d{2}:\d{2});([A-Z ]+);(.*)$/;
  for (const line of lines) {
    const m = markRe.exec(line.trim());
    if (m) marks.push({ time: m[1], type: m[2].trim(), description: m[3].trim() });
  }

  // Extracción de la sección «Indicadores genéricos»
  const telemetry: TelemetryMetrics = {};
  const indIdx = find(/^Indicadores gen.ricos/i);
  if (indIdx >= 0) {
    for (let i = indIdx + 1; i < lines.length; i++) {
      const line = lines[i]?.trim();
      if (!line) continue;
      const parts = line.split(";").map((p) => p.trim());
      const label = parts[0]?.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() ?? "";
      const val = parts[1] ?? "";

      if (label.includes("distancia recorrida sin freno")) telemetry.coastDistanceMeters = parseFloat(val) || 0;
      else if (label.startsWith("distancia")) telemetry.distanceMeters = parseFloat(val) || 0;
      else if (label.includes("consumo medio")) telemetry.averageConsumption = parseFloat(val) || 0;
      else if (label.includes("uso normal del acelerador")) telemetry.throttleNormalTime = val;
      else if (label.includes("uso del acelerador por encima")) telemetry.throttleAbove60Time = val;
      else if (label.includes("usos del acelerador")) telemetry.throttleUses = parseInt(val, 10) || 0;
      else if (label.includes("tiempo de uso del freno")) telemetry.brakeTime = val;
      else if (label.includes("usos totales de freno")) telemetry.brakeTotalUses = parseInt(val, 10) || 0;
      else if (label.includes("freno por encima del 60")) telemetry.brakeAbove60Uses = parseInt(val, 10) || 0;
      else if (label.includes("usos del embrague")) telemetry.clutchUses = parseInt(val, 10) || 0;
      else if (label.includes("cambios de marcha")) telemetry.gearChanges = parseInt(val, 10) || 0;
      else if (label.includes("velocidad media")) telemetry.averageSpeed = parseFloat(val) || 0;
      else if (label.includes("velocidad maxima")) telemetry.maxSpeed = parseFloat(val) || 0;
      else if (label.includes("revoluciones maximas")) telemetry.maxRpm = parseInt(val, 10) || 0;
      else if (label.includes("zona verde")) telemetry.pctGreenZone = parseFloat(val) || 0;
      else if (label.includes("zona amarilla")) telemetry.pctYellowZone = parseFloat(val) || 0;
      else if (label.includes("zona roja")) telemetry.pctRedZone = parseFloat(val) || 0;
      else if (label.includes("freno aux")) telemetry.auxBrakeTimeSec = parseFloat(val) || 0;
    }
  }

  const durationSec = toSeconds(duration);
  const ev = evaluateMarks(marks, durationSec, telemetry);

  return {
    driver,
    date,
    durationSec,
    lesson,
    unit,
    exercise,
    vehicle,
    marks,
    telemetry,
    errorCount: ev.errorCount,
    criticalCount: ev.criticalCount,
    errorScore: ev.errorScore,
    telemetryScore: ev.telemetryScore,
    score: ev.score,
    uncataloged: ev.uncataloged,
  };
}
