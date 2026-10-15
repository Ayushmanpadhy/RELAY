import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MoreHorizontal, ShieldAlert, Clock, Power } from 'lucide-react';
import type { WorkerInfo } from '@relay/shared';
import { api } from '../api/client';

interface WorkerCardProps {
  worker: WorkerInfo;
}

export function WorkerCard({ worker }: WorkerCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [timeAgo, setTimeAgo] = useState(0);
  const [shouldHideDead, setShouldHideDead] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const isDead = worker.status === 'DEAD';
  const isBusy = worker.status === 'BUSY';
  const isStopped = worker.status === 'STOPPED';

  // Calculate time since last heartbeat for dead worker
  useEffect(() => {
    if (isDead) {
      const update = () => {
        const diffSec = Math.max(0, Math.floor((Date.now() - worker.last_heartbeat) / 1000));
        setTimeAgo(diffSec);
        if (diffSec > 10) {
          setShouldHideDead(true);
        }
      };
      update();
      const interval = setInterval(update, 1000);
      return () => clearInterval(interval);
    }
  }, [isDead, worker.last_heartbeat]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    if (menuOpen) {
      window.addEventListener('mousedown', handler);
      return () => window.removeEventListener('mousedown', handler);
    }
  }, [menuOpen]);

  if (shouldHideDead) {
    return null;
  }

  const handleSlow = async (factor: number) => {
    setMenuOpen(false);
    try {
      await api.slowWorker(worker.id, factor);
    } catch (err) {
      console.error(err);
    }
  };

  const handleStop = async () => {
    setMenuOpen(false);
    try {
      await api.stopWorker(worker.id);
    } catch (err) {
      console.error(err);
    }
  };

  const handleKill = async () => {
    setMenuOpen(false);
    try {
      await api.killWorker(worker.id);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{
        opacity: isDead ? 0.45 : 1,
        y: 0,
        transition: { duration: 0.18 },
      }}
      exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.25 } }}
      className={`rounded-card p-4 border transition-colors relative flex flex-col justify-between ${
        isDead
          ? 'bg-surface/50 border-bad/30'
          : isStopped
          ? 'bg-surface/60 border-line/60'
          : 'bg-surface border-line hover:border-line/80'
      }`}
    >
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span
              className={`w-2.5 h-2.5 rounded-full transition-colors ${
                isBusy
                  ? 'bg-accent animate-pulse'
                  : worker.status === 'IDLE'
                  ? 'bg-ok'
                  : isDead
                  ? 'bg-bad'
                  : 'bg-text-dim/40'
              }`}
            />
            <span className="font-mono text-caption font-medium text-text-base">
              {worker.name}
            </span>
            {worker.slow_factor > 1 && (
              <span className="text-tiny font-mono px-1.5 py-0.5 rounded bg-warn/15 text-warn border border-warn/30">
                {worker.slow_factor}x slow
              </span>
            )}
          </div>

          {!isDead && !isStopped && (
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen(!menuOpen)}
                className="p-1 rounded-btn text-text-dim hover:text-text-base hover:bg-surface-2 transition-colors"
                aria-label="Worker options"
              >
                <MoreHorizontal size={16} />
              </button>

              <AnimatePresence>
                {menuOpen && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: -4 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.12 }}
                    className="absolute right-0 top-full mt-1 w-48 rounded-card bg-surface-2 border border-line shadow-xl py-1 z-30 text-caption"
                  >
                    <div className="px-3 py-1.5 text-tiny text-text-dim font-medium border-b border-line flex items-center gap-1.5">
                      <Clock size={12} /> Execution Speed
                    </div>
                    <button
                      onClick={() => handleSlow(1)}
                      className={`w-full text-left px-3 py-1.5 hover:bg-surface flex items-center justify-between ${
                        worker.slow_factor === 1 ? 'text-accent font-medium' : 'text-text-base'
                      }`}
                    >
                      <span>1x (Normal)</span>
                      {worker.slow_factor === 1 && <span className="w-1.5 h-1.5 rounded-full bg-accent" />}
                    </button>
                    <button
                      onClick={() => handleSlow(3)}
                      className={`w-full text-left px-3 py-1.5 hover:bg-surface flex items-center justify-between ${
                        worker.slow_factor === 3 ? 'text-accent font-medium' : 'text-text-base'
                      }`}
                    >
                      <span>3x Slower</span>
                      {worker.slow_factor === 3 && <span className="w-1.5 h-1.5 rounded-full bg-accent" />}
                    </button>
                    <button
                      onClick={() => handleSlow(6)}
                      className={`w-full text-left px-3 py-1.5 hover:bg-surface flex items-center justify-between ${
                        worker.slow_factor === 6 ? 'text-accent font-medium' : 'text-text-base'
                      }`}
                    >
                      <span>6x Slower</span>
                      {worker.slow_factor === 6 && <span className="w-1.5 h-1.5 rounded-full bg-accent" />}
                    </button>

                    <div className="my-1 border-t border-line" />

                    <button
                      onClick={handleStop}
                      className="w-full text-left px-3 py-1.5 hover:bg-surface text-text-base flex items-center gap-2"
                    >
                      <Power size={13} className="text-text-dim" />
                      <span>Graceful Stop</span>
                    </button>

                    <button
                      onClick={handleKill}
                      className="w-full text-left px-3 py-1.5 hover:bg-bad/10 text-bad flex items-center gap-2"
                    >
                      <ShieldAlert size={13} />
                      <span>Kill Process (Crash)</span>
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>

        <div className="mb-3">
          {isDead ? (
            <span className="text-tiny text-bad font-mono">
              Lost contact {timeAgo}s ago
            </span>
          ) : isStopped ? (
            <span className="text-tiny text-text-dim font-mono">Stopped</span>
          ) : isBusy && worker.current_task_id ? (
            <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-accent/10 border border-accent/25 text-accent text-tiny font-mono max-w-full truncate">
              <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
              <span className="truncate">{worker.current_task_id}</span>
            </div>
          ) : (
            <span className="text-tiny text-text-dim font-mono">Idle</span>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-line/60 text-tiny text-text-dim">
        <span>Tasks done</span>
        <span className="font-mono text-caption text-text-base font-medium">
          {worker.tasks_done}
        </span>
      </div>
    </motion.div>
  );
}
