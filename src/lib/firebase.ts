import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  persistentSingleTabManager,
  getDoc,
  getDocFromCache,
  getDocFromServer,
  getDocs,
  getDocsFromCache,
  getDocsFromServer,
  onSnapshotsInSync,
  type Firestore,
  type DocumentReference,
  type DocumentSnapshot,
  type Query,
  type QuerySnapshot,
  type DocumentData,
} from "firebase/firestore";

// Config pública del proyecto web (no es un secreto); se puede sobreescribir con variables VITE_*.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? "AIzaSyC_LiPl1CgHd37e0wEfuAb-HxymQIWVAUg",
  authDomain: "tracksim-zero.web.app",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "tracksim-zero",
  storageBucket: "tracksim-zero.firebasestorage.app",
  messagingSenderId: "120711426085",
  appId: "1:120711426085:web:ea635636aeb265c5ce8fcc",
};

export const app: FirebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);

let _firestore: Firestore | null = null;
export function getDb(): Firestore {
  if (!_firestore) {
    try {
      // Habilitar caché persistente en IndexedDB con soporte multi-pestaña (Web y Electron)
      _firestore = initializeFirestore(app, {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
        }),
      });
    } catch {
      try {
        _firestore = initializeFirestore(app, {
          localCache: persistentLocalCache({
            tabManager: persistentSingleTabManager({ forceOwnership: true }),
          }),
        });
      } catch {
        _firestore = getFirestore(app);
      }
    }
  }
  return _firestore;
}

export const firestore: Firestore = getDb();
export const auth: Auth = getAuth(app);

// ---------------------------------------------------------------------------
// Estado de Conectividad y Cola de Sincronización Offline / Red Lenta
// ---------------------------------------------------------------------------
export type NetworkStatus = {
  online: boolean;
  degraded: boolean;       // true cuando la red está tan lenta que se usó caché local o hubo timeout
  pendingWrites: number;   // escrituras guardadas en IndexedDB pendientes de confirmación en la nube
  lastSyncedAt: number | null;
};

let networkState: NetworkStatus = {
  online: typeof navigator !== "undefined" ? navigator.onLine : true,
  degraded: false,
  pendingWrites: 0,
  lastSyncedAt: Date.now(),
};

const listeners = new Set<(state: NetworkStatus) => void>();

function notifyNetworkListeners() {
  const snapshot = { ...networkState };
  for (const fn of listeners) {
    try {
      fn(snapshot);
    } catch {}
  }
}

export function subscribeNetworkStatus(listener: (state: NetworkStatus) => void): () => void {
  listeners.add(listener);
  listener({ ...networkState });
  return () => {
    listeners.delete(listener);
  };
}

function dispatchFirestoreDataRefreshed() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("tracksim:firestore-data-refreshed"));
  }
}

function docDataChanged<T>(cached: DocumentSnapshot<T>, fresh: DocumentSnapshot<T>): boolean {
  return cached.exists() !== fresh.exists() || JSON.stringify(cached.data()) !== JSON.stringify(fresh.data());
}

function queryDataChanged<T>(cached: QuerySnapshot<T>, fresh: QuerySnapshot<T>): boolean {
  if (cached.size !== fresh.size) return true;
  const cachedDocs = new Map(cached.docs.map((snapshot) => [snapshot.id, JSON.stringify(snapshot.data())]));
  return fresh.docs.some((snapshot) => cachedDocs.get(snapshot.id) !== JSON.stringify(snapshot.data()));
}

function notifyIfDocChanged<T>(cached: DocumentSnapshot<T>, fresh: DocumentSnapshot<T>) {
  if (fresh.metadata.fromCache) return;
  markHealthyConnection();
  if (docDataChanged(cached, fresh)) dispatchFirestoreDataRefreshed();
}

function notifyIfQueryChanged<T>(cached: QuerySnapshot<T>, fresh: QuerySnapshot<T>) {
  if (!fresh.metadata.fromCache) {
    markHealthyConnection();
    if (queryDataChanged(cached, fresh)) dispatchFirestoreDataRefreshed();
  }
}

