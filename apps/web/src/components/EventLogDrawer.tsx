import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronUp, ChevronDown, Terminal } from 'lucide-react';
import type { EventLog } from '@relay/shared';

interface EventLogDrawerProps {
  logs: EventLog[];
}

export function EventLogDrawer({ logs }: EventLogDrawerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const logContainerRef = useRef<HTMLDivElement>(null);

  const latestLog = logs[logs.length - 1];

  // Auto-scroll to bottom when new logs arrive while open
  useEffect(() => {
    if (isOpen && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, isOpen]);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, '0')}:${d
      .getMinutes()
      .toString()
      .padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}.${Math.floor(
      d.getMilliseconds() / 100
    )}`;
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-line bg-surface/95 backdrop-blur">
      {/* Header bar (collapsed state & toggle) */}
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="max-w-7xl mx-auto px-6 h-10 flex items-center justify-between cursor-pointer select-none hover:bg-surface-2/40 transition-colors"
      >
        <div className="flex items-center gap-3 overflow-hidden">
          <div className="flex items-center gap-1.5 text-text-dim text-tiny font-mono">
            <Terminal size={14} />
            <span className="font-medium uppercase tracking-wider">Activity</span>
            <span className="text-line">|</span>
          </div>

          {latestLog ? (
            <div className="flex items-center gap-2 text-tiny font-mono truncate">
              <span className="text-text-dim/60">{formatTime(latestLog.ts)}</span>
              <span
                className={`truncate ${
                  latestLog.level === 'error'
                    ? 'text-bad'
                    : latestLog.level === 'warn'
                    ? 'text-warn'
                    : 'text-text-base'
                }`}
              >
                {latestLog.message}
              </span>
            </div>
          ) : (
            <span className="text-tiny font-mono text-text-dim/60">Cluster idle</span>
          )}
        </div>

        <button
          type="button"
          className="text-text-dim hover:text-text-base p-1"
          aria-label={isOpen ? 'Collapse logs' : 'Expand logs'}
        >
          {isOpen ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
      </div>

      {/* Expanded Logs Drawer */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 240, opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="border-t border-line/60 bg-bg/90 overflow-hidden"
          >
            <div
              ref={logContainerRef}
              className="max-w-7xl mx-auto px-6 py-3 h-[240px] overflow-y-auto font-mono text-tiny space-y-1.5"
            >
              {logs.length === 0 ? (
                <div className="text-text-dim/60 italic py-4">No events logged yet.</div>
              ) : (
                logs.map((log) => (
                  <div key={log.id} className="flex items-start gap-3 leading-relaxed">
                    <span className="text-text-dim/50 shrink-0">{formatTime(log.ts)}</span>
                    <span
                      className={`uppercase text-[10px] px-1 py-0.2 rounded font-medium shrink-0 ${
                        log.level === 'error'
                          ? 'bg-bad/20 text-bad'
                          : log.level === 'warn'
                          ? 'bg-warn/20 text-warn'
                          : 'bg-surface-2 text-text-dim'
                      }`}
                    >
                      {log.level}
                    </span>
                    <span
                      className={`${
                        log.level === 'error'
                          ? 'text-bad'
                          : log.level === 'warn'
                          ? 'text-warn'
                          : 'text-text-base'
                      }`}
                    >
                      {log.message}
                    </span>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
