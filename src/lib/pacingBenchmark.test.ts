import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, removeGroupCatalog, setGroupCatalog } from "./catalog";
import { analyzePacing, computeGroupBenchmarks } from "./pacingBenchmark";

const speedingMark = { time: "0:01:00", type: "ERROR", description: "Exceso de velocidad" };

afterEach(() => {
  removeGroupCatalog("pacing-test-group");
});

describe("computeGroupBenchmarks", () => {
  it("groups normalized exercise names and calculates averages and thresholds", () => {
    const benchmarks = computeGroupBenchmarks([
      { unit: " Ruta Norte ", telemetry: { averageSpeed: 40, distanceMeters: 1000 } },
      { exercise: "ruta-norte", telemetry: { averageSpeed: 60, distanceMeters: 2000 } },
      { unit: "Sin datos", telemetry: { averageSpeed: 0, distanceMeters: 0 } },
    ]);

    expect(benchmarks.get("ruta norte")).toEqual({
      exerciseKey: "ruta norte",
      exerciseName: "Ruta Norte",
      sampleCount: 2,
      avgSpeed: 50,
      avgDistance: 1500,
      minSpeedThreshold: 30,
      minDistanceThreshold: 900,
    });
    expect(benchmarks.has("sin datos")).toBe(false);
  });

  it("requires at least two valid measurements to produce a benchmark", () => {
    expect(
      computeGroupBenchmarks([{ unit: "Ruta", telemetry: { averageSpeed: 50 } }]).size
    ).toBe(0);
  });

  it("excludes speeding evaluations from both averages and prevents a misleading slow-driving penalty", () => {
    const benchmarks = computeGroupBenchmarks([
      { unit: "Pillones", telemetry: { averageSpeed: 12.5, distanceMeters: 1000 } },
      { unit: "Pillones", telemetry: { averageSpeed: 14, distanceMeters: 1100 } },
      {
        unit: "Pillones",
        marks: [{ ...speedingMark, description: "EXCESO de velocidad: 80 km/h" }],
        telemetry: { averageSpeed: 37.7, distanceMeters: 5000 },
      },
      { unit: "Otra ruta", marks: [speedingMark], telemetry: { averageSpeed: 70, distanceMeters: 3000 } },
    ]);

    expect(benchmarks.get("pillones")).toMatchObject({
      sampleCount: 2,
      avgSpeed: 13.3,
      avgDistance: 1050,
      minDistanceThreshold: 630,
    });
    expect(benchmarks.has("otra ruta")).toBe(false);
    expect(analyzePacing("Pillones", { averageSpeed: 12.5, distanceMeters: 1000 }, benchmarks))
      .toMatchObject({ hasBenchmark: true, isPacingDeficit: false, penaltyDeduction: 0 });
  });

  it("does not create a benchmark when exclusions leave fewer than two evaluations", () => {
    const benchmarks = computeGroupBenchmarks([
      { unit: "Ruta", telemetry: { averageSpeed: 12.5, distanceMeters: 1000 } },
      { unit: "Ruta", marks: [speedingMark], telemetry: { averageSpeed: 40, distanceMeters: 3000 } },
    ]);
    expect(benchmarks.has("ruta")).toBe(false);
    expect(analyzePacing("Ruta", { averageSpeed: 12.5, distanceMeters: 1000 }, benchmarks))
      .toMatchObject({ hasBenchmark: false, penaltyDeduction: 0 });
  });

  it("keeps ignored marks and non-error events in the reference", () => {
    const benchmarks = computeGroupBenchmarks([
      { unit: "Ruta", marks: [{ ...speedingMark, ignored: true }], telemetry: { averageSpeed: 10 } },
      { unit: "Ruta", marks: [{ ...speedingMark, type: "INFO" }], telemetry: { averageSpeed: 20 } },
    ]);
    expect(benchmarks.get("ruta")).toMatchObject({ sampleCount: 2, avgSpeed: 15 });
  });

  it("recognizes group catalog aliases for speeding, including manual errors", () => {
    setGroupCatalog("pacing-test-group", {
      ...DEFAULT_CONFIG,
      entries: [{ name: "Exceso de velocidad", severity: "GRAVE", aliases: ["Límite superado"] }],
    });
    const benchmarks = computeGroupBenchmarks([
      { unit: "Ruta", telemetry: { averageSpeed: 10 } },
      { unit: "Ruta", telemetry: { averageSpeed: 20 } },
      {
        groupId: "pacing-test-group",
        unit: "Ruta",
        marks: [{ ...speedingMark, description: "Limite superado", manual: true }],
        telemetry: { averageSpeed: 100 },
      },
    ]);
    expect(benchmarks.get("ruta")).toMatchObject({ sampleCount: 2, avgSpeed: 15 });
  });

  it("uses frozen marks for frozen evaluations", () => {
    const benchmarks = computeGroupBenchmarks([
      { unit: "Ruta", telemetry: { averageSpeed: 10 } },
      { unit: "Ruta", telemetry: { averageSpeed: 20 } },
      { unit: "Ruta", frozen: true, marks: [], frozenMarks: [speedingMark], telemetry: { averageSpeed: 100 } },
      { unit: "Ruta", frozen: true, marks: [speedingMark], frozenMarks: [], telemetry: { averageSpeed: 30 } },
    ]);
    expect(benchmarks.get("ruta")).toMatchObject({ sampleCount: 3, avgSpeed: 20 });
  });
});

describe("analyzePacing", () => {
  const benchmarks = computeGroupBenchmarks([
    { unit: "Ruta", telemetry: { averageSpeed: 50, distanceMeters: 1000 } },
    { unit: "Ruta", telemetry: { averageSpeed: 50, distanceMeters: 1000 } },
  ]);

  it("does not apply a deficit at the exact 60 percent threshold", () => {
    expect(analyzePacing("Ruta", { averageSpeed: 30, distanceMeters: 600 }, benchmarks)).toMatchObject({
      hasBenchmark: true,
      isPacingDeficit: false,
      speedRatio: 0.6,
      distanceRatio: 0.6,
      penaltyDeduction: 0,
    });
  });

  it("reports both deficient metrics and caps the progressive penalty", () => {
    expect(analyzePacing("Ruta", { averageSpeed: 0, distanceMeters: 0 }, benchmarks)).toMatchObject({
      hasBenchmark: true,
      isPacingDeficit: true,
      speedRatio: 0,
      distanceRatio: 0,
      deficitRatio: 1,
      penaltyDeduction: 4,
      reason: expect.stringContaining("Velocidad media"),
    });
  });

  it("returns a neutral result when telemetry or a benchmark is missing", () => {
    expect(analyzePacing("Ruta")).toEqual({
      hasBenchmark: false,
      isPacingDeficit: false,
      speedRatio: 1,
      distanceRatio: 1,
      deficitRatio: 0,
      penaltyDeduction: 0,
    });
    expect(analyzePacing("Other", { averageSpeed: 20 }, benchmarks).hasBenchmark).toBe(false);
  });
});
