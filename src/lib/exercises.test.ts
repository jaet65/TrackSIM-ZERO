import { afterEach, describe, expect, it } from "vitest";
import {
  detectEnvironmentFromName,
  exerciseKey,
  phaseForExercise,
  removeGroupExercises,
  resolveExerciseEnvironment,
  sanitizeExercises,
  setGroupExercises,
  setGroupTypeMemory,
  getGroupType,
} from "./exercises";

const groupId = "exercise-test-group";

afterEach(() => {
  removeGroupExercises(groupId);
});

describe("exercise naming and environment", () => {
  it("normalizes names and detects environments from keywords", () => {
    expect(exerciseKey("  01 - Montaña / Curvas ")).toBe("01 montana curvas");
    expect(detectEnvironmentFromName("Ruta de la Sierra")).toBe("MONTANA");
    expect(detectEnvironmentFromName("Patio urbano")).toBe("CIUDAD");
    expect(detectEnvironmentFromName("Autopista")).toBe("CARRETERA");
  });

  it("uses explicit group environments and detects AUTO values by name", () => {
    setGroupExercises(
      groupId,
      {},
      {
        "ruta de la sierra": "CIUDAD",
        "patio urbano": "AUTO",
      }
    );

    expect(resolveExerciseEnvironment("Ruta de la Sierra", groupId)).toBe("CIUDAD");
    expect(resolveExerciseEnvironment("Patio urbano", groupId)).toBe("CIUDAD");
    expect(resolveExerciseEnvironment(undefined, groupId)).toBe("CARRETERA");
  });
});

describe("exercise settings", () => {
  it("moves legacy phase zero entries into phase one and filters invalid duplicates", () => {
    expect(
      sanitizeExercises({
        phases: {
          "0": [" Ruta ", "Ruta", "", 4],
          "1": ["Ruta Uno"],
          "2": "not-a-list",
        },
        environments: {
          ruta: "MONTANA",
          invalid: "OTHER",
        },
        descriptions: {
          ruta: "Pista con curvas",
        },
      })
    ).toEqual({
      phases: { "1": ["Ruta Uno", " Ruta "] },
      environments: { ruta: "MONTANA" },
      descriptions: { ruta: "Pista con curvas" },
      phaseNames: {},
      globalType: "escuela",
      cursoExercises: undefined,
    });
  });

  it("sanitizes isolated cursoExercises correctly", () => {
    expect(
      sanitizeExercises({
        phases: { "1": ["Escuela 1"] },
        cursoExercises: {
          phases: { "1": ["Curso Ex 1", "Curso Ex 1", ""] },
          environments: { "curso ex 1": "MONTANA" },
        },
      })
    ).toEqual({
      phases: { "1": ["Escuela 1"] },
      environments: {},
      descriptions: {},
      phaseNames: {},
      globalType: "escuela",
      cursoExercises: {
        phases: { "1": ["Curso Ex 1"] },
        environments: { "curso ex 1": "MONTANA" },
        descriptions: {},
      },
    });
  });

  it("looks up phases using normalized names and tracks group type", () => {
    setGroupExercises(groupId, { "3": ["Dinámica en pendientes"] });
    setGroupTypeMemory(groupId, "curso");

    expect(phaseForExercise("DINAMICA en pendientes", groupId)).toBe(3);
    expect(phaseForExercise("Not configured", groupId)).toBeNull();
    expect(getGroupType(groupId)).toBe("curso");
    expect(getGroupType("missing-group")).toBe("escuela");
  });
});
