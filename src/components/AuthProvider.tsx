import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import { auth } from "../lib/firebase";
import { ALLOWED_DOMAIN, isAllowedEmail } from "../lib/config";

type AuthState = {
  user: User | null;
  loading: boolean;
  error: string;
  signIn: () => Promise<void>;
  logout: () => Promise<void>;
};

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(
    () =>
      onAuthStateChanged(auth, async (u) => {
        // Las reglas de Firestore son la barrera real; esto solo evita mostrar una app que no podrá leer datos.
        if (u && !isAllowedEmail(u.email, u.emailVerified)) {
          await signOut(auth);
          setError(`Solo se permiten cuentas @${ALLOWED_DOMAIN}`);
          u = null;
        }
        setUser(u);
        setLoading(false);
      }),
    [],
  );

  const signIn = async () => {
    setError("");
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ hd: ALLOWED_DOMAIN, prompt: "select_account" });
    try {
      await signInWithPopup(auth, provider);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code !== "auth/popup-closed-by-user" && code !== "auth/cancelled-popup-request") setError((e as Error).message);
    }
  };

  return <Ctx.Provider value={{ user, loading, error, signIn, logout: () => signOut(auth) }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth fuera de AuthProvider");
  return v;
}
