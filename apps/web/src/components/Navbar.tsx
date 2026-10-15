import { Link, useLocation } from 'react-router-dom';
import { useRelayStore } from '../store/relayStore';

export function Navbar() {
  const location = useLocation();
  const { connected, reconnecting } = useRelayStore();

  const isApp = location.pathname.startsWith('/app');
  const isBenchmark = location.pathname === '/app/benchmark';
  const isDashboard = location.pathname === '/app';

  if (location.pathname === '/') {
    return null;
  }

  return (
    <header className="h-14 border-b border-line bg-bg/80 backdrop-blur sticky top-0 z-40 px-6 flex items-center justify-between">
      <div className="flex items-center gap-8">
        <Link to="/" className="flex items-center gap-2 group">
          <div className="w-6 h-6 rounded-md bg-surface-2 border border-line flex items-center justify-center transition-colors group-hover:border-accent">
            <div className="w-2 h-2 rounded-full bg-accent" />
          </div>
          <span className="font-semibold text-body tracking-tight text-text-base">Relay</span>
        </Link>

        {isApp && (
          <nav className="flex items-center gap-1 text-caption">
            <Link
              to="/app"
              className={`px-3 py-1.5 rounded-btn transition-colors ${
                isDashboard
                  ? 'text-text-base bg-surface-2 font-medium'
                  : 'text-text-dim hover:text-text-base hover:bg-surface'
              }`}
            >
              Dashboard
            </Link>
            <Link
              to="/app/benchmark"
              className={`px-3 py-1.5 rounded-btn transition-colors ${
                isBenchmark
                  ? 'text-text-base bg-surface-2 font-medium'
                  : 'text-text-dim hover:text-text-base hover:bg-surface'
              }`}
            >
              Benchmark
            </Link>
          </nav>
        )}
      </div>

      <div className="flex items-center gap-4">
        {!isApp && (
          <Link
            to="/app"
            className="text-caption font-medium px-3.5 py-1.5 rounded-btn bg-accent text-bg hover:bg-accent-hover transition-colors"
          >
            Open Dashboard
          </Link>
        )}

        <div className="flex items-center gap-2 text-tiny font-mono px-2.5 py-1 rounded-full bg-surface border border-line">
          <span
            className={`w-2 h-2 rounded-full ${
              connected
                ? 'bg-ok'
                : reconnecting
                ? 'bg-warn animate-pulse'
                : 'bg-bad'
            }`}
          />
          <span className="text-text-dim">
            {connected ? 'Live' : reconnecting ? 'Reconnecting' : 'Disconnected'}
          </span>
        </div>
      </div>
    </header>
  );
}
