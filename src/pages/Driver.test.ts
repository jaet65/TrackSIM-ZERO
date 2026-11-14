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
      if (initialState === null) {
        // Driver initializes selectedEval to null, but also selectedModalSeverity to null.
        // We only want to inject state.selectedEval into selectedEval, which has type EvaluationView | null.
        // If state.selectedEval is already consumed or for subsequent null state calls, return null.
        const val = state.selectedEval;
        state.selectedEval = null;
        return react.useState(val);
      }
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

function renderReport(groupEvals: EvaluationView[], driverEval = evaluation) {
  state.selectedEval = driverEval;
  state.data = {
    name: "Conductor",
    evals: [driverEval],
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
    expect(html).not.toContain("Incidencias editadas");
    expect(html).not.toContain(">Editado</span>");
  });

  it("identifies driver records with ignored false positives or manually added errors", () => {
    const editedEvaluation: EvaluationView = {
      ...evaluation,
      marks: [
        { time: "0:00:10", type: "ERROR", description: "Falso positivo", ignored: true },
        { time: "0:00:20", type: "ERROR", description: "Error manual", manual: true },
      ],
    };

    const html = renderReport([], editedEvaluation);

    expect(html).toContain("Incidencias editadas");
    expect(html).toContain(">Editado</span>");
    expect(html).toContain("1 falso(s) positivo(s) anulado(s) · 1 error(es) agregado(s) manualmente");
  });
});
