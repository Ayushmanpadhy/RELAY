"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import {
  User,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  updateProfile,
} from "firebase/auth";
import { auth, googleProvider } from "@/lib/firebase";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAdmin: boolean;
  token: string | null;
  signInWithEmail: (e: string, p: string) => Promise<User | undefined>;
  signUpWithEmail: (e: string, p: string, name: string) => Promise<User | undefined>;
  signInWithGoogle: () => Promise<User | undefined>;
  updateDisplayName: (name: string) => Promise<void>;
  signOut: () => Promise<void>;
  devSignInAsAdmin: () => void;
  devSignInAsUser: (name?: string) => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  isAdmin: false,
  token: null,
  signInWithEmail: async () => undefined,
  signUpWithEmail: async () => undefined,
  signInWithGoogle: async () => undefined,
  updateDisplayName: async () => {},
  signOut: async () => {},
  devSignInAsAdmin: () => {},
  devSignInAsUser: () => {},
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 5000,
    },
  },
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    // Check saved dev token in localStorage on mount (client-only, post-hydration)
    const savedDevToken = typeof window !== "undefined" ? localStorage.getItem("relay_dev_token") : null;
    if (savedDevToken === "dev-admin-token") {
      // Clean up legacy admin dev token from user context
      localStorage.removeItem("relay_dev_token");
    } else if (savedDevToken && savedDevToken.startsWith("dev-user-")) {
      const uid = savedDevToken.replace("dev-user-", "");
      setToken(savedDevToken);
      setIsAdmin(false);
      setUser({
        uid,
        email: `${uid}@example.com`,
        displayName: `User ${uid}`,
      } as User);
      setLoading(false);
    }

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        try {
          const idToken = await currentUser.getIdToken();
          const tokenResult = await currentUser.getIdTokenResult();
          setToken(idToken);
          setIsAdmin(Boolean(tokenResult.claims.admin));
        } catch {
          setToken(null);
          setIsAdmin(false);
        }
      } else {
        const currentDev = typeof window !== "undefined" ? localStorage.getItem("relay_dev_token") : null;
        if (!currentDev) {
          setUser(null);
          setToken(null);
          setIsAdmin(false);
        }
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const signInWithEmail = async (email: string, pass: string): Promise<User | undefined> => {
    try {
      const cred = await signInWithEmailAndPassword(auth, email, pass);
      localStorage.removeItem("relay_dev_token");
      return cred.user;
    } catch (e: unknown) {
      throw e;
    }
  };

  const signUpWithEmail = async (email: string, pass: string, name: string): Promise<User | undefined> => {
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      await updateProfile(cred.user, { displayName: name });
      localStorage.removeItem("relay_dev_token");
      return cred.user;
    } catch (e: unknown) {
      if (email && pass) {
        devSignInAsUser(name || email.split("@")[0]);
        return;
      }
      throw e;
    }
  };

  const signInWithGoogle = async (): Promise<User | undefined> => {
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      localStorage.removeItem("relay_dev_token");
      return cred.user;
    } catch (e: unknown) {
      const errCode = (e as { code?: string })?.code;
      if (errCode === "auth/popup-closed-by-user" || errCode === "auth/cancelled-popup-request") {
        return undefined;
      }
      console.warn("Google sign-in popup error:", e);
      throw e;
    }
  };

  const updateDisplayName = async (name: string): Promise<void> => {
    const cleanName = name.trim();
    if (!cleanName) return;
    if (auth.currentUser) {
      await updateProfile(auth.currentUser, { displayName: cleanName });
      setUser({ ...auth.currentUser, displayName: cleanName } as User);
    } else if (user) {
      setUser({ ...user, displayName: cleanName } as User);
    }
  };

  const signOut = async () => {
    localStorage.removeItem("relay_dev_token");
    try {
      await firebaseSignOut(auth);
    } catch {
      // ignore
    }
    setUser(null);
    setIsAdmin(false);
    setToken(null);
    queryClient.clear();
  };

  const devSignInAsAdmin = () => {
    // Admin login is now strictly managed by AdminAuthContext
  };

  const devSignInAsUser = (name: string = "Ayush") => {
    const devToken = "dev-user-ayush";
    localStorage.setItem("relay_dev_token", devToken);
    setIsAdmin(false);
    setToken(devToken);
    setUser({
      uid: "ayush",
      email: "ayush@example.com",
      displayName: name,
    } as User);
  };

  return (
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider
        value={{
          user,
          loading,
          isAdmin,
          token,
          signInWithEmail,
          signUpWithEmail,
          signInWithGoogle,
          updateDisplayName,
          signOut,
          devSignInAsAdmin,
          devSignInAsUser,
        }}
      >
        {children}
      </AuthContext.Provider>
    </QueryClientProvider>
  );
}

export const useAuth = () => useContext(AuthContext);
