import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG, getCatalog } from "./catalog";

const { safeGetDoc, fastWrite, setDoc, updateDoc } = vi.hoisted(() => ({
  safeGetDoc: vi.fn(),
  fastWrite: vi.fn((write: Promise<unknown>) => write),
  setDoc: vi.fn(() => Promise.resolve()),
  updateDoc: vi.fn(() => Promise.resolve()),
}));

vi.mock("firebase/firestore", () => ({
  doc: vi.fn((_db: unknown, collectionName: string, id?: string) => ({ collectionName, id })),
  setDoc,
  updateDoc,
}));

vi.mock("./firebase", () => ({
  firestore: {},
  safeGetDoc,
  fastWrite,
}));

import { loadCatalog, saveCatalog, waitForCatalogSaves } from "./catalogStore";

describe("catalog persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    safeGetDoc.mockResolvedValue({ exists: () => false, data: () => undefined });
  });

  it("loads the default catalog when the global document does not exist", async () => {
    await expect(loadCatalog(true)).resolves.toBe(DEFAULT_CONFIG);
    expect(safeGetDoc).toHaveBeenCalledWith({ collectionName: "settings", id: "catalog" });
  });

  it("sanitizes loaded catalog data and returns a group-specific catalog when present", async () => {
    safeGetDoc.mockImplementation(async (ref: { collectionName: string }) =>
      ref.collectionName === "settings"
        ? { exists: () => true, data: () => ({ weights: { GRAVE: 8 }, entries: [] }) }
        : {
            exists: () => true,
            data: () => ({ catalog: { weights: { LEVE: 2 }, entries: [{ name: "Group", severity: "LEVE" }] } }),
          }
    );

    const groupCatalog = await loadCatalog(true, "group-1");
    expect(groupCatalog.weights).toMatchObject({ GRAVE: 3, LEVE: 2 });
    expect(groupCatalog.entries).toEqual([{ name: "Group", severity: "LEVE" }]);
    expect(getCatalog().weights.GRAVE).toBe(8);
    expect(getCatalog("group-1")).toEqual(groupCatalog);
  });

  it("updates group memory and persists group and global settings", async () => {
    const groupConfig = {
      weights: { CRITICO: 1, GRAVE: 2, MODERADO: 3, LEVE: 4 },
      entries: [{ name: "Group entry", severity: "GRAVE" as const, aliases: ["Alias"], points: undefined }],
    };
    await saveCatalog(groupConfig, "editor@example.com", "group-2");
    await waitForCatalogSaves();

    expect(getCatalog("group-2").entries).toEqual([{ name: "Group entry", severity: "GRAVE", aliases: ["Alias"] }]);
    expect(updateDoc).toHaveBeenCalledWith(
      { collectionName: "groups", id: "group-2" },
      expect.objectContaining({ catalog: expect.any(Object), catalogUpdatedBy: "editor@example.com" })
    );

    await saveCatalog(groupConfig, "editor@example.com");
    await waitForCatalogSaves();
    expect(getCatalog()).toEqual(groupConfig);
    expect(setDoc).toHaveBeenCalledWith(
      { collectionName: "settings", id: "catalog" },
      expect.objectContaining({ updatedBy: "editor@example.com" })
    );
  });
});
