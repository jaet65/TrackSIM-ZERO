import { describe, expect, it } from "vitest";
import {
  adjustScoreForCritical,
  buildCertificateRecipients,
  buildDriverDataFromEvals,
  dictamen,
  distributeCriticalPenalty,
  driverSlug,
  withCurrentScore,
  type EvaluationDoc,
} from "./db";
import { computeGroupBenchmarks } from "./pacingBenchmark";
import { exerciseKey, removeGroupExercises, setGroupExercises } from "./exercises";

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

  it("distributes accumulated critical penalties across exercise scores", () => {
    const scores = distributeCriticalPenalty([8, 8, 8], 3, 2);

    expect(scores.reduce((total, score) => total + score, 0) / 3).toBe(
      adjustScoreForCritical(8, 2)
    );
    expect(distributeCriticalPenalty([8, 8, 8], 3, 1)).toEqual([8, 8, 8]);
  });

  it.each([
    [[9, 8], 3, 2],
    [[10, 7, 5], 4, 3],
    [[8.4, 6.7, 5.2], 3, 4],
    [[10, 9], 2, 7],
  ])("keeps rounded exercise grades equal to the penalized overall average", (scores, expected, criticalErrors) => {
    const rawAverage = Math.round((scores.reduce((total, score) => total + score, 0) / expected) * 10) / 10;
    const adjustedScores = distributeCriticalPenalty(scores, expected, criticalErrors);
    const adjustedAverage = Math.round((adjustedScores.reduce((total, score) => total + score, 0) / expected) * 10) / 10;

    expect(adjustedAverage).toBe(adjustScoreForCritical(rawAverage, criticalErrors));
  });

  it("uses penalized exercise grades consistently for the driver, phases, missing work, and overall average", () => {
    const groupId = "scoring-consistency-group";
    setGroupExercises(
      groupId,
      {
        "1": ["Ejercicio A", "Ejercicio B"],
        "2": ["Ejercicio C", "No evaluado"],
      },
      {},
      {},
      {},
      { [exerciseKey("No evaluado")]: true }
    );

    try {
      const evaluations = [
        withCurrentScore(evaluation({
          groupId,
          phase: 1,
          exercise: "Ejercicio A",
          unit: "Ejercicio A",
          fileName: "ejercicio-a.rep",
          frozen: true,
          frozenScore: 9,
          frozenCriticalCount: 2,
        })),
        withCurrentScore(evaluation({
          groupId,
          phase: 2,
          exercise: "Ejercicio C",
          unit: "Ejercicio C",
          fileName: "ejercicio-c.rep",
          frozen: true,
          frozenScore: 7,
          frozenCriticalCount: 0,
        })),
      ];
      const data = buildDriverDataFromEvals("ana-perez", evaluations, { groupId });

      expect(data).not.toBeNull();
      if (!data) throw new Error("No se pudo construir el expediente para la prueba.");

      const exerciseA = data.evals.find((item) => item.exercise === "Ejercicio A");
      const exerciseC = data.evals.find((item) => item.exercise === "Ejercicio C");
      expect(exerciseA).toBeDefined();
      expect(exerciseC).toBeDefined();
      if (!exerciseA || !exerciseC) throw new Error("Faltan ejercicios evaluados en la prueba.");

      const phaseOne = data.phases.find((phase) => phase.phase === 1);
      const phaseTwo = data.phases.find((phase) => phase.phase === 2);
      expect(phaseOne?.countedEvals?.find((item) => item.exercise === "Ejercicio A")?.score).toBe(exerciseA.score);
      expect(phaseTwo?.countedEvals?.find((item) => item.exercise === "Ejercicio C")?.score).toBe(exerciseC.score);
      expect(phaseOne?.avgScore).toBe(Math.round((exerciseA.score / 2) * 10) / 10);
      expect(phaseTwo?.avgScore).toBe(Math.round(exerciseC.score * 10) / 10);
      expect(data.expectedExercises).toBe(4);
      expect(data.overall).toBe(
        Math.round(((exerciseA.score + exerciseC.score) / 3) * 10) / 10
      );
      expect(data.overall).toBe(3.1);
      expect(exerciseA.score).toBeLessThan(9);
      expect(exerciseC.score).toBeLessThan(7);
    } finally {
      removeGroupExercises(groupId);
    }
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
