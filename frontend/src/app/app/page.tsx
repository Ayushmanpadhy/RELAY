"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useAuth } from "@/context/AuthContext";
import { transitionTheme } from "@/components/ThemeTransition";
import { fetchWithAuth } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import {
  Upload,
  X,
  FileText,
  ArrowRight,
  LogOut,
  Sparkles,
  AlertCircle,
  Loader2,
  Settings,
  User,
} from "lucide-react";
import { JobRecord } from "@/lib/types";
import { UserProfileModal } from "@/components/UserProfileModal";

const SoftOrb = dynamic(() => import("@/components/orb/SoftOrb"), { ssr: false });

const PLACEHOLDERS = [
  "Count how many numbers start with 9 in this dataset",
  "Summarize customer feedback into top 5 complaints",
  "Extract recurring themes from these PDF quarterly reports",
  "Find the minimum and maximum values across these data rows",
];

export default function UserHomePage() {
  const router = useRouter();
  const { user, token, signOut } = useAuth();
  const [prompt, setPrompt] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Set theme to light on mount
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", "light");
  }, []);

  // Rotate placeholders when idle
  useEffect(() => {
    if (prompt) return;
    const interval = setInterval(() => {
      setPlaceholderIndex((prev) => (prev + 1) % PLACEHOLDERS.length);
    }, 4500);
    return () => clearInterval(interval);
  }, [prompt]);

  // Query past jobs
  const { data: myJobs = [], refetch } = useQuery<JobRecord[]>({
    queryKey: ["myJobs", token],
    queryFn: () => fetchWithAuth<JobRecord[]>("/jobs", token),
    enabled: Boolean(token),
  });

  const handleSignOut = (e: React.MouseEvent) => {
    transitionTheme("dark", e.nativeEvent, async () => {
      await signOut();
      router.push("/");
    });
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files) {
      addFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      addFiles(Array.from(e.target.files));
    }
  };

  const addFiles = (newFiles: File[]) => {
    setErrorMsg("");
    if (files.length + newFiles.length > 10) {
      setErrorMsg("Maximum 10 files allowed per request.");
      return;
    }
    const combined = [...files, ...newFiles];
    const totalSize = combined.reduce((acc, f) => acc + f.size, 0);
    if (totalSize > 50 * 1024 * 1024) {
      setErrorMsg("Total upload size cannot exceed 50 MB.");
      return;
    }
    setFiles(combined);
  };

  const removeFile = (idx: number) => {
    setFiles(files.filter((_, i) => i !== idx));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;

    setErrorMsg("");
    setIsSubmitting(true);

    try {
      const formData = new FormData();
      formData.append("prompt", prompt.trim());
      files.forEach((f) => {
        formData.append("files", f);
      });

      const res = await fetchWithAuth<{ jobId: string }>("/jobs", token, {
        method: "POST",
        body: formData,
      });

      router.push(`/app/r/${res.jobId}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to submit request. Please try again.";
      setErrorMsg(msg);
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)] transition-colors duration-300">
      {/* Top Bar */}
      <header className="sticky top-0 z-20 bg-[rgba(246,247,251,0.85)] backdrop-blur-md border-b border-[var(--line)]">
        <div className="w-full max-w-[1440px] mx-auto px-6 md:px-10 lg:px-12 h-16 flex items-center justify-between">
          <Link href="/app" className="flex items-center gap-2.5 font-semibold text-lg tracking-tight">
            <span className="w-3 h-3 rounded-full bg-[var(--accent)] shadow-[0_0_12px_var(--accent)] inline-block" />
            <span>Relay</span>
          </Link>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl border border-[var(--line)] bg-[var(--surface)] hover:bg-[var(--surface-2)] text-xs text-[var(--text)] transition-all cursor-pointer"
              title="Account & Profile Settings"
            >
              <div className="w-5 h-5 rounded-full bg-[var(--accent)] text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                {(user?.displayName || user?.email || "U").substring(0, 1).toUpperCase()}
              </div>
              <span className="font-medium max-w-[140px] truncate" suppressHydrationWarning>
                {user?.displayName || user?.email || "My Workspace"}
              </span>
            </button>

            <button
              onClick={() => setIsSettingsOpen(true)}
              title="Workspace & Model Settings"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[var(--line)] bg-[var(--surface)] hover:bg-[var(--surface-2)] text-xs text-[var(--dim)] hover:text-[var(--text)] transition-all cursor-pointer"
            >
              <Settings className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Settings</span>
            </button>

            <button
              onClick={handleSignOut}
              title="Sign Out"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[var(--line)] bg-[var(--surface)] hover:bg-[var(--surface-2)] text-xs text-[var(--dim)] hover:text-[var(--bad)] transition-all cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="w-full max-w-[1440px] mx-auto px-6 md:px-10 lg:px-12 py-10">
        {/* Hero Greeting & Composer */}
        <section className="mb-16">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-[var(--text)] mb-2">
                What should we get done today?
              </h1>
              <p className="text-base text-[var(--dim)]">
                Describe the task and drop your files. Relay splits the work and delivers the result.
              </p>
            </div>
            <SoftOrb isDispersing={isSubmitting} />
          </div>

          {/* Composer Card */}
          <div className="bg-[var(--surface)] rounded-[20px] p-6 shadow-[0_1px_2px_rgba(14,18,38,0.04),0_12px_40px_rgba(14,18,38,0.06)] border border-[var(--line)] relative">
            <form onSubmit={handleSubmit}>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={PLACEHOLDERS[placeholderIndex]}
                rows={4}
                className="w-full bg-transparent resize-none text-base text-[var(--text)] placeholder-[var(--dim)] focus:outline-none transition-colors"
              />

              {/* File Drop Zone */}
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleFileDrop}
                onClick={() => fileInputRef.current?.click()}
                className="mt-4 border-2 border-dashed border-[var(--line)] hover:border-[var(--accent)] rounded-2xl p-4 text-center cursor-pointer bg-[var(--surface-2)] transition-colors"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <div className="flex items-center justify-center gap-2 text-xs text-[var(--dim)]">
                  <Upload className="w-4 h-4 text-[var(--accent)]" />
                  <span>Drop text, CSV, PDF, docx or images here, or browse</span>
                </div>
              </div>

              {/* Uploaded File Chips */}
              {files.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-4">
                  {files.map((file, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-2 bg-[var(--surface-2)] border border-[var(--line)] px-3 py-1.5 rounded-xl text-xs"
                    >
                      <FileText className="w-3.5 h-3.5 text-[var(--dim)]" />
                      <span className="font-medium truncate max-w-[160px]">{file.name}</span>
                      <span className="text-[var(--dim)]">({(file.size / 1024).toFixed(0)} KB)</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeFile(idx);
                        }}
                        className="hover:text-[var(--bad)] text-[var(--dim)] ml-1"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {errorMsg && (
                <div className="mt-4 p-3 rounded-xl bg-[rgba(216,67,75,0.08)] border border-[var(--bad)] text-[var(--bad)] text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {/* Bottom bar with Submit button */}
              <div className="flex items-center justify-between mt-6 pt-4 border-t border-[var(--line)]">
                <span className="text-xs text-[var(--dim)]">
                  {files.length} file{files.length === 1 ? "" : "s"} attached
                </span>
                <button
                  type="submit"
                  disabled={!prompt.trim() || isSubmitting}
                  className="flex items-center gap-2 px-6 py-2.5 rounded-xl font-semibold text-sm bg-[var(--accent)] text-white hover:bg-[#4b5bf0] disabled:opacity-40 transition-all transform hover:-translate-y-0.5 cursor-pointer shadow-md shadow-[rgba(91,108,255,0.25)]"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Planning...</span>
                    </>
                  ) : (
                    <>
                      <span>Start</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </section>

        {/* Bento Grid: Your Requests */}
        <section>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold tracking-tight">Your requests</h2>
            <button
              onClick={() => refetch()}
              className="text-xs text-[var(--dim)] hover:text-[var(--text)] transition-colors"
            >
              Refresh
            </button>
          </div>

          {myJobs.length === 0 ? (
            <div className="bg-[var(--surface)] rounded-[20px] p-10 text-center border border-[var(--line)] text-[var(--dim)] text-sm">
              <Sparkles className="w-8 h-8 text-[var(--accent)] mx-auto mb-3 opacity-80" />
              <p className="font-medium text-[var(--text)] mb-1">No requests yet</p>
              <p>Type a prompt and drop a file above to start your first distributed run.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {myJobs.map((job: JobRecord) => (
                <Link
                  key={job.id}
                  href={`/app/r/${job.id}`}
                  className="bg-[var(--surface)] hover:bg-[var(--surface-2)] border border-[var(--line)] hover:border-[var(--dim)] rounded-[20px] p-5 transition-all transform hover:-translate-y-0.5 shadow-sm"
                >
                  <div className="flex items-center justify-between mb-3">
                    <span
                      className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                        job.status === "done"
                          ? "status-done"
                          : job.status === "failed"
                          ? "status-crashed"
                          : "status-working"
                      }`}
                    >
                      {job.stepLabel || job.status}
                    </span>
                    <span className="text-xs text-[var(--dim)] font-mono">
                      {job.createdAt ? new Date(job.createdAt).toLocaleDateString() : ""}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-[var(--text)] line-clamp-2 mb-4">
                    {job.promptPreview || "Untitled Request"}
                  </p>
                  <div className="flex items-center justify-between text-xs text-[var(--dim)] font-mono">
                    <span>Progress: {job.progress}%</span>
                    <span className="text-[var(--accent)] font-sans font-medium">View Result →</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </main>

      <UserProfileModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
    </div>
  );
}
