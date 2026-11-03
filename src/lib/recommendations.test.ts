import { describe, expect, it } from "vitest";
import { generatePedagogicalRecommendations, type DriverEvaluationInput } from "./recommendations";

const evaluation = (overrides: Partial<DriverEvaluationInput> = {}): DriverEvaluationInput => ({
  overall: 7,
  verdict: "APTO CON OBSERVACIONES",
  criticalErrors: 0,
  breakdown: [],
  ...overrides,
});

describe("generatePedagogicalRecommendations", () => {
  it("recommends lane discipline and defensive driving for matching errors", () => {
    const recommendations = generatePedagogicalRecommendations(
      evaluation({
        breakdown: [
          {
            description: "Salirse de la vía en montaña",
            rawDescription: "Salirse de la via",
            count: 2,
            severity: "GRAVE",
            environment: "MONTANA",
          },
          {
            description: "Colision con vehículo",
            count: 1,
            severity: "CRITICO",
          },
        ],
      })
    );

    expect(recommendations.map(({ id }) => id)).toEqual(["lane_discipline", "defensive_driving"]);
    expect(recommendations[0].description).toContain("2 incidente(s)");
    expect(recommendations[0].description).toContain("montaña");
  });

  it("falls back to the first positive critical fault when there are no collision or lane errors", () => {
    const recommendations = generatePedagogicalRecommendations(
      evaluation({
        breakdown: [
          { description: "Falta ignorada", count: 0, severity: "CRITICO" },
          { description: "Vuelco", count: 1, severity: "CRITICO" },
        ],
      })
    );

    expect(recommendations[0]).toMatchObject({
      id: "critical_faults",
      priority: "ALTA",
      description: expect.stringContaining("1× Vuelco"),
    });
  });

  it("uses radar values at their thresholds and limits output to four recommendations", () => {
    const recommendations = generatePedagogicalRecommendations(
      evaluation({
        radarAxes: [
          { label: "Zona Verde", value: 49, raw: "49%" },
          { label: "Freno Suave", value: 69, raw: "4 f. bruscas" },
          { label: "Retarder", value: 64, raw: "1s" },
          { label: "Inercia", value: 59, raw: "20%" },
          { label: "Acel. Suave", value: 64, raw: "8s" },
        ],
        breakdown: [
          { description: "Colision", count: 1, severity: "CRITICO" },
          { description: "Salirse de la via", count: 1, severity: "GRAVE" },
        ],
      })
    );

    expect(recommendations).toHaveLength(4);
    expect(recommendations.map(({ id }) => id)).toEqual([
      "lane_discipline",
      "defensive_driving",
      "rpm_green_zone",
      "harsh_braking",
    ]);
    expect(recommendations[2].priority).toBe("ALTA");
  });

  it("provides an excellence recommendation only when no other recommendation applies", () => {
    expect(
      generatePedagogicalRecommendations(evaluation({ overall: 8.5, verdict: "APTO" })).map(({ id }) => id)
    ).toEqual(["driver_excellence"]);
    expect(generatePedagogicalRecommendations(evaluation()).map(({ id }) => id)).toEqual([
      "continuous_improvement",
    ]);
  });
});
