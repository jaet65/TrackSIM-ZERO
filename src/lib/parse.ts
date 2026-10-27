import { PENALTY_PER_ERROR_RATE } from "./config";
import { classify, type Severity } from "./catalog";
import { resolveExerciseEnvironment, type ExerciseEnvironment } from "./exercises";

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
  hasSlipperyRoad?: boolean;        // Lluvia, nieve o hielo detectados
  slipperyCondition?: string;       // Descripción del clima adverso
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
 * Calcula el puntaje de eficiencia y telemetría (0 a 100) adaptado al entorno del ejercicio.
 * Entornos soportados:
 * - MONTANA (Sierra / Pendientes):
 *   * Meta de RPM verde más realista (45-50% = 100 pts de sub-escala).
 *   * Zona amarilla tolerada si se usa para retención en bajada.
 *   * Mayor peso a uso de Retarder / Freno de motor (35%) y tolerancia en inercia.
 * - CIUDAD (Urbano / Maniobras):
 *   * Meta de RPM verde (55-60%).
 *   * Mayor tolerancia a frenadas progresivas necesarias por tráfico, pero castigo a acelerador >60%.
 * - CARRETERA (Autopista / Plano):
 *   * Meta estándar de RPM verde (75%).
 *   * Mayor peso al aprovechamiento de inercia y velocidad constante.
 */
