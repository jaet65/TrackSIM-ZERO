import { describe, expect, it } from "vitest";
import { computeGroupRadarBenchmark, computeTelemetryAxes } from "./telemetryRadar";

describe("computeTelemetryAxes", () => {
  it("returns a zeroed radar when there are no valid telemetry records", () => {
    const summary = computeTelemetryAxes([undefined, {}]);

    expect(summary.totalExercises).toBe(0);
    expect(summary.ecoScore).toBe(0);
    expect(summary.axes.map(({ value }) => value)).toEqual([0, 0, 0, 0, 0]);
    expect(summary.environment).toBe("CARRETERA");
  });

  it("applies each environment's targets before averaging mixed exercises", () => {
    const summary = computeTelemetryAxes([
      {
        exercise: "Autopista",
        telemetry: {
          pctGreenZone: 75,
          distanceMeters: 1000,
          coastDistanceMeters: 350,
          brakeTime: "00:06",
          auxBrakeTimeSec: 4,
          averageSpeed: 70,
        },
      },
      {
        exercise: "Ruta de montaña",
        telemetry: {
          pctGreenZone: 48,
          distanceMeters: 1000,
          coastDistanceMeters: 250,
          brakeTime: "00:20",
          auxBrakeTimeSec: 30,
          throttleAbove60Time: "00:02",
          averageSpeed: 50,
        },
      },
    ]);

    expect(summary.environment).toBe("MIXTO");
    expect(summary.environments).toEqual(["CARRETERA", "MONTANA"]);
    expect(summary.totalExercises).toBe(2);
    expect(summary.greenTarget).toBe(62);
    expect(summary.axes.map(({ value }) => value)).toEqual([100, 100, 100, 100, 95]);
    expect(summary.metrics.avgSpeed).toBe(60);
  });

  it("includes slippery-road summaries and uses the safer retarder axis label", () => {
    const summary = computeGroupRadarBenchmark([
      {
        hasSlipperyRoad: true,
        pctGreenZone: 75,
        auxBrakeTimeSec: 0,
      },
    ]);

    expect(summary.hasSlipperyRoad).toBe(true);
    expect(summary.slipperyCount).toBe(1);
    expect(summary.axes[2].label).toBe("Retarder Seg.");
    expect(summary.axes[2].raw).toContain("Seguro");
  });
});
