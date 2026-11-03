import { describe, expect, it } from "vitest";
import { decodeCsv } from "./parse";

describe("decodeCsv", () => {
  it("decodifica UTF-8 y elimina el BOM", () => {
    const bytes = new TextEncoder().encode("\uFEFFconductor,año");
    expect(decodeCsv(bytes.buffer as ArrayBuffer)).toBe("conductor,año");
  });

  it("recurre a windows-1252 cuando no es UTF-8 válido", () => {
    const bytes = new Uint8Array([0x61, 0xf1, 0x6f]); // "año" en windows-1252
    expect(decodeCsv(bytes.buffer)).toBe("año");
  });
});
