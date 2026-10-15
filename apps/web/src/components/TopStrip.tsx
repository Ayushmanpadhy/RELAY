import { useEffect } from 'react';
import { motion, useSpring, useTransform } from 'framer-motion';

function AnimatedNumber({ value }: { value: number }) {
  const spring = useSpring(value, { stiffness: 200, damping: 25, duration: 200 });
  const display = useTransform(spring, (current) => Math.round(current).toLocaleString('en-US'));
  useEffect(() => {
    spring.set(value);
  }, [value, spring]);

  return <motion.span className="font-mono text-display font-medium text-text-base">{display}</motion.span>;
}

interface TopStripProps {
  workersAlive: number;
  queuedTasks: number;
  runningTasks: number;
  completedJobs: number;
}

export function TopStrip({ workersAlive, queuedTasks, runningTasks, completedJobs }: TopStripProps) {
  const stats = [
    { label: 'Workers alive', value: workersAlive },
    { label: 'Queued tasks', value: queuedTasks },
    { label: 'Running tasks', value: runningTasks },
    { label: 'Completed jobs', value: completedJobs },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="bg-surface rounded-card p-5 border border-line flex flex-col justify-between"
        >
          <span className="text-caption text-text-dim font-medium mb-1">{stat.label}</span>
          <AnimatedNumber value={stat.value} />
        </div>
      ))}
    </div>
  );
}
