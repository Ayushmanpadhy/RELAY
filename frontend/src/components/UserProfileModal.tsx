"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import {
  User,
  Settings,
  Mail,
  ShieldCheck,
  Copy,
  Check,
  LogOut,
  X,
  Sparkles,
  Sliders,
  CheckCircle2,
  ExternalLink,
} from "lucide-react";

interface UserProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function UserProfileModal({ isOpen, onClose }: UserProfileModalProps) {
  const router = useRouter();
  const { user, signOut, updateDisplayName } = useAuth();
  const [activeTab, setActiveTab] = useState<"profile" | "preferences">("profile");
  const [displayNameInput, setDisplayNameInput] = useState(user?.displayName || "");
  const [isEditingName, setIsEditingName] = useState(false);
  const [isSavingName, setIsSavingName] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await signOut();
      onClose();
      router.push("/auth");
    } catch (err) {
      console.error("Sign out error:", err);
      onClose();
      window.location.href = "/auth";
    } finally {
      setIsSigningOut(false);
    }
  };

  // Settings State (persisted in localStorage)
  const [defaultMode, setDefaultMode] = useState<"auto" | "tools">(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("relay_pref_mode") as "auto" | "tools") || "auto";
    }
    return "auto";
  });
  const [soundNotify, setSoundNotify] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("relay_pref_sound") !== "false";
    }
    return true;
  });

  if (!isOpen) return null;

  const handleCopyId = () => {
    if (user?.uid) {
      navigator.clipboard.writeText(user.uid);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayNameInput.trim()) return;
    setIsSavingName(true);
    try {
      await updateDisplayName(displayNameInput.trim());
      setIsEditingName(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      console.error("Failed to update profile name:", err);
    } finally {
      setIsSavingName(false);
    }
  };

  const handleModeChange = (mode: "auto" | "tools") => {
    setDefaultMode(mode);
    if (typeof window !== "undefined") {
      localStorage.setItem("relay_pref_mode", mode);
    }
  };

  const handleSoundToggle = (val: boolean) => {
    setSoundNotify(val);
    if (typeof window !== "undefined") {
      localStorage.setItem("relay_pref_sound", String(val));
    }
  };

  const initials = (user?.displayName || user?.email || "U")
    .substring(0, 2)
    .toUpperCase();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="w-full max-w-lg bg-[var(--surface)] border border-[var(--line)] rounded-3xl shadow-2xl overflow-hidden flex flex-col relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-[var(--line)] flex items-center justify-between bg-[var(--surface-2)]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[rgba(91,108,255,0.1)] flex items-center justify-center text-[var(--accent)]">
              <Settings className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[var(--text)]">Account &amp; Settings</h2>
              <p className="text-xs text-[var(--dim)]">Manage your workspace preferences</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-[var(--dim)] hover:text-[var(--text)] hover:bg-[var(--surface)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-[var(--line)] px-6 bg-[var(--surface)]">
          <button
            onClick={() => setActiveTab("profile")}
            className={`py-3 px-4 text-xs font-semibold border-b-2 transition-colors cursor-pointer flex items-center gap-2 ${
              activeTab === "profile"
                ? "border-[var(--accent)] text-[var(--accent)]"
                : "border-transparent text-[var(--dim)] hover:text-[var(--text)]"
            }`}
          >
            <User className="w-3.5 h-3.5" />
            <span>Profile Details</span>
          </button>
          <button
            onClick={() => setActiveTab("preferences")}
            className={`py-3 px-4 text-xs font-semibold border-b-2 transition-colors cursor-pointer flex items-center gap-2 ${
              activeTab === "preferences"
                ? "border-[var(--accent)] text-[var(--accent)]"
                : "border-transparent text-[var(--dim)] hover:text-[var(--text)]"
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Preferences</span>
          </button>
        </div>

        {/* Tab Content */}
        <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
          {activeTab === "profile" && (
            <div className="space-y-6">
              {/* User Identity Card */}
              <div className="flex items-center gap-4 p-4 rounded-2xl bg-[var(--surface-2)] border border-[var(--line)]">
                <div className="w-14 h-14 rounded-2xl bg-[var(--accent)] text-white font-bold text-lg flex items-center justify-center shadow-md">
                  {initials}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold text-[var(--text)] truncate">
                      {user?.displayName || "Unnamed User"}
                    </h3>
                    <span className="px-2 py-0.5 rounded-full bg-[rgba(74,222,154,0.15)] text-[var(--ok)] text-[10px] font-bold uppercase tracking-wider">
                      User
                    </span>
                  </div>
                  <p className="text-xs text-[var(--dim)] truncate flex items-center gap-1.5 mt-0.5">
                    <Mail className="w-3.5 h-3.5 text-[var(--dim)]" />
                    <span>{user?.email || "No email linked"}</span>
                  </p>
                </div>
              </div>

              {/* Edit Display Name */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--dim)]">
                  Display Name
                </label>
                {isEditingName ? (
                  <form onSubmit={handleSaveProfile} className="flex gap-2">
                    <input
                      type="text"
                      value={displayNameInput}
                      onChange={(e) => setDisplayNameInput(e.target.value)}
                      placeholder="Enter your name"
                      className="flex-1 px-3.5 py-2 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                    />
                    <button
                      type="submit"
                      disabled={isSavingName}
                      className="px-4 py-2 rounded-xl bg-[var(--accent)] text-white text-xs font-semibold hover:bg-[#4b5bf0] transition-colors"
                    >
                      {isSavingName ? "Saving..." : "Save"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsEditingName(false);
                        setDisplayNameInput(user?.displayName || "");
                      }}
                      className="px-3 py-2 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] text-xs text-[var(--dim)] hover:text-[var(--text)]"
                    >
                      Cancel
                    </button>
                  </form>
                ) : (
                  <div className="flex items-center justify-between p-3 rounded-xl bg-[var(--surface-2)] border border-[var(--line)]">
                    <span className="text-sm text-[var(--text)] font-medium">
                      {user?.displayName || "Not specified"}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setDisplayNameInput(user?.displayName || "");
                        setIsEditingName(true);
                      }}
                      className="text-xs text-[var(--accent)] font-semibold hover:underline cursor-pointer"
                    >
                      Change
                    </button>
                  </div>
                )}
                {saveSuccess && (
                  <p className="text-xs text-[var(--ok)] flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Display name updated!</span>
                  </p>
                )}
              </div>

              {/* User ID / Identity Info */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--dim)]">
                  Account Identifier (UID)
                </label>
                <div className="flex items-center justify-between p-3 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] text-xs font-mono">
                  <span className="truncate text-[var(--dim)] mr-2">{user?.uid || "Anonymous"}</span>
                  <button
                    onClick={handleCopyId}
                    title="Copy UID"
                    className="p-1.5 rounded-lg hover:bg-[var(--surface)] text-[var(--dim)] hover:text-[var(--text)] transition-colors shrink-0"
                  >
                    {copiedId ? (
                      <Check className="w-3.5 h-3.5 text-[var(--ok)]" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === "preferences" && (
            <div className="space-y-5">
              {/* Execution Mode */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--dim)]">
                  Default Task Execution Engine
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => handleModeChange("auto")}
                    className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                      defaultMode === "auto"
                        ? "border-[var(--accent)] bg-[rgba(91,108,255,0.08)] text-[var(--text)]"
                        : "border-[var(--line)] bg-[var(--surface-2)] text-[var(--dim)] hover:border-[var(--accent)]"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold">Hybrid AI + Tools</span>
                      {defaultMode === "auto" && <Sparkles className="w-3.5 h-3.5 text-[var(--accent)]" />}
                    </div>
                    <p className="text-[11px] text-[var(--dim)]">AI planning with parallel tool dispatch.</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleModeChange("tools")}
                    className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                      defaultMode === "tools"
                        ? "border-[var(--accent)] bg-[rgba(91,108,255,0.08)] text-[var(--text)]"
                        : "border-[var(--line)] bg-[var(--surface-2)] text-[var(--dim)] hover:border-[var(--accent)]"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold">Deterministic</span>
                      {defaultMode === "tools" && <Check className="w-3.5 h-3.5 text-[var(--accent)]" />}
                    </div>
                    <p className="text-[11px] text-[var(--dim)]">Python tools for exact numeric computing.</p>
                  </button>
                </div>
              </div>

              {/* Sound Notifications */}
              <div className="flex items-center justify-between p-3.5 rounded-xl bg-[var(--surface-2)] border border-[var(--line)]">
                <div>
                  <p className="text-xs font-semibold text-[var(--text)]">Completion Alert Sound</p>
                  <p className="text-[11px] text-[var(--dim)]">Play a subtle audio notification when tasks complete</p>
                </div>
                <input
                  type="checkbox"
                  checked={soundNotify}
                  onChange={(e) => handleSoundToggle(e.target.checked)}
                  className="w-4 h-4 accent-[var(--accent)] cursor-pointer"
                />
              </div>

              {/* Data & Cloud Status */}
              <div className="p-3.5 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[var(--text)]">Cloud Storage</span>
                  <span className="text-[10px] font-mono text-[var(--ok)] bg-[rgba(74,222,154,0.12)] px-2 py-0.5 rounded-full">
                    relay-2c57e
                  </span>
                </div>
                <p className="text-[11px] text-[var(--dim)]">
                  Job deliverables and uploaded datasets are stored securely in your project workspace.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[var(--line)] bg-[var(--surface-2)] flex items-center justify-between">
          <button
            type="button"
            onClick={handleSignOut}
            disabled={isSigningOut}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-[var(--bad)] hover:bg-[rgba(239,68,68,0.1)] transition-colors cursor-pointer disabled:opacity-50"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>{isSigningOut ? "Signing out..." : "Sign Out"}</span>
          </button>
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl text-xs font-semibold bg-[var(--accent)] text-white hover:bg-[#4b5bf0] transition-colors shadow-sm cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
