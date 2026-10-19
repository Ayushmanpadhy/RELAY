"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { useAdminAuth } from "@/context/AdminAuthContext";
import { fetchWithAuth } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { Search, ExternalLink, ChevronDown, ChevronRight, Layers } from "lucide-react";
import { JobRecord, TaskIteration } from "@/lib/types";

export default function AdminSubmissionsPage() {
  const router = useRouter();
  const { token } = useAdminAuth();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [expandedSubmissions, setExpandedSubmissions] = useState<Record<string, boolean>>({});

  const toggleExpand = (jobId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setExpandedSubmissions((prev) => ({
      ...prev,
      [jobId]: !prev[jobId],
    }));
  };

  const { data: jobs = [] } = useQuery<JobRecord[]>({
    queryKey: ["adminJobs", token],
    queryFn: () => fetchWithAuth<JobRecord[]>("/admin/jobs", token),
    enabled: Boolean(token),
    refetchInterval: 2000,
  });

  const filteredJobs = jobs.filter((j: JobRecord) => {
    if (statusFilter !== "all" && j.status !== statusFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchId = (j.id || "").toLowerCase().includes(q);
      const matchPrompt = (j.fullPrompt || "").toLowerCase().includes(q);
      const matchUser = (j.userId || "").toLowerCase().includes(q);
      const matchIterations = j.iterations?.some(
        (it) =>
          (it.id || "").toLowerCase().includes(q) ||
          (it.fullPrompt || it.promptPreview || "").toLowerCase().includes(q)
      );
      if (!matchId && !matchPrompt && !matchUser && !matchIterations) return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">Submissions</h1>
          <p className="text-xs text-[var(--dim)] mt-0.5">
            Full audit log of all distributed tasks across the platform. Multiple follow-up prompts are grouped under one submission.
          </p>
        </div>

        {/* Search & Filter Controls */}
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-[var(--dim)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search prompt, task ID or user..."
              className="bg-[var(--surface)] border border-[var(--line)] rounded-xl pl-9 pr-4 py-2 text-xs focus:outline-none focus:border-[var(--accent)] text-[var(--text)]"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-[var(--surface)] border border-[var(--line)] rounded-xl px-3 py-2 text-xs text-[var(--dim)] focus:outline-none focus:border-[var(--accent)]"
          >
            <option value="all">All Statuses</option>
            <option value="working">Working</option>
            <option value="done">Done</option>
            <option value="failed">Failed</option>
          </select>
        </div>
      </div>

      {/* Submissions Table */}
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--line)] overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[var(--line)] bg-[var(--surface-2)] text-[var(--dim)] font-mono uppercase tracking-wider text-[11px]">
                <th className="p-4 w-12 text-center"></th>
                <th className="p-4 w-28 whitespace-nowrap">Time</th>
                <th className="p-4 w-44 whitespace-nowrap">Submission ID</th>
                <th className="p-4 min-w-[220px]">Prompt Excerpt</th>
                <th className="p-4 w-20 whitespace-nowrap">Mode</th>
                <th className="p-4 w-20 whitespace-nowrap">Parts</th>
                <th className="p-4 w-32 whitespace-nowrap">Status</th>
                <th className="p-4 w-24 whitespace-nowrap">Reassigned</th>
                <th className="p-4 w-24 text-right whitespace-nowrap">Actions</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-[var(--line)]">
              {filteredJobs.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-[var(--dim)]">
                    No submissions found.
                  </td>
                </tr>
              ) : (
                filteredJobs.map((job: JobRecord) => {
                  const hasMultipleTasks = (job.iterationCount && job.iterationCount > 1) || (job.iterations && job.iterations.length > 1);
                  const isExpanded = Boolean(expandedSubmissions[job.id]);
                  const taskCount = job.iterationCount || job.iterations?.length || 1;

                  return (
                    <React.Fragment key={job.id}>
                      <tr
                        onClick={() => router.push(`/admin/jobs/${job.latestJobId || job.id}`)}
                        className={`hover:bg-[var(--surface-2)] transition-colors cursor-pointer ${
                          isExpanded ? "bg-[var(--surface-2)]/40" : ""
                        }`}
                      >
                        <td className="p-4 text-center">
                          {hasMultipleTasks ? (
                            <button
                              type="button"
                              onClick={(e) => toggleExpand(job.id, e)}
                              className="p-1 rounded hover:bg-[var(--surface)] border border-transparent hover:border-[var(--line)] transition-colors text-[var(--accent)] cursor-pointer"
                              title={isExpanded ? "Collapse related tasks" : "Expand all related tasks"}
                            >
                              {isExpanded ? (
                                <ChevronDown className="w-4 h-4" />
                              ) : (
                                <ChevronRight className="w-4 h-4" />
                              )}
                            </button>
                          ) : (
                            <span className="w-4 h-4 inline-block text-[var(--dim)] opacity-40">·</span>
                          )}
                        </td>
                        <td className="p-4 text-[var(--dim)] font-mono whitespace-nowrap">
                          {job.createdAt ? new Date(job.createdAt).toLocaleTimeString() : "-"}
                        </td>
                        <td className="p-4 font-mono font-semibold text-[var(--text)]">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span>{job.id}</span>
                            {hasMultipleTasks && (
                              <span
                                onClick={(e) => toggleExpand(job.id, e)}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold font-mono bg-[rgba(91,108,255,0.12)] text-[var(--accent)] border border-[rgba(91,108,255,0.2)] hover:bg-[rgba(91,108,255,0.2)] transition-colors cursor-pointer"
                                title="Click to view all tasks under this submission"
                              >
                                <Layers className="w-3 h-3" />
                                <span>{taskCount} tasks</span>
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-4 text-[var(--text)] font-medium max-w-xs truncate" title={job.latestPrompt || job.fullPrompt || job.promptPreview}>
                          {job.latestPrompt || job.fullPrompt || job.promptPreview || "-"}
                        </td>
                        <td className="p-4">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase font-mono ${
                              job.mode === "exact"
                                ? "bg-[rgba(74,222,154,0.15)] text-[var(--ok)]"
                                : "bg-[rgba(124,140,255,0.15)] text-[var(--accent)]"
                            }`}
                          >
                            {job.mode}
                          </span>
                        </td>
                        <td className="p-4 font-mono text-[var(--text)]">{job.partCount || "-"}</td>
                        <td className="p-4">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
                              job.status === "done"
                                ? "status-done"
                                : job.status === "failed"
                                ? "status-crashed"
                                : "status-working"
                            }`}
                          >
                            {job.stepLabel || job.status}
                          </span>
                        </td>
                        <td className="p-4 font-mono text-[var(--warn)]">
                          {job.reassignments || 0}
                        </td>
                        <td className="p-4 text-right">
                          <span className="text-[var(--accent)] inline-flex items-center gap-1 font-semibold">
                            <span>Inspect</span>
                            <ExternalLink className="w-3.5 h-3.5" />
                          </span>
                        </td>
                      </tr>

                      {/* Expandable Accordion: All Related Tasks in Submission */}
                      {isExpanded && hasMultipleTasks && (
                        <tr className="bg-[var(--surface-2)]/60">
                          <td colSpan={9} className="p-4 pl-12 pr-6 border-b border-[var(--line)]">
                            <div className="space-y-3">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <Layers className="w-3.5 h-3.5 text-[var(--accent)]" />
                                  <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-[var(--accent)]">
                                    All Related Tasks in Submission ({taskCount} Total)
                                  </span>
                                </div>
                                <span className="text-[11px] text-[var(--dim)] font-mono">
                                  Root ID: {job.rootJobId || job.id}
                                </span>
                              </div>

                              <div className="space-y-2">
                                {job.iterations?.map((iter: TaskIteration, itIdx: number) => (
                                  <div
                                    key={iter.id}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      router.push(`/admin/jobs/${iter.id}`);
                                    }}
                                    className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-3 rounded-xl bg-[var(--surface)] border border-[var(--line)] hover:border-[var(--accent)] transition-all cursor-pointer shadow-sm group"
                                  >
                                    <div className="flex items-center gap-3 min-w-0">
                                      <span className="px-2 py-0.5 rounded text-[10px] font-bold font-mono uppercase bg-[rgba(91,108,255,0.12)] text-[var(--accent)] shrink-0">
                                        Task #{iter.iteration || itIdx + 1}
                                      </span>
                                      <span className="font-mono text-xs text-[var(--dim)] shrink-0">
                                        {iter.id}
                                      </span>
                                      <p className="text-xs text-[var(--text)] font-medium truncate max-w-md group-hover:text-[var(--accent)] transition-colors">
                                        {iter.fullPrompt || iter.promptPreview || "Untitled prompt"}
                                      </p>
                                    </div>

                                    <div className="flex items-center gap-4 shrink-0 text-xs">
                                      <span className="font-mono text-[var(--dim)]">
                                        {iter.partCount || "-"} parts
                                      </span>
                                      <span
                                        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase font-mono ${
                                          iter.status === "done"
                                            ? "status-done"
                                            : iter.status === "failed"
                                            ? "status-crashed"
                                            : "status-working"
                                        }`}
                                      >
                                        {iter.status}
                                      </span>
                                      <span className="text-[var(--dim)] font-mono">
                                        {iter.createdAt ? new Date(iter.createdAt).toLocaleTimeString() : "-"}
                                      </span>
                                      <span className="text-[var(--accent)] font-semibold inline-flex items-center gap-1 group-hover:underline">
                                        <span>Inspect</span>
                                        <ExternalLink className="w-3 h-3" />
                                      </span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
