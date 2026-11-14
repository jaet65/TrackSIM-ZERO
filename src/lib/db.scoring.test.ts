import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { safeGetDocs } = vi.hoisted(() => ({
  safeGetDocs: vi.fn(),
}));

vi.mock("./firebase", () => ({
  firestore: {},
  getDb: vi.fn(() => ({})),
  safeGetDoc: vi.fn(),
  safeGetDocs,
  fastWrite: vi.fn((promise: Promise<unknown>) => promise),
}));

vi.mock("firebase/firestore", () => ({
  collection: vi.fn((_db: unknown, ...parts: string[]) => ({ path: parts.join("/") })),
  deleteDoc: vi.fn(),
  doc: vi.fn((_parent: unknown, ...parts: string[]) => ({ path: parts.join("/") })),
  limit: vi.fn(),
  onSnapshot: vi.fn(),
  orderBy: vi.fn(),
  query: vi.fn((col: unknown, ...constraints: unknown[]) => ({ col, constraints })),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  where: vi.fn(),
  writeBatch: vi.fn(),
}));

vi.mock("./catalogStore", () => ({
  loadCatalog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./groups", () => ({
  listGroups: vi.fn().mockResolvedValue([
    { id: "scoring-group", name: "Scoring group", status: "open", type: "escuela" },
  ]),
}));

vi.mock("./exercises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./exercises")>();
  return {
    ...actual,
    loadExercises: vi.fn().mockResolvedValue(undefined),
  };
});

import {
  getLatestEvaluation,
  listReportExercises,
  overallSummaries,
  phaseSummaries,
  type EvaluationDoc,
} from "./db";
import { exerciseKey, removeGroupExercises, setGroupExercises, setGroupTypeMemory } from "./exercises";

const groupId = "scoring-group";

function makeEvaluation(overrides: Partial<EvaluationDoc> = {}): EvaluationDoc {
  return {
    phase: 1,
    driverId: "driver-1",
    driverName: "Driver One",
    fileName: "exercise-a.rep",
    lesson: "Lesson 1",
    unit: "Exercise A",
    exercise: "Exercise A",
    vehicle: "Vehicle",
    instructor: "Instructor",
    instructorEmail: "instructor@example.com",
    date: "2026-11-01",
    durationSec: 120,
    errorCount: 0,
    score: 9,
    marks: [],
    createdAt: 1,
    groupId,
    frozen: true,
    frozenScore: 9,
    frozenCriticalCount: 2,
    ...overrides,
  };
}

describe("consistent penalized score summaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setGroupTypeMemory(groupId, "escuela");
    setGroupExercises(
      groupId,
      {
        "1": ["Exercise A", "Exercise B"],
        "2": ["Exercise C", "Not evaluated"],
      },
      {},
      {},
      {},
      { [exerciseKey("Not evaluated")]: true }
    );

    const docs = [
      { id: "eval-a", data: () => makeEvaluation() },
      {
        id: "eval-c",
        data: () => makeEvaluation({
          phase: 2,
          fileName: "exercise-c.rep",
          unit: "Exercise C",
          exercise: "Exercise C",
          score: 7,
          frozenScore: 7,
          frozenCriticalCount: 0,
          createdAt: 2,
        }),
      },
    ];
    safeGetDocs.mockResolvedValue({ docs });
  });

  afterEach(() => {
    removeGroupExercises(groupId);
  });

  it("keeps overall, phase, full exercise, and phase-filtered exercise averages on the same penalized grades", async () => {
    const [driver] = await overallSummaries({ groupId });
    const phaseOne = await phaseSummaries(1, { groupId });
    const phaseTwo = await phaseSummaries(2, { groupId });
    const latest = await getLatestEvaluation({ groupId });
    const allExerciseAverages = await listReportExercises({ groupId });
    const phaseTwoExerciseAverages = await listReportExercises({ groupId }, 2);

    const exerciseA = allExerciseAverages.find((exercise) => exercise.name === "Exercise A");
    const exerciseB = allExerciseAverages.find((exercise) => exercise.name === "Exercise B");
    const exerciseC = allExerciseAverages.find((exercise) => exercise.name === "Exercise C");
    const exerciseCInPhaseFilter = phaseTwoExerciseAverages.find((exercise) => exercise.name === "Exercise C");
    const penalizedA = phaseOne[0].countedEvals?.[0].score;
    const penalizedC = phaseTwo[0].countedEvals?.[0].score;

    expect(exerciseA?.avgScore).toBe(penalizedA);
    expect(exerciseB?.avgScore).toBe(0);
    expect(exerciseC?.avgScore).toBe(penalizedC);
    expect(latest?.score).toBe(penalizedC);
    expect(exerciseCInPhaseFilter?.avgScore).toBe(exerciseC?.avgScore);
    expect(driver.avgScore).toBe(
      Math.round(((exerciseA?.avgScore ?? 0) + (exerciseB?.avgScore ?? 0) + (exerciseC?.avgScore ?? 0)) / 3 * 10) / 10
    );
    expect(driver.avgScore).toBe(3.1);
  });
});
