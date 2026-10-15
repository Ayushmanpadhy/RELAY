import { useEffect, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Navbar } from './components/Navbar';
import { Dashboard } from './pages/Dashboard';
import { JobDetail } from './pages/JobDetail';
import { Benchmark } from './pages/Benchmark';
import { useRelayStore } from './store/relayStore';

const Landing = lazy(() => import('./pages/Landing/Landing'));

export function App() {
  const initSSE = useRelayStore((s) => s.initSSE);

  useEffect(() => {
    const cleanup = initSSE();
    return () => {
      cleanup();
    };
  }, [initSSE]);

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-bg text-text-base flex flex-col font-sans">
        <Navbar />
        <div className="flex-1">
          <Routes>
            <Route
              path="/"
              element={
                <Suspense fallback={<div className="min-h-screen bg-[#0B0D12]" />}>
                  <Landing />
                </Suspense>
              }
            />
            <Route path="/app" element={<Dashboard />} />
            <Route path="/app/jobs/:id" element={<JobDetail />} />
            <Route path="/app/benchmark" element={<Benchmark />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </div>
    </BrowserRouter>
  );
}

export default App;
