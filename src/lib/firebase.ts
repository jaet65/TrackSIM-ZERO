import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Config pública del proyecto web (no es un secreto); se puede sobreescribir con variables VITE_*.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? "AIzaSyC_LiPl1CgHd37e0wEfuAb-HxymQIWVAUg",
  authDomain: "tracksim-zero.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "tracksim-zero",
  storageBucket: "tracksim-zero.firebasestorage.app",
  messagingSenderId: "120711426085",
  appId: "1:120711426085:web:ea635636aeb265c5ce8fcc",
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const firestore = getFirestore(app);
export const auth = getAuth(app);
