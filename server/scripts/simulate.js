// server/scripts/simulate.js
import { generateEvent } from './generate.js';

const args = process.argv.slice(2);
const hasOptIn = args.includes('--run') || process.env.SIMULATE === 'true';

if (!hasOptIn) {
  console.log(`DataForge Event Simulator (Milestone M4)
Explicit opt-in is required to prevent unintended event generation.

Usage:
  node scripts/simulate.js --run [--duration <seconds>] [--port <port>]

Options:
  --run                  Explicitly enable and run the simulator
  --duration <seconds>   Simulation duration in seconds (default: 60, max: 300)
  --port <port>          Target server port (default: process.env.PORT or 4000)

Environment variables:
  SIMULATE=true          Alternative to --run
  SIMULATE_DURATION=60   Alternative to --duration`);
  process.exit(0);
}

function getArg(name) {
  const idx = args.findIndex((a) => a === name || a.startsWith(`${name}=`));
  if (idx === -1) return null;
  return args[idx].includes('=') ? args[idx].split('=')[1] : args[idx + 1] || null;
}

const rawDuration = Number(getArg('--duration') || process.env.SIMULATE_DURATION || 60);
const durationSec = Math.min(Math.max(Number.isFinite(rawDuration) && rawDuration > 0 ? Math.floor(rawDuration) : 60, 2), 300);
const rawPort = Number(getArg('--port') || process.env.PORT || 4000);
const port = Number.isInteger(rawPort) && rawPort >= 1 && rawPort <= 65535 ? rawPort : 4000;
const ingestUrl = `http://localhost:${port}/api/ingest`;

console.log(`[Simulator] Active: ${durationSec}s duration, ~5-25 events/2s -> ${ingestUrl}`);

let totalGenerated = 0;
let totalInserted = 0;
let totalDuplicates = 0;
let totalConfirmedFailed = 0;
let totalUnconfirmed = 0;
let inFlight = false;
let isShuttingDown = false;
let activeRequest = null;
const startTime = Date.now();

function generateSimulatedBatch() {
  const count = Math.floor(Math.random() * 21) + 5;
  const batch = [];
  const now = new Date().toISOString();
  for (let i = 0; i < count; i++) {
    const ev = generateEvent();
    ev.userId = `u_sim_${String(Math.floor(1000 + Math.random() * 9000))}`;
    ev.sessionId = `s_sim_${String(Math.floor(1000 + Math.random() * 9000))}`;
    ev.country = 'IN';
    ev.ts = now;
    batch.push(ev);
  }
  return batch;
}

function validateAcknowledgement(data, batchLength, status) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return null;
  }

  const { received, inserted, duplicates, failed } = data;
  const counts = [received, inserted, duplicates, failed];

  if (!counts.every(
    value => Number.isSafeInteger(value) && value >= 0
  )) {
    return null;
  }

  if (received !== batchLength) return null;

  if (inserted + duplicates + failed !== batchLength) {
    return null;
  }

  if (status === 201) {
    if (
      inserted !== batchLength ||
      duplicates !== 0 ||
      failed !== 0
    ) {
      return null;
    }
  }

  return { inserted, duplicates, failed };
}

async function sendBatch() {
  if (isShuttingDown) return;

  const elapsedSec = Math.floor((Date.now() - startTime) / 1000);
  if (elapsedSec >= durationSec) {
    shutdown('Duration limit reached');
    return;
  }

  if (inFlight) return;

  inFlight = true;
  const batch = generateSimulatedBatch();
  totalGenerated += batch.length;

  const requestPromise = (async () => {
    try {
      const res = await fetch(ingestUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: batch })
      });

      if (res.status === 201 || res.status === 207) {
        let data;

        try {
          data = await res.json();
        } catch {
          totalUnconfirmed += batch.length;
          console.warn(
            `[Simulator] ${elapsedSec}s: unconfirmed batch - malformed JSON (HTTP ${res.status})`
          );
          return;
        }

        const acknowledgement = validateAcknowledgement(
          data,
          batch.length,
          res.status
        );

        if (!acknowledgement) {
          totalUnconfirmed += batch.length;
          console.warn(
            `[Simulator] ${elapsedSec}s: unconfirmed batch - invalid acknowledgement (HTTP ${res.status})`
          );
          return;
        }

        const { inserted, duplicates, failed } = acknowledgement;

        totalInserted += inserted;
        totalDuplicates += duplicates;
        totalConfirmedFailed += failed;

        console.log(
          `[Simulator] ${elapsedSec}s/${durationSec}s: ` +
          `inserted: ${inserted}, duplicates: ${duplicates}, ` +
          `failed: ${failed} (HTTP ${res.status})`
        );

      } else if (res.status === 400) {
        totalConfirmedFailed += batch.length;

        console.warn(
          `[Simulator] ${elapsedSec}s: batch rejected before database writes (HTTP 400)`
        );

      } else {
        totalUnconfirmed += batch.length;

        console.warn(
          `[Simulator] ${elapsedSec}s: unconfirmed batch - HTTP ${res.status}`
        );
      }
    } catch (err) {
      totalUnconfirmed += batch.length;
      console.error(`[Simulator] Ingest failed (unconfirmed): ${err.message}`);
    } finally {
      inFlight = false;
      if (activeRequest === requestPromise) {
        activeRequest = null;
      }
    }
  })();

  activeRequest = requestPromise;
  await requestPromise;
}

const intervalId = setInterval(sendBatch, 2000);
sendBatch();

async function shutdown(reason) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  clearInterval(intervalId);

  const forceExitTimer = setTimeout(() => {
    console.warn('[Simulator] Shutdown timed out waiting for active request, forcing exit.');
    process.exit(1);
  }, 5000);
  if (forceExitTimer.unref) forceExitTimer.unref();

  if (activeRequest) {
    try {
      await activeRequest;
    } catch {
      // Handled inside requestPromise
    }
  }

  clearTimeout(forceExitTimer);
  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[Simulator] Stopped (${reason}): ${totalGenerated} generated, ${totalInserted} inserted, ${totalDuplicates} duplicates, ${totalConfirmedFailed} failures, ${totalUnconfirmed} unconfirmed across ${totalElapsed}s.`);
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT received'));
process.on('SIGTERM', () => shutdown('SIGTERM received'));