export function calculateTelemetryScore(
  telemetry?: TelemetryMetrics,
  exerciseName?: string,
): number | undefined {
  if (!telemetry || telemetry.pctGreenZone === undefined) return undefined;

  const env = resolveExerciseEnvironment(exerciseName);

  // --- 1. Sub-puntaje RPM ---
  // Meta de zona verde según entorno
  const greenTarget = env === "MONTANA" ? 48 : env === "CIUDAD" ? 58 : 75;
  let rpmScore = Math.min(100, (telemetry.pctGreenZone / greenTarget) * 100);

  // Penalización severa por zona roja (nunca permitida en ningún entorno)
  if (telemetry.pctRedZone && telemetry.pctRedZone > 0) {
    rpmScore -= telemetry.pctRedZone * 25;
  }

  // Zona amarilla: en montaña es tolerada para retención en bajada siempre que no haya aceleración a fondo
  if (telemetry.pctYellowZone && telemetry.pctYellowZone > 0) {
    if (env === "MONTANA") {
      // En montaña solo penaliza levemente si es excesiva (> 20%)
      if (telemetry.pctYellowZone > 20) {
        rpmScore -= (telemetry.pctYellowZone - 20) * 3;
      }
    } else {
      rpmScore -= telemetry.pctYellowZone * 4;
    }
  }
  rpmScore = Math.max(0, Math.min(100, rpmScore));

  // --- 2. Sub-puntaje Frenado & Retarder ---
  // Escala diferenciada por entorno:
  // - CIUDAD / ENRAMPE: 3 de tolerancia para semáforos y maniobras a baja velocidad (-5 pts desde la 4ª).
  // - MONTANA / SIERRA: 1 de tolerancia; se debe priorizar retarder (-8 pts desde la 2ª).
  // - CARRETERA / AUTOPISTA: Tolerancia cero (-10 pts por cada frenada brusca a velocidad).
  const harshBrakes = telemetry.brakeAbove60Uses || 0;
  let brakePenalty = 0;
  if (env === "CIUDAD") {
    if (harshBrakes > 3) brakePenalty = (harshBrakes - 3) * 5;
  } else if (env === "MONTANA") {
    if (harshBrakes > 1) brakePenalty = (harshBrakes - 1) * 8;
  } else {
    brakePenalty = harshBrakes * 10;
  }
  let brakeScore = Math.max(0, 100 - brakePenalty);

  // REGLA DE SEGURIDAD CLIMÁTICA: Lluvia, nieve o hielo
  if (telemetry.hasSlipperyRoad) {
    // Con piso deslizante NO se debe usar el freno auxiliar para evitar el efecto tijera (jackknife).
    // Si el operador NO usó el retarder (0s o < 3s), se premia la retención segura.
    if (!telemetry.auxBrakeTimeSec || telemetry.auxBrakeTimeSec <= 3) {
      brakeScore = Math.min(100, brakeScore + 5);
    } else {
      // Si usó el retarder sobre mojado o nieve, penaliza severamente por riesgo de pérdida de tracción
      brakeScore = Math.max(0, brakeScore - Math.min(40, telemetry.auxBrakeTimeSec * 3));
    }
  } else {
    // Pavimento seco:
    // En montaña el retarder es crítico: bonifica su uso o penaliza si no se usó en bajada prolongada
    if (env === "MONTANA") {
      if (telemetry.auxBrakeTimeSec && telemetry.auxBrakeTimeSec > 15) {
        brakeScore = Math.min(100, brakeScore + 10);
      } else if (!telemetry.auxBrakeTimeSec || telemetry.auxBrakeTimeSec === 0) {
        brakeScore = Math.max(20, brakeScore - 15); // Alerta por no usar freno de motor en sierra seca
      }
    } else if (telemetry.auxBrakeTimeSec && telemetry.auxBrakeTimeSec > 5) {
      brakeScore = Math.min(100, brakeScore + 5);
    }
  }
  brakeScore = Math.max(0, Math.min(100, brakeScore));

  // --- 3. Sub-puntaje Inercia / Rodadura Libre ---
  let inertiaScore = 80;
  if (telemetry.distanceMeters && telemetry.distanceMeters > 100 && telemetry.coastDistanceMeters !== undefined) {
    const inertiaRatio = telemetry.coastDistanceMeters / telemetry.distanceMeters;
    const optimalInertia = env === "MONTANA" ? 0.25 : env === "CIUDAD" ? 0.20 : 0.35;
    inertiaScore = Math.min(100, Math.max(25, Math.round((inertiaRatio / optimalInertia) * 100)));
  }

  // --- 4. Sub-puntaje Aceleración Suave (Técnica de Ahorro y Pedal) ---
  // Evaluado exclusivamente por el uso del acelerador (evitar pedal a fondo >60%).
  let accelScore = 100;
  if (telemetry.throttleAbove60Time) {
    const secAbove60 = toSeconds(telemetry.throttleAbove60Time);
    // Cada segundo de acelerador por encima del 60% resta 5 puntos de técnica
    if (secAbove60 > 0) {
      accelScore = Math.max(20, 100 - (secAbove60 * 5));
    }
  }
  accelScore = Math.max(0, Math.min(100, accelScore));

  // Ponderaciones adaptadas según el entorno:
  let totalScore = 0;
  if (env === "MONTANA") {
    // 30% RPM + 35% Frenado/Retarder + 20% Inercia + 15% Aceleración Progresiva
    totalScore = (rpmScore * 0.30) + (brakeScore * 0.35) + (inertiaScore * 0.20) + (accelScore * 0.15);
  } else if (env === "CIUDAD") {
    // 35% RPM + 30% Frenado + 15% Inercia + 20% Aceleración Progresiva
    totalScore = (rpmScore * 0.35) + (brakeScore * 0.30) + (inertiaScore * 0.15) + (accelScore * 0.20);
  } else {
    // CARRETERA: 40% RPM + 25% Frenado + 20% Inercia + 15% Aceleración Progresiva
    totalScore = (rpmScore * 0.40) + (brakeScore * 0.25) + (inertiaScore * 0.20) + (accelScore * 0.15);
  }

  return Math.round(Math.max(0, Math.min(100, totalScore)) * 10) / 10;
}

// Calificación compuesta: 70% Errores de maniobra + 30% Telemetría y Eco-Driving.
// Si no hay telemetría disponible en el reporte, se toma el 100% de la nota de errores.
export function evaluateMarks(
  marks: Mark[],
  durationSec: number,
  telemetry?: TelemetryMetrics,
  exerciseName?: string,
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

  const telemetryScore = calculateTelemetryScore(telemetry, exerciseName);

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
  let hasSlipperyRoad = false;
  let slipperyCondition = "";

  for (const line of lines) {
    const m = markRe.exec(line.trim());
    if (m) {
      const type = m[2].trim();
      const desc = m[3].trim();
      marks.push({ time: m[1], type, description: desc });

      const lower = desc.toLowerCase();
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
      }
    }
  }

  // Extracción de la sección «Indicadores genéricos»
  const telemetry: TelemetryMetrics = {
    hasSlipperyRoad,
    slipperyCondition: hasSlipperyRoad ? slipperyCondition : undefined,
  };
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
  const ev = evaluateMarks(marks, durationSec, telemetry, exercise);

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
