import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseBackupPackage } from "./backupRestore";

const {
  collection,
  doc,
  query,
  writeBatch,
  safeGetDoc,
  safeGetDocs,
  fastWrite,
  batchSet,
  batchCommit,
} = vi.hoisted(() => {
  const batchSet = vi.fn();
  const batchCommit = vi.fn(() => Promise.resolve());
  return {
    collection: vi.fn((_db: unknown, name: string) => ({ name })),
    doc: vi.fn((first: { name?: string; id?: string } | unknown, name?: string, id?: string) => ({
      parent: first,
      collectionName: name,
      id,
    })),
    query: vi.fn((collectionRef: { name: string }) => collectionRef),
    writeBatch: vi.fn(() => ({ set: batchSet, update: vi.fn(), delete: vi.fn(), commit: batchCommit })),
    safeGetDoc: vi.fn(),
    safeGetDocs: vi.fn(),
    fastWrite: vi.fn((write: Promise<unknown>) => write),
    batchSet,
    batchCommit,
  };
});

vi.mock("firebase/firestore", () => ({ collection, doc, query, writeBatch }));
vi.mock("./firebase", () => ({
  getDb: () => ({}),
  safeGetDoc,
  safeGetDocs,
  fastWrite,
}));

import { createDatabaseBackup, restoreDatabaseBackup } from "./backupRestore";

const snapshot = (docs: Array<{ id: string; data: () => unknown }>) => ({ docs });
const backup: DatabaseBackupPackage = {
  metadata: {
    version: "1.0.0",
    timestamp: 1,
    dateIso: "1970-01-01T00:00:00.001Z",
    source: "TrackSIM PRO",
    stats: { evaluationsCount: 1, groupsCount: 1, settingsIncluded: true },
  },
  evaluations: [{ id: "eval-1", data: { score: 8 } as DatabaseBackupPackage["evaluations"][number]["data"] }],
  groups: [{ id: "group-1", data: { name: "Group" } as DatabaseBackupPackage["groups"][number]["data"] }],
  settings: {
    catalog: { weights: { CRITICO: 1, GRAVE: 2, MODERADO: 3, LEVE: 4 }, entries: [] },
    exercises: { phases: { "1": ["Ruta"] } },
  },
};

describe("database backup and restore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    batchCommit.mockResolvedValue(undefined);
  });

  it("exports evaluations, groups, and optional global settings with accurate metadata", async () => {
    safeGetDocs
      .mockResolvedValueOnce(snapshot([{ id: "eval-1", data: () => ({ score: 8 }) }]))
      .mockResolvedValueOnce(snapshot([{ id: "group-1", data: () => ({ name: "Group" }) }]));
    safeGetDoc
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ entries: [] }) })
      .mockResolvedValueOnce({ exists: () => false });

    const result = await createDatabaseBackup();
    expect(result.metadata.stats).toEqual({
      evaluationsCount: 1,
      groupsCount: 1,
      settingsIncluded: true,
    });
    expect(result.evaluations).toEqual([{ id: "eval-1", data: { score: 8 } }]);
    expect(result.groups).toEqual([{ id: "group-1", data: { name: "Group" } }]);
    expect(result.settings.catalog).toEqual({ entries: [] });
    expect(result.settings.exercises).toBeUndefined();
  });

  it("rejects malformed backup input before issuing writes", async () => {
    await expect(restoreDatabaseBackup({} as DatabaseBackupPackage)).rejects.toThrow(
      "El archivo proporcionado no tiene el formato válido de respaldo de TrackSIM PRO."
    );
    expect(writeBatch).not.toHaveBeenCalled();
  });

  it("restores collections and settings and reports progress for each stage", async () => {
    const progress = vi.fn();
    await expect(restoreDatabaseBackup(backup, progress)).resolves.toEqual({
      evaluationsRestored: 1,
      groupsRestored: 1,
    });

    expect(batchSet).toHaveBeenCalledTimes(4);
    expect(batchCommit).toHaveBeenCalledTimes(4);
    expect(progress).toHaveBeenCalledWith(0, 1, "Restaurando grupos de trabajo…");
    expect(progress).toHaveBeenCalledWith(1, 1, "Grupos restaurados: 1/1");
    expect(progress).toHaveBeenCalledWith(0, 1, "Restaurando evaluaciones y telemetrías…");
    expect(progress).toHaveBeenCalledWith(1, 1, "Evaluaciones restauradas: 1/1");
  });

  it("splits large restores into safe batches", async () => {
    const largeBackup = {
      ...backup,
      groups: [],
      settings: {},
      evaluations: Array.from({ length: 401 }, (_, index) => ({
        id: `eval-${index}`,
        data: {} as DatabaseBackupPackage["evaluations"][number]["data"],
      })),
    };

    await expect(restoreDatabaseBackup(largeBackup)).resolves.toEqual({
      evaluationsRestored: 401,
      groupsRestored: 0,
    });
    expect(batchCommit).toHaveBeenCalledTimes(2);
    expect(batchSet).toHaveBeenCalledTimes(401);
  });
});
