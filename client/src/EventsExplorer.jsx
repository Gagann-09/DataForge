import React, { useState } from 'react';
import { fetchApi, usePolling } from './api.js';

const EVENT_TYPES = ['view', 'add_to_cart', 'purchase'];

const number = value => Number(value || 0).toLocaleString('en-IN');

function EventsResults({ query, page, limit, onPageChange, Panel }) {
  const result = usePolling(
    signal => fetchApi(`/events?${query}`, { signal }),
    60000
  );

  const data = result.data;
  const rows = data?.data || [];
  const totalPages = data?.totalPages || 0;
  const error = result.error
    ? {
        message: `${result.error.code || 'API_ERROR'}: ${result.error.message}`
      }
    : null;

  const fields = [
    'eventId', 'userId', 'sessionId', 'type',
    'productId', 'category', 'price', 'quantity',
    'device', 'country', 'ts'
  ];

  return (
    <Panel
      title="EVENT STREAM / RECORDS"
      status={`PAGE ${page} / ${totalPages} · LIMIT ${limit}`}
      loading={result.loading && !data}
      error={error}
      empty={!!data && rows.length === 0}
    >
      {data && (
        <>
          <div className="explorer-summary">
            <span>{number(data.total)} MATCHING EVENTS</span>
            <span>PAGE {data.page} OF {totalPages}</span>
            <span>REFRESH · 60S</span>
          </div>

          <div className="chart-table-wrap explorer-table-wrap">
            <table className="analytics-table explorer-table">
              <thead>
                <tr>
                  {fields.map(field => <th key={field}>{field}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((event, index) => (
                  <tr key={event.eventId || `${event.ts}-${index}`}>
                    {fields.map(field => (
                      <td key={field}>
                        {field === 'ts' && event[field]
                          ? new Date(event[field]).toISOString()
                          : event[field] == null
                            ? '—'
                            : String(event[field])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="explorer-pagination">
            <button
              type="button"
              className="explorer-button"
              disabled={page <= 1 || result.loading}
              onClick={() => onPageChange(page - 1)}
            >
              ← PREVIOUS
            </button>
            <span>{page} / {totalPages || 0}</span>
            <button
              type="button"
              className="explorer-button"
              disabled={page >= totalPages || result.loading}
              onClick={() => onPageChange(page + 1)}
            >
              NEXT →
            </button>
          </div>
        </>
      )}
    </Panel>
  );
}

export default function EventsExplorer({ Panel }) {
  const [types, setTypes] = useState([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [limit, setLimit] = useState('25');
  const [applied, setApplied] = useState({
    types: [],
    from: '',
    to: '',
    limit: '25'
  });
  const [page, setPage] = useState(1);
  const [validationError, setValidationError] = useState('');

  const toggleType = type => {
    setTypes(current =>
      current.includes(type)
        ? current.filter(item => item !== type)
        : [...current, type]
    );
  };

  const applyFilters = () => {
    if (from && to && new Date(from) > new Date(to)) {
      setValidationError('Start date must not exceed end date.');
      return;
    }

    setValidationError('');
    setPage(1);
    setApplied({ types, from, to, limit });
  };

  const clearFilters = () => {
    setTypes([]);
    setFrom('');
    setTo('');
    setLimit('25');
    setValidationError('');
    setPage(1);
    setApplied({ types: [], from: '', to: '', limit: '25' });
  };

  const params = new URLSearchParams();
  if (applied.types.length) params.set('type', applied.types.join(','));
  if (applied.from) params.set('from', new Date(applied.from).toISOString());
  if (applied.to) params.set('to', new Date(applied.to).toISOString());
  params.set('page', String(page));
  params.set('limit', applied.limit);

  const query = params.toString();

  return (
    <section id="raw-data">
      <Panel title="RAW EVENT EXPLORER" status="FILTER · INSPECT · PAGINATE">
        <div className="explorer-filters">
          <div className="explorer-field">
            <span className="explorer-label">EVENT TYPE</span>
            <div className="explorer-types">
              {EVENT_TYPES.map(type => (
                <label key={type} className="explorer-check">
                  <input
                    type="checkbox"
                    checked={types.includes(type)}
                    onChange={() => toggleType(type)}
                  />
                  {type}
                </label>
              ))}
            </div>
          </div>

          <label className="explorer-field">
            <span className="explorer-label">FROM · LOCAL TIME</span>
            <input
              type="datetime-local"
              value={from}
              onChange={event => setFrom(event.target.value)}
              className="explorer-input"
            />
          </label>

          <label className="explorer-field">
            <span className="explorer-label">TO · LOCAL TIME</span>
            <input
              type="datetime-local"
              value={to}
              onChange={event => setTo(event.target.value)}
              className="explorer-input"
            />
          </label>

          <label className="explorer-field explorer-limit">
            <span className="explorer-label">ROWS PER PAGE</span>
            <select
              value={limit}
              onChange={event => setLimit(event.target.value)}
              className="explorer-input"
            >
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </label>
        </div>

        {validationError && (
          <div className="status-box status-error">
            [ INVALID FILTER: {validationError} ]
          </div>
        )}

        <div className="explorer-actions">
          <button
            type="button"
            className="explorer-button explorer-primary"
            onClick={applyFilters}
          >
            APPLY FILTERS
          </button>
          <button
            type="button"
            className="explorer-button"
            onClick={clearFilters}
          >
            CLEAR FILTERS
          </button>
        </div>
      </Panel>

      <EventsResults
        key={query}
        query={query}
        page={page}
        limit={applied.limit}
        onPageChange={setPage}
        Panel={Panel}
      />
    </section>
  );
}
