"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { fetchWithAuth, SERVER_ROOT_URL } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Download,
  AlertCircle,
  HelpCircle,
  Sparkles,
  RotateCcw,
  Loader2,
  MessageSquarePlus,
  Layers,
  History,
} from "lucide-react";
import { JobRecord, ResultFile } from "@/lib/types";
import { UserProfileModal } from "@/components/UserProfileModal";

export default function RequestProgressPage() {
  const router = useRouter();
  const params = useParams();
  const initialJobId = params?.id as string;
  const [activeJobId, setActiveJobId] = useState<string>(initialJobId);
  const { user, token, loading } = useAuth();
  const [answers, setAnswers] = useState<string[]>([]);
  const [submittingAnswers, setSubmittingAnswers] = useState(false);
  const [followUpPrompt, setFollowUpPrompt] = useState("");
  const [isSubmittingFollowUp, setIsSubmittingFollowUp] = useState(false);
  const [followUpError, setFollowUpError] = useState("");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Redirect to auth if unauthenticated
  useEffect(() => {
    if (!loading && !user && !token) {
      router.push("/auth");
    }
  }, [loading, user, token, router]);

  useEffect(() => {
    if (initialJobId) {
      setActiveJobId(initialJobId);
    }
  }, [initialJobId]);

  const handleFollowUpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!followUpPrompt.trim()) return;

    setFollowUpError("");
    setIsSubmittingFollowUp(true);

    try {
      const formData = new FormData();
      formData.append("prompt", followUpPrompt.trim());
      formData.append("parent_job_id", activeJobId);

      const res = await fetchWithAuth<{ jobId: string; rootJobId?: string; iteration?: number }>("/jobs", token, {
        method: "POST",
        body: formData,
      });

      setFollowUpPrompt("");
      setActiveJobId(res.jobId);
      router.push(`/app/r/${res.jobId}`);
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : "Failed to submit follow-up. Please try again.";
      setFollowUpError(msg);
    } finally {
      setIsSubmittingFollowUp(false);
    }
  };

  const [downloadingFile, setDownloadingFile] = useState<string | null>(null);

  const handleDownload = async (e: React.MouseEvent, file: ResultFile) => {
    e.preventDefault();
    setDownloadingFile(file.name);
    try {
      const downloadPath = file.downloadUrl.startsWith("/") ? file.downloadUrl : `/${file.downloadUrl}`;
      const url = `${SERVER_ROOT_URL}${downloadPath}`;

      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!res.ok) {
        throw new Error(`Download failed with status ${res.status}`);
      }

      const blob = await res.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = file.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error("Direct blob download error, using fallback with token query:", err);
      const tokenParam = token ? `?token=${encodeURIComponent(token)}` : "";
      window.open(`http://localhost:8000${file.downloadUrl}${tokenParam}`, "_blank");
    } finally {
      setDownloadingFile(null);
    }
  };

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", "light");
  }, []);

  // Poll for job status every 1.5 seconds while running
  const { data: job, refetch } = useQuery<JobRecord>({
    queryKey: ["job", activeJobId, token],
    queryFn: () => fetchWithAuth<JobRecord>(`/jobs/${activeJobId}`, token),
    enabled: Boolean(activeJobId && token),
    refetchInterval: (query) => {
      const currentJob = query.state.data;
      if (currentJob?.status === "done" || currentJob?.status === "failed") {
        return false;
      }
      return 1500;
    },
  });

  const handleClarifySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!answers.some((a) => a?.trim())) return;
    setSubmittingAnswers(true);
    try {
      await fetchWithAuth(`/jobs/${activeJobId}/clarify`, token, {
        method: "POST",
        body: JSON.stringify({ answers }),
      });
      refetch();
    } catch {
      // ignore
    } finally {
      setSubmittingAnswers(false);
    }
  };

  const isDone = job?.status === "done";
  const isFailed = job?.status === "failed";
  const progress = job?.progress || 0;
  const stepLabel = job?.stepLabel || "Working on it...";
  const questions: string[] = job?.clarifyingQuestions || [];

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)] transition-colors duration-300">
      {/* Top Bar */}
      <header className="sticky top-0 z-20 bg-[rgba(246,247,251,0.85)] backdrop-blur-md border-b border-[var(--line)]">
        <div className="w-full max-w-[1440px] mx-auto px-6 md:px-10 lg:px-12 h-16 flex items-center justify-between">
          <Link
            href="/app"
            className="flex items-center gap-2 text-sm text-[var(--dim)] hover:text-[var(--text)] transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to requests</span>
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden md:inline text-xs font-mono text-[var(--dim)] truncate max-w-[200px]">
              {activeJobId}
            </span>
            <button
              onClick={() => setIsSettingsOpen(true)}
              title="Account & Profile Settings"
              className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl border border-[var(--line)] bg-[var(--surface)] hover:bg-[var(--surface-2)] text-xs text-[var(--text)] transition-all cursor-pointer shadow-sm"
            >
              <div className="w-5 h-5 rounded-full bg-[var(--accent)] text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                {(user?.displayName || user?.email || "U").substring(0, 1).toUpperCase()}
              </div>
              <span className="font-medium hidden sm:inline max-w-[140px] truncate" suppressHydrationWarning>
                {user?.displayName || user?.email || "My Workspace"}
              </span>
            </button>
          </div>
        </div>
      </header>

      <main className="w-full max-w-[1440px] mx-auto px-6 md:px-10 lg:px-12 py-10">
        {/* Submission Iteration History Chain */}
        {Boolean(job?.iterations && job.iterations.length > 1) && (
          <div className="bg-[var(--surface)] p-5 rounded-[22px] border border-[var(--line)] shadow-sm mb-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 mb-3.5">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-[rgba(91,108,255,0.12)] flex items-center justify-center text-[var(--accent)] shrink-0">
                  <Layers className="w-3.5 h-3.5" />
                </div>
                <h3 className="text-sm font-semibold text-[var(--text)]">
                  Submission History ({job?.iterations?.length} Related Prompts)
                </h3>
              </div>
              <p className="text-[11px] font-mono text-[var(--dim)]">
                All changes stay organized in this single submission. Click any task to inspect its result.
              </p>
            </div>

            <div className="flex items-center gap-2.5 overflow-x-auto pb-1 scrollbar-thin">
              {job?.iterations?.map((it, idx) => {
                const isSelected = it.id === activeJobId;
                return (
                  <button
                    key={it.id}
                    type="button"
                    onClick={() => setActiveJobId(it.id)}
                    className={`px-3.5 py-2.5 rounded-xl text-left border transition-all shrink-0 min-w-[200px] max-w-[280px] cursor-pointer ${
                      isSelected
                        ? "bg-[rgba(91,108,255,0.08)] border-[var(--accent)] shadow-sm text-[var(--text)]"
                        : "bg-[var(--surface-2)] border-[var(--line)] text-[var(--dim)] hover:text-[var(--text)] hover:border-[var(--dim)]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[var(--accent)]">
                        Task #{it.iteration || idx + 1}
                      </span>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase font-mono ${
                          it.status === "done"
                            ? "bg-[rgba(74,222,154,0.15)] text-[var(--ok)]"
                            : it.status === "failed"
                            ? "bg-[rgba(216,67,75,0.15)] text-[var(--bad)]"
                            : "bg-[rgba(91,108,255,0.15)] text-[var(--accent)]"
                        }`}
                      >
                        {it.status}
                      </span>
                    </div>
                    <p className="text-xs font-medium truncate" title={it.fullPrompt || it.promptPreview}>
                      {it.fullPrompt || it.promptPreview || "Untitled prompt"}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* While Running Progress Ring */}
        {!isDone && !isFailed && (
          <div className="bg-[var(--surface)] rounded-[24px] p-10 border border-[var(--line)] shadow-[0_12px_40px_rgba(14,18,38,0.06)] text-center flex flex-col items-center">
            {/* Percentage Ring SVG */}
            <div className="relative w-44 h-44 mb-6">
              <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  stroke="var(--line)"
                  strokeWidth="8"
                  fill="transparent"
                />
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  stroke="var(--accent)"
                  strokeWidth="8"
                  strokeDasharray="264"
                  strokeDashoffset={264 - (264 * progress) / 100}
                  strokeLinecap="round"
                  fill="transparent"
                  className="transition-all duration-700 ease-out"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-3xl font-bold font-mono tracking-tight text-[var(--text)]">
                  {progress}%
                </span>
                <span className="text-xs text-[var(--dim)] mt-0.5">processing</span>
              </div>
            </div>

            <h2 className="text-2xl font-bold tracking-tight text-[var(--text)] mb-2">
              {stepLabel}
            </h2>
            <p className="text-sm text-[var(--dim)] max-w-md mx-auto">
              {job?.promptPreview || "Your task is being analyzed and distributed across nodes."}
            </p>

            {/* Clarifying Questions Form */}
            {questions.length > 0 && (
              <div className="mt-8 text-left w-full max-w-lg bg-[var(--surface-2)] p-6 rounded-2xl border border-[var(--line)]">
                <div className="flex items-center gap-2 text-sm font-semibold mb-3 text-[var(--accent)]">
                  <HelpCircle className="w-4 h-4" />
                  <span>A quick clarification is needed</span>
                </div>
                <form onSubmit={handleClarifySubmit} className="space-y-4">
                  {questions.map((q, idx) => (
                    <div key={idx}>
                      <label className="block text-xs font-medium text-[var(--text)] mb-1.5">{q}</label>
                      <input
                        type="text"
                        required
                        value={answers[idx] || ""}
                        onChange={(e) => {
                          const copy = [...answers];
                          copy[idx] = e.target.value;
                          setAnswers(copy);
                        }}
                        placeholder="Your answer..."
                        className="w-full bg-[var(--surface)] border border-[var(--line)] rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[var(--accent)]"
                      />
                    </div>
                  ))}
                  <button
                    type="submit"
                    disabled={submittingAnswers}
                    className="w-full py-2.5 rounded-xl font-semibold text-sm bg-[var(--accent)] text-white hover:bg-[#4b5bf0] transition-colors"
                  >
                    {submittingAnswers ? "Submitting..." : "Continue"}
                  </button>
                </form>
              </div>
            )}
          </div>
        )}

        {/* Failed State */}
        {isFailed && (
          <div className="bg-[var(--surface)] rounded-[24px] p-10 border border-[var(--bad)] text-center shadow-lg">
            <AlertCircle className="w-12 h-12 text-[var(--bad)] mx-auto mb-4" />
            <h2 className="text-2xl font-bold tracking-tight mb-2">Something went wrong</h2>
            <p className="text-sm text-[var(--dim)] max-w-md mx-auto mb-6">
              We encountered an issue during execution. Please try again or adjust your prompt.
            </p>
            <Link
              href="/app"
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold bg-[var(--accent)] text-white hover:bg-[#4b5bf0] transition-all"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Try again</span>
            </Link>
          </div>
        )}

        {/* Completed Result Window */}
        {isDone && (
          <div className="space-y-6">
            <div className="bg-[var(--surface)] rounded-[24px] p-8 md:p-10 border border-[var(--line)] shadow-[0_12px_40px_rgba(14,18,38,0.06)]">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--ok)] mb-4">
                <CheckCircle2 className="w-4 h-4" />
                <span>Finished &amp; Verified</span>
              </div>

              {/* Headline Answer */}
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-[var(--text)] mb-6 leading-snug">
                {job?.result?.headline || "Analysis Completed"}
              </h1>

              {/* Human-Friendly Explanation */}
              <div className="text-base text-[var(--dim)] leading-relaxed space-y-4 mb-8 whitespace-pre-line border-t border-[var(--line)] pt-6">
                {job?.result?.explanation}
              </div>

              {/* Download Deliverables */}
              {job?.result?.files && job.result.files.length > 0 && (
                <div className="pt-6 border-t border-[var(--line)] flex flex-wrap items-center gap-3">
                  <span className="text-xs font-medium text-[var(--dim)] mr-2">Deliverable files:</span>
                  {job.result.files.map((file: ResultFile, idx: number) => {
                    const tokenParam = token ? `?token=${encodeURIComponent(token)}` : "";
                    const fullDownloadUrl = `http://localhost:8000${file.downloadUrl}${tokenParam}`;
                    const isDownloading = downloadingFile === file.name;
                    return (
                      <a
                        key={idx}
                        href={fullDownloadUrl}
                        download={file.name}
                        onClick={(e) => handleDownload(e, file)}
                        title={`Download ${file.name}`}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] hover:border-[var(--accent)] text-xs font-semibold text-[var(--text)] transition-colors shadow-sm cursor-pointer select-none"
                      >
                        {isDownloading ? (
                          <Loader2 className="w-3.5 h-3.5 text-[var(--accent)] animate-spin" />
                        ) : (
                          <Download className="w-3.5 h-3.5 text-[var(--accent)]" />
                        )}
                        <span>{file.name}</span>
                        <span className="text-[var(--dim)] font-mono">
                          ({(file.size / 1024).toFixed(1)} KB)
                        </span>
                      </a>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Follow-up / Refinement Prompt Section */}
            <div className="bg-[var(--surface)] rounded-[24px] p-6 md:p-8 border border-[var(--line)] shadow-[0_12px_40px_rgba(14,18,38,0.06)] relative">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-[rgba(91,108,255,0.1)] flex items-center justify-center text-[var(--accent)] shrink-0">
                    <MessageSquarePlus className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-[var(--text)]">
                      Not satisfied or need changes?
                    </h3>
                    <p className="text-xs text-[var(--dim)]">
                      Ask a follow-up or refine this answer without re-uploading your files.
                    </p>
                  </div>
                </div>
                {job?.fileCount !== undefined && job.fileCount > 0 && (
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[var(--surface-2)] text-xs text-[var(--dim)] border border-[var(--line)] self-start sm:self-auto">
                    <span className="w-2 h-2 rounded-full bg-[var(--ok)]" />
                    <span>{job.fileCount} {job.fileCount === 1 ? "file" : "files"} attached</span>
                  </div>
                )}
              </div>

              {/* Quick Refinement Suggestion Chips */}
              <div className="flex flex-wrap gap-2 mb-4">
                {[
                  "Format as a markdown table",
                  "Provide a detailed breakdown",
                  "Summarize in 3 bullet points",
                  "Check for inconsistencies",
                  "Make it simpler and shorter",
                ].map((suggestion, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setFollowUpPrompt(suggestion)}
                    className="text-xs px-3 py-1.5 rounded-lg bg-[var(--surface-2)] hover:bg-[rgba(91,108,255,0.1)] hover:text-[var(--accent)] border border-[var(--line)] text-[var(--dim)] transition-all cursor-pointer text-left"
                  >
                    + {suggestion}
                  </button>
                ))}
              </div>

              {/* Follow-up Form */}
              <form onSubmit={handleFollowUpSubmit} className="space-y-4">
                <div className="relative">
                  <textarea
                    value={followUpPrompt}
                    onChange={(e) => setFollowUpPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        handleFollowUpSubmit(e);
                      }
                    }}
                    placeholder="Tell Relay what to change or ask another question about this data... (e.g. 'Format this into a table' or 'Highlight the top 3 risks')"
                    rows={3}
                    className="w-full bg-[var(--surface-2)] border border-[var(--line)] focus:border-[var(--accent)] rounded-2xl p-4 text-sm text-[var(--text)] placeholder-[var(--dim)] focus:outline-none transition-colors resize-none leading-relaxed"
                  />
                </div>

                {followUpError && (
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-[rgba(239,68,68,0.1)] border border-[var(--bad)] text-xs text-[var(--bad)]">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{followUpError}</span>
                  </div>
                )}

                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-1">
                  <div className="text-xs text-[var(--dim)] order-2 sm:order-1">
                    Press <kbd className="px-1.5 py-0.5 rounded bg-[var(--surface-2)] border border-[var(--line)] text-[10px] font-mono font-medium">Ctrl + Enter</kbd> to submit
                  </div>

                  <div className="flex items-center gap-3 w-full sm:w-auto justify-end order-1 sm:order-2">
                    <Link
                      href="/app"
                      className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold text-[var(--dim)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors border border-transparent hover:border-[var(--line)]"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Start fresh with new files</span>
                    </Link>

                    <button
                      type="submit"
                      disabled={isSubmittingFollowUp || !followUpPrompt.trim()}
                      className="inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold bg-[var(--accent)] text-white hover:bg-[#4b5bf0] disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md shadow-[rgba(91,108,255,0.25)] min-w-[140px]"
                    >
                      {isSubmittingFollowUp ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Updating...</span>
                        </>
                      ) : (
                        <>
                          <ArrowRight className="w-4 h-4" />
                          <span>Submit changes</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>

      <UserProfileModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
    </div>
  );
}
