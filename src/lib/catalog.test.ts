import { afterEach, describe, expect, it } from "vitest";
import {
  classify,
  DEFAULT_CONFIG,
  hasGroupCatalog,
  normalize,
  removeGroupCatalog,
  sanitizeCatalog,
  setCatalog,
  setGroupCatalog,
} from "./catalog";

const groupId = "catalog-test-group";

afterEach(() => {
  setCatalog(DEFAULT_CONFIG);
  removeGroupCatalog(groupId);
});

describe("catalog normalization and validation", () => {
  it("normalizes accents, punctuation, and repeated spaces", () => {
    expect(normalize("  Colisión—con   un vehículo! ")).toBe("colision con un vehiculo");
  });

  it("sanitizes weights and entries while retaining defaults", () => {
    expect(
      sanitizeCatalog({
        weights: { CRITICO: 0, GRAVE: -1 },
        entries: [
          { name: "Custom", severity: "GRAVE" },
          { name: 7, severity: "LEVE" },
          { name: "Invalid severity", severity: "UNKNOWN" },
        ],
      })
    ).toEqual({
      weights: { CRITICO: 0, GRAVE: 3, MODERADO: 1, LEVE: 0.5 },
      entries: [{ name: "Custom", severity: "GRAVE" }],
    });
  });
});

describe("classify", () => {
  it("matches default entries and aliases regardless of accents or case", () => {
    expect(classify("COLISIÓN CON UN VEHÍCULO DEL TRÁFICO")).toEqual({
      severity: "CRITICO",
      weight: 32,
      cataloged: true,
    });
    expect(classify("No poner la luz direccional derecha con suficiente antelación para el cambio de carril").cataloged)
      .toBe(true);
  });

  it("uses the fallback severity for unknown entries and elevates off-road errors in mountains", () => {
    expect(classify("Error nuevo")).toEqual({
      severity: "MODERADO",
      weight: 1,
      cataloged: false,
    });
    expect(classify("Salirse de la vía", "MONTANA")).toEqual({
      severity: "CRITICO",
      weight: 32,
      cataloged: true,
    });
  });

  it("prefers a group catalog and honors entry-specific points", () => {
    setGroupCatalog(groupId, {
      weights: { CRITICO: 40, GRAVE: 4, MODERADO: 2, LEVE: 1 },
      entries: [{ name: "Custom", severity: "GRAVE", points: 7 }],
    });

    expect(hasGroupCatalog(groupId)).toBe(true);
    expect(classify("custom", undefined, groupId)).toEqual({
      severity: "GRAVE",
      weight: 7,
      cataloged: true,
    });
    expect(classify("Unknown", undefined, groupId).weight).toBe(2);
  });
});
