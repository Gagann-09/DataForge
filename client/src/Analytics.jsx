import React from 'react';
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip
} from 'recharts';
import { fetchApi, usePolling } from './api.js';

const ACCENT = '#8fb4ff';
const WHITE = '#f5f5f5';
const MUTED = '#8a8a8a';

const number = value => Number(value || 0).toLocaleString('en-IN');
const percent = value =>
  value == null ? 'N/A' : `${(value * 100).toFixed(2)}%`;

function apiError(error) {
  return error
    ? { message: `${error.code || 'API_ERROR'}: ${error.message}` }
    : null;
}

function windowStatus(window) {
  if (!window?.to) return 'NO DATA';
  const timestamp = new Date(window.to);
  const stale = Date.now() - timestamp.getTime() > 15 * 60 * 1000;
  return stale
    ? `STATIC DATASET · AS OF ${timestamp.toISOString()}`
    : '24H WINDOW · UTC';
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;

  return (
    <div className="chart-tooltip">
      <div className="tooltip-label">{label}</div>
      {payload.map((item, index) => (
        <div className="tooltip-row" key={`${item.dataKey}-${index}`}>
          <span>{item.name}</span>
          <strong>{number(item.value)}</strong>
        </div>
      ))}
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="chart-metric">
      <div className="stat-label">[ {label} ]</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

function TopProducts({ Panel }) {
  const result = usePolling(
    signal => fetchApi('/p1/top-products', { signal }),
    60000
  );
  const rows = result.data?.data || [];

  return (
    <Panel
      title="P1 / TOP PRODUCTS"
      status={windowStatus(result.data?.window)}
      loading={result.loading && !result.data}
      error={apiError(result.error)}
      empty={!!result.data && rows.length === 0}
    >
      <div className="chart-caption">
        PRODUCT PERFORMANCE · RANKED BY TOTAL EVENTS
      </div>
      <div className="chart-container">
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
            <CartesianGrid stroke="#1f1f1f" vertical={false} />
            <XAxis dataKey="productId" stroke={MUTED} tick={{ fontSize: 11 }} />
            <YAxis stroke={MUTED} tick={{ fontSize: 11 }} />
            <Tooltip content={<ChartTooltip />} />
            <Bar dataKey="events" name="Events" fill={ACCENT} maxBarSize={48} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="chart-table-wrap">
        <table className="analytics-table">
          <thead>
            <tr>
              <th>PRODUCT</th>
              <th>VIEWS</th>
              <th>CARTS</th>
              <th>PURCHASES</th>
              <th>REVENUE</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.productId}>
                <td>{row.productId}</td>
                <td>{number(row.views)}</td>
                <td>{number(row.addToCarts)}</td>
                <td>{number(row.purchases)}</td>
                <td>{number(row.revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function Funnel({ Panel }) {
  const result = usePolling(
    signal => fetchApi('/p2/funnel', { signal }),
    60000
  );
  const data = result.data;
  const totals = data?.totals;
  const buckets = data?.buckets || [];

  const cartRate = totals?.views
    ? totals.addToCarts / totals.views
    : null;
  const purchaseRate = totals?.addToCarts
    ? totals.purchases / totals.addToCarts
    : null;
  const overallRate = totals?.views
    ? totals.purchases / totals.views
    : null;

  const chartRows = buckets.map(bucket => ({
    ...bucket,
    label: new Date(bucket.hour).toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC'
    })
  }));

  return (
    <Panel
      title="P2 / CONVERSION FUNNEL"
      status={windowStatus(data?.window)}
      loading={result.loading && !data}
      error={apiError(result.error)}
      empty={!!data && buckets.length === 0}
    >
      <div className="metrics-grid">
        <Metric label="VIEWS" value={number(totals?.views)} />
        <Metric label="ADD TO CART" value={number(totals?.addToCarts)} />
        <Metric label="PURCHASES" value={number(totals?.purchases)} />
      </div>
      <div className="metrics-grid rate-grid">
        <Metric label="CART / VIEW" value={percent(cartRate)} />
        <Metric label="PURCHASE / CART" value={percent(purchaseRate)} />
        <Metric label="PURCHASE / VIEW" value={percent(overallRate)} />
      </div>
      <div className="chart-caption">
        HOURLY EVENT VOLUME · TIMESTAMPS IN UTC
      </div>
      <div className="chart-container">
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={chartRows} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
            <CartesianGrid stroke="#1f1f1f" vertical={false} />
            <XAxis
              dataKey="label"
              stroke={MUTED}
              tick={{ fontSize: 10 }}
              minTickGap={28}
            />
            <YAxis stroke={MUTED} tick={{ fontSize: 11 }} />
            <Tooltip content={<ChartTooltip />} />
            <Line
              type="monotone"
              dataKey="views"
              name="Views"
              stroke={WHITE}
              dot={false}
              strokeWidth={2}
            />
            <Line
              type="monotone"
              dataKey="addToCarts"
              name="Add to carts"
              stroke={ACCENT}
              dot={false}
              strokeWidth={2}
            />
            <Line
              type="monotone"
              dataKey="purchases"
              name="Purchases"
              stroke={WHITE}
              strokeDasharray="4 4"
              dot={false}
              strokeWidth={1.5}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="chart-footnote">
        Hourly buckets use UTC. The first and last buckets may be partial.
      </div>
    </Panel>
  );
}

function Segments({ Panel }) {
  const result = usePolling(
    signal => fetchApi('/p3/segments', { signal }),
    60000
  );
  const rows = result.data?.data || [];
  const totalUsers = rows.reduce((sum, row) => sum + row.users, 0);

  return (
    <Panel
      title="P3 / CUSTOMER SEGMENTATION"
      status="ALL-TIME · SPEND-BASED"
      loading={result.loading && !result.data}
      error={apiError(result.error)}
      empty={!!result.data && rows.every(row => row.users === 0)}
    >
      <div className="chart-caption">
        USER DISTRIBUTION · APPROVED SPEND THRESHOLDS
      </div>
      <div className="chart-container">
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
            <CartesianGrid stroke="#1f1f1f" vertical={false} />
            <XAxis dataKey="segment" stroke={MUTED} tick={{ fontSize: 10 }} />
            <YAxis stroke={MUTED} tick={{ fontSize: 11 }} />
            <Tooltip content={<ChartTooltip />} />
            <Bar dataKey="users" name="Users" fill={ACCENT} maxBarSize={56} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="metrics-grid segment-summary">
        <Metric label="TOTAL USERS" value={number(totalUsers)} />
        <Metric label="SEGMENTS" value={number(rows.length)} />
      </div>
      <div className="chart-table-wrap">
        <table className="analytics-table">
          <thead>
            <tr>
              <th>SEGMENT</th>
              <th>USERS</th>
              <th>TOTAL SPEND</th>
              <th>AVG SPEND</th>
              <th>AVG EVENTS</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.segment}>
                <td>{row.segment}</td>
                <td>{number(row.users)}</td>
                <td>{number(row.totalSpend)}</td>
                <td>{number(row.avgSpend)}</td>
                <td>{Number(row.avgEvents).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="chart-footnote">
        Spend values are displayed without an assumed currency symbol.
      </div>
    </Panel>
  );
}

export default function PipelineAnalytics({ Panel }) {
  return (
    <>
      <section id="pipeline">
        <div className="analytics-grid">
          <TopProducts Panel={Panel} />
          <Funnel Panel={Panel} />
        </div>
      </section>
      <section id="insights">
        <Segments Panel={Panel} />
      </section>
    </>
  );
}
