"use client";

import React, { useEffect, useState, Suspense } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AdminAuthProvider, useAdminAuth } from "@/context/AdminAuthContext";
import {
  LayoutDashboard,
  Layers,
  Server,
  Settings,
  Users,
  LogOut,
  Radio,
  ShieldAlert,
  Lock,
} from "lucide-react";

function AdminNav() {
  const pathname = usePathname();
  const router = useRouter();

  const navItems = [
    { label: "Overview", href: "/admin", icon: LayoutDashboard },
    { label: "Submissions", href: "/admin/submissions", icon: Layers },
    { label: "Nodes & Providers", href: "/admin/nodes", icon: Server },
    { label: "Settings", href: "/admin/settings", icon: Settings },
    { label: "Users", href: "/admin/users", icon: Users },
  ];

  return (
    <nav className="p-4 space-y-1">
      {navItems.map((item) => {
        const Icon = item.icon;
        const isActive = pathname === item.href;
        return (
          <button
            key={item.href}
            onClick={() => router.push(item.href)}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors text-left cursor-pointer ${
              isActive
                ? "bg-[var(--surface-2)] text-[var(--accent)] border border-[var(--line)]"
                : "text-[var(--dim)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]"
            }`}
          >
            <Icon className="w-4 h-4 shrink-0" />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function AdminLayoutContent({ children }: { children: React.ReactNode }) {
  const { adminEmail, isAdmin, loading, login, logout } = useAdminAuth();
  const [emailInput, setEmailInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [authError, setAuthError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", "dark");
  }, []);

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    setIsSubmitting(true);
    try {
      await login(emailInput.trim(), passwordInput);
    } catch (err: unknown) {
      setAuthError(
        err instanceof Error
          ? err.message
          : "Invalid administrator credentials. Access restricted."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // 1. Loading gate
  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center text-xs font-mono text-[var(--dim)]">
        <div className="flex flex-col items-center gap-3">
          <span className="w-5 h-5 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" />
          <span>Verifying Administrator Authorization...</span>
        </div>
      </div>
    );
  }

  // 2. Private Admin Authentication Gate (Unauthorized users cannot view console)
  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-[var(--bg)] text-[var(--text)] flex flex-col justify-center items-center px-4 relative overflow-hidden font-sans">
        {/* Glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-[radial-gradient(circle,rgba(99,102,241,0.12)_0%,transparent_70%)] pointer-events-none" />

        <div className="w-full max-w-md bg-[var(--surface)] border border-[var(--line)] rounded-2xl p-8 relative shadow-2xl">
          <div className="flex flex-col items-center text-center mb-6">
            <div className="w-12 h-12 rounded-2xl bg-[rgba(99,102,241,0.12)] border border-[rgba(99,102,241,0.25)] flex items-center justify-center text-[var(--accent)] mb-4 shadow-[0_0_20px_rgba(99,102,241,0.2)]">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <h1 className="text-xl font-bold tracking-tight">Private Administrator Console</h1>
            <p className="text-xs text-[var(--dim)] mt-1.5 leading-relaxed">
              Restricted access. Authorized system operators only. Enter the administrator credentials to unlock.
            </p>
          </div>

          {authError && (
            <div className="mb-4 p-3 rounded-xl bg-[rgba(255,107,107,0.1)] border border-[var(--bad)] text-[var(--bad)] text-xs font-mono">
              {authError}
            </div>
          )}

          <form onSubmit={handleAdminLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-mono uppercase text-[var(--dim)] mb-1.5">
                Admin Email
              </label>
              <input
                type="email"
                required
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                placeholder="admin@gmail.com"
                className="w-full bg-[var(--surface-2)] border border-[var(--line)] rounded-xl px-3.5 py-2.5 text-xs text-[var(--text)] focus:outline-none focus:border-[var(--accent)] transition-colors font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-mono uppercase text-[var(--dim)] mb-1.5">
                Admin Password
              </label>
              <input
                type="password"
                required
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder="••••••••••••"
                className="w-full bg-[var(--surface-2)] border border-[var(--line)] rounded-xl px-3.5 py-2.5 text-xs text-[var(--text)] focus:outline-none focus:border-[var(--accent)] transition-colors font-mono"
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-2.5 rounded-xl bg-[var(--accent)] hover:opacity-90 text-black font-semibold text-xs tracking-wide transition-all cursor-pointer disabled:opacity-50 mt-2 flex items-center justify-center gap-2"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>{isSubmitting ? "Authenticating..." : "Unlock Administrator Console"}</span>
            </button>
          </form>
        </div>
      </div>
    );
  }

  // 3. Authenticated Admin Console View
  return (
    <div className="h-screen w-screen overflow-hidden bg-[var(--bg)] text-[var(--text)] flex font-sans selection:bg-[var(--accent)] selection:text-black">
      {/* Sidebar: Strictly FIXED height, NEVER scrolls with main content */}
      <aside className="w-64 h-screen border-r border-[var(--line)] bg-[var(--surface)] flex flex-col justify-between shrink-0 z-20 overflow-hidden select-none">
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          {/* Brand */}
          <div className="h-16 border-b border-[var(--line)] px-6 flex items-center justify-between shrink-0">
            <span className="font-semibold text-lg flex items-center gap-2.5 tracking-wide">
              <i className="w-2.5 h-2.5 rounded-full bg-[var(--accent)] shadow-[0_0_10px_var(--accent)] inline-block" />
              <span>Relay Admin</span>
            </span>
            <div className="flex items-center gap-1.5 text-[11px] font-mono text-[var(--ok)] bg-[rgba(74,222,154,0.12)] px-2 py-0.5 rounded-full">
              <Radio className="w-3 h-3 animate-pulse" />
              <span>Live</span>
            </div>
          </div>

          {/* Navigation Links wrapped in Suspense */}
          <div className="flex-1 overflow-y-auto">
            <Suspense fallback={<div className="p-4 text-xs font-mono text-[var(--dim)]">Loading navigation...</div>}>
              <AdminNav />
            </Suspense>
          </div>
        </div>

        {/* Admin profile footer & sign out - Fixed at bottom of sidebar */}
        <div className="p-4 border-t border-[var(--line)] flex items-center justify-between bg-[var(--surface-2)]/30 shrink-0">
          <div className="truncate mr-2">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[var(--ok)] shadow-[0_0_6px_var(--ok)]" />
              <p className="text-xs font-bold text-[var(--text)] tracking-tight">
                System Administrator
              </p>
            </div>
            <p className="text-[11px] text-[var(--dim)] font-mono truncate mt-0.5 font-medium">
              {adminEmail || "admin@relay.platform"}
            </p>
          </div>
          <button
            onClick={logout}
            title="Sign out of Admin Console"
            className="p-2 rounded-lg bg-[var(--surface)] hover:bg-[rgba(255,107,107,0.15)] text-[var(--dim)] hover:text-[var(--bad)] transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </aside>

      {/* Main Content Area: ONLY this panel scrolls */}
      <div className="flex-1 h-screen flex flex-col min-w-0 overflow-y-auto overflow-x-hidden">
        <header className="h-16 border-b border-[var(--line)] bg-[rgba(18,21,28,0.85)] backdrop-blur-md px-8 flex items-center justify-between sticky top-0 z-10 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-[var(--dim)] uppercase tracking-wider">
              Platform Status:
            </span>
            <span className="text-xs font-medium text-[var(--ok)] flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[var(--ok)]" />
              100 Nodes Active
            </span>
          </div>
          <div className="flex items-center gap-4 text-xs font-mono text-[var(--dim)]">
            <span>FastAPI v4.0.0</span>
            <span>·</span>
            <span>Next.js 16</span>
          </div>
        </header>

        <main className="p-8 flex-1">{children}</main>
      </div>
    </div>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminAuthProvider>
      <AdminLayoutContent>{children}</AdminLayoutContent>
    </AdminAuthProvider>
  );
}
