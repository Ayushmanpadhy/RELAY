"use client";

import React, { createContext, useContext, useEffect, useState, useTransition } from "react";
import { API_BASE_URL } from "@/lib/api";

interface AdminAuthContextType {
  token: string | null;
  adminEmail: string | null;
  isAdmin: boolean;
  loading: boolean;
  login: (email: string, pass: string) => Promise<void>;
  logout: () => void;
}

const AdminAuthContext = createContext<AdminAuthContextType>({
  token: null,
  adminEmail: null,
  isAdmin: false,
  loading: true,
  login: async () => {},
  logout: () => {},
});

export function AdminAuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [adminEmail, setAdminEmail] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [, startTransition] = useTransition();

  useEffect(() => {
    // Check saved admin token strictly from localStorage
    // Completely isolated from Firebase Client SDK auth
    try {
      const savedToken = typeof window !== "undefined" ? localStorage.getItem("relay_admin_token") : null;
      const savedEmail = typeof window !== "undefined" ? localStorage.getItem("relay_admin_email") : null;
      if (savedToken) {
        startTransition(() => {
          setToken(savedToken);
          setAdminEmail(savedEmail || "admin@gmail.com");
          setIsAdmin(true);
        });
      }
    } catch {
      // localStorage may fail in restricted sandbox
    } finally {
      startTransition(() => {
        setLoading(false);
      });
    }
  }, []);

  const login = async (email: string, pass: string) => {
    const cleanEmail = email.trim();
    const res = await fetch(`${API_BASE_URL}/admin/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: cleanEmail,
        password: pass,
      }),
    });

    if (!res.ok) {
      let errorMsg = "Invalid administrator credentials. Access restricted.";
      try {
        const errJson = await res.json();
        if (errJson?.detail?.error?.message) {
          errorMsg = errJson.detail.error.message;
        } else if (typeof errJson?.detail === "string") {
          errorMsg = errJson.detail;
        }
      } catch {
        // ignore
      }
      throw new Error(errorMsg);
    }

    const data = await res.json();
    const mintedToken = data.token;
    const finalEmail = data.email || cleanEmail;

    try {
      localStorage.setItem("relay_admin_token", mintedToken);
      localStorage.setItem("relay_admin_email", finalEmail);
    } catch {
      // ignore
    }

    setToken(mintedToken);
    setAdminEmail(finalEmail);
    setIsAdmin(true);
  };

  const logout = () => {
    try {
      localStorage.removeItem("relay_admin_token");
      localStorage.removeItem("relay_admin_email");
    } catch {
      // ignore
    }
    setToken(null);
    setAdminEmail(null);
    setIsAdmin(false);
  };

  return (
    <AdminAuthContext.Provider
      value={{
        token,
        adminEmail,
        isAdmin,
        loading,
        login,
        logout,
      }}
    >
      {children}
    </AdminAuthContext.Provider>
  );
}

export const useAdminAuth = () => useContext(AdminAuthContext);
