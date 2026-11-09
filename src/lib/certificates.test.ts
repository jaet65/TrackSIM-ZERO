import jsPDF from "jspdf";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CertificateRecipient } from "./db";

const mocks = vi.hoisted(() => ({ getGroup: vi.fn(), listCertificateRecipients: vi.fn() }));
vi.mock("./groups", () => ({ getGroup: mocks.getGroup }));
vi.mock("./db", () => ({ listCertificateRecipients: mocks.listCertificateRecipients }));

import { downloadCertificate, generateGroupCertificates, generateCertificatePdf } from "./certificates";

const recipient: CertificateRecipient = {
  driverId: "ana",
  name: "Ana Pérez",
  score: 5.4,
  lastEvaluationDate: "2026-11-09",
};
const template = readFileSync(new URL("../../Material Apoyo/RECONOCIMIENTO 6@.jpg", import.meta.url));

function pdfText(bytes: ArrayBuffer) {
  return Buffer.from(bytes).toString("latin1");
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("diplomas", () => {
  it("generates a diploma with the requested data even for a low score", () => {
    const text = pdfText(generateCertificatePdf(recipient, "Grupo Norte", "Conducción segura", template));
    expect(text).toContain("Ana P");
    expect(text).toContain("Curso:");
    expect(text).toContain("Grupo: Grupo Norte");
    expect(text).toContain("5.4 / 10");
    expect(text).toContain("2026-11-09");
    expect(text).toContain("/Subtype /Image");
    expect(text.includes("/Width 3300")).toBe(true);
    expect(text.includes("/Height 2534")).toBe(true);
    expect(text).toContain("/DCTDecode");
  });

  it("omits an unspecified course and reports an unavailable date", () => {
    const text = pdfText(generateCertificatePdf({ ...recipient, lastEvaluationDate: null }, "Grupo", "", template));
    expect(text).not.toContain("Curso:");
    expect(text).toContain("Fecha no disponible");
  });

  it("centers the evaluation details below the certification block", () => {
    const text = pdfText(generateCertificatePdf(recipient, "Grupo Norte", "Conducción segura", template));
    const details = /([\d.]+) ([\d.]+) Td\n\(Curso:/.exec(text);
    expect(details).not.toBeNull();
    const textWidth = new jsPDF().setFont("helvetica", "normal").setFontSize(9).getTextWidth("Curso: Conducción segura");
    expect(Number(details![1]) * 25.4 / 72 + textWidth / 2).toBeCloseTo(139, 1);
    const pageHeight = 297 * 2534 / 3300;
    expect(pageHeight - Number(details![2]) * 25.4 / 72).toBeCloseTo(199, 1);
  });

  it("fits long course and group names without dropping the evaluation details", () => {
    const text = pdfText(generateCertificatePdf(
      recipient,
      "Grupo de evaluación ".repeat(9).trim(),
      "Curso de conducción segura ".repeat(7).trim(),
      template
    ));
    expect(text.includes("5.4 / 10")).toBe(true);
    expect(text.includes("2026-11-09")).toBe(true);
  });

  it("downloads a PDF and generates one uniquely named PDF per evaluated driver", async () => {
    mocks.getGroup.mockResolvedValue({ id: "group", name: "Grupo Norte", courseName: "Curso" });
    mocks.listCertificateRecipients.mockResolvedValue([
      recipient,
      { ...recipient, driverId: "beto", name: "Beto", score: 0, lastEvaluationDate: "2027-01-02" },
    ]);
    const click = vi.fn();
    const remove = vi.fn();
    const link = { href: "", download: "", click, remove };
    const createObjectURL = vi.fn((_blob: Blob) => "blob:test");
    vi.stubGlobal("document", { createElement: () => link, body: { appendChild: vi.fn() } });
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });
    const fetchTemplate = vi.fn(async () => ({ ok: true, arrayBuffer: async () => Uint8Array.from(template).buffer }));
    vi.stubGlobal("fetch", fetchTemplate);

    await downloadCertificate("group", "ana");
    expect(link.download).toBe("Ana Pérez_Diploma.pdf");
    expect(createObjectURL.mock.calls[0][0]).toBeInstanceOf(Blob);

    const result = await generateGroupCertificates("group");
    expect(result).toMatchObject({ groupName: "Grupo Norte", year: "2027" });
    expect(result.files.map((file) => file.path)).toEqual(["Ana Pérez_Diploma.pdf", "Beto_Diploma.pdf"]);
    expect(pdfText(result.files[1].content)).toContain("0.0 / 10");
    expect(click).toHaveBeenCalledTimes(1);
    expect(fetchTemplate).toHaveBeenCalledTimes(2);
  });

  it("preserves diplomas with identical names in separate folders", async () => {
    mocks.getGroup.mockResolvedValue({ id: "group", name: "Grupo" });
    mocks.listCertificateRecipients.mockResolvedValue([recipient, { ...recipient, driverId: "ana-2" }]);
    const createObjectURL = vi.fn((_blob: Blob) => "blob:test");
    vi.stubGlobal("document", { createElement: () => ({ click: vi.fn(), remove: vi.fn() }), body: { appendChild: vi.fn() } });
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, arrayBuffer: async () => Uint8Array.from(template).buffer })));

    const { files } = await generateGroupCertificates("group");
    expect(files.map((file) => file.path)).toEqual(["001/Ana Pérez_Diploma.pdf", "002/Ana Pérez_Diploma.pdf"]);
  });

  it("reports missing group evaluation dates instead of inventing a year", async () => {
    mocks.getGroup.mockResolvedValue({ id: "group", name: "Grupo" });
    mocks.listCertificateRecipients.mockResolvedValue([{ ...recipient, lastEvaluationDate: null }]);
    await expect(generateGroupCertificates("group")).rejects.toThrow("No se pudo determinar el año");
  });

  it("reports template loading failures without downloading an incomplete PDF", async () => {
    mocks.getGroup.mockResolvedValue({ id: "group", name: "Grupo" });
    mocks.listCertificateRecipients.mockResolvedValue([recipient]);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
    await expect(downloadCertificate("group", "ana")).rejects.toThrow("No se pudo cargar el formato de reconocimiento.");
  });
});
