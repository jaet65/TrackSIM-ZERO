import { PENALTY_PER_ERROR_RATE } from "./config";
import { classify, type Severity } from "./catalog";
import { resolveExerciseEnvironment, type ExerciseEnvironment } from "./exercises";

export type Mark = {
  time: string;
  type: string;
  description: string;
  ignored?: boolean;     // true si se anuló como falso positivo del simulador
  ignoredBy?: string;    // usuario que anuló el error
  ignoredAt?: number;    // fecha de anulación
  manual?: boolean;      // true si fue agregado manualmente por un instructor
  addedBy?: string;      // usuario que agregó el error
  addedAt?: number;      // fecha de adición
};

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
  pctLowRpmZone?: number;           // % (zona de bajas revoluciones por debajo de la zona verde)
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

/**
 * Normaliza las zonas de RPM de la telemetría para corregir conteos anómalos del simulador:
 * - Las 4 zonas (Bajas RPM + Verde + Amarilla + Roja) deben sumar el 100%.
 * - La suma de verde + amarilla + roja nunca debe sobrepasar el 100%. Si el simulador reporta
 *   un acumulado mayor, se normalizan proporcionalmente respetando la relación entre ellas.
 * - Calcula automáticamente el % de zona de bajas revoluciones (calado o sub-régimen).
 */
export function normalizeRpmZones(telemetry: TelemetryMetrics): TelemetryMetrics {
  const green = Math.max(0, telemetry.pctGreenZone ?? 0);
  const yellow = Math.max(0, telemetry.pctYellowZone ?? 0);
  const red = Math.max(0, telemetry.pctRedZone ?? 0);

  const sumReported = green + yellow + red;

  let normGreen = green;
  let normYellow = yellow;
  let normRed = red;

  if (sumReported > 100 && sumReported > 0) {
    // Escalar proporcionalmente al 100% como tope máximo
    const scale = 100 / sumReported;
    normGreen = Math.round(green * scale * 10) / 10;
    normYellow = Math.round(yellow * scale * 10) / 10;
    normRed = Math.round(red * scale * 10) / 10;
  }

  // La zona de bajas revoluciones corresponde al tiempo restante del motor
  const sumUpper = normGreen + normYellow + normRed;
  const lowRpm = Math.max(0, Math.round((100 - sumUpper) * 10) / 10);

  return {
    ...telemetry,
    pctGreenZone: normGreen,
    pctYellowZone: normYellow,
    pctRedZone: normRed,
    pctLowRpmZone: lowRpm,
  };
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
  groupId?: string | null,
): number | undefined {
  if (!telemetry || telemetry.pctGreenZone === undefined) return undefined;

  const env = resolveExerciseEnvironment(exerciseName, groupId);

  // --- 1. Sub-puntaje RPM ---
  // Meta de zona verde según entorno
  const greenTarget = env === "MONTANA" ? 48 : env === "CIUDAD" ? 58 : 75;
  let rpmScore = Math.min(100, (telemetry.pctGreenZone / greenTarget) * 100);

  // 1.1 Penalización severa por zona roja (nunca permitida; sobrerégimen destructivo del motor)
  if (telemetry.pctRedZone && telemetry.pctRedZone > 0) {
    rpmScore -= telemetry.pctRedZone * 25;
  }

  // 1.2 Regla de Zona Amarilla:
  // - En condiciones normales (piso seco): solo está justificada cuando se utiliza para retención con freno motor.
  //   Si hay amarilla SIN freno motor, castiga severamente por forzar el motor acelerando o en marchas cortas.
  // - En condiciones climáticas adversas (LLUVIA / NIEVE / HIELO): NO se debe usar el freno auxiliar por riesgo de tijera.
  //   El operador debe retener el vehículo con la compresión natural del motor (cambio bajo), lo cual eleva las RPM
  //   hacia la zona amarilla de forma segura y controlada. Por ende, en clima resbaladizo se es altamente permisivo
  //   con la zona amarilla y NO se exige freno motor.
  const yellowZone = telemetry.pctYellowZone || 0;
  const auxBrakeSec = telemetry.auxBrakeTimeSec || 0;
  const hasSlippery = Boolean(telemetry.hasSlipperyRoad);

  if (yellowZone > 0) {
    if (hasSlippery) {
      // En lluvia/nieve: permisivo porque la retención por marcha (compresión sin retarder) es la técnica correcta.
      // Solo penaliza si es excesiva (> 25%) y con tasa leve (-1.5 pts)
      if (yellowZone > 25) {
        rpmScore -= (yellowZone - 25) * 1.5;
      }
    } else if (auxBrakeSec <= 1) {
      // Pavimento seco SIN freno motor: castigo directo e íntegro (-5 pts por cada 1% en amarilla)
      rpmScore -= yellowZone * 5;
    } else {
      // Pavimento seco CON freno motor: admitida para disipar energía en bajada
      if (env === "MONTANA") {
        if (yellowZone > 20) {
          rpmScore -= (yellowZone - 20) * 3;
        }
      } else {
        if (yellowZone > 8) {
          rpmScore -= (yellowZone - 8) * 3;
        }
      }
    }
  }
  rpmScore = Math.max(0, Math.min(100, Math.round(rpmScore)));

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

  return Math.round(Math.max(0, Math.min(10, totalScore / 10)) * 10) / 10;
}

