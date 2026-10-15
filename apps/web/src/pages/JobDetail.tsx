import { useEffect, useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  Ban,
  CheckCircle2,
  Download,
  Eye,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useRelayStore } from '../store/relayStore';
import { api, type SamplePair } from '../api/client';
import type { Task } from '@relay/shared';

export function JobDetail() {
  const { id } = useParams<{ id: string }>();
  const { jobDetail, fetchJobDetail, clearJobDetail } = useRelayStore();
  const [cancelling, setCancelling] = useState(false);
  const [hoveredTask, setHoveredTask] = useState<Task | null>(null);
  const [currentTime, setCurrentTime] = useState(Date.now());

  // V3 specific states
  const [samples, setSamples] = useState<SamplePair[]>([]);
  const [showSamples, setShowSamples] = useState(true);

  useEffect(() => {
    if (id) {
      fetchJobDetail(id);
      api.fetchJobSamples(id).then(res => setSamples(res.samples)).catch(() => {});
    }
    return () => {
      clearJobDetail();
    };
  }, [id, fetchJobDetail, clearJobDetail]);

  // Update timer every 200ms while running
  useEffect(() => {
    if (jobDetail?.job?.status === 'RUNNING' || jobDetail?.job?.status === 'QUEUED') {
      const interval = setInterval(() => {
        setCurrentTime(Date.now());
        if (id) {
          api.fetchJobSamples(id).then(res => setSamples(res.samples)).catch(() => {});
        }
      }, 500);
      return () => clearInterval(interval);
    }
  }, [jobDetail?.job?.status, id]);

  if (!jobDetail || !jobDetail.job) {
    return (
      <div className="min-h-screen bg-bg text-text-base flex items-center justify-center">
        <div className="font-mono text-caption text-text-dim">Loading job details...</div>
      </div>
    );
  }

  const { job, tasks, attempts } = jobDetail;

  const jobStartTs = job.started_at || job.created_at;
  const jobEndTs = job.finished_at || currentTime;
  const totalDurationSec = Math.max(0.1, (jobEndTs - jobStartTs) / 1000);

  // Statistics
  const retriesCount = tasks.reduce((sum, t) => sum + Math.max(0, t.attempts - 1), 0);
  const distinctWorkers = useMemo(() => {
    const set = new Set<string>();
    attempts.forEach((a) => set.add(a.worker_id));
    return Array.from(set).sort();
  }, [attempts]);

  const percent = job.total_tasks > 0 ? Math.round((job.done_tasks / job.total_tasks) * 100) : 0;

  // Average attempt latency
  const completedAttempts = attempts.filter(a => a.ended_at && a.outcome === 'DONE');
  const avgLatencyMs = completedAttempts.length > 0
    ? Math.round(completedAttempts.reduce((acc, a) => acc + ((a.ended_at || 0) - a.started_at), 0) / completedAttempts.length)
    : 0;

  const handleCancel = async () => {
    if (cancelling) return;
    setCancelling(true);
    try {
      await api.cancelJob(job.id);
      if (id) await fetchJobDetail(id);
    } catch (err) {
      console.error('Failed to cancel job:', err);
    } finally {
      setCancelling(false);
    }
  };

  // Timeline swim lane helper
  const renderTimeline = () => {
    if (distinctWorkers.length === 0) {
      return (
        <div className="py-8 text-center text-tiny font-mono text-text-dim">
          Waiting for workers to claim tasks...
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-3 py-2">
        {/* Time Axis Ruler */}
        <div className="flex items-center text-tiny font-mono text-text-dim/60 border-b border-line pb-1.5 pl-24 pr-4 justify-between">
          <span>0.0s</span>
          <span>{(totalDurationSec / 2).toFixed(1)}s</span>
          <span>{totalDurationSec.toFixed(1)}s</span>
        </div>

        {distinctWorkers.map((workerId) => {
          const workerAttempts = attempts.filter((a) => a.worker_id === workerId);
          const hasLost = workerAttempts.some((a) => a.outcome === 'LOST');

          return (
            <div key={workerId} className="flex items-center gap-3">
              <div className="w-24 shrink-0 font-mono text-tiny flex flex-col justify-center">
                <span className="text-text-base truncate">{workerId}</span>
                {hasLost && (
                  <span className="text-[10px] text-bad font-sans font-medium flex items-center gap-1">
                    Worker Lost
                  </span>
                )}
              </div>

              {/* Lane track */}
              <div className="flex-1 h-7 bg-surface-2 rounded-btn relative overflow-hidden border border-line">
                {workerAttempts.map((att) => {
                  const startRel = Math.max(0, att.started_at - jobStartTs);
                  const endRel = Math.min(totalDurationSec * 1000, (att.ended_at || currentTime) - jobStartTs);

                  const leftPct = Math.min(100, Math.max(0, (startRel / (totalDurationSec * 1000)) * 100));
                  const widthPct = Math.min(
                    100 - leftPct,
                    Math.max(1.5, ((endRel - startRel) / (totalDurationSec * 1000)) * 100)
                  );

                  let colorClass = 'bg-accent border-accent';
                  if (att.outcome === 'DONE') colorClass = 'bg-ok/90 border-ok';
                  else if (att.outcome === 'FAILED') colorClass = 'bg-warn border-warn';
                  else if (att.outcome === 'LOST') colorClass = 'hatched-lost border-bad/50';

                  return (
                    <div
                      key={att.id}
                      style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                      className={`absolute top-0 bottom-0 border text-[10px] font-mono flex items-center justify-center text-bg font-medium truncate px-1 transition-all ${colorClass}`}
                      title={`Task: ${att.task_id} (Attempt #${att.attempt}) - ${att.outcome || 'RUNNING'}`}
                    >
                      {widthPct > 5 && `#${att.attempt}`}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const isV3 = job.type === 'v3_pipeline';
  const deliverableUrl = api.getDeliverableUrl(job.id);
  const currentStageIdx = job.current_stage ?? 0;

  // Stepper Stage Calculation
  const stepperSteps = [
    { name: 'Intake', status: 'DONE' },
    { name: 'Plan', status: 'DONE' },
    { name: 'Approve', status: 'DONE' },
    {
      name: 'Map (Workers)',
      status: currentStageIdx === 0
        ? (job.status === 'RUNNING' ? 'RUNNING' : job.done_tasks === job.total_tasks ? 'DONE' : 'PENDING')
        : 'DONE',
    },
    {
      name: 'Merge (Reduce)',
      status: currentStageIdx > 0
        ? (job.status === 'DONE' ? 'DONE' : 'RUNNING')
        : 'PENDING',
    },
    {
      name: 'Verify',
      status: job.verification
        ? (job.verification.ok ? 'DONE' : 'WARN')
        : (job.status === 'DONE' ? 'DONE' : 'PENDING'),
    },
    {
      name: 'Deliverable',
      status: job.status === 'DONE' ? 'DONE' : 'PENDING',
    },
  ];

  return (
    <div className="min-h-screen bg-bg text-text-base flex flex-col font-sans">
      {/* Top Bar */}
      <header className="h-14 border-b border-line bg-surface/70 backdrop-blur px-6 flex items-center justify-between sticky top-0 z-20">
        <div className="flex items-center gap-4">
          <Link
            to="/app"
            className="flex items-center gap-1.5 text-caption font-medium text-text-dim hover:text-text-base transition-colors"
          >
            <ArrowLeft size={16} /> Back to Dashboard
          </Link>
          <div className="h-4 w-px bg-line" />
          <div className="font-mono text-caption text-text-base flex items-center gap-2">
            <span>{job.id}</span>
            <span className="text-text-dim">({job.type})</span>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-3">
          {(job.status === 'RUNNING' || job.status === 'QUEUED') && (
            <button
              onClick={handleCancel}
              disabled={cancelling}
              className="px-3 py-1.5 rounded-btn border border-bad/30 bg-bad/10 text-bad hover:bg-bad/20 text-caption font-medium flex items-center gap-1.5 transition-colors"
            >
              <Ban size={14} /> Cancel Execution
            </button>
          )}

          {job.deliverable_path && (
            <a
              href={deliverableUrl}
              download
              className="px-3.5 py-1.5 rounded-btn bg-accent text-bg hover:bg-accent/90 text-caption font-medium flex items-center gap-1.5 transition-colors shadow-sm"
            >
              <Download size={14} /> Download Deliverable
            </a>
          )}
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-6 flex flex-col gap-6">
        {/* Stage Stepper for V3 Pipeline */}
        {isV3 && (
          <div className="bg-surface rounded-card p-5 border border-line flex flex-col gap-3">
            <span className="text-tiny uppercase tracking-wider text-text-dim font-mono font-medium">
              Pipeline Stage Stepper
            </span>
            <div className="flex items-center justify-between relative">
              <div className="absolute left-6 right-6 top-1/2 -translate-y-1/2 h-0.5 bg-line -z-0" />
              {stepperSteps.map((st, idx) => {
                let badgeClass = 'bg-surface-2 border-line text-text-dim';
                if (st.status === 'DONE') badgeClass = 'bg-ok text-bg border-ok';
                else if (st.status === 'RUNNING') badgeClass = 'bg-accent text-bg border-accent animate-pulse';
                else if (st.status === 'WARN') badgeClass = 'bg-warn text-bg border-warn';

                return (
                  <div key={idx} className="relative z-10 flex flex-col items-center gap-1.5 bg-surface px-2">
                    <div
                      className={`w-7 h-7 rounded-full border text-tiny font-mono flex items-center justify-center font-medium ${badgeClass}`}
                    >
                      {idx + 1}
                    </div>
                    <span className="text-[11px] font-mono text-text-dim whitespace-nowrap">
                      {st.name}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Header Summary Card */}
        <div className="bg-surface rounded-card p-6 border border-line flex flex-col gap-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-display font-medium text-text-base">
                  {job.brief ? `"${job.brief}"` : `${job.type.toUpperCase()} Job`}
                </h1>
                <span
                  className={`text-tiny font-mono px-2.5 py-0.5 rounded-full border uppercase font-medium ${
                    job.status === 'DONE'
                      ? 'border-ok/30 bg-ok/10 text-ok'
                      : job.status === 'RUNNING'
                      ? 'border-accent/30 bg-accent/10 text-accent animate-pulse'
                      : job.status === 'FAILED'
                      ? 'border-bad/30 bg-bad/10 text-bad'
                      : 'border-line bg-surface-2 text-text-dim'
                  }`}
                >
                  {job.status}
                </span>
              </div>
              <p className="text-caption text-text-dim mt-1">
                Started {new Date(job.created_at).toLocaleTimeString()} • Duration: {totalDurationSec.toFixed(1)}s
              </p>
            </div>

            {/* Progress Bar & Counter */}
            <div className="w-full md:w-64 flex flex-col gap-1.5">
              <div className="flex justify-between text-tiny font-mono text-text-dim">
                <span>Completed Tasks</span>
                <span className="text-text-base font-medium">
                  {job.done_tasks} / {job.total_tasks} ({percent}%)
                </span>
              </div>
              <div className="h-2 w-full bg-surface-2 rounded-full overflow-hidden border border-line">
                <motion.div
                  initial={false}
                  animate={{ width: `${percent}%` }}
                  transition={{ duration: 0.3 }}
                  className={`h-full ${job.status === 'FAILED' ? 'bg-bad' : 'bg-accent'}`}
                />
              </div>
            </div>
          </div>

          {/* Metrics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3 pt-4 border-t border-line font-mono text-caption">
            <div className="bg-surface-2 p-3 rounded-btn border border-line">
              <span className="text-text-dim text-[11px] block">Active Workers</span>
              <span className="text-text-base font-medium mt-1 block">
                {distinctWorkers.length} worker{distinctWorkers.length === 1 ? '' : 's'}
              </span>
            </div>
            <div className="bg-surface-2 p-3 rounded-btn border border-line">
              <span className="text-text-dim text-[11px] block">Avg Task Latency</span>
              <span className="text-text-base font-medium mt-1 block">
                {avgLatencyMs} ms
              </span>
            </div>
            <div className="bg-surface-2 p-3 rounded-btn border border-line">
              <span className="text-text-dim text-[11px] block">Retries Handled</span>
              <span className="text-text-base font-medium mt-1 block">
                {retriesCount}
              </span>
            </div>
            <div className="bg-surface-2 p-3 rounded-btn border border-line">
              <span className="text-text-dim text-[11px] block">Tokens In / Out</span>
              <span className="text-text-base font-medium mt-1 block">
                {job.tokens_in || 0} / {job.tokens_out || 0}
              </span>
            </div>
            <div className="bg-surface-2 p-3 rounded-btn border border-line">
              <span className="text-text-dim text-[11px] block">Accumulated Cost</span>
              <span className="text-ok font-medium mt-1 block">
                ${(job.cost_usd || 0).toFixed(4)}
              </span>
            </div>
            <div className="bg-surface-2 p-3 rounded-btn border border-line">
              <span className="text-text-dim text-[11px] block">Budget Limit</span>
              <span className="text-text-dim font-medium mt-1 block">
                ${(job.budget_usd || 5).toFixed(2)}
              </span>
            </div>
          </div>
        </div>

        {/* Deliverable Section (When Available) */}
        {job.deliverable_path && (
          <div className="bg-surface rounded-card p-6 border border-line flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-btn bg-ok/10 text-ok border border-ok/20">
                  <CheckCircle2 size={22} />
                </div>
                <div>
                  <h3 className="text-heading font-medium text-text-base">Finished Deliverable Ready</h3>
                  <p className="text-tiny text-text-dim font-mono">
                    {job.deliverable_path}
                  </p>
                </div>
              </div>

              <a
                href={deliverableUrl}
                download
                className="px-4 py-2 bg-ok text-bg font-medium rounded-btn hover:bg-ok/90 flex items-center gap-2 text-caption transition-all shadow-sm"
              >
                <Download size={16} /> Download Deliverable
              </a>
            </div>

            {/* Content Preview Box if JSON or String Result */}
            {Boolean(job.result) && (
              <div className="bg-surface-2 rounded-btn p-4 border border-line font-mono text-caption text-text-dim max-h-72 overflow-y-auto">
                <span className="text-tiny uppercase tracking-wider text-text-dim/80 block mb-2 font-bold">
                  Result Synthesis Preview
                </span>
                <pre className="whitespace-pre-wrap font-sans text-body text-text-base">
                  {typeof job.result === 'string'
                    ? job.result
                    : String((job.result as any)?.synthesis || JSON.stringify(job.result, null, 2))}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* Check the Work: Quality Spot-Check Verification */}
        {samples.length > 0 && (
          <div className="bg-surface rounded-card p-6 border border-line flex flex-col gap-4">
            <div
              className="flex items-center justify-between cursor-pointer select-none"
              onClick={() => setShowSamples(!showSamples)}
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-btn bg-accent/10 text-accent">
                  <Eye size={18} />
                </div>
                <div>
                  <h3 className="text-heading font-medium text-text-base flex items-center gap-2">
                    <span>Check the Work (Quality Spot-Check)</span>
                    {job.verification && (
                      <span
                        className={`text-tiny font-mono px-2 py-0.5 rounded-full border font-medium ${
                          job.verification.ok
                            ? 'border-ok/30 bg-ok/10 text-ok'
                            : 'border-warn/30 bg-warn/10 text-warn'
                        }`}
                      >
                        {job.verification.ok ? 'Verified Passed' : 'Needs Review'}
                      </span>
                    )}
                  </h3>
                  <p className="text-tiny text-text-dim">
                    Inspect sample source inputs against worker outputs to verify fidelity
                  </p>
                </div>
              </div>

              <button className="text-text-dim hover:text-text-base">
                {showSamples ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
              </button>
            </div>

            {showSamples && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
                {samples.map((s) => (
                  <div
                    key={s.taskId}
                    className="p-4 bg-surface-2 rounded-btn border border-line flex flex-col gap-2.5"
                  >
                    <div className="flex items-center justify-between text-tiny font-mono">
                      <span className="text-text-base font-medium">Task #{s.taskIdx}</span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                          s.needsReview
                            ? 'bg-warn/20 text-warn border border-warn/30'
                            : 'bg-ok/20 text-ok border border-ok/30'
                        }`}
                      >
                        {s.needsReview ? 'Needs Review' : 'Verified'}
                      </span>
                    </div>

                    <div className="text-caption font-sans bg-surface p-2.5 rounded border border-line">
                      <span className="text-tiny font-mono uppercase text-text-dim block mb-1">
                        Input Preview
                      </span>
                      <p className="text-text-dim line-clamp-3 text-tiny">{s.inputPreview}</p>
                    </div>

                    <div className="text-caption font-sans bg-surface p-2.5 rounded border border-line">
                      <span className="text-tiny font-mono uppercase text-text-dim block mb-1">
                        Worker Output Result
                      </span>
                      <p className="text-text-base font-mono line-clamp-3 text-tiny">
                        {typeof s.outputResult === 'string'
                          ? s.outputResult
                          : JSON.stringify(s.outputResult, null, 2)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Task Grid */}
        <div className="bg-surface rounded-card p-6 border border-line flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="text-heading font-medium text-text-base">Distributed Task Grid</h3>
            <div className="flex items-center gap-4 text-tiny font-mono">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded bg-surface-2 border border-line" /> Pending
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded bg-accent" /> Leased
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded bg-ok" /> Done
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded bg-bad" /> Dead
              </span>
            </div>
          </div>

          <div className="grid grid-cols-6 sm:grid-cols-12 md:grid-cols-16 lg:grid-cols-24 gap-2">
            {tasks.map((task) => {
              let chipColor = 'bg-surface-2 border-line text-text-dim';
              if (task.status === 'DONE') chipColor = 'bg-ok/90 text-bg border-ok';
              else if (task.status === 'LEASED') chipColor = 'bg-accent text-bg border-accent animate-pulse';
              else if (task.status === 'DEAD') chipColor = 'bg-bad text-bg border-bad';

              return (
                <motion.div
                  layout
                  key={task.id}
                  onMouseEnter={() => setHoveredTask(task)}
                  onMouseLeave={() => setHoveredTask(null)}
                  className={`h-9 rounded-btn border text-tiny font-mono flex items-center justify-center cursor-pointer transition-colors relative ${chipColor}`}
                >
                  {task.idx}
                </motion.div>
              );
            })}
          </div>

          {/* Hovered task tooltip */}
          {hoveredTask && (
            <div className="p-3 bg-surface-2 rounded-btn border border-line text-caption font-mono flex items-center justify-between text-text-dim">
              <span>Task: {hoveredTask.id} (Stage {hoveredTask.stage_idx})</span>
              <span>Worker: {hoveredTask.worker_id || 'unassigned'}</span>
              <span>Op: {hoveredTask.op || 'compute'}</span>
              <span>Attempts: {hoveredTask.attempts}</span>
              <span className="capitalize">Status: {hoveredTask.status}</span>
            </div>
          )}
        </div>

        {/* Timeline Swim Lanes */}
        <div className="bg-surface rounded-card p-6 border border-line flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-heading font-medium text-text-base">Execution Timeline</h3>
              <p className="text-tiny text-text-dim">
                Worker swim lanes showing task execution, leases, and failure recovery
              </p>
            </div>

            <div className="flex items-center gap-4 text-tiny font-mono">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded bg-ok" /> Done
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded bg-accent" /> Running
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded bg-warn" /> Failed
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded hatched-lost" /> Lost (Crashed)
              </span>
            </div>
          </div>

          {renderTimeline()}
        </div>
      </main>
    </div>
  );
}
