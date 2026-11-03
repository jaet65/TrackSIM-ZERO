import { describe, expect, it } from "vitest";
import { generateExecutiveSummaryPdf, generateGlobalReportPdf } from "./pdfExport";

describe("PDF report generation", () => {
  it("generates a global report even when there are no evaluations", () => {
    const pdf = generateGlobalReportPdf([], "Todos los grupos");

    expect(pdf).toBeInstanceOf(ArrayBuffer);
    expect((pdf as unknown as ArrayBuffer).byteLength).toBeGreaterThan(0);
  });

  it("generates an executive summary for an empty group", () => {
    const pdf = generateExecutiveSummaryPdf("Grupo de prueba", [], "Sin filtros");

    expect(pdf).toBeInstanceOf(ArrayBuffer);
    expect((pdf as unknown as ArrayBuffer).byteLength).toBeGreaterThan(0);
  });
});
