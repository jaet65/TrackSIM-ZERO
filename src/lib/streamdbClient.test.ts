import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkStreamDBStatus,
  countSimulatorSessions,
  extractSimulatorSessions,
  isElectronApp,
  saveStreamDBConfig,
} from "./streamdbClient";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("StreamDB bridge", () => {
  it("reports unavailable status and rejects desktop-only operations in the browser", async () => {
    expect(isElectronApp()).toBe(false);
    expect((await checkStreamDBStatus()).service).toBe("stopped");
    await expect(countSimulatorSessions("2026-01-01", "2026-01-02")).rejects.toThrow(
      "Solo disponible en la aplicación de escritorio."
    );
    await expect(extractSimulatorSessions("2026-01-01", "2026-01-02")).rejects.toThrow(
      "Solo disponible en la aplicación de escritorio."
    );
    expect(await saveStreamDBConfig({ host: "localhost" })).toMatchObject({ ok: false });
  });

  it("delegates status, configuration, count, and extraction to the Electron bridge", async () => {
    const bridge = {
      checkStatus: vi.fn().mockResolvedValue({ service: "running", db_connected: true }),
      saveConfig: vi.fn().mockResolvedValue({ ok: true }),
      countSessions: vi.fn().mockResolvedValue({ ok: true, total: 3 }),
      extractSessions: vi.fn().mockResolvedValue({ ok: true, extracted: 1, sessions: [] }),
    };
    vi.stubGlobal("window", { landerBridge: bridge });

    expect(isElectronApp()).toBe(true);
    expect(await checkStreamDBStatus()).toEqual({ service: "running", db_connected: true });
    expect(await saveStreamDBConfig({ host: "db.example", password: "secret" })).toEqual({ ok: true });
    expect(await countSimulatorSessions("2026-02-01", "2026-02-28", true)).toMatchObject({
      total: 3,
      fecha_inicio: "2026-02-01",
      fecha_fin: "2026-02-28",
    });
    expect(bridge.countSessions).toHaveBeenCalledWith({
      inicio: "2026-02-01",
      fin: "2026-02-28",
      anon: true,
    });
    expect(await extractSimulatorSessions("2026-02-01", "2026-02-28")).toMatchObject({
      ok: true,
      extracted: 1,
    });
    expect(bridge.extractSessions).toHaveBeenCalledWith({
      inicio: "2026-02-01",
      fin: "2026-02-28",
      anon: false,
      limit: 200,
    });
  });

  it("turns bridge failures into status errors and propagates operation errors", async () => {
    vi.stubGlobal("window", {
      landerBridge: {
        checkStatus: vi.fn().mockRejectedValue(new Error("offline")),
        saveConfig: vi.fn(),
        countSessions: vi.fn().mockResolvedValue({ ok: false, error: "bad range" }),
        extractSessions: vi.fn().mockResolvedValue({ ok: false }),
      },
    });

    expect(await checkStreamDBStatus()).toMatchObject({
      service: "stopped",
      db_connected: false,
      error: "offline",
    });
    await expect(countSimulatorSessions("x", "y")).rejects.toThrow("bad range");
    await expect(extractSimulatorSessions("x", "y")).rejects.toThrow("Error al extraer sesiones");
  });
});
