import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

// Config pública del proyecto web (no es un secreto); se puede sobreescribir con variables VITE_*.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? "AIzaSyC_LiPl1CgHd37e0wEfuAb-HxymQIWVAUg",
  authDomain: "tracksim-zero.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "tracksim-zero",
  storageBucket: "tracksim-zero.firebasestorage.app",
  messagingSenderId: "120711426085",
  appId: "1:120711426085:web:ea635636aeb265c5ce8fcc",
};

export const app: FirebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);

let _firestore: Firestore | null = null;
export function getDb(): Firestore {
  if (!_firestore) {
    _firestore = getFirestore(app);
  }
  return _firestore;
}

export const firestore: Firestore = getDb();
export const auth: Auth = getAuth(app);
