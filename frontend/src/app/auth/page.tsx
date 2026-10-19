"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { transitionTheme } from "@/components/ThemeTransition";
import { Eye, EyeOff, Lock, Mail, User } from "lucide-react";

export default function AuthPage() {
  const router = useRouter();
  const {
    signInWithEmail,
    signUpWithEmail,
    signInWithGoogle,
    devSignInAsAdmin,
    devSignInAsUser,
  } = useAuth();

  const [tab, setTab] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setSubmitting(true);

    try {
      if (tab === "signin") {
        await signInWithEmail(email, password);
      } else {
        await signUpWithEmail(email, password, displayName);
      }

      // Check role redirection
      const isAdminUser = email === "admin@gmail.com";
      if (isAdminUser) {
        router.push("/admin");
      } else {
        // Dark to Light Transition (FR-T2)
        transitionTheme("light", undefined, () => {
          router.push("/app");
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Authentication failed. Check your credentials.";
      setErrorMsg(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleSignIn = async (e: React.MouseEvent) => {
    setErrorMsg("");
    setSubmitting(true);
    try {
      const googleUser = await signInWithGoogle();
      if (googleUser) {
        transitionTheme("light", e.nativeEvent, () => {
          router.push("/app");
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Google sign in failed.";
      setErrorMsg(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDevUser = (e: React.MouseEvent) => {
    devSignInAsUser("Demo User");
    transitionTheme("light", e.nativeEvent, () => {
      router.push("/app");
    });
  };

  const handleDevAdmin = () => {
    devSignInAsAdmin();
    router.push("/admin");
  };

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)] flex flex-col justify-center items-center px-4 py-12 relative overflow-hidden">
      {/* Background radial glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-[radial-gradient(circle,rgba(124,140,255,0.08)_0%,transparent_70%)] pointer-events-none" />

      {/* Nav back */}
      <div className="absolute top-8 left-8">
        <Link href="/" className="flex items-center gap-2 text-sm text-[var(--dim)] hover:text-[var(--text)] transition-colors">
          <span className="w-2.5 h-2.5 rounded-full bg-[var(--accent)]" />
          <span>Relay</span>
        </Link>
      </div>

      <div className="w-full max-w-[420px] bg-[var(--surface)] border border-[var(--line)] rounded-2xl p-8 shadow-2xl relative z-10">
        {/* Tabs */}
        <div className="grid grid-cols-2 bg-[var(--surface-2)] p-1 rounded-xl mb-6 text-sm font-medium">
          <button
            type="button"
            onClick={() => setTab("signin")}
            className={`py-2 rounded-lg transition-all ${
              tab === "signin"
                ? "bg-[var(--surface)] text-[var(--text)] shadow-sm"
                : "text-[var(--dim)] hover:text-[var(--text)]"
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => setTab("signup")}
            className={`py-2 rounded-lg transition-all ${
              tab === "signup"
                ? "bg-[var(--surface)] text-[var(--text)] shadow-sm"
                : "text-[var(--dim)] hover:text-[var(--text)]"
            }`}
          >
            Create Account
          </button>
        </div>

        {errorMsg && (
          <div className="mb-4 p-3 rounded-lg bg-[rgba(255,107,107,0.12)] border border-[var(--bad)] text-[var(--bad)] text-xs leading-relaxed">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {tab === "signup" && (
            <div>
              <label className="block text-xs font-medium text-[var(--dim)] mb-1.5">Full Name</label>
              <div className="relative">
                <User className="absolute left-3.5 top-3 w-4 h-4 text-[var(--dim)]" />
                <input
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Jane Doe"
                  className="w-full bg-[var(--surface-2)] border border-[var(--line)] rounded-xl px-10 py-2.5 text-sm focus:outline-none focus:border-[var(--accent)] transition-colors"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-[var(--dim)] mb-1.5">Email Address</label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-3 w-4 h-4 text-[var(--dim)]" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="w-full bg-[var(--surface-2)] border border-[var(--line)] rounded-xl px-10 py-2.5 text-sm focus:outline-none focus:border-[var(--accent)] transition-colors"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--dim)] mb-1.5">Password</label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-3 w-4 h-4 text-[var(--dim)]" />
              <input
                type={showPassword ? "text" : "password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-[var(--surface-2)] border border-[var(--line)] rounded-xl pl-10 pr-10 py-2.5 text-sm focus:outline-none focus:border-[var(--accent)] transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3.5 top-3 text-[var(--dim)] hover:text-[var(--text)]"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full mt-2 py-3 rounded-xl font-semibold text-sm bg-[var(--accent)] text-[#0B0D12] hover:bg-[#919fff] transition-all transform hover:-translate-y-0.5 disabled:opacity-50 cursor-pointer shadow-lg shadow-[rgba(124,140,255,0.2)]"
          >
            {submitting ? "Please wait..." : tab === "signin" ? "Sign In" : "Create Account"}
          </button>
        </form>

        <div className="relative my-6 text-center text-xs text-[var(--dim)]">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-[var(--line)]" />
          </div>
          <span className="relative bg-[var(--surface)] px-3 uppercase tracking-wider">or</span>
        </div>

        {/* Continue with Google */}
        <button
          type="button"
          onClick={handleGoogleSignIn}
          className="w-full flex items-center justify-center gap-3 py-2.5 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] hover:border-[var(--dim)] text-sm font-medium transition-all"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.66v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.15z"
            />
            <path
              fill="#34A853"
              d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.94H1.24v3.15C3.26 21.36 7.34 24 12 24z"
            />
            <path
              fill="#FBBC05"
              d="M5.28 14.26c-.25-.72-.38-1.49-.38-2.26s.13-1.54.38-2.26V6.59H1.24C.45 8.16 0 9.94 0 12s.45 3.84 1.24 5.41l4.04-3.15z"
            />
            <path
              fill="#EA4335"
              d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.34 0 3.26 2.64 1.24 6.59l4.04 3.15c.95-2.84 3.6-4.99 6.72-4.99z"
            />
          </svg>
          <span>Continue with Google</span>
        </button>

        {/* Development Quick-Access Shortcuts */}
        <div className="mt-6 pt-5 border-t border-[var(--line)]">
          <p className="text-[11px] font-mono text-[var(--dim)] uppercase tracking-wider mb-2 text-center">
            Development Quick Access
          </p>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <button
              type="button"
              onClick={handleDevUser}
              className="py-1.5 px-2 rounded-lg bg-[var(--surface-2)] border border-[var(--line)] hover:border-[var(--accent)] text-[var(--dim)] hover:text-[var(--text)] transition-colors"
            >
              Sign in as User
            </button>
            <button
              type="button"
              onClick={handleDevAdmin}
              className="py-1.5 px-2 rounded-lg bg-[var(--surface-2)] border border-[var(--line)] hover:border-[var(--accent)] text-[var(--dim)] hover:text-[var(--text)] transition-colors"
            >
              Sign in as Admin
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
