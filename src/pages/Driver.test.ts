import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DriverData, EvaluationView } from "../lib/db";

const state = vi.hoisted(() => ({
  data: undefined as DriverData | undefined,
  selectedEval: null as EvaluationView | null,
}));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useState: (initialState: unknown) => {
      if (initialState === undefined) return react.useState(state.data);
      if (initialState === null) return react.useState(state.selectedEval);
      return react.useState(initialState);
    },
  };
});

vi.mock("react-router-dom", () => ({
  useParams: () => ({ id: "driver" }),
  useSearchParams: () => [new URLSearchParams("grupo=group")],
  Link: ({ children }: { children: React.ReactNode }) => createElement("a", null, children),
}));

vi.mock("../components/AuthProvider", () => ({
  useAuth: () => ({ user: null }),
}));

import Driver from "./Driver";

const evaluation: EvaluationView = {
  phase: 1,
  driverId: "driver",
  driverName: "Conductor",
  fileName: "reporte.csv",
  lesson: "",
  unit: "Autopista",
  exercise: "Autopista",
  vehicle: "",
  instructor: "",
  instructorEmail: "",
  date: "",
  durationSec: 60,
  errorCount: 0,
  score: 9,
  errorScore: 9,
  criticalCount: 0,
  marks: [],
  createdAt: 0,
  groupId: "group",
  telemetry: { pctGreenZone: 75, distanceMeters: 1000, coastDistanceMeters: 350 },
};

function renderReport(groupEvals: EvaluationView[]) {
  state.selectedEval = evaluation;
  state.data = {
    name: "Conductor",
    evals: [evaluation],
    missingExercises: [],
    phases: [],
    breakdown: [],
    overall: 9,
    rawOverall: 9,
    completedExercises: 1,
    expectedExercises: 1,
    criticalErrors: 0,
    verdict: "APTO",
    color: "",
    groupType: "escuela",
    groupEvals,
  };
  return renderToStaticMarkup(createElement(Driver));
}

describe("driver exercise report", () => {
  it("renders the group benchmark polygon when the exercise has group telemetry", () => {
    const html = renderReport([evaluation]);
    expect(html).toContain("Media del Grupo (1 ej.)");
    expect(html).toMatch(/<polygon points="(?:-?\d+\.\d,-?\d+\.\d ?){5}" fill="rgba\(191, 219, 254, 0\.12\)"/);
  });

  it("renders the operator radar without a group benchmark", () => {
    const html = renderReport([]);
    expect(html).toContain("Operador");
    expect(html).not.toContain("Media del Grupo");
    expect(html).not.toContain('fill="rgba(191, 219, 254, 0.12)"');
  });
});
