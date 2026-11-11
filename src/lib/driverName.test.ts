import { describe, expect, it } from "vitest";
import { autoAccentDriverName } from "./driverName";

describe("autoAccentDriverName", () => {
  it("agrega tildes automáticamente a nombres y apellidos conocidos", () => {
    expect(autoAccentDriverName("SAUL PACHECO ROQUE")).toBe("Saúl Pacheco Roque");
    expect(autoAccentDriverName("LEONARDO ISAI OLVERA RIVERA")).toBe("Leonardo Isaí Olvera Rivera");
    expect(autoAccentDriverName("JUAN CARLOS ESCOBAR VIDAURE")).toBe("Juan Carlos Escobar Vidaure");
    expect(autoAccentDriverName("JUAN MANUEL DAVILA IBARRA")).toBe("Juan Manuel Dávila Ibarra");
    expect(autoAccentDriverName("RAFAEL AGUILAR DE JESUS")).toBe("Rafael Aguilar de Jesús");
    expect(autoAccentDriverName("EDUARDO RIVERA RAMIREZ")).toBe("Eduardo Rivera Ramírez");
    expect(autoAccentDriverName("LUIS PENA MARTINEZ")).toBe("Luis Peña Martínez");
    expect(autoAccentDriverName("MARCO ANTONIO CRUZ AGUIRRE")).toBe("Marco Antonio Cruz Aguirre");
  });

  it("respeta partículas como 'de' o 'del'", () => {
    expect(autoAccentDriverName("RAFAEL AGUILAR DE JESUS")).toBe("Rafael Aguilar de Jesús");
    expect(autoAccentDriverName("DE LA MORA")).toBe("De la Mora");
  });

  it("preserva acentos si ya vienen en el nombre original", () => {
    expect(autoAccentDriverName("Ángel Hernández")).toBe("Ángel Hernández");
    expect(autoAccentDriverName("José Peña")).toBe("José Peña");
  });

  it("maneja nombres con mayúsculas y minúsculas mixtas", () => {
    expect(autoAccentDriverName("maria gonzalez")).toBe("María González");
    expect(autoAccentDriverName("VICTOR PEREZ")).toBe("Víctor Pérez");
    expect(autoAccentDriverName("cesar diaz")).toBe("César Díaz");
  });
});

