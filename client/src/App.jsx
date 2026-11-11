import React, { useRef, useEffect } from 'react';
import { fetchApi, usePolling } from './api.js';
import PipelineAnalytics from './Analytics.jsx';
import EventsExplorer from './EventsExplorer.jsx';

export function Panel({ title, status, children, loading, error, empty }) {
  return (
    <div className="panel">
      <div className="panel-header">
        <span className="panel-title">{title}</span>
        {status && <span className="panel-status">{status}</span>}
      </div>
      <div className="panel-body">
        {loading && <div className="status-box">[ FETCHING SYSTEM METRICS... ]</div>}
        {error && <div className="status-box status-error">[ ERROR: {error.message} ]</div>}
        {!loading && !error && empty && <div className="status-box">[ NO DATA AVAILABLE ]</div>}
        {!loading && !error && !empty && children}
      </div>
    </div>
  );
}

export function ParticleField() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    let animId = null;
    let haloAngle = 0;
    let w = 0;
    let h = 0;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const particleCount = 600;
    const particles = [];

    const resize = () => {
      const previousW = w;
      const previousH = h;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      w = canvas.parentElement.clientWidth;
      h = canvas.parentElement.clientHeight;

      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      if (previousW > 0 && previousH > 0 && particles.length) {
        const orbitScale = Math.min(w, h) / Math.min(previousW, previousH);

        particles.forEach(p => {
          p.x *= w / previousW;
          p.y *= h / previousH;
          p.orbitRadius *= orbitScale;
        });
      }
    };

    resize();
    window.addEventListener('resize', resize);

    for (let i = 0; i < particleCount; i++) {
      particles.push({
        x: Math.random() * w,
        y: Math.random() * h,
        radius: Math.random() * 1.2 + 0.3,
        alpha: Math.random() * 0.4 + 0.1,
        orbitRadius: Math.random() * (Math.min(w, h) * 0.35) + 40,
        orbitSpeed: (Math.random() - 0.5) * 0.0015,
        angle: Math.random() * Math.PI * 2
      });
    }

    const render = () => {
      ctx.clearRect(0, 0, w, h);
      const centerX = w * 0.65;
      const centerY = h * 0.5;
      haloAngle += 0.002;

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        if (!reducedMotion) {
          p.angle += p.orbitSpeed;
          p.x = centerX + Math.cos(p.angle + haloAngle) * p.orbitRadius;
          p.y = centerY + Math.sin(p.angle + haloAngle) * (p.orbitRadius * 0.65);
        }

        ctx.fillStyle = `rgba(143, 180, 255, ${p.alpha})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
      }

      if (!reducedMotion && !document.hidden) {
        animId = requestAnimationFrame(render);
      }
    };

    render();

    const onVisibility = () => {
      if (!document.hidden && !reducedMotion) {
        animId = requestAnimationFrame(render);
      }
    };

    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      if (animId !== null) cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return <canvas ref={canvasRef} className="particle-canvas" aria-hidden="true" />;
}

export function LiveStats() {
  const { data, error, loading } = usePolling(signal => fetchApi('/stats', { signal }), 5000);

  const windowToDate = data?.window?.to ? new Date(data.window.to) : null;
  const isStale = windowToDate ? Date.now() - windowToDate.getTime() > 15 * 60 * 1000 : false;
  const badgeText = isStale ? `STATIC DATASET · AS OF ${data?.window?.to}` : 'LIVE TELEMETRY · 5S INTERVAL';

  return (
    <Panel
      title="SYSTEM TELEMETRY"
      status={<span className={`badge ${isStale ? 'badge-stale' : ''}`}>{badgeText}</span>}
      loading={loading && !data}
      error={error}
    >
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">[ TOTAL DOCUMENTS ]</div>
          <div className="stat-value">{data?.totalEvents?.toLocaleString() ?? '—'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">[ EVENTS / MIN ]</div>
          <div className="stat-value">{data?.eventsPerMinute ?? '—'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">[ TOP INSIGHT ]</div>
          <div className="stat-value" style={{ fontSize: '20px' }}>{data?.topInsight?.category ?? '—'}</div>
          <div className="stat-desc">{data?.topInsight?.description ?? '—'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">[ AS OF ]</div>
          <div className="stat-value" style={{ fontSize: '20px' }}>{windowToDate ? windowToDate.toISOString() : '—'}</div>
        </div>
      </div>
    </Panel>
  );
}

export default function App() {
  return (
    <div className="app-root">
      <nav className="nav-bar">
        <div className="wordmark">DATAFORGE</div>
        <div className="nav-links">
          <a href="#pipeline" className="ghost-btn">PIPELINE ↗</a>
          <a href="#insights" className="ghost-btn">INSIGHTS ↗</a>
          <a href="#raw-data" className="ghost-btn">RAW DATA ↗</a>
        </div>
      </nav>

      <header className="hero-section">
        <ParticleField />
        <div className="hero-content">
          <h1 className="hero-headline">
            HIGH-THROUGHPUT CLICKSTREAM INTELLIGENCE <span className="accent">✦</span> AT SCALE
          </h1>
          <p className="hero-subhead">
            Deterministic ingestion, conversion funnels, and behavioral user segmentation
            engineered for 150,000+ synthetic e-commerce events.
          </p>
        </div>
      </header>

      <main className="main-content">
        <LiveStats />
        <PipelineAnalytics Panel={Panel} />
        <EventsExplorer Panel={Panel} />
      </main>
    </div>
  );
}