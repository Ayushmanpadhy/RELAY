"use client";

import React, { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useAdminAuth } from "@/context/AdminAuthContext";
import { fetchWithAuth } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Layers,
} from "lucide-react";
import { JobRecord, PartRecord, PartAttempt } from "@/lib/types";

interface IterationDetail {
  job: JobRecord;
  parts: PartRecord[];
}

interface JobDetailResponse {
  job: JobRecord;
  parts: PartRecord[];
  rootJobId?: string;
  iteration?: number;
  iterationCount?: number;
  iterations?: IterationDetail[];
}

export default function AdminJobDetailPage() {
  const params = useParams();
  const jobId = params?.id as string;
  const { token } = useAdminAuth();
  const [selectedIterationId, setSelectedIterationId] = useState<string>(jobId);
  const [expandedPartId, setExpandedPartId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"plan" | "parts" | "outputs" | "result">("parts");

  const { data } = useQuery<JobDetailResponse>({
    queryKey: ["adminJobDetail", jobId, token],
    queryFn: () => fetchWithAuth<JobDetailResponse>(`/admin/jobs/${jobId}`, token),
    enabled: Boolean(jobId && token),
    refetchInterval: (query) => {
      const resp = query.state.data;
      if (!resp) return 1500;
      const anyRunning =
        resp.iterations?.some(
          (it) => it.job.status !== "done" && it.job.status !== "failed"
        ) ||
        (resp.job.status !== "done" && resp.job.status !== "failed");
      return anyRunning ? 1500 : false;
    },
  });

  const activeIteration =
    data?.iterations?.find((it) => it.job.id === selectedIterationId) || {
      job: data?.job,
      parts: data?.parts || [],
    };

  const job = activeIteration.job;
  const parts: PartRecord[] = activeIteration.parts || [];

  if (!job) {
    return (
      <div className="p-8 text-center text-sm font-mono text-[var(--dim)]">
        Loading job details...
      </div>
    );
  }

  const plan = job.plan || {};
  const threadIterations = data?.iterations || [];
  const hasMultipleTasks = threadIterations.length > 1;

  return (
    <div className="space-y-6">
      {/* Back button & Title */}
      <div className="flex items-center justify-between">
        <Link
          href="/admin/submissions"
          className="flex items-center gap-2 text-xs font-mono text-[var(--dim)] hover:text-[var(--text)] transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>All Submissions</span>
        </Link>
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-[var(--dim)]">
            Submission Root: {data?.rootJobId || job.rootJobId || job.id}
          </span>
          <span className="text-xs font-mono px-2 py-0.5 rounded bg-[var(--surface-2)] text-[var(--accent)] font-semibold">
            Task ID: {job.id}
          </span>
        </div>
      </div>

      {/* Submission Iterations Switcher Strip (If multiple tasks in thread) */}
      {hasMultipleTasks && (
        <div className="bg-[var(--surface)] p-5 rounded-2xl border border-[var(--line)] shadow-sm space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-[var(--accent)]" />
              <span className="text-xs font-mono font-bold uppercase tracking-wider text-[var(--accent)]">
                Submission Tasks ({threadIterations.length} In This Thread)
              </span>
            </div>
            <span className="text-[11px] text-[var(--dim)]">
              Select any task to inspect its partition, nodes, AI trail and outputs
            </span>
          </div>

          <div className="flex items-center gap-2.5 overflow-x-auto pb-1 scrollbar-thin">
            {threadIterations.map((it, idx) => {
              const itJob = it.job;
              const isSelected = itJob.id === (selectedIterationId || data?.job?.id);
              return (
                <button
                  key={itJob.id}
                  type="button"
                  onClick={() => {
                    setSelectedIterationId(itJob.id);
                    setExpandedPartId(null);
                  }}
                  className={`px-4 py-3 rounded-xl text-left border transition-all shrink-0 min-w-[240px] max-w-[320px] cursor-pointer ${
                    isSelected
                      ? "bg-[rgba(91,108,255,0.08)] border-[var(--accent)] shadow-sm text-[var(--text)]"
                      : "bg-[var(--surface-2)] border-[var(--line)] text-[var(--dim)] hover:text-[var(--text)] hover:border-[var(--dim)]"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[var(--accent)]">
                      Task #{itJob.iteration || idx + 1}
                    </span>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase font-mono ${
                        itJob.status === "done"
                          ? "status-done"
                          : itJob.status === "failed"
                          ? "status-crashed"
                          : "status-working"
                      }`}
                    >
                      {itJob.status}
                    </span>
                  </div>
                  <p className="text-xs font-medium truncate" title={itJob.fullPrompt || itJob.promptPreview}>
                    {itJob.fullPrompt || itJob.promptPreview || "Untitled prompt"}
                  </p>
                  <div className="flex items-center justify-between mt-2 text-[10px] font-mono text-[var(--dim)]">
                    <span>{itJob.partCount || it.parts?.length || 10} parts</span>
                    <span>{itJob.createdAt ? new Date(itJob.createdAt).toLocaleTimeString() : ""}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Summary Stat Strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-[var(--surface)] p-4 rounded-xl border border-[var(--line)]">
          <p className="text-[11px] font-mono text-[var(--dim)] uppercase">Mode</p>
          <p className="text-lg font-bold font-mono text-[var(--accent)] uppercase">{job.mode}</p>
        </div>
        <div className="bg-[var(--surface)] p-4 rounded-xl border border-[var(--line)]">
          <p className="text-[11px] font-mono text-[var(--dim)] uppercase">Parts Count</p>
          <p className="text-lg font-bold font-mono text-[var(--text)]">{job.partCount || parts.length}</p>
        </div>
        <div className="bg-[var(--surface)] p-4 rounded-xl border border-[var(--line)]">
          <p className="text-[11px] font-mono text-[var(--dim)] uppercase">Reassignments</p>
          <p className="text-lg font-bold font-mono text-[var(--warn)]">{job.reassignments || 0}</p>
        </div>
        <div className="bg-[var(--surface)] p-4 rounded-xl border border-[var(--line)]">
          <p className="text-[11px] font-mono text-[var(--dim)] uppercase">Crashed Attempts</p>
          <p className="text-lg font-bold font-mono text-[var(--bad)]">{job.crashedAttempts || 0}</p>
        </div>
        <div className="bg-[var(--surface)] p-4 rounded-xl border border-[var(--line)]">
          <p className="text-[11px] font-mono text-[var(--dim)] uppercase">Status</p>
          <p className="text-lg font-bold capitalize text-[var(--ok)]">{job.status}</p>
        </div>
      </div>

      {/* User Request Prompt Card */}
      <div className="bg-[var(--surface)] p-6 rounded-2xl border border-[var(--line)]">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-mono text-[var(--dim)] uppercase tracking-wider">
            {hasMultipleTasks ? `Task #${job.iteration || 1} Prompt` : "User Submission Prompt"}
          </h3>
          <span className="text-[11px] font-mono text-[var(--dim)]">
            Created: {job.createdAt ? new Date(job.createdAt).toLocaleString() : "-"}
          </span>
        </div>
        <p className="text-sm text-[var(--text)] leading-relaxed font-sans">{job.fullPrompt}</p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-[var(--line)] pb-2 text-xs font-medium">
        <button
          onClick={() => setActiveTab("parts")}
          className={`px-4 py-2 rounded-xl transition-colors ${
            activeTab === "parts"
              ? "bg-[var(--surface-2)] text-[var(--accent)] font-semibold"
              : "text-[var(--dim)] hover:text-[var(--text)]"
          }`}
        >
          Parts Distribution ({parts.length})
        </button>
        <button
          onClick={() => setActiveTab("plan")}
          className={`px-4 py-2 rounded-xl transition-colors ${
            activeTab === "plan"
              ? "bg-[var(--surface-2)] text-[var(--accent)] font-semibold"
              : "text-[var(--dim)] hover:text-[var(--text)]"
          }`}
        >
          Plan Specification
        </button>
        <button
          onClick={() => setActiveTab("outputs")}
          className={`px-4 py-2 rounded-xl transition-colors ${
            activeTab === "outputs"
              ? "bg-[var(--surface-2)] text-[var(--accent)] font-semibold"
              : "text-[var(--dim)] hover:text-[var(--text)]"
          }`}
        >
          Raw Part Outputs
        </button>
        <button
          onClick={() => setActiveTab("result")}
          className={`px-4 py-2 rounded-xl transition-colors ${
            activeTab === "result"
              ? "bg-[var(--surface-2)] text-[var(--accent)] font-semibold"
              : "text-[var(--dim)] hover:text-[var(--text)]"
          }`}
        >
          Delivered Result
        </button>
      </div>

      {/* Tab: Parts Distribution with Reassignment Trail */}
      {activeTab === "parts" && (
        <div className="bg-[var(--surface)] rounded-2xl border border-[var(--line)] overflow-hidden">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[var(--line)] bg-[var(--surface-2)] text-[var(--dim)] font-mono uppercase tracking-wider text-[11px]">
                <th className="p-3.5">Part ID</th>
                <th className="p-3.5">Size</th>
                <th className="p-3.5">Execution</th>
                <th className="p-3.5">Node</th>
                <th className="p-3.5">Provider</th>
                <th className="p-3.5">Attempts</th>
                <th className="p-3.5">Status</th>
                <th className="p-3.5">Trail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {parts.map((p) => {
                const isExpanded = expandedPartId === p.partId;
                const attempts = p.attempts || [];
                const hasReassignments = attempts.length > 1;

                return (
                  <React.Fragment key={p.partId}>
                    <tr
                      onClick={() => setExpandedPartId(isExpanded ? null : p.partId)}
                      className="hover:bg-[var(--surface-2)] transition-colors cursor-pointer"
                    >
                      <td className="p-3.5 font-mono font-semibold text-[var(--text)]">
                        {p.partId}
                      </td>
                      <td className="p-3.5 font-mono text-[var(--dim)]">{p.size} items</td>
                      <td className="p-3.5 font-mono uppercase text-[var(--accent)]">
                        {p.execution}
                      </td>
                      <td className="p-3.5 font-mono text-[var(--text)]">{p.nodeId || "-"}</td>
                      <td className="p-3.5 font-mono text-[var(--dim)]">{p.provider || "-"}</td>
                      <td className="p-3.5 font-mono font-bold">
                        <span
                          className={hasReassignments ? "text-[var(--warn)]" : "text-[var(--text)]"}
                        >
                          {attempts.length || 1}
                        </span>
                      </td>
                      <td className="p-3.5">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase font-mono ${
                            p.status === "done"
                              ? "status-done"
                              : p.status === "dead"
                              ? "status-crashed"
                              : "status-working"
                          }`}
                        >
                          {p.status}
                        </span>
                      </td>
                      <td className="p-3.5">
                        {hasReassignments ? (
                          <span className="text-xs text-[var(--warn)] font-mono flex items-center gap-1 font-semibold">
                            <span>Trail ({attempts.length})</span>
                            {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                          </span>
                        ) : (
                          <span className="text-[var(--dim)] text-xs font-mono">1 attempt</span>
                        )}
                      </td>
                    </tr>

                    {/* Reassignment Trail Accordion */}
                    {isExpanded && (
                      <tr className="bg-[var(--surface-2)]">
                        <td colSpan={8} className="p-4 pl-10 border-b border-[var(--line)]">
                          <p className="text-[11px] font-mono text-[var(--accent)] uppercase font-semibold mb-2">
                            Reassignment &amp; Execution Trail:
                          </p>
                          <div className="space-y-1.5 font-mono text-xs">
                            {attempts.map((att: PartAttempt, attIdx: number) => (
                              <div
                                key={attIdx}
                                className={`flex items-center gap-3 ${
                                  att.error ? "text-[var(--bad)]" : "text-[var(--ok)]"
                                }`}
                              >
                                <span className="font-bold">Attempt #{attIdx + 1}:</span>
                                <span>
                                  Node {att.nodeId} ({att.provider} / {att.model}) · {att.durationMs}ms
                                </span>
                                {att.error ? (
                                  <span className="text-[var(--bad)] font-medium">
                                    [FAILED: {att.error}]
                                  </span>
                                ) : (
                                  <span className="text-[var(--ok)]">[SUCCESS]</span>
                                )}
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab: Plan */}
      {activeTab === "plan" && (
        <div className="bg-[var(--surface)] p-6 rounded-2xl border border-[var(--line)] space-y-4 text-xs font-mono">
          <div>
            <span className="text-[var(--dim)]">Intent:</span>
            <p className="text-[var(--text)] font-sans text-sm mt-1">{plan.intent}</p>
          </div>
          <div>
            <span className="text-[var(--dim)]">Part Count &amp; Sizing Reason:</span>
            <p className="text-[var(--accent)] font-semibold mt-1">
              {job.partCount} parts ({plan.partCountReason || "Deterministic partition"})
            </p>
          </div>
          <div>
            <span className="text-[var(--dim)]">Reduce Strategy:</span>
            <p className="text-[var(--text)] uppercase mt-1">{plan.reduce}</p>
          </div>
          {plan.tool && (
            <div>
              <span className="text-[var(--dim)]">Exact Tool Bound:</span>
              <p className="text-[var(--ok)] font-semibold mt-1">
                {plan.tool} with args {JSON.stringify(plan.toolArgs)}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Tab: Raw Outputs */}
      {activeTab === "outputs" && (
        <div className="bg-[var(--surface)] p-6 rounded-2xl border border-[var(--line)] max-h-[500px] overflow-y-auto">
          <div className="space-y-3">
            {parts.map((p) => (
              <div
                key={p.partId}
                className="p-3 bg-[var(--surface-2)] rounded-xl border border-[var(--line)] font-mono text-xs"
              >
                <div className="flex justify-between items-center mb-1 text-[var(--accent)]">
                  <span className="font-bold">{p.partId} Output:</span>
                  <span className="text-[var(--dim)]">Node: {p.nodeId}</span>
                </div>
                <pre className="text-[var(--text)] whitespace-pre-wrap overflow-x-auto text-[11px]">
                  {JSON.stringify(p.output, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab: Delivered Result */}
      {activeTab === "result" && (
        <div className="bg-[var(--surface)] p-6 rounded-2xl border border-[var(--line)] space-y-4">
          <div className="text-xs font-mono text-[var(--ok)] uppercase tracking-wider">
            Delivered to User:
          </div>
          <h2 className="text-xl font-bold tracking-tight text-[var(--text)]">
            {job.result?.headline || "No result"}
          </h2>
          <div className="text-sm text-[var(--dim)] whitespace-pre-line leading-relaxed">
            {job.result?.explanation}
          </div>
        </div>
      )}
    </div>
  );
}
