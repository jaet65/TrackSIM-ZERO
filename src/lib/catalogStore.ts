import { doc, getDoc, setDoc } from "firebase/firestore";
import { firestore } from "./firebase";
import { DEFAULT_CONFIG, DEFAULT_WEIGHTS, SEVERITY_ORDER, setCatalog, type CatalogConfig, type Entry, type Severity } from "./catalog";

const ref = () => doc(firestore, "settings", "catalog");

let loading: Promise<CatalogConfig> | null = null;

function sanitize(raw: unknown): CatalogConfig {
  const r = raw as Partial<CatalogConfig> | undefined;
  const weights = { ...DEFAULT_WEIGHTS };
  for (const s of SEVERITY_ORDER) {
    const w = r?.weights?.[s];
    if (typeof w === "number" && w >= 0) weights[s] = w;
  }
  const entries = Array.isArray(r?.entries)
    ? (r.entries as Entry[]).filter((e) => e && typeof e.name === "string" && SEVERITY_ORDER.includes(e.severity))
    : DEFAULT_CONFIG.entries;
  return { weights, entries };
}

// Carga el catálogo una sola vez por sesión; si aún no se ha editado, se usa el catálogo por defecto.
export function loadCatalog(force = false): Promise<CatalogConfig> {
  if (!loading || force) {
    loading = getDoc(ref())
      .then((snap) => {
        const cfg = snap.exists() ? sanitize(snap.data()) : DEFAULT_CONFIG;
        setCatalog(cfg);
        return cfg;
      })
      .catch((e) => {
        loading = null;
        throw e;
      });
  }
  return loading;
}

export async function saveCatalog(cfg: CatalogConfig, editorEmail: string) {
  // JSON elimina los `undefined`, que Firestore no acepta.
  const clean = JSON.parse(JSON.stringify(cfg)) as CatalogConfig;
  await setDoc(ref(), { ...clean, updatedAt: Date.now(), updatedBy: editorEmail });
  setCatalog(clean);
  loading = Promise.resolve(clean);
}

export type { Severity };
