/**
 * Utilidades para importar y exportar el catálogo de ejercicios en formato CSV.
 */
import {
  detectEnvironmentFromName,
  exerciseKey,
  getPhasesList,
  type ExerciseConfig,
  type ExerciseDescriptionsMap,
  type ExerciseEnvironment,
  type ExerciseEnvironmentsMap,
  type UnevaluatedExercisesMap,
} from "./exercises";
import { type PhaseItem } from "./config";

export interface ParsedExerciseCsvRow {
  nombre: string;
  descripcion?: string;
  fase?: number;
  entorno?: ExerciseEnvironment;
  noEvaluado?: boolean;
}

/**
 * Parsea un archivo de texto en formato CSV respetando comillas (""), saltos de línea y delimitador coma (o punto y coma).
 */
export function parseCsvRows(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, "").trim();
  if (!clean) return [];

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let inQuotes = false;

  // Detectar delimitador predominante en la primera línea (, o ;)
  const firstLine = clean.split(/\r?\n/)[0] || "";
  let delimiter = ",";
  const commaCount = (firstLine.match(/,/g) || []).length;
  const semicolonCount = (firstLine.match(/;/g) || []).length;
  if (semicolonCount > commaCount) {
    delimiter = ";";
  }

  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    const nextChar = clean[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          // Comilla escapada ""
          currentField += '"';
          i++;
        } else {
          // Fin de comillas
          inQuotes = false;
        }
      } else {
        currentField += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === delimiter) {
        currentRow.push(currentField.trim());
        currentField = "";
      } else if (char === "\r") {
        if (nextChar === "\n") i++;
        currentRow.push(currentField.trim());
        rows.push(currentRow);
        currentRow = [];
        currentField = "";
      } else if (char === "\n") {
        currentRow.push(currentField.trim());
        rows.push(currentRow);
        currentRow = [];
        currentField = "";
      } else {
        currentField += char;
      }
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    rows.push(currentRow);
  }

  return rows;
}

/**
 * Lee un texto CSV de catálogo de ejercicios y extrae una lista estructurada de ejercicios sin duplicados.
 * Acepta columnas: nombre/ejercicio/name, descripcion/description, fase/phase (opcional), entorno/ambiente/environment (opcional).
 */
export function parseExerciseCsv(csvText: string): ParsedExerciseCsvRow[] {
  const table = parseCsvRows(csvText);
  if (table.length === 0) return [];

  // Analizar cabecera
  const header = table[0].map((c) =>
    c.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim()
  );

  let nameCol = header.findIndex((h) => h === "nombre" || h === "ejercicio" || h === "name" || h === "unidad");
  let descCol = header.findIndex((h) => h === "descripcion" || h === "description" || h === "detalle");
  let phaseCol = header.findIndex((h) => h === "fase" || h === "phase");
  let envCol = header.findIndex((h) => h === "entorno" || h === "ambiente" || h === "environment");
  let unevCol = header.findIndex(
    (h) =>
      h === "no_evaluado" ||
      h === "no evaluado" ||
      h === "unevaluated" ||
      h === "concientizacion" ||
      h === "evaluado"
  );

  let startIndex = 1;

  // Si no se encontró cabecera reconocible en la fila 0, asumir columna 0 = nombre, columna 1 = descripción
  if (nameCol === -1) {
    nameCol = 0;
    descCol = table[0].length > 1 ? 1 : -1;
    startIndex = 0;
  }

  const results: ParsedExerciseCsvRow[] = [];
  const seen = new Set<string>();

  for (let i = startIndex; i < table.length; i++) {
    const row = table[i];
    if (!row || row.length === 0) continue;

    const nombre = (row[nameCol] ?? "").trim();
    if (!nombre) continue;

    const key = exerciseKey(nombre);
    if (seen.has(key)) continue;
    seen.add(key);

    const descripcion = descCol !== -1 && row[descCol] ? row[descCol].trim() : undefined;

    let fase: number | undefined;
    if (phaseCol !== -1 && row[phaseCol]) {
      const parsedPhase = parseInt(row[phaseCol].replace(/\D/g, ""), 10);
      if (parsedPhase >= 1 && parsedPhase <= 30) {
        fase = parsedPhase;
      }
    }

    let entorno: ExerciseEnvironment | undefined;
    if (envCol !== -1 && row[envCol]) {
      const rawEnv = row[envCol].toUpperCase().trim();
      if (rawEnv === "MONTANA" || rawEnv === "MONTAÑA") entorno = "MONTANA";
      else if (rawEnv === "CIUDAD") entorno = "CIUDAD";
      else if (rawEnv === "CARRETERA") entorno = "CARRETERA";
      else if (rawEnv === "AUTO") entorno = "AUTO";
    }

    let noEvaluado: boolean | undefined;
    if (unevCol !== -1 && row[unevCol]) {
      const val = row[unevCol].toLowerCase().trim();
      const colHeader = header[unevCol];
      if (colHeader === "evaluado") {
        if (val === "no" || val === "false" || val === "0") noEvaluado = true;
      } else {
        if (val === "si" || val === "sí" || val === "true" || val === "1" || val.includes("no evaluado") || val.includes("concientiz")) {
          noEvaluado = true;
        }
      }
    }

    results.push({
      nombre,
      descripcion,
      fase,
      entorno: entorno || (detectEnvironmentFromName(nombre) as ExerciseEnvironment),
      noEvaluado,
    });
  }

  return results;
}

/**
 * Genera el contenido de texto CSV para exportar la configuración actual de ejercicios.
 */
export function exportExercisesToCsv(
  cfg: ExerciseConfig,
  isCurso: boolean,
  envs?: ExerciseEnvironmentsMap,
  descriptions?: ExerciseDescriptionsMap,
  phasesList?: PhaseItem[],
  unevaluated?: UnevaluatedExercisesMap
): string {
  const lines: string[] = [];

  if (isCurso) {
    lines.push("nombre,descripcion,entorno,no_evaluado");
    const list = cfg[1] ?? [];
    for (const name of list) {
      const key = exerciseKey(name);
      const env = envs?.[key] || "AUTO";
      const desc = descriptions?.[key] || "";
      const unev = unevaluated?.[key] ? "SI" : "NO";
      lines.push(`${escapeCsvField(name)},${escapeCsvField(desc)},${escapeCsvField(env)},${unev}`);
    }
  } else {
    lines.push("fase,nombre_fase,nombre,descripcion,entorno,no_evaluado");
    const effectivePhases = phasesList && phasesList.length > 0 ? phasesList : getPhasesList(null, cfg);
    for (const p of effectivePhases) {
      const list = cfg[p.id] ?? [];
      for (const name of list) {
        const key = exerciseKey(name);
        const env = envs?.[key] || "AUTO";
        const desc = descriptions?.[key] || "";
        const unev = unevaluated?.[key] ? "SI" : "NO";
        lines.push(
          `${p.id},${escapeCsvField(p.name)},${escapeCsvField(name)},${escapeCsvField(desc)},${escapeCsvField(env)},${unev}`
        );
      }
    }
  }

  return lines.join("\r\n");
}

function escapeCsvField(val: string): string {
  if (val.includes(",") || val.includes('"') || val.includes("\n") || val.includes("\r") || val.includes(";")) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

