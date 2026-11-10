import { describe, expect, it } from "vitest";
import {
  adjustScoreForCritical,
  buildCertificateRecipients,
  dictamen,
  driverSlug,
  withCurrentScore,
  type EvaluationDoc,
} from "./db";
import { computeGroupBenchmarks } from "./pacingBenchmark";
import { removeGroupExercises, setGroupExercises } from "./exercises";

const evaluation = (overrides: Partial<EvaluationDoc> = {}): EvaluationDoc => ({
  phase: 1,
  driverId: "ana-perez",
  driverName: "Ana Pérez",
  fileName: "report.csv",
  lesson: "Lección 1",
  unit: "Autopista",
  exercise: "Autopista",
  vehicle: "Camión",
  instructor: "Instructor",
  instructorEmail: "instructor@example.com",
  date: "2026-01-10",
  durationSec: 120,
  errorCount: 0,
  score: 10,
  marks: [],
  createdAt: 1,
  ...overrides,
});

describe("evaluation helpers", () => {
  it("creates stable driver slugs and applies the critical-fault verdict threshold", () => {
    expect(driverSlug("  Ana Pérez + López  ")).toBe("ana-perez-lopez");
    expect(dictamen(9, 1).label).toBe("APTO");
    expect(dictamen(9, 2).label).toBe("NO APTO");
    expect(adjustScoreForCritical(9, 1)).toBe(9);
    // Conducir al 10/10 en el resto de la conducción llega exactamente al techo:
    expect(adjustScoreForCritical(10, 2)).toBe(5.9);
    expect(adjustScoreForCritical(10, 3)).toBe(5.4);
    expect(adjustScoreForCritical(10, 6)).toBe(3.9);
    // Con 9/10 en el resto modula proporcionalmente (5.9 * 0.9 = 5.3):
    expect(adjustScoreForCritical(9, 2)).toBe(5.3);
    // A partir de la 7ª falta crítica se va automáticamente a 0:
    expect(adjustScoreForCritical(10, 7)).toBe(0);
    expect(adjustScoreForCritical(8, 8)).toBe(0);
  });

  it("recalculates current scores and detects legacy slippery-road marks", () => {
    const view = withCurrentScore(
      evaluation({
        marks: [{ time: "00:00:10", type: "ERROR", description: "Salirse de la vía" }],
        telemetry: { pctGreenZone: 75 },
      }),
      undefined,
      "evaluation-1"
    );

    expect(view.docId).toBe("evaluation-1");
    expect(view.criticalCount).toBe(0);
    expect(view.errorCount).toBe(1);
    expect(view.telemetry?.pctLowRpmZone).toBe(25);
    expect(view.score).toBeLessThan(10);

    const wetView = withCurrentScore(
      evaluation({
        marks: [{ time: "00:00:10", type: "INFO", description: "Nieve detectada" }],
        telemetry: { pctGreenZone: 75 },
      })
    );
    expect(wetView.telemetry?.hasSlipperyRoad).toBe(true);
    expect(wetView.telemetry?.slipperyCondition).toBe("Nieve");
  });

  it("preserves frozen values and converts legacy 0-to-100 scores into the 0-to-10 scale", () => {
    const frozenMarks = [{ time: "00:00:01", type: "ERROR", description: "Frozen mark" }];
    const view = withCurrentScore(
      evaluation({
        frozen: true,
        frozenScore: 87,
        frozenErrorScore: 92,
        frozenTelemetryScore: 75,
        frozenErrorCount: 4,
        frozenCriticalCount: 2,
        frozenMarks,
      })
    );

    expect(view).toMatchObject({
      score: 8.7,
      errorScore: 9.2,
      telemetryScore: 7.5,
      errorCount: 4,
      criticalCount: 2,
      marks: frozenMarks,
    });
  });

  it("recalculates the score without a pacing penalty when speeding peers are excluded", () => {
    const driver = evaluation({ telemetry: { averageSpeed: 12.5, distanceMeters: 1000 } });
    const benchmarks = computeGroupBenchmarks([
      driver,
      evaluation({ telemetry: { averageSpeed: 14, distanceMeters: 1100 } }),
      evaluation({
        marks: [{ time: "0:01:00", type: "ERROR", description: "Exceso de velocidad" }],
        telemetry: { averageSpeed: 37.7, distanceMeters: 5000 },
      }),
    ]);

    const view = withCurrentScore(driver, undefined, "evaluation-1", benchmarks);
    expect(view.pacing).toMatchObject({ hasBenchmark: true, isPacingDeficit: false, penaltyDeduction: 0 });
    expect(view.score).toBe(withCurrentScore(driver).score);
  });

  it("builds recipients for all evaluated drivers of the selected group using their latest evaluation date", () => {
    setGroupExercises("group", { "1": ["Autopista"] });
    const docs = [
      withCurrentScore(evaluation({ groupId: "group", date: "2026-10-01", frozen: true, frozenScore: 8 })),
      withCurrentScore(evaluation({ groupId: "group", date: "2026-11-09", fileName: "second.csv", frozen: true, frozenScore: 5.4 })),
      withCurrentScore(evaluation({ groupId: "group", driverId: "beto", driverName: "Beto", date: "" })),
      withCurrentScore(evaluation({ groupId: "other", driverId: "other" })),
    ];
    const recipients = buildCertificateRecipients("group", docs);
    removeGroupExercises("group");
    expect(recipients).toHaveLength(2);
    expect(recipients[0]).toMatchObject({ driverId: "ana-perez", lastEvaluationDate: "2026-11-09", score: 5.4 });
    expect(recipients[1]).toMatchObject({ driverId: "beto", lastEvaluationDate: null });
  });
});
