import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ generateGroupCertificates: vi.fn(), getLatestEvaluationYear: vi.fn() }));
vi.mock("./certificates", async (importOriginal) => ({
  ...await importOriginal<typeof import("./certificates")>(),
  generateGroupCertificates: mocks.generateGroupCertificates,
}));
vi.mock("./db", async (importOriginal) => ({
  ...await importOriginal<typeof import("./db")>(),
  getLatestEvaluationYear: mocks.getLatestEvaluationYear,
}));

import { downloadBulkReportsZip } from "./pdfExport";

const metrics = { total: 0, promedio: 0, aptos: 0, noAptos: 0 };

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

function setupDownload() {
  const link = { href: "", download: "", click: vi.fn() };
  const createObjectURL = vi.fn((_blob: Blob) => "blob:test");
  vi.stubGlobal("document", { createElement: () => link, body: { appendChild: vi.fn(), removeChild: vi.fn() } });
  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });
  return { link, createObjectURL };
}

describe("bulk report ZIP", () => {
  it("includes the group diplomas alongside reports when a group is selected", async () => {
    const { link, createObjectURL } = setupDownload();
    mocks.generateGroupCertificates.mockResolvedValue({
      groupName: "Grupo",
      year: "2026",
      files: [{ path: "Ana_Diploma.pdf", content: new TextEncoder().encode("diploma").buffer }],
    });

    await downloadBulkReportsZip([], "Grupo", metrics, undefined, { groupId: "group", startDate: "2026-01-01" }, "Grupo");
    expect(mocks.generateGroupCertificates).toHaveBeenCalledWith("group");
    const zip = await JSZip.loadAsync(await createObjectURL.mock.calls[0][0].arrayBuffer());
    expect(zip.file("00_Reporte_Global_Resultados.pdf")).not.toBeNull();
    expect(zip.file("01_Resumen_Ejecutivo_Direccion.pdf")).not.toBeNull();
    expect(await zip.file("Diplomas/Ana_Diploma.pdf")!.async("string")).toBe("diploma");
    expect(Object.keys(zip.files).some((name) => name.endsWith(".zip"))).toBe(false);
    expect(link.download).toBe("TrackSIM Reportes_Grupo_2026.zip");
    expect(link.click).toHaveBeenCalledOnce();
  });

  it("exports reports without diplomas when all groups are selected", async () => {
    const { createObjectURL, link } = setupDownload();
    mocks.getLatestEvaluationYear.mockResolvedValue("2027");
    await downloadBulkReportsZip([], "Todos", metrics);
    expect(mocks.generateGroupCertificates).not.toHaveBeenCalled();
    const zip = await JSZip.loadAsync(await createObjectURL.mock.calls[0][0].arrayBuffer());
    expect(zip.file("00_Reporte_Global_Resultados.pdf")).not.toBeNull();
    expect(Object.keys(zip.files).some((name) => name.startsWith("Diplomas_"))).toBe(false);
    expect(link.download).toBe("TrackSIM Reportes_Todos los grupos_2027.zip");
  });

  it("does not download an incomplete ZIP if generating diplomas fails", async () => {
    const { link } = setupDownload();
    mocks.generateGroupCertificates.mockRejectedValue(new Error("No se pudo generar el diploma"));
    await expect(downloadBulkReportsZip([], "Grupo", metrics, undefined, { groupId: "group" })).rejects.toThrow("No se pudo generar el diploma");
    expect(link.click).not.toHaveBeenCalled();
  });
});
