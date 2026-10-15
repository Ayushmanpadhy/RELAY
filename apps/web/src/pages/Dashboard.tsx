import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Sparkles } from 'lucide-react';
import { useRelayStore } from '../store/relayStore';
import { TopStrip } from '../components/TopStrip';
import { WorkerCard } from '../components/WorkerCard';
import { NewJobModal } from '../components/NewJobModal';
import { EventLogDrawer } from '../components/EventLogDrawer';
import { api } from '../api/client';
import { CONFIG } from '@relay/shared';

export function Dashboard() {
  const navigate = useNavigate();
  const { workers, jobs, tasksSummary, logs } = useRelayStore();
  const [modalOpen, setModalOpen] = useState(false);
  const [addingWorker, setAddingWorker] = useState(false);
  const [submittingSampleJob, setSubmittingSampleJob] = useState(false);

  const activeWorkers = workers.filter((w) => w.status !== 'DEAD' && w.status !== 'STOPPED');
  const completedJobsCount = jobs.filter((j) => j.status === 'DONE').length;

  const handleAddWorker = async () => {
    if (activeWorkers.length >= CONFIG.MAX_MANAGED_WORKERS || addingWorker) return;
    setAddingWorker(true);
    try {
      await api.spawnWorker();
    } catch (err) {
      console.error('Failed to spawn worker:', err);
    } finally {
      setAddingWorker(false);
    }
  };

  const handleRunSampleJob = async () => {
    if (submittingSampleJob) return;
    setSubmittingSampleJob(true);
    try {
      const job = await api.createJob('primes', { limit: 10_000_000, chunks: 24 }, 1);
      navigate(`/app/jobs/${job.id}`);
    } catch (err) {
      console.error('Failed to run workload:', err);
    } finally {
      setSubmittingSampleJob(false);
    }
  };

  const formatElapsed = (startedAt: number | null, finishedAt: number | null) => {
    if (!startedAt) return 'Queued';
    const end = finishedAt || Date.now();
    return `${((end - startedAt) / 1000).toFixed(1)}s`;
  };

  const getWorkloadLabel = (job: any) => {
    if (job.type === 'v3_pipeline') {
      return job.brief || 'AI Task Pipeline';
    }
    switch (job.type) {
      case 'primes':
        return 'Primes Counter';
      case 'pi':
        return 'Monte Carlo π';
      case 'wordcount':
        return 'MapReduce (Word Count)';
      default:
        return job.type;
    }
  };

  return (
    <div className="min-h-screen bg-bg text-text-base pb-24">
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Top Metric Strip */}
        <TopStrip
          workersAlive={activeWorkers.length}
          queuedTasks={tasksSummary.queued}
          runningTasks={tasksSummary.running}
          completedJobs={completedJobsCount}
        />

        {/* Two-Column Cluster & Jobs Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Left Column: Cluster (7 cols) */}
          <section className="lg:col-span-7 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-heading font-medium text-text-base">Cluster</h2>
                <p className="text-tiny text-text-dim">
                  {activeWorkers.length} active process{activeWorkers.length === 1 ? '' : 'es'}
                </p>
              </div>
              <button
                type="button"
                onClick={handleAddWorker}
                disabled={activeWorkers.length >= CONFIG.MAX_MANAGED_WORKERS || addingWorker}
                className="px-3.5 py-1.5 rounded-btn bg-surface-2 hover:bg-surface-2/80 text-caption font-medium text-text-base border border-line transition-colors flex items-center gap-1.5 disabled:opacity-50"
              >
                <Plus size={14} />
                <span>Add worker</span>
              </button>
            </div>

            {workers.length === 0 ? (
              <div className="rounded-card border border-line bg-surface p-8 text-center flex flex-col items-center justify-center gap-2">
                <p className="text-caption text-text-dim">
                  No workers running. Add one to start processing.
                </p>
                <button
                  onClick={handleAddWorker}
                  className="mt-2 px-3 py-1.5 rounded-btn bg-accent text-bg text-caption font-medium hover:bg-accent-hover transition-colors"
                >
                  Spawn initial worker
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {workers.map((worker) => (
                  <WorkerCard key={worker.id} worker={worker} />
                ))}
              </div>
            )}
          </section>

          {/* Right Column: Jobs (5 cols) */}
          <section className="lg:col-span-5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-heading font-medium text-text-base">Jobs</h2>
                <p className="text-tiny text-text-dim">Recent workload pipelines</p>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(true)}
                className="px-4 py-1.5 rounded-btn bg-accent hover:bg-accent-hover text-caption font-medium text-bg transition-colors flex items-center gap-1.5"
              >
                <Plus size={14} />
                <span>New job</span>
              </button>
            </div>

            {jobs.length === 0 ? (
              <div className="rounded-card border border-line bg-surface p-8 text-center flex flex-col items-center justify-center gap-3">
                <p className="text-caption text-text-dim">No jobs submitted yet.</p>
                <button
                  onClick={handleRunSampleJob}
                  disabled={submittingSampleJob}
                  className="px-4 py-2 rounded-btn bg-surface-2 hover:bg-surface-2/80 text-caption text-text-base border border-line transition-colors flex items-center gap-2"
                >
                  <Sparkles size={14} className="text-accent" />
                  <span>{submittingSampleJob ? 'Submitting...' : 'Run sample workload (Primes)'}</span>
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-2.5 overflow-y-auto max-h-[640px] pr-1">
                {jobs.map((job) => {
                  const percent =
                    job.total_tasks > 0
                      ? Math.round((job.done_tasks / job.total_tasks) * 100)
                      : 0;

                  return (
                    <div
                      key={job.id}
                      onClick={() => navigate(`/app/jobs/${job.id}`)}
                      className="rounded-card p-4 bg-surface border border-line hover:border-line/80 hover:bg-surface-2/30 transition-all cursor-pointer flex flex-col gap-2.5"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-caption font-medium text-text-base">
                            {getWorkloadLabel(job)}
                          </div>
                          <div className="font-mono text-tiny text-text-dim">
                            {job.id}
                          </div>
                        </div>

                        <div className="flex items-center gap-2.5">
                          <span className="font-mono text-tiny text-text-dim">
                            {formatElapsed(job.started_at, job.finished_at)}
                          </span>

                          <span
                            className={`px-2 py-0.5 rounded text-tiny font-mono uppercase font-medium ${
                              job.status === 'DONE'
                                ? 'bg-ok/15 text-ok'
                                : job.status === 'RUNNING'
                                ? 'bg-accent/15 text-accent'
                                : job.status === 'FAILED'
                                ? 'bg-bad/15 text-bad'
                                : 'bg-surface-2 text-text-dim'
                            }`}
                          >
                            {job.status}
                          </span>
                        </div>
                      </div>

                      {/* Progress bar */}
                      <div className="flex flex-col gap-1">
                        <div className="h-1.5 w-full bg-surface-2 rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all duration-300 ease-out ${
                              job.status === 'FAILED'
                                ? 'bg-bad'
                                : job.status === 'DONE'
                                ? 'bg-ok'
                                : 'bg-accent'
                            }`}
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                        <div className="flex items-center justify-between text-tiny font-mono text-text-dim">
                          <span>
                            {job.done_tasks} / {job.total_tasks} tasks
                          </span>
                          <span>{percent}%</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </main>

      {/* New Job Modal */}
      <NewJobModal isOpen={modalOpen} onClose={() => setModalOpen(false)} />

      {/* Collapsible Event Log Drawer */}
      <EventLogDrawer logs={logs} />
    </div>
  );
}
