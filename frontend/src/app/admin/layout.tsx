"use client";

import React, { useEffect, Suspense } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import {
  LayoutDashboard,
  Layers,
  Server,
  Settings,
  Users,
  LogOut,
  Radio,
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

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, signOut } = useAuth();

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", "dark");
  }, []);

  const handleSignOut = async () => {
    await signOut();
    router.push("/auth");
  };

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)] flex font-sans selection:bg-[var(--accent)] selection:text-black">
      {/* Sidebar */}
      <aside className="w-64 border-r border-[var(--line)] bg-[var(--surface)] flex flex-col justify-between shrink-0">
        <div>
          {/* Brand */}
          <div className="h-16 border-b border-[var(--line)] px-6 flex items-center justify-between">
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
          <Suspense fallback={<div className="p-4 text-xs font-mono text-[var(--dim)]">Loading navigation...</div>}>
            <AdminNav />
          </Suspense>
        </div>

        {/* User footer & sign out */}
        <div className="p-4 border-t border-[var(--line)] flex items-center justify-between">
          <div className="truncate mr-2">
            <p className="text-xs font-semibold text-[var(--text)] truncate" suppressHydrationWarning>
              {user?.displayName || "Admin Operator"}
            </p>
            <p className="text-[11px] text-[var(--dim)] truncate font-mono" suppressHydrationWarning>
              {user?.email || "admin@gmail.com"}
            </p>
          </div>
          <button
            onClick={handleSignOut}
            title="Sign out"
            className="p-2 rounded-lg bg-[var(--surface-2)] hover:bg-[rgba(255,107,107,0.15)] text-[var(--dim)] hover:text-[var(--bad)] transition-colors"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        <header className="h-16 border-b border-[var(--line)] bg-[rgba(18,21,28,0.7)] backdrop-blur-md px-8 flex items-center justify-between sticky top-0 z-10">
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
