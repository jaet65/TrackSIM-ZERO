import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  collection,
  doc,
  query,
  orderBy,
  where,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  safeGetDoc,
  safeGetDocs,
  fastWrite,
  loadExercises,
  getExercises,
  getExerciseEnvironments,
  sanitizeExercises,
  setGroupExercises,
  setGroupTypeMemory,
  removeGroupExercises,
  hasPendingExerciseSave,
  waitForExerciseSaves,
  loadCatalog,
  waitForCatalogSaves,
  withCurrentScore,
} = vi.hoisted(() => {
  const batchSet = vi.fn();
  const batchUpdate = vi.fn();
  const batchDelete = vi.fn();
  const batchCommit = vi.fn(() => Promise.resolve());
  return {
    collection: vi.fn((_db: unknown, name: string) => ({ name })),
    doc: vi.fn((first: { name?: string; id?: string } | unknown, collectionName?: string, id?: string) => ({
      parent: first,
      collectionName,
      id,
    })),
    query: vi.fn((source: unknown, ...constraints: unknown[]) => ({ source, constraints })),
    orderBy: vi.fn((...args: unknown[]) => ({ type: "orderBy", args })),
    where: vi.fn((...args: unknown[]) => ({ type: "where", args })),
    setDoc: vi.fn(() => Promise.resolve()),
    updateDoc: vi.fn(() => Promise.resolve()),
    deleteDoc: vi.fn(() => Promise.resolve()),
    writeBatch: vi.fn(() => ({ set: batchSet, update: batchUpdate, delete: batchDelete, commit: batchCommit })),
    safeGetDoc: vi.fn(),
    safeGetDocs: vi.fn(),
    fastWrite: vi.fn((write: Promise<unknown>) => write),
    loadExercises: vi.fn(() => Promise.resolve({})),
    getExercises: vi.fn(() => ({})),
    getExerciseEnvironments: vi.fn(() => ({})),
    sanitizeExercises: vi.fn((value: {
      phases?: Record<string, string[]>;
      environments?: Record<string, string>;
      descriptions?: Record<string, string>;
    }) => ({
      phases: value?.phases ?? {},
      environments: value?.environments ?? {},
      descriptions: value?.descriptions ?? {},
    })),
    setGroupExercises: vi.fn(),
    setGroupTypeMemory: vi.fn(),
    removeGroupExercises: vi.fn(),
    hasPendingExerciseSave: vi.fn(() => false),
    waitForExerciseSaves: vi.fn(() => Promise.resolve()),
    loadCatalog: vi.fn(() => Promise.resolve({})),
    waitForCatalogSaves: vi.fn(() => Promise.resolve()),
    withCurrentScore: vi.fn((value: Record<string, unknown>) => ({
      ...value,
      score: 8,
      errorCount: 2,
      criticalCount: 1,
      errorScore: 7,
      telemetryScore: 9,
      marks: value.marks,
    })),
  };
});

vi.mock("firebase/firestore", () => ({
  collection,
  doc,
  query,
  orderBy,
  where,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
}));
vi.mock("./firebase", () => ({
  firestore: {},
  getDb: () => ({}),
  safeGetDoc,
  safeGetDocs,
  fastWrite,
}));
vi.mock("./db", () => ({ withCurrentScore }));
vi.mock("./exercises", () => ({
  loadExercises,
  getExercises,
  getExerciseEnvironments,
  sanitizeExercises,
  setGroupExercises,
  setGroupTypeMemory,
  removeGroupExercises,
  hasPendingExerciseSave,
  waitForExerciseSaves,
}));
vi.mock("./catalogStore", () => ({ loadCatalog, waitForCatalogSaves }));

import {
  createGroup,
  getActiveGroupId,
  getGroup,
  hydrateGroupRules,
  listGroups,
  setActiveGroupId,
  updateGroupDetails,
  updateGroupType,
  type GroupDoc,
} from "./groups";
import { removeGroupCatalog } from "./catalog";

const localStorageMock = () => {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: vi.fn((key: string) => values.delete(key)),
  };
};

