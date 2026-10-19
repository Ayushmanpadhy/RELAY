"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { fetchWithAuth } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { Search, ExternalLink } from "lucide-react";
import { JobRecord } from "@/lib/types";

export default function AdminSubmissionsPage() {
  const router = useRouter();
  const { token } = useAuth();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

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
      if (!matchId && !matchPrompt && !matchUser) return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">Submissions</h1>
          <p className="text-xs text-[var(--dim)] mt-0.5">
            Full audit log of all distributed tasks across the platform.
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
              placeholder="Search prompt or ID..."
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
                <th className="p-4">Time</th>
                <th className="p-4">Job ID</th>
                <th className="p-4">Prompt Excerpt</th>
                <th className="p-4">Mode</th>
                <th className="p-4">Parts</th>
                <th className="p-4">Status</th>
                <th className="p-4">Reassigned</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {filteredJobs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-[var(--dim)]">
                    No submissions found.
                  </td>
                </tr>
              ) : (
                filteredJobs.map((job: JobRecord) => (
                  <tr
                    key={job.id}
                    onClick={() => router.push(`/admin/jobs/${job.id}`)}
                    className="hover:bg-[var(--surface-2)] transition-colors cursor-pointer"
                  >
                    <td className="p-4 text-[var(--dim)] font-mono whitespace-nowrap">
                      {job.createdAt ? new Date(job.createdAt).toLocaleTimeString() : "-"}
                    </td>
                    <td className="p-4 font-mono font-semibold text-[var(--text)]">{job.id}</td>
                    <td className="p-4 text-[var(--text)] font-medium max-w-xs truncate" title={job.fullPrompt || job.promptPreview}>
                      {job.fullPrompt || job.promptPreview || "-"}
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
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
