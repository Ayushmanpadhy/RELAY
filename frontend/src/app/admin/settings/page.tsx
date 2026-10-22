"use client";

import React, { useState, useEffect } from "react";
import { useAdminAuth } from "@/context/AdminAuthContext";
import { fetchWithAuth } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { Save, CheckCircle2, RotateCw, Trash2, AlertTriangle } from "lucide-react";
import { ProviderRecord } from "@/lib/types";

interface RuntimeSettings {
  callMode?: string;
  maxConcurrency?: number;
  maxAttempts?: number;
}

export default function AdminSettingsPage() {
  const { token } = useAdminAuth();
  const [callMode, setCallMode] = useState("batched");
  const [concurrency, setConcurrency] = useState(10);
  const [maxAttempts, setMaxAttempts] = useState(4);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [probeResult, setProbeResult] = useState<ProviderRecord[] | null>(null);
  const [probing, setProbing] = useState(false);
  const [clearingHistory, setClearingHistory] = useState(false);
  const [clearSuccess, setClearSuccess] = useState(false);
  const [clearMessage, setClearMessage] = useState("");

  const { data: currentSettings, refetch } = useQuery<RuntimeSettings>({
    queryKey: ["adminSettings", token],
    queryFn: () => fetchWithAuth<RuntimeSettings>("/admin/settings", token),
    enabled: Boolean(token),
  });

  useEffect(() => {
    if (!currentSettings) return;
    const timer = setTimeout(() => {
      if (currentSettings.callMode) setCallMode(currentSettings.callMode);
      if (currentSettings.maxConcurrency) setConcurrency(currentSettings.maxConcurrency);
      if (currentSettings.maxAttempts) setMaxAttempts(currentSettings.maxAttempts);
    }, 0);
    return () => clearTimeout(timer);
  }, [currentSettings]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveSuccess(false);
    try {
      await fetchWithAuth("/admin/settings", token, {
        method: "PUT",
        body: JSON.stringify({
          callMode,
          maxConcurrency: Number(concurrency),
          maxAttempts: Number(maxAttempts),
        }),
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      refetch();
    } catch {
      // ignore
    }
  };

  const handleRunProbe = async () => {
    setProbing(true);
    setProbeResult(null);
    try {
      const res = await fetchWithAuth<ProviderRecord[]>("/admin/probe", token, { method: "POST" });
      setProbeResult(res);
    } catch {
      // ignore
    } finally {
      setProbing(false);
    }
  };

  const handleClearHistory = async () => {
    if (
      !window.confirm(
        "Are you sure you want to clear all database history? This will delete all past submissions, internal tasks, audit logs, and uploads for a clean presentation."
      )
    ) {
      return;
    }
    setClearingHistory(true);
    setClearSuccess(false);
    try {
      const res = await fetchWithAuth<{ status: string; message: string }>(
        "/admin/clear-history",
        token,
        {
          method: "POST",
        }
      );
      setClearSuccess(true);
      setClearMessage(res.message || "Database history cleared successfully!");
      setTimeout(() => setClearSuccess(false), 5000);
      refetch();
    } catch (err: unknown) {
      alert(
        "Failed to clear database history: " +
          (err instanceof Error ? err.message : String(err))
      );
    } finally {
      setClearingHistory(false);
    }
  };

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">Platform Settings</h1>
        <p className="text-xs text-[var(--dim)] mt-0.5">
          Tune distributed runtime parameters, call batching modes, and test live AI provider availability.
        </p>
      </div>

      {saveSuccess && (
        <div className="p-4 rounded-xl bg-[rgba(74,222,154,0.12)] border border-[var(--ok)] text-[var(--ok)] text-xs font-mono flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          <span>Runtime settings saved and propagated to worker pool.</span>
        </div>
      )}

      {/* Runtime Settings Form */}
      <form onSubmit={handleSave} className="bg-[var(--surface)] p-6 rounded-2xl border border-[var(--line)] space-y-6">
        <div>
          <label className="block text-xs font-mono uppercase text-[var(--dim)] mb-2">
            Worker Call Mode (FR-D5)
          </label>
          <div className="grid grid-cols-2 gap-3 max-w-md">
            <button
              type="button"
              onClick={() => setCallMode("batched")}
              className={`p-3 rounded-xl border text-left text-xs transition-colors ${
                callMode === "batched"
                  ? "bg-[var(--surface-2)] border-[var(--accent)] text-[var(--accent)] font-semibold"
                  : "bg-[var(--surface)] border-[var(--line)] text-[var(--dim)]"
              }`}
            >
              <div className="font-bold text-sm mb-1">Batched (Default)</div>
              <div>Groups up to 10 parts per provider call. Highly cost &amp; quota efficient.</div>
            </button>
            <button
              type="button"
              onClick={() => setCallMode("individual")}
              className={`p-3 rounded-xl border text-left text-xs transition-colors ${
                callMode === "individual"
                  ? "bg-[var(--surface-2)] border-[var(--accent)] text-[var(--accent)] font-semibold"
                  : "bg-[var(--surface)] border-[var(--line)] text-[var(--dim)]"
              }`}
            >
              <div className="font-bold text-sm mb-1">Individual</div>
              <div>One call per sub-task. High concurrency distribution across all nodes.</div>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-xs font-mono uppercase text-[var(--dim)] mb-2">
              Global Concurrency Limit ({concurrency} workers)
            </label>
            <input
              type="range"
              min={1}
              max={30}
              value={concurrency}
              onChange={(e) => setConcurrency(Number(e.target.value))}
              className="w-full accent-[var(--accent)]"
            />
          </div>

          <div>
            <label className="block text-xs font-mono uppercase text-[var(--dim)] mb-2">
              Max Retry Attempts Per Part ({maxAttempts} attempts)
            </label>
            <input
              type="range"
              min={1}
              max={6}
              value={maxAttempts}
              onChange={(e) => setMaxAttempts(Number(e.target.value))}
              className="w-full accent-[var(--accent)]"
            />
          </div>
        </div>

        <div className="pt-4 border-t border-[var(--line)] flex justify-end">
          <button
            type="submit"
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl font-semibold text-xs bg-[var(--accent)] text-[#0B0D12] hover:bg-[#919fff] transition-colors shadow-md"
          >
            <Save className="w-4 h-4" />
            <span>Save Runtime Settings</span>
          </button>
        </div>
      </form>

      {/* Provider Probe Runner */}
      <section className="bg-[var(--surface)] p-6 rounded-2xl border border-[var(--line)]">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold tracking-tight text-[var(--text)]">
              Manual Provider Probe
            </h2>
            <p className="text-xs text-[var(--dim)] mt-0.5">
              Live ping each provider&apos;s models list and 1-token test to confirm credentials and model health.
            </p>
          </div>
          <button
            onClick={handleRunProbe}
            disabled={probing}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] hover:border-[var(--accent)] text-xs font-mono text-[var(--text)] transition-colors"
          >
            <RotateCw className={`w-3.5 h-3.5 ${probing ? "animate-spin" : ""}`} />
            <span>{probing ? "Probing..." : "Run Probe"}</span>
          </button>
        </div>

        {probeResult && (
          <div className="mt-4 space-y-2">
            {probeResult.map((pr: ProviderRecord) => (
              <div
                key={pr.provider_id}
                className="p-3 bg-[var(--surface-2)] rounded-xl border border-[var(--line)] flex items-center justify-between text-xs font-mono"
              >
                <div>
                  <span className="font-bold text-[var(--text)] mr-2">{pr.name}</span>
                  <span className="text-[var(--dim)]">({pr.model})</span>
                  <p className="text-[11px] text-[var(--dim)] mt-0.5">{pr.reason}</p>
                </div>
                <span
                  className={`px-2 py-0.5 rounded uppercase font-bold text-[10px] ${
                    pr.state === "healthy" ? "status-done" : "status-crashed"
                  }`}
                >
                  {pr.state}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Presentation / Demo Database Reset */}
      <section className="bg-[var(--surface)] p-6 rounded-2xl border border-[rgba(239,68,68,0.25)] space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-[var(--bad)] font-semibold text-base">
              <AlertTriangle className="w-4 h-4" />
              <h2>Presentation &amp; Demo Reset</h2>
            </div>
            <p className="text-xs text-[var(--dim)]">
              Permanently purges all past job submissions, partition records, event logs, and uploaded files. Registered accounts are kept intact.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClearHistory}
            disabled={clearingHistory}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold bg-[rgba(239,68,68,0.12)] text-[var(--bad)] hover:bg-[rgba(239,68,68,0.2)] border border-[rgba(239,68,68,0.3)] transition-all cursor-pointer shrink-0 disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{clearingHistory ? "Purging History..." : "Clear Database History"}</span>
          </button>
        </div>

        {clearSuccess && (
          <div className="p-3.5 rounded-xl bg-[rgba(74,222,154,0.12)] border border-[var(--ok)] text-[var(--ok)] text-xs font-mono flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{clearMessage}</span>
          </div>
        )}
      </section>
    </div>
  );
}