// Calificación compuesta (escala 0 a 10): 70% Errores de maniobra + 30% Telemetría y Eco-Driving.
// Si no hay telemetría disponible en el reporte, se toma el 100% de la nota de errores.
export function evaluateMarks(
  marks: Mark[],
  durationSec: number,
  telemetry?: TelemetryMetrics,
  exerciseName?: string,
  groupId?: string | null,
): Evaluation {
  const bySeverity: Record<Severity, number> = { CRITICO: 0, GRAVE: 0, MODERADO: 0, LEVE: 0 };
  const uncataloged = new Set<string>();
  let ratePoints = 0;
  let directPoints = 0;
  let errorCount = 0;

  const env = resolveExerciseEnvironment(exerciseName, groupId);

  for (const m of marks) {
    if (m.type !== "ERROR" || m.ignored) continue;
    const c = classify(m.description, env, groupId);
    errorCount++;
    // Los errores críticos (o con penalización de 100 pts) restan su valor íntegro de forma directa sin diluirse por la duración
    if (c.severity === "CRITICO" || c.weight >= 100) {
      directPoints += c.weight;
    } else {
      ratePoints += c.weight;
    }
    bySeverity[c.severity]++;
    if (!c.cataloged) uncataloged.add(m.description);
  }

  const minutes = Math.max(durationSec / 60, 1);
  const rawError = (100 - directPoints - (ratePoints / minutes) * PENALTY_PER_ERROR_RATE) / 10;
  const errorScore = Math.round(Math.max(0, Math.min(10, rawError)) * 10) / 10;

  const telemetryScore = calculateTelemetryScore(telemetry, exerciseName, groupId);

  let finalScore = errorScore;
  if (telemetryScore !== undefined) {
    // 70% Errores + 30% Telemetría (Eco-Driving)
    finalScore = Math.round((errorScore * 0.7 + telemetryScore * 0.3) * 10) / 10;
  }

  return {
    errorCount,
    criticalCount: bySeverity.CRITICO,
    penaltyPoints: directPoints + ratePoints,
    errorScore,
    telemetryScore,
    score: finalScore,
    bySeverity,
    uncataloged: [...uncataloged],
  };
}

export function parseReport(text: string, groupId?: string | null): ParsedReport {
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
  };
  if (hasSlipperyRoad && slipperyCondition) {
    telemetry.slipperyCondition = slipperyCondition;
  }
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

  // Normalizar las zonas de RPM para evitar que la suma exceda el 100% y calcular zona de bajas RPM
  const normalizedTelemetry = normalizeRpmZones(telemetry);

  const durationSec = toSeconds(duration);
  const ev = evaluateMarks(marks, durationSec, normalizedTelemetry, exercise, groupId);

  return {
    driver,
    date,
    durationSec,
    lesson,
    unit,
    exercise,
    vehicle,
    marks,
    telemetry: normalizedTelemetry,
    errorCount: ev.errorCount,
    criticalCount: ev.criticalCount,
    errorScore: ev.errorScore,
    telemetryScore: ev.telemetryScore,
    score: ev.score,
    uncataloged: ev.uncataloged,
  };
}