describe("group helpers and persistence", () => {
  afterEach(() => {
    removeGroupCatalog("group-1");
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("localStorage", localStorageMock());
    safeGetDoc.mockResolvedValue({ id: "group-1", exists: () => false, data: () => undefined });
    safeGetDocs.mockResolvedValue({ empty: true, docs: [] });
    loadCatalog.mockResolvedValue({});
    loadExercises.mockResolvedValue({});
    getExercises.mockReturnValue({});
    getExerciseEnvironments.mockReturnValue({});
    sanitizeExercises.mockImplementation((value) => ({
      phases: value?.phases ?? {},
      environments: value?.environments ?? {},
      descriptions: value?.descriptions ?? {},
    }));
  });

  it("stores and clears the active group and hydrates group rules", () => {
    setActiveGroupId("group-1");
    expect(getActiveGroupId()).toBe("group-1");
    setActiveGroupId(null);
    expect(getActiveGroupId()).toBeNull();

    const group: GroupDoc = {
      id: "group-1",
      name: "Group",
      type: "curso",
      status: "open",
      createdAt: 1,
      createdBy: "Admin",
      createdByEmail: "admin@example.com",
      catalog: { weights: { CRITICO: 1, GRAVE: 2, MODERADO: 3, LEVE: 4 }, entries: [] },
      exercises: { phases: { "1": ["Ruta"] } },
    };
    hydrateGroupRules(group);

    expect(setGroupTypeMemory).toHaveBeenCalledWith("group-1", "curso");
    expect(setGroupExercises).toHaveBeenCalledWith("group-1", { "1": ["Ruta"] }, {}, {});
    expect(hasPendingExerciseSave).toHaveBeenCalledWith("group-1");
  });

  it("loads and hydrates group snapshots and returns null for missing groups", async () => {
    safeGetDoc.mockResolvedValueOnce({
      id: "group-1",
      exists: () => true,
      data: () => ({
        name: "Group",
        type: "curso",
        status: "open",
        createdAt: 1,
        createdBy: "Admin",
        createdByEmail: "admin@example.com",
      }),
    });

    await expect(getGroup("group-1")).resolves.toMatchObject({ id: "group-1", type: "curso" });
    safeGetDoc.mockResolvedValueOnce({ exists: () => false });
    await expect(getGroup("missing")).resolves.toBeNull();
  });

  it("creates a trimmed group with copied settings and selects it as active", async () => {
    getExercises.mockReturnValue({ "1": ["Route"] });
    getExerciseEnvironments.mockReturnValue({ route: "CARRETERA" });
    const group = await createGroup(
      "  New Group  ",
      "  Description  ",
      { name: "", email: "admin@example.com" },
      undefined,
      "curso"
    );

    expect(group).toMatchObject({
      name: "New Group",
      description: "Description",
      type: "curso",
      status: "open",
      createdBy: "admin@example.com",
      exercises: { phases: { "1": ["Route"] }, environments: { route: "CARRETERA" } },
    });
    expect(getActiveGroupId()).toBe(group.id);
    expect(setDoc).toHaveBeenCalledWith(
      expect.objectContaining({ collectionName: group.id }),
      group
    );
    await expect(createGroup("   ", "", { name: "Admin", email: "admin@example.com" })).rejects.toThrow(
      "El nombre del grupo no puede estar vacío."
    );
  });

  it("trims group updates and rejects blank names", async () => {
    await updateGroupDetails("group-1", "  Renamed  ", "  Updated  ");
    expect(updateDoc).toHaveBeenCalledWith(
      expect.objectContaining({ collectionName: "group-1" }),
      { name: "Renamed", description: "Updated" }
    );
    await updateGroupType("group-1", "curso");
    expect(updateDoc).toHaveBeenCalledWith(
      expect.objectContaining({ collectionName: "group-1" }),
      { type: "curso" }
    );
    await expect(updateGroupDetails("group-1", " ")).rejects.toThrow(
      "El nombre del grupo no puede estar vacío."
    );
  });

  it("lists groups in creation order and hydrates each group's rules", async () => {
    safeGetDocs.mockResolvedValue({
      docs: [
        {
          id: "group-1",
          data: () => ({
            name: "Group",
            type: "escuela",
            status: "open",
            createdAt: 10,
            createdBy: "Admin",
            createdByEmail: "admin@example.com",
          }),
        },
      ],
    });

    await expect(listGroups()).resolves.toMatchObject([{ id: "group-1", name: "Group" }]);
    expect(orderBy).toHaveBeenCalledWith("createdAt", "desc");
    expect(setGroupTypeMemory).toHaveBeenCalledWith("group-1", "escuela");
  });

});