let degradedResetTimer: ReturnType<typeof setTimeout> | null = null;

function markDegradedConnection() {
  if (!networkState.degraded) {
    networkState.degraded = true;
    notifyNetworkListeners();
  }
  if (degradedResetTimer) clearTimeout(degradedResetTimer);
  degradedResetTimer = setTimeout(() => {
    if (networkState.online && networkState.pendingWrites === 0) {
      networkState.degraded = false;
      notifyNetworkListeners();
    }
  }, 15000);
}

function markHealthyConnection() {
  networkState.lastSyncedAt = Date.now();
  if (networkState.degraded && networkState.pendingWrites === 0) {
    networkState.degraded = false;
    notifyNetworkListeners();
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    networkState.online = true;
    notifyNetworkListeners();
    dispatchFirestoreDataRefreshed();
  });
  window.addEventListener("focus", dispatchFirestoreDataRefreshed);
  window.addEventListener("offline", () => {
    networkState.online = false;
    notifyNetworkListeners();
  });

  try {
    onSnapshotsInSync(firestore, () => {
      if (networkState.online && networkState.pendingWrites === 0) {
        networkState.lastSyncedAt = Date.now();
        notifyNetworkListeners();
      }
    });
  } catch {}
}

/**
 * Lectura resiliente de un documento:
 * - Si el navegador está offline, consulta directamente la caché IndexedDB.
 * - Si está online pero la conexión es mala/inestable y tarda más de `timeoutMs`,
 *   recurre de inmediato a la caché local para no congelar la interfaz.
 */
