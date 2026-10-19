"use client";

import React, { useState } from "react";
import { useAdminAuth } from "@/context/AdminAuthContext";
import { fetchWithAuth } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Server,
  AlertTriangle,
  RotateCcw,
  X,
} from "lucide-react";
import { NodeRecord, ProviderRecord, EventRecord } from "@/lib/types";

interface OverviewData {
  activeJobs: number;
  nodeCounts: { working: number; idle: number; crashed: number; recovering: number };
  nodes: NodeRecord[];
  totalReassignments: number;
  failureRate: number;
  avgCompletionTime: string;
  providers: ProviderRecord[];
  events: EventRecord[];
}

export default function AdminOverviewPage() {
  const { token } = useAdminAuth();
  const [selectedNode, setSelectedNode] = useState<NodeRecord | null>(null);

  // Poll overview data every 1 second for live real-time updates
  const { data: overview } = useQuery<OverviewData>({
    queryKey: ["adminOverview", token],
    queryFn: () => fetchWithAuth<OverviewData>("/admin/overview", token),
    enabled: Boolean(token),
    refetchInterval: 1000,
  });

  const nodeCounts = overview?.nodeCounts || { working: 0, idle: 100, crashed: 0, recovering: 0 };
  const nodes = overview?.nodes || [];
  const providers = overview?.providers || [];
  const events = overview?.events || [];

  return (
    <div className="space-y-8">
      {/* Stat Strip */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-[var(--surface)] p-5 rounded-2xl border border-[var(--line)] flex items-center justify-between">
          <div>
            <p className="text-xs font-mono text-[var(--dim)] uppercase tracking-wider mb-1">
              Active Jobs
            </p>
            <p className="text-3xl font-bold font-mono text-[var(--text)]">
              {overview?.activeJobs ?? 0}
            </p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-[rgba(124,140,255,0.12)] text-[var(--accent)] flex items-center justify-center">
            <Activity className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-[var(--surface)] p-5 rounded-2xl border border-[var(--line)] flex items-center justify-between">
          <div>
            <p className="text-xs font-mono text-[var(--dim)] uppercase tracking-wider mb-1">
              Nodes Working
            </p>
            <p className="text-3xl font-bold font-mono text-[var(--accent)]">
              {nodeCounts.working}
            </p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-[rgba(124,140,255,0.12)] text-[var(--accent)] flex items-center justify-center">
            <Server className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-[var(--surface)] p-5 rounded-2xl border border-[var(--line)] flex items-center justify-between">
          <div>
            <p className="text-xs font-mono text-[var(--dim)] uppercase tracking-wider mb-1">
              Nodes Crashed
            </p>
            <p className="text-3xl font-bold font-mono text-[var(--bad)]">
              {nodeCounts.crashed}
            </p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-[rgba(255,107,107,0.12)] text-[var(--bad)] flex items-center justify-center">
            <AlertTriangle className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-[var(--surface)] p-5 rounded-2xl border border-[var(--line)] flex items-center justify-between">
          <div>
            <p className="text-xs font-mono text-[var(--dim)] uppercase tracking-wider mb-1">
              Reassignments
            </p>
            <p className="text-3xl font-bold font-mono text-[var(--warn)]">
              {overview?.totalReassignments ?? 0}
            </p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-[rgba(245,179,90,0.12)] text-[var(--warn)] flex items-center justify-center">
            <RotateCcw className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Provider Health Strip */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold tracking-tight text-[var(--text)]">
            Provider Health Strip
          </h2>
          <span className="text-xs font-mono text-[var(--dim)]">5 Endpoints Configured</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          {providers.map((p: ProviderRecord) => {
            const isHealthy = p.state === "healthy";
            const isUnavailable = p.state === "unavailable";
            return (
              <div
                key={p.id}
                className="bg-[var(--surface)] p-4 rounded-xl border border-[var(--line)] flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-semibold text-sm">{p.name}</span>
                    <span
                      className={`w-2.5 h-2.5 rounded-full ${
                        isHealthy
                          ? "bg-[var(--ok)] shadow-[0_0_8px_var(--ok)]"
                          : isUnavailable
                          ? "bg-[var(--dim)]"
                          : "bg-[var(--bad)] shadow-[0_0_8px_var(--bad)]"
                      }`}
                    />
                  </div>
                  <p className="text-[11px] font-mono text-[var(--dim)] truncate mb-2">{p.model}</p>
                </div>
                <div className="pt-2 border-t border-[var(--line)] text-xs flex justify-between items-center text-[var(--dim)] font-mono">
                  <span>{p.latencyMs}ms</span>
                  <span
                    className={
                      isHealthy
                        ? "text-[var(--ok)] uppercase text-[10px]"
                        : isUnavailable
                        ? "text-[var(--dim)] uppercase text-[10px]"
                        : "text-[var(--bad)] uppercase text-[10px]"
                    }
                  >
                    {p.circuit || p.state}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 100-Node Live Grid */}
      <section className="bg-[var(--surface)] p-6 rounded-2xl border border-[var(--line)]">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-base font-semibold tracking-tight text-[var(--text)]">
              Worker Node Pool (100 Slots)
            </h2>
            <p className="text-xs text-[var(--dim)] mt-0.5">
              Live pull-based virtual workers with dynamic provider binding. Click a node to view its drawer.
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs font-mono">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-[var(--accent)]" /> Working ({nodeCounts.working})
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-[var(--dim)] opacity-50" /> Idle ({nodeCounts.idle})
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-[var(--bad)]" /> Crashed ({nodeCounts.crashed})
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-[var(--warn)]" /> Recovering ({nodeCounts.recovering})
            </span>
          </div>
        </div>

        {/* 100 Nodes Tile Grid */}
        <div className="grid grid-cols-10 sm:grid-cols-20 gap-2">
          {nodes.map((node: NodeRecord) => {
            const st = node.state || "idle";
            const bgClass =
              st === "working"
                ? "bg-[var(--accent)] text-black"
                : st === "crashed"
                ? "bg-[var(--bad)] text-white"
                : st === "recovering"
                ? "bg-[var(--warn)] text-black"
                : "bg-[var(--surface-2)] text-[var(--dim)] hover:bg-[var(--line)]";

            return (
              <button
                key={node.nodeId}
                onClick={() => setSelectedNode(node)}
                title={`${node.nodeId} · ${st} · Provider: ${node.provider}`}
                className={`h-8 rounded-lg flex items-center justify-center font-mono text-[10px] font-semibold transition-all transform hover:scale-110 cursor-pointer ${bgClass}`}
              >
                {node.nodeId.replace("node-", "")}
              </button>
            );
          })}
        </div>
      </section>

      {/* Live Activity Feed */}
      <section className="bg-[var(--surface)] p-6 rounded-2xl border border-[var(--line)]">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold tracking-tight text-[var(--text)]">
            Live Activity Feed
          </h2>
          <span className="text-xs font-mono text-[var(--dim)]">Rolling Window (500 events)</span>
        </div>
        <div className="space-y-2 max-h-72 overflow-y-auto pr-2">
          {events.length === 0 ? (
            <p className="text-xs text-[var(--dim)] font-mono py-4 text-center">
              No recent events. Submissions and cluster events will stream here live.
            </p>
          ) : (
            events.map((evt: EventRecord) => (
              <div
                key={evt.eventId}
                className="flex items-center justify-between py-2 border-b border-[var(--line)] text-xs font-mono"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                      evt.level === "ERROR"
                        ? "bg-[rgba(255,107,107,0.15)] text-[var(--bad)]"
                        : evt.level === "WARN"
                        ? "bg-[rgba(245,179,90,0.15)] text-[var(--warn)]"
                        : "bg-[rgba(74,222,154,0.15)] text-[var(--ok)]"
                    }`}
                  >
                    {evt.level}
                  </span>
                  <span className="text-[var(--text)]">{evt.message}</span>
                </div>
                <span className="text-[var(--dim)] shrink-0 ml-4">
                  {new Date(evt.ts * 1000).toLocaleTimeString()}
                </span>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Node Detail Side Drawer */}
      {selectedNode && (
        <div className="fixed inset-0 z-50 bg-[rgba(0,0,0,0.6)] backdrop-blur-xs flex justify-end">
          <div className="w-full max-w-md bg-[var(--surface)] border-l border-[var(--line)] h-full p-6 flex flex-col justify-between shadow-2xl">
            <div>
              <div className="flex items-center justify-between pb-4 border-b border-[var(--line)] mb-6">
                <div>
                  <h3 className="text-lg font-bold font-mono">{selectedNode.nodeId}</h3>
                  <p className="text-xs text-[var(--dim)]">Worker Slot Specification</p>
                </div>
                <button
                  onClick={() => setSelectedNode(null)}
                  className="p-2 rounded-lg bg-[var(--surface-2)] text-[var(--dim)] hover:text-[var(--text)]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-4 text-xs font-mono">
                <div className="flex justify-between py-2 border-b border-[var(--line)]">
                  <span className="text-[var(--dim)]">State:</span>
                  <span
                    className={`font-bold uppercase ${
                      selectedNode.state === "working"
                        ? "text-[var(--accent)]"
                        : selectedNode.state === "crashed"
                        ? "text-[var(--bad)]"
                        : selectedNode.state === "recovering"
                        ? "text-[var(--warn)]"
                        : "text-[var(--dim)]"
                    }`}
                  >
                    {selectedNode.state}
                  </span>
                </div>
                <div className="flex justify-between py-2 border-b border-[var(--line)]">
                  <span className="text-[var(--dim)]">Bound Provider:</span>
                  <span className="text-[var(--text)] font-semibold">{selectedNode.provider}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-[var(--line)]">
                  <span className="text-[var(--dim)]">Current Job:</span>
                  <span className="text-[var(--text)] truncate max-w-[200px]">
                    {selectedNode.currentJobId || "None"}
                  </span>
                </div>
                <div className="flex justify-between py-2 border-b border-[var(--line)]">
                  <span className="text-[var(--dim)]">Current Part:</span>
                  <span className="text-[var(--text)]">{selectedNode.currentPartId || "None"}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-[var(--line)]">
                  <span className="text-[var(--dim)]">Parts Completed:</span>
                  <span className="text-[var(--ok)] font-bold">{selectedNode.completed || 0}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-[var(--line)]">
                  <span className="text-[var(--dim)]">Parts Failed:</span>
                  <span className="text-[var(--bad)] font-bold">{selectedNode.failed || 0}</span>
                </div>
              </div>
            </div>

            <button
              onClick={() => setSelectedNode(null)}
              className="w-full py-2.5 rounded-xl bg-[var(--surface-2)] text-xs font-semibold hover:bg-[var(--line)] transition-colors"
            >
              Close Drawer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
