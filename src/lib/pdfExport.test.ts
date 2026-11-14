import { describe, expect, it } from "vitest";
import {
  generateExecutiveSummaryPdf,
  generateGlobalReportPdf,
  driverPdfFilenamePart,
  sortGlobalReportRowsByScore,
} from "./pdfExport";

describe("PDF report generation", () => {
  it("generates a global report even when there are no evaluations", () => {
    const pdf = generateGlobalReportPdf([], "Todos los grupos");

    expect(pdf).toBeInstanceOf(ArrayBuffer);
    expect((pdf as unknown as ArrayBuffer).byteLength).toBeGreaterThan(0);
  });

  it("sorts global report drivers by score from highest to lowest", () => {
    const rows = [
      { driver: "Beto", avgScore: 6.2 },
      { driver: "Ana", avgScore: 9.1 },
      { driver: "Carlos", avgScore: 7.5 },
    ];

    expect(sortGlobalReportRowsByScore(rows).map((row) => row.driver)).toEqual([
      "Ana",
      "Carlos",
      "Beto",
    ]);
    expect(rows[0].driver).toBe("Beto");
  });

  it("preserves letters in accented driver names when creating PDF filenames", () => {
    expect(driverPdfFilenamePart("Adrián Flores Sierra")).toBe("Adrian_Flores_Sierra");
    expect(driverPdfFilenamePart("Benjamín García Bonilla")).toBe("Benjamin_Garcia_Bonilla");
    expect(driverPdfFilenamePart("José Alberto Carrillo Reyes")).toBe("Jose_Alberto_Carrillo_Reyes");
  });

  it("generates an executive summary for an empty group", () => {
    const pdf = generateExecutiveSummaryPdf("Grupo de prueba", [], "Sin filtros");

    expect(pdf).toBeInstanceOf(ArrayBuffer);
    expect((pdf as unknown as ArrayBuffer).byteLength).toBeGreaterThan(0);
  });

  it("generates formatted exercise cards across continuation pages", () => {
    const exercises = Array.from({ length: 30 }, (_, index) => ({
      phase: 1,
      name: `Ejercicio ${index + 1}`,
      description: "Descripción del ejercicio y criterios de evaluación.",
      drivers: 4,
      avgScore: 7.5,
    }));

    const pdf = generateExecutiveSummaryPdf("Grupo de prueba", [], "Sin filtros", undefined, exercises);

    expect(pdf).toBeInstanceOf(ArrayBuffer);
    expect((pdf as unknown as ArrayBuffer).byteLength).toBeGreaterThan(0);
  });
});