export async function safeGetDoc<T = DocumentData>(
  ref: DocumentReference<T>,
  timeoutMs = 2800
): Promise<DocumentSnapshot<T>> {
  const isOffline = typeof navigator !== "undefined" && !navigator.onLine;

  if (isOffline) {
    try {
      return await getDocFromCache(ref);
    } catch {
      // Si no existe en caché local, continuar con getDoc o devolver snapshot vacío sintético
    }
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<"TIMEOUT">((resolve) => {
    timer = setTimeout(() => resolve("TIMEOUT"), isOffline ? 350 : timeoutMs);
  });

  try {
    const netPromise = getDoc(ref);
    const winner = await Promise.race([netPromise, timeoutPromise]);
    if (timer) clearTimeout(timer);

    if (winner !== "TIMEOUT") {
      if (!winner.metadata.fromCache) {
        markHealthyConnection();
      } else if (typeof navigator === "undefined" || navigator.onLine) {
        getDocFromServer(ref).then((fresh) => notifyIfDocChanged(winner, fresh)).catch(() => {});
      }
      return winner;
    }

    // Timeout por conexión lenta: intentar leer de la caché local IndexedDB
    markDegradedConnection();
    try {
      const cached = await getDocFromCache(ref);
      netPromise.then((fresh) => notifyIfDocChanged(cached, fresh)).catch(() => {});
      return cached;
    } catch {
      // Si el documento nunca ha estado en caché (p. ej. verificando si un ID nuevo ya existe),
      // devolver un objeto compatible con DocumentSnapshot indicando exists() = false
      // mientras la promesa original sigue resolviéndose en segundo plano.
      netPromise.catch(() => {});
      return {
        exists: () => false,
        data: () => undefined,
        id: ref.id,
        ref,
        metadata: { fromCache: true, hasPendingWrites: false, isEqual: () => false },
        get: () => undefined,
      } as unknown as DocumentSnapshot<T>;
    }
  } catch {
    if (timer) clearTimeout(timer);
    markDegradedConnection();
    try {
      return await getDocFromCache(ref);
    } catch {
      return {
        exists: () => false,
        data: () => undefined,
        id: ref.id,
        ref,
        metadata: { fromCache: true, hasPendingWrites: false, isEqual: () => false },
        get: () => undefined,
      } as unknown as DocumentSnapshot<T>;
    }
  }
}

/**
 * Lectura ultra-rápida y resiliente de una colección o consulta (Query) con estrategia Cache-First:
 * 1. Intenta leer primero de la caché persistente IndexedDB local. Si ya hay datos en caché,
 *    los devuelve de inmediato (0 ms) para que la pantalla no muestre spinners innecesarios.
 * 2. En segundo plano o si no hay caché local, consulta la red con timeout resiliente.
 */
export async function safeGetDocs<T = DocumentData>(
  q: Query<T>,
  timeoutMs = 2500
): Promise<QuerySnapshot<T>> {
  const isOffline = typeof navigator !== "undefined" && !navigator.onLine;

  if (isOffline) {
    try {
      return await getDocsFromCache(q);
    } catch {}
  }

  // 1. Probar caché local primero (instantáneo)
  try {
    const cached = await getDocsFromCache(q);
    if (!cached.empty) {
      // Revalidación silenciosa en segundo plano para refrescar caché local
      getDocsFromServer(q).then((fresh) => notifyIfQueryChanged(cached, fresh)).catch(() => {});
      return cached;
    }
  } catch {}

  // 2. Si no hay caché o estaba vacía, consultar la red con timeout
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<"TIMEOUT">((resolve) => {
    timer = setTimeout(() => resolve("TIMEOUT"), isOffline ? 300 : timeoutMs);
  });

  try {
    const netPromise = getDocs(q);
    const winner = await Promise.race([netPromise, timeoutPromise]);
    if (timer) clearTimeout(timer);

    if (winner !== "TIMEOUT") {
      if (!winner.metadata.fromCache) {
        markHealthyConnection();
      }
      return winner;
    }

    // Si la conexión es muy lenta, intentar caché nuevamente antes de fallar
    markDegradedConnection();
    try {
      return await getDocsFromCache(q);
    } catch {
      return await netPromise;
    }
  } catch (err) {
    if (timer) clearTimeout(timer);
    markDegradedConnection();
    try {
      return await getDocsFromCache(q);
    } catch {
      throw err;
    }
  }
}

/**
 * Escritura no bloqueante con cola persistente:
 * En Firestore con `persistentLocalCache`, `setDoc` / `updateDoc` / `batch.commit()`
 * guarda los cambios inmediatamente en IndexedDB y los encola para sincronizar con la nube,
 * pero su Promesa no se resuelve hasta recibir el ACK del servidor.
 * Con `fastWrite`, esperamos hasta `timeoutMs` por el ACK; si el internet está lento o caído,
 * liberamos la interfaz para que el usuario siga trabajando mientras Firestore sincroniza en segundo plano.
 */
export async function fastWrite<T>(writePromise: Promise<T>, timeoutMs = 2500): Promise<T | undefined> {
  networkState.pendingWrites += 1;
  notifyNetworkListeners();

  writePromise
    .then(() => {
      networkState.pendingWrites = Math.max(0, networkState.pendingWrites - 1);
      networkState.lastSyncedAt = Date.now();
      if (networkState.pendingWrites === 0 && networkState.online) {
        networkState.degraded = false;
      }
      notifyNetworkListeners();
    })
    .catch((err) => {
      networkState.pendingWrites = Math.max(0, networkState.pendingWrites - 1);
      notifyNetworkListeners();
      console.warn("[Firestore Sync] Error en escritura en segundo plano:", err);
    });

  const isOffline = typeof navigator !== "undefined" && !navigator.onLine;
  const effectiveTimeout = isOffline ? 250 : timeoutMs;

  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutSentinel = new Promise<"QUEUED_OFFLINE">((resolve) => {
    timer = setTimeout(() => resolve("QUEUED_OFFLINE"), effectiveTimeout);
  });

  const result = await Promise.race([writePromise, timeoutSentinel]);
  if (timer) clearTimeout(timer);

  if (result === "QUEUED_OFFLINE") {
    markDegradedConnection();
    return undefined;
  }

  return result;
}
