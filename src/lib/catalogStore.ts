import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { firestore } from "./firebase";
import {
  DEFAULT_CONFIG,
  sanitizeCatalog,
  setCatalog,
  setGroupCatalog,
  getCatalog,
  type CatalogConfig,
  type Severity,
} from "./catalog";

const ref = () => doc(firestore, "settings", "catalog");
const groupRef = (groupId: string) => doc(firestore, "groups", groupId);

let loading: Promise<CatalogConfig> | null = null;
let savingPromise: Promise<void> = Promise.resolve();

export function waitForCatalogSaves(): Promise<void> {
  return savingPromise;
}

// Carga el catálogo base global y, si se indica groupId, el catálogo propio de ese grupo.
export async function loadCatalog(force = false, groupId?: string | null): Promise<CatalogConfig> {
  await savingPromise;
  if (!loading || force) {
    loading = getDoc(ref())
      .then((snap) => {
        const cfg = snap.exists() ? sanitizeCatalog(snap.data()) : DEFAULT_CONFIG;
        setCatalog(cfg);
        return cfg;
      })
      .catch((e) => {
        loading = null;
        throw e;
      });
  }
  const baseCfg = await loading;

  if (groupId) {
    const grpSnap = await getDoc(groupRef(groupId));
    if (grpSnap.exists()) {
      const grpData = grpSnap.data();
      if (grpData?.catalog) {
        const grpCfg = sanitizeCatalog(grpData.catalog);
        setGroupCatalog(groupId, grpCfg);
        return grpCfg;
      }
    }
    return getCatalog(groupId) || baseCfg;
  }

  return baseCfg;
}

export async function saveCatalog(cfg: CatalogConfig, editorEmail: string, groupId?: string | null) {
  // JSON elimina los `undefined`, que Firestore no acepta.
  const clean = JSON.parse(JSON.stringify(cfg)) as CatalogConfig;

  if (groupId) {
    setGroupCatalog(groupId, clean);
    const writeOp = savingPromise.then(() =>
      updateDoc(groupRef(groupId), {
        catalog: clean,
        catalogUpdatedAt: Date.now(),
        catalogUpdatedBy: editorEmail,
      })
    );
    savingPromise = writeOp.catch(() => {});
    await writeOp;
    return;
  }

  setCatalog(clean);
  loading = Promise.resolve(clean);
  const writeOp = savingPromise.then(() =>
    setDoc(ref(), { ...clean, updatedAt: Date.now(), updatedBy: editorEmail })
  );
  savingPromise = writeOp.catch(() => {});
  await writeOp;
}

export type { Severity };
