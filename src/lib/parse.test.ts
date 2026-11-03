import { describe, expect, it } from "vitest";
import { calculateTelemetryScore, decodeCsv, evaluateMarks, normalizeRpmZones, parseReport } from "./parse";

describe("decodeCsv", () => {
  it("decodifica UTF-8 y elimina el BOM", () => {
    const bytes = new TextEncoder().encode("\uFEFFconductor,año");
    expect(decodeCsv(bytes.buffer as ArrayBuffer)).toBe("conductor,año");
  });

  it("recurre a windows-1252 cuando no es UTF-8 válido", () => {
    const bytes = new Uint8Array([0x61, 0xf1, 0x6f]); // "año" en windows-1252
    expect(decodeCsv(bytes.buffer)).toBe("año");
  });
});

describe("normalizeRpmZones", () => {
  it("calculates the low-RPM remainder without changing valid zones", () => {
    expect(normalizeRpmZones({ pctGreenZone: 50, pctYellowZone: 20, pctRedZone: 10 })).toMatchObject({
      pctGreenZone: 50,
      pctYellowZone: 20,
      pctRedZone: 10,
      pctLowRpmZone: 20,
    });
  });

  it("clamps negative values and proportionally scales totals above 100", () => {
    expect(normalizeRpmZones({ pctGreenZone: 80, pctYellowZone: 40, pctRedZone: -5 })).toMatchObject({
      pctGreenZone: 66.7,
      pctYellowZone: 33.3,
      pctRedZone: 0,
      pctLowRpmZone: 0,
    });
  });
});

describe("calculateTelemetryScore", () => {
  it("returns no score when RPM telemetry is missing", () => {
    expect(calculateTelemetryScore(undefined)).toBeUndefined();
    expect(calculateTelemetryScore({ averageSpeed: 50 })).toBeUndefined();
  });

  it("uses the exercise environment to select the RPM target", () => {
    const telemetry = { pctGreenZone: 48 };
    expect(calculateTelemetryScore(telemetry, "Ruta de la Sierra")).toBe(9.1);
    expect(calculateTelemetryScore(telemetry, "Autopista")).toBe(8.2);
  });
});

describe("evaluateMarks", () => {
  it("applies critical faults directly and ignores dismissed or non-error marks", () => {
    const result = evaluateMarks(
      [
        { time: "00:00:01", type: "ERROR", description: "Atropello de un peatón" },
        { time: "00:00:02", type: "ERROR", description: "Vuelco", ignored: true },
        { time: "00:00:03", type: "INFO", description: "Lluvia" },
      ],
      120
    );

    expect(result).toMatchObject({
      errorCount: 1,
      criticalCount: 1,
      penaltyPoints: 32,
      errorScore: 6.8,
      score: 6.8,
      bySeverity: { CRITICO: 1, GRAVE: 0, MODERADO: 0, LEVE: 0 },
    });
  });

  it("normalizes regular penalties by duration and reports uncataloged errors", () => {
    const result = evaluateMarks(
      [
        { time: "00:00:01", type: "ERROR", description: "Salirse de la vía" },
        { time: "00:00:02", type: "ERROR", description: "Error no catalogado" },
      ],
      120
    );

    expect(result).toMatchObject({
      errorCount: 2,
      penaltyPoints: 4,
      errorScore: 9.2,
      bySeverity: { CRITICO: 0, GRAVE: 1, MODERADO: 1, LEVE: 0 },
      uncataloged: ["Error no catalogado"],
    });
  });
});

describe("parseReport", () => {
  const report = [
    "Lección;Unidad;Ejercicio",
    "Lección 1;Ruta de la Sierra;Ruta de la Sierra",
    "FECHA;CONDUCTOR;ID;DURACIÓN",
    "2026-01-02;123;Ana Pérez;00:02:30",
    "Vehículo:;Camión",
    "00:00:01;ERROR;Salirse de la vía",
    "00:00:05;INFO;Lluvia intensa",
    "Indicadores genéricos",
    "Distancia recorrida;1200",
    "Distancia recorrida sin freno;300",
    "Zona verde;80",
    "Zona amarilla;30",
    "Zona roja;10",
  ].join("\n");

  it("reads report fields, marks, telemetry and normalizes RPM values", () => {
    const parsed = parseReport(report);

    expect(parsed).toMatchObject({
      driver: "Ana Pérez",
      date: "2026-01-02",
      durationSec: 150,
      lesson: "Lección 1",
      unit: "Ruta de la Sierra",
      exercise: "Ruta de la Sierra",
      vehicle: "Camión",
      errorCount: 1,
      criticalCount: 1,
      telemetry: {
        distanceMeters: 1200,
        coastDistanceMeters: 300,
        pctGreenZone: 66.7,
        pctYellowZone: 25,
        pctRedZone: 8.3,
        pctLowRpmZone: 0,
        hasSlipperyRoad: true,
        slipperyCondition: "Lluvia / Pavimento mojado",
      },
    });
    expect(parsed.marks).toHaveLength(2);
  });

  it("rejects unrecognized reports and missing driver names", () => {
    expect(() => parseReport("not a report")).toThrow("Formato de CSV no reconocido");
    expect(() =>
      parseReport("Lección;Unidad;Ejercicio\n1;Ruta;Ruta\nFECHA;CONDUCTOR;DURACIÓN\n2026-01-01;;")
    ).toThrow("El CSV no indica el conductor");
  });
});
