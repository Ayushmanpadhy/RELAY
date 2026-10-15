import { useState } from 'react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { Play, CheckCircle2, TrendingUp, Info } from 'lucide-react';
import { api } from '../api/client';
import { useRelayStore } from '../store/relayStore';

interface BenchmarkRunResult {
  workers: number;
  durationSec: number;
  speedup: number;
  efficiencyPct: number;
}

export function Benchmark() {
  const { workers, workloads } = useRelayStore();

  const [workloadType, setWorkloadType] = useState<'primes' | 'pi' | 'wordcount'>('primes');
  const [size, setSize] = useState<'small' | 'medium' | 'large'>('small');
  const [selectedWorkerCounts, setSelectedWorkerCounts] = useState<number[]>([1, 2, 4]);

  const [running, setRunning] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState<number | null>(null);
  const [currentStepStatus, setCurrentStepStatus] = useState<string>('');
  const [benchmarkResults, setBenchmarkResults] = useState<BenchmarkRunResult[] | null>(null);

  const toggleWorkerCount = (count: number) => {
    if (selectedWorkerCounts.includes(count)) {
      if (selectedWorkerCounts.length > 1) {
        setSelectedWorkerCounts(selectedWorkerCounts.filter((c) => c !== count).sort((a, b) => a - b));
      }
    } else {
      setSelectedWorkerCounts([...selectedWorkerCounts, count].sort((a, b) => a - b));
    }
  };

  const handleRunBenchmark = async () => {
    if (running) return;
    setRunning(true);
    setBenchmarkResults(null);

    const initialLiveWorkers = workers.filter((w) => w.status !== 'DEAD' && w.status !== 'STOPPED').length;
    const sortedCounts = [...selectedWorkerCounts].sort((a, b) => a - b);
    const measuredResults: { workers: number; durationSec: number }[] = [];

    try {
      for (let i = 0; i < sortedCounts.length; i++) {
        const count = sortedCounts[i];
        setCurrentStepIndex(i);
        setCurrentStepStatus(`Scaling cluster to ${count} worker${count === 1 ? '' : 's'}...`);

        // 1. Scale cluster
        await api.scaleCluster(count);

        // Wait until at least count workers are IDLE
        let ready = false;
        const scaleStart = Date.now();
        while (!ready) {
          if (Date.now() - scaleStart > 25000) {
            throw new Error(`Timed out waiting for ${count} workers to become IDLE`);
          }
          await new Promise((r) => setTimeout(r, 400));
          const state = await api.fetchState();
          const liveIdle = state.workers.filter((w) => w.status === 'IDLE');
          if (liveIdle.length >= count) {
            ready = true;
          }
        }

        // 2. Submit Benchmark Job
        setCurrentStepStatus(`Running ${workloadType} with ${count} worker${count === 1 ? '' : 's'}...`);
        const currentWorkload = workloads.find((w) => w.type === workloadType);
        const presetParams = currentWorkload?.presets[size] || { limit: 1_000_000, chunks: 12 };

        const job = await api.createJob(workloadType, presetParams, 2);

        // 3. Poll until DONE
        let finished = false;
        let finishedJob: any = null;
        const jobStart = Date.now();

        while (!finished) {
          if (Date.now() - jobStart > 60000) {
            throw new Error('Benchmark job timed out');
          }
          await new Promise((r) => setTimeout(r, 400));
          const detail = await api.fetchJobDetail(job.id);
          if (detail.job.status === 'DONE') {
            finished = true;
            finishedJob = detail.job;
          } else if (detail.job.status === 'FAILED') {
            throw new Error(`Job failed: ${detail.job.error}`);
          } else {
            setCurrentStepStatus(
              `Running with ${count} worker${count === 1 ? '' : 's'} (${detail.job.done_tasks}/${detail.job.total_tasks} tasks)...`
            );
          }
        }

        const duration =
          finishedJob.started_at && finishedJob.finished_at
            ? (finishedJob.finished_at - finishedJob.started_at) / 1000
            : (Date.now() - jobStart) / 1000;

        measuredResults.push({
          workers: count,
          durationSec: Math.max(0.1, Number(duration.toFixed(2))),
        });
      }

      // Compute speedup and efficiency relative to baseline (first measurement or 1 worker)
      const baseDuration = measuredResults[0].durationSec;
      const baseWorkers = measuredResults[0].workers;

      const fullResults: BenchmarkRunResult[] = measuredResults.map((res) => {
        // speedup = T_base / T_n * (baseWorkers)
        const speedup = Number((baseDuration / res.durationSec).toFixed(2));
        const efficiencyPct = Math.min(100, Math.round((speedup / (res.workers / baseWorkers)) * 100));

        return {
          workers: res.workers,
          durationSec: res.durationSec,
          speedup,
          efficiencyPct,
        };
      });

      setBenchmarkResults(fullResults);
    } catch (err: any) {
      console.error('Benchmark failed:', err);
      alert(`Benchmark error: ${err.message}`);
    } finally {
      // Restore initial worker count
      setCurrentStepStatus('Restoring previous worker count...');
      await api.scaleCluster(initialLiveWorkers > 0 ? initialLiveWorkers : 3).catch(() => {});
      setRunning(false);
      setCurrentStepIndex(null);
      setCurrentStepStatus('');
    }
  };

  // Generate automated insight
  const insightText = () => {
    if (!benchmarkResults || benchmarkResults.length < 2) return null;
    const maxRun = benchmarkResults[benchmarkResults.length - 1];
    return `${maxRun.workers} workers achieved ${maxRun.speedup}x speedup with ${maxRun.efficiencyPct}% parallel efficiency.`;
  };

  return (
    <div className="min-h-screen bg-bg text-text-base pb-24">
      <main className="max-w-7xl mx-auto px-6 py-8 flex flex-col gap-8">
        <div>
          <h1 className="text-display font-medium text-text-base">Scalability Benchmark</h1>
          <p className="text-caption text-text-dim mt-1">
            Empirically measure speedup and parallel efficiency across dynamic worker pool configurations.
          </p>
        </div>

        {/* Controls */}
        <div className="bg-surface rounded-card p-6 border border-line grid grid-cols-1 md:grid-cols-4 gap-6 items-end">
          {/* Workload Select */}
          <div>
            <label className="text-tiny uppercase tracking-wider text-text-dim font-medium block mb-2">
              Workload
            </label>
            <select
              value={workloadType}
              onChange={(e) => setWorkloadType(e.target.value as any)}
              disabled={running}
              className="w-full bg-surface-2 border border-line rounded-btn p-2.5 text-caption text-text-base focus:outline-none focus:border-accent font-sans"
            >
              <option value="primes">Prime Counter</option>
              <option value="pi">Monte Carlo π</option>
              <option value="wordcount">MapReduce (Word Count)</option>
            </select>
          </div>

          {/* Size Select */}
          <div>
            <label className="text-tiny uppercase tracking-wider text-text-dim font-medium block mb-2">
              Scale Preset
            </label>
            <div className="grid grid-cols-3 gap-1 p-1 bg-surface-2 rounded-btn border border-line">
              {(['small', 'medium', 'large'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSize(s)}
                  disabled={running}
                  className={`py-1 text-tiny capitalize rounded-btn transition-colors ${
                    size === s
                      ? 'bg-accent text-bg font-medium'
                      : 'text-text-dim hover:text-text-base'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Worker Counts Checkboxes */}
          <div>
            <label className="text-tiny uppercase tracking-wider text-text-dim font-medium block mb-2">
              Worker Counts
            </label>
            <div className="flex items-center gap-2">
              {[1, 2, 4, 8].map((count) => {
                const isChecked = selectedWorkerCounts.includes(count);
                return (
                  <button
                    key={count}
                    type="button"
                    onClick={() => toggleWorkerCount(count)}
                    disabled={running}
                    className={`w-9 h-9 rounded-btn font-mono text-tiny font-medium border transition-colors ${
                      isChecked
                        ? 'border-accent bg-accent/15 text-accent'
                        : 'border-line bg-surface-2 text-text-dim hover:text-text-base'
                    }`}
                  >
                    {count}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Run Button */}
          <div>
            <button
              type="button"
              onClick={handleRunBenchmark}
              disabled={running}
              className="w-full h-10 rounded-btn bg-accent text-bg font-medium text-caption hover:bg-accent-hover transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <Play size={14} />
              <span>{running ? 'Running Benchmark...' : 'Run Benchmark'}</span>
            </button>
          </div>
        </div>

        {/* Live Stepper during Benchmark */}
        {running && (
          <div className="bg-surface rounded-card p-6 border border-accent/40 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-accent font-medium text-caption">
                <span className="w-2 h-2 rounded-full bg-accent animate-ping" />
                <span>Benchmark Orchestration in Progress</span>
              </div>
              <span className="font-mono text-tiny text-text-dim">{currentStepStatus}</span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {selectedWorkerCounts.map((count, idx) => {
                const isCurrent = currentStepIndex === idx;
                const isPast = currentStepIndex !== null && currentStepIndex > idx;

                return (
                  <div
                    key={count}
                    className={`p-3 rounded-btn border text-caption flex items-center gap-2 ${
                      isCurrent
                        ? 'border-accent bg-accent/10 text-accent font-medium'
                        : isPast
                        ? 'border-ok/30 bg-ok/5 text-ok'
                        : 'border-line bg-surface-2 text-text-dim'
                    }`}
                  >
                    {isPast ? (
                      <CheckCircle2 size={16} className="text-ok" />
                    ) : (
                      <span className="w-4 h-4 rounded-full border border-current flex items-center justify-center text-[10px] font-mono">
                        {idx + 1}
                      </span>
                    )}
                    <span>{count} Worker{count === 1 ? '' : 's'}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Results Section */}
        {benchmarkResults && (
          <div className="flex flex-col gap-6">
            {/* Auto-generated Insight banner */}
            <div className="p-4 rounded-card bg-surface border border-accent/30 flex items-center gap-3">
              <TrendingUp size={20} className="text-accent shrink-0" />
              <div className="text-caption">
                <strong className="text-text-base">Insight: </strong>
                <span className="text-text-dim">{insightText()}</span>
              </div>
            </div>

            {/* Charts Row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Chart 1: Time vs Workers */}
              <div className="bg-surface rounded-card p-6 border border-line flex flex-col gap-4">
                <h3 className="text-caption font-medium text-text-base">
                  Execution Time vs Workers (Lower is better)
                </h3>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={benchmarkResults} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid stroke="#232836" strokeDasharray="3 3" />
                      <XAxis dataKey="workers" stroke="#8A92A6" tickLine={false} tickFormatter={(val) => `${val}w`} />
                      <YAxis stroke="#8A92A6" tickLine={false} tickFormatter={(val) => `${val}s`} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#181C25', borderColor: '#232836', borderRadius: '10px' }}
                        formatter={(value: any) => [`${value}s`, 'Duration']}
                      />
                      <Bar dataKey="durationSec" fill="#7C8CFF" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Chart 2: Speedup vs Workers */}
              <div className="bg-surface rounded-card p-6 border border-line flex flex-col gap-4">
                <h3 className="text-caption font-medium text-text-base">
                  Speedup vs Workers (Higher is better)
                </h3>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={benchmarkResults.map((r) => ({
                        workers: r.workers,
                        measured: r.speedup,
                        ideal: r.workers,
                      }))}
                      margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                    >
                      <CartesianGrid stroke="#232836" strokeDasharray="3 3" />
                      <XAxis dataKey="workers" stroke="#8A92A6" tickLine={false} tickFormatter={(val) => `${val}w`} />
                      <YAxis stroke="#8A92A6" tickLine={false} tickFormatter={(val) => `${val}x`} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#181C25', borderColor: '#232836', borderRadius: '10px' }}
                      />
                      <Line
                        type="monotone"
                        dataKey="ideal"
                        stroke="#8A92A6"
                        strokeDasharray="4 4"
                        name="Ideal Linear"
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="measured"
                        stroke="#4ADE9A"
                        strokeWidth={2}
                        name="Measured Speedup"
                        dot={{ r: 4, fill: '#4ADE9A' }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Results Table */}
            <div className="bg-surface rounded-card border border-line overflow-hidden">
              <table className="w-full text-left border-collapse text-caption">
                <thead>
                  <tr className="border-b border-line bg-surface-2/60 text-tiny text-text-dim uppercase tracking-wider font-mono">
                    <th className="py-3 px-6">Workers</th>
                    <th className="py-3 px-6">Time (s)</th>
                    <th className="py-3 px-6">Speedup</th>
                    <th className="py-3 px-6">Efficiency (%)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60 font-mono text-tiny">
                  {benchmarkResults.map((row) => (
                    <tr key={row.workers} className="hover:bg-surface-2/30 transition-colors">
                      <td className="py-3 px-6 text-text-base font-medium">{row.workers}</td>
                      <td className="py-3 px-6 text-text-dim">{row.durationSec.toFixed(2)}s</td>
                      <td className="py-3 px-6 text-accent font-medium">{row.speedup.toFixed(2)}x</td>
                      <td className="py-3 px-6 text-ok">{row.efficiencyPct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Distributed Systems Theoretical Context Note */}
            <div className="p-4 rounded-card bg-surface-2/40 border border-line/60 text-tiny text-text-dim flex items-start gap-2.5">
              <Info size={16} className="text-text-dim/80 shrink-0 mt-0.5" />
              <p className="leading-relaxed">
                <strong>Why is speedup sublinear?</strong> In distributed systems, Amdahl's Law and
                coordination overhead (coordinator serialization, HTTP request roundtrips, SQLite transactions,
                and network/thread context switching) prevent purely linear $N\times$ scaling. As worker count
                grows, the non-parallelizable fraction (reduce step and scheduling contention) increasingly dominates.
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
