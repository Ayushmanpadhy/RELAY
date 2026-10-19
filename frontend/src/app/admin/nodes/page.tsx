"use client";

import React, { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { fetchWithAuth } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import {
  Flame,
  CheckCircle,
} from "lucide-react";
import { ProviderRecord } from "@/lib/types";

interface ChaosOverview {
  providers?: ProviderRecord[];
}

export default function AdminNodesChaosPage() {
  const { token } = useAuth();
  const [targetNode, setTargetNode] = useState("node-005");
  const [targetProvider, setTargetProvider] = useState("groq");
  const [duration, setDuration] = useState(30);
  const [chaosMessage, setChaosMessage] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  const { data: overview, refetch } = useQuery<ChaosOverview>({
    queryKey: ["adminNodesChaos", token],
    queryFn: () => fetchWithAuth<ChaosOverview>("/admin/overview", token),
    enabled: Boolean(token),
    refetchInterval: 1500,
  });

  const providers: ProviderRecord[] = overview?.providers || [];

  const handleCrashNode = async () => {
    if (!window.confirm(`Simulated failure: Are you sure you want to crash node ${targetNode}? In-flight tasks will automatically re-route.`)) {
      return;
    }
    setActionLoading(true);
    setChaosMessage("");
    try {
      await fetchWithAuth("/admin/chaos/crash-node", token, {
        method: "POST",
        body: JSON.stringify({ nodeId: targetNode }),
      });
      setChaosMessage(`Simulated crash triggered on ${targetNode}. Tasks will re-route.`);
      refetch();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Crash failed";
      setChaosMessage(`Error: ${msg}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleCrashProvider = async () => {
    if (!window.confirm(`Simulated failure: Are you sure you want to trigger a simulated outage on ${targetProvider} for ${duration}s?`)) {
      return;
    }
    setActionLoading(true);
    setChaosMessage("");
    try {
      await fetchWithAuth("/admin/chaos/crash-provider", token, {
        method: "POST",
        body: JSON.stringify({ provider: targetProvider, seconds: duration }),
      });
      setChaosMessage(`Simulated crash: ${targetProvider} disabled for ${duration}s. Failover active.`);
      refetch();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Provider crash failed";
      setChaosMessage(`Error: ${msg}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleHealAll = async () => {
    if (!window.confirm("Restore: Are you sure you want to reset all simulated crashes and circuit breakers?")) {
      return;
    }
    setActionLoading(true);
    setChaosMessage("");
    try {
      await fetchWithAuth("/admin/chaos/heal", token, {
        method: "POST",
      });
      setChaosMessage("All nodes and provider circuits healed successfully.");
      refetch();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Heal failed";
      setChaosMessage(`Error: ${msg}`);
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">
          Nodes &amp; Chaos Controls
        </h1>
        <p className="text-xs text-[var(--dim)] mt-0.5">
          Inject simulated hardware and API provider failures to demonstrate automatic platform resilience.
        </p>
      </div>

      {/* Chaos Control Panel */}
      <section className="bg-[var(--surface)] p-6 rounded-2xl border border-[var(--bad)] shadow-[0_0_24px_rgba(255,107,107,0.08)]">
        <div className="flex items-center gap-2.5 text-sm font-bold text-[var(--bad)] uppercase tracking-wider mb-4">
          <Flame className="w-5 h-5 text-[var(--bad)]" />
          <span>Simulated Failure Injection Controls</span>
        </div>

        {chaosMessage && (
          <div className="mb-6 p-3 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] text-xs font-mono text-[var(--accent)] flex items-center gap-2">
            <CheckCircle className="w-4 h-4 shrink-0 text-[var(--ok)]" />
            <span>{chaosMessage}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Action 1: Crash Node */}
          <div className="bg-[var(--surface-2)] p-5 rounded-xl border border-[var(--line)] flex flex-col justify-between space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-[var(--text)] mb-1">Crash Worker Node</h3>
              <p className="text-xs text-[var(--dim)] leading-relaxed">
                Kills a specific worker slot mid-flight. Its active sub-task will be immediately
                reassigned.
              </p>
            </div>
            <div className="space-y-3">
              <input
                type="text"
                value={targetNode}
                onChange={(e) => setTargetNode(e.target.value)}
                placeholder="node-005"
                className="w-full bg-[var(--surface)] border border-[var(--line)] rounded-xl px-3 py-2 text-xs font-mono focus:outline-none focus:border-[var(--bad)]"
              />
              <button
                onClick={handleCrashNode}
                disabled={actionLoading}
                className="w-full py-2.5 rounded-xl text-xs font-bold font-mono uppercase bg-[var(--bad)] text-white hover:bg-[#ff5252] transition-colors"
              >
                Crash Node
              </button>
            </div>
          </div>

          {/* Action 2: Crash Provider */}
          <div className="bg-[var(--surface-2)] p-5 rounded-xl border border-[var(--line)] flex flex-col justify-between space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-[var(--text)] mb-1">Crash Provider (N sec)</h3>
              <p className="text-xs text-[var(--dim)] leading-relaxed">
                Simulates 500 server errors or quota exhaustion. Circuit breaker will open.
              </p>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={targetProvider}
                  onChange={(e) => setTargetProvider(e.target.value)}
                  className="bg-[var(--surface)] border border-[var(--line)] rounded-xl px-2 py-2 text-xs font-mono focus:outline-none"
                >
                  <option value="groq">Groq</option>
                  <option value="gemini">Gemini</option>
                  <option value="mistral">Mistral</option>
                  <option value="github">GitHub</option>
                  <option value="gemini_lite">Gemini Lite</option>
                </select>
                <select
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  className="bg-[var(--surface)] border border-[var(--line)] rounded-xl px-2 py-2 text-xs font-mono focus:outline-none"
                >
                  <option value={15}>15 seconds</option>
                  <option value={30}>30 seconds</option>
                  <option value={60}>60 seconds</option>
                </select>
              </div>
              <button
                onClick={handleCrashProvider}
                disabled={actionLoading}
                className="w-full py-2.5 rounded-xl text-xs font-bold font-mono uppercase bg-[var(--bad)] text-white hover:bg-[#ff5252] transition-colors"
              >
                Simulate Provider Outage
              </button>
            </div>
          </div>

          {/* Action 3: Heal All */}
          <div className="bg-[var(--surface-2)] p-5 rounded-xl border border-[var(--line)] flex flex-col justify-between space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-[var(--text)] mb-1">Heal All Systems</h3>
              <p className="text-xs text-[var(--dim)] leading-relaxed">
                Clears all simulated crashes, resets provider circuit breakers, and restores all 100
                nodes to healthy idle state.
              </p>
            </div>
            <div>
              <button
                onClick={handleHealAll}
                disabled={actionLoading}
                className="w-full py-2.5 rounded-xl text-xs font-bold font-mono uppercase bg-[var(--ok)] text-black hover:bg-[#3ecb8b] transition-colors shadow-md shadow-[rgba(74,222,154,0.2)]"
              >
                Heal All Nodes &amp; Circuits
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Providers Table */}
      <section className="bg-[var(--surface)] rounded-2xl border border-[var(--line)] p-6">
        <h2 className="text-base font-semibold tracking-tight text-[var(--text)] mb-4">
          Configured Provider Endpoints
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs font-mono">
            <thead>
              <tr className="border-b border-[var(--line)] bg-[var(--surface-2)] text-[var(--dim)] uppercase tracking-wider text-[11px]">
                <th className="p-3">Provider</th>
                <th className="p-3">Model</th>
                <th className="p-3">State</th>
                <th className="p-3">Circuit</th>
                <th className="p-3">Latency</th>
                <th className="p-3">Error Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {providers.map((p: ProviderRecord) => (
                <tr key={p.id}>
                  <td className="p-3 font-semibold text-[var(--text)]">{p.name}</td>
                  <td className="p-3 text-[var(--dim)]">{p.model}</td>
                  <td className="p-3">
                    <span
                      className={`px-2 py-0.5 rounded uppercase font-bold text-[10px] ${
                        p.state === "healthy"
                          ? "status-done"
                          : p.state === "unavailable"
                          ? "status-idle"
                          : "status-crashed"
                      }`}
                    >
                      {p.state}
                    </span>
                  </td>
                  <td className="p-3 uppercase text-[var(--text)]">{p.circuit}</td>
                  <td className="p-3 text-[var(--dim)]">{p.latencyMs}ms</td>
                  <td className="p-3 text-[var(--dim)]">{p.errorRate * 100}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
