import { describe, expect, it } from "vitest";
import { exportExercisesToCsv, parseCsvRows, parseExerciseCsv } from "./exerciseCsv";

describe("exerciseCsv - parseCsvRows", () => {
  it("parses simple comma separated values", () => {
    const csv = "nombre,descripcion\nMontaña,Pista de montaña\nNiebla,Baja visibilidad";
    const rows = parseCsvRows(csv);
    expect(rows).toEqual([
      ["nombre", "descripcion"],
      ["Montaña", "Pista de montaña"],
      ["Niebla", "Baja visibilidad"],
    ]);
  });

  it("handles quotes and commas inside quotes", () => {
    const csv = 'nombre,descripcion\n"Sierra","Conducción en Sierra, enfocada en frenado."\nNiebla,Normal';
    const rows = parseCsvRows(csv);
    expect(rows[1]).toEqual(["Sierra", "Conducción en Sierra, enfocada en frenado."]);
  });

  it("handles semicolon delimiter when predominant", () => {
    const csv = "nombre;descripcion;fase\nMontaña;Pista;1";
    const rows = parseCsvRows(csv);
    expect(rows).toEqual([
      ["nombre", "descripcion", "fase"],
      ["Montaña", "Pista", "1"],
    ]);
  });
});

describe("exerciseCsv - parseExerciseCsv", () => {
  it("correctly parses sample file like catalogo_ejercicios_2026-11-04.csv", () => {
    const sample = `nombre,descripcion
Montaña,Conducción en Montaña con enfoque al uso de frenos auxiliares
Manejo técnico económico,Conducción en Autopista
02 - Pillones,"Conducción en Sierra con condiciones adversas, enfocada en técnicas de frenado"`;

    const parsed = parseExerciseCsv(sample);
    expect(parsed).toHaveLength(3);
    expect(parsed[0].nombre).toBe("Montaña");
    expect(parsed[0].descripcion).toContain("frenos auxiliares");
    expect(parsed[0].entorno).toBe("MONTANA");

    expect(parsed[1].nombre).toBe("Manejo técnico económico");
    expect(parsed[1].entorno).toBe("CARRETERA");

    expect(parsed[2].nombre).toBe("02 - Pillones");
    expect(parsed[2].descripcion).toContain("Sierra con condiciones");
  });

  it("deduplicates case-insensitively and ignores empty lines", () => {
    const sample = `nombre,descripcion
Montaña,Desc 1
montaña,Desc 2

`;
    const parsed = parseExerciseCsv(sample);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].nombre).toBe("Montaña");
  });

  it("extracts phase and environment if present in csv", () => {
    const sample = `fase,nombre,entorno
2,02 - Montaña,MONTANA
4,Maniobras Críticas,CIUDAD`;

    const parsed = parseExerciseCsv(sample);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].fase).toBe(2);
    expect(parsed[0].entorno).toBe("MONTANA");
    expect(parsed[1].fase).toBe(4);
    expect(parsed[1].entorno).toBe("CIUDAD");
  });
});

describe("exerciseCsv - exportExercisesToCsv", () => {
  it("exports course configuration without phases", () => {
    const cfg = { "1": ["Montaña", "Manejo defensivo"] };
    const csv = exportExercisesToCsv(cfg, true, { montana: "MONTANA" });
    expect(csv).toContain("nombre,descripcion,entorno");
    expect(csv).toContain("Montaña,,MONTANA");
    expect(csv).toContain("Manejo defensivo,,AUTO");
  });

  it("exports school configuration with phases", () => {
    const cfg = {
      "1": ["Adaptación Básica"],
      "3": ["02 - Montaña"],
    };
    const csv = exportExercisesToCsv(cfg, false);
    expect(csv).toContain("fase,nombre_fase,nombre,descripcion,entorno");
    expect(csv).toContain("1,Adaptación Sensorial,Adaptación Básica,,AUTO");
    expect(csv).toContain("3,Dinámica en pendientes,02 - Montaña,,AUTO");
  });
});
