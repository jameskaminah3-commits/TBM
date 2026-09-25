// zaina-platform/web/console/pages/reports.tsx
//
// The business's report: headline numbers for the period, chats per day,
// what was made in chat, questions nothing answered, and what the model cost.

import { useState } from "react";
import { api, businessPath } from "../api.ts";
import { go } from "../app.tsx";
import { count, day, money, percent, usd } from "../format.ts";
import type { Report } from "../types.ts";
import { ErrorLine, Icon, Tabs, useLoad } from "../ui.tsx";

type Period = "7" | "30" | "90";

export function ReportsPage(props: { businessId: string }) {
  const [period, setPeriod] = useState<Period>("30");
  const report = useLoad(() => api<Report>("GET", businessPath(props.businessId, `/reports?days=${period}`)), [props.businessId, period]);
  const data = report.data;
  return (
    <div className="page">
      <div className="page-head">
        <h1>Reports</h1>
      </div>
      <Tabs label="Period" active={period} onChange={setPeriod} tabs={[{ id: "7", label: "Last 7 days" }, { id: "30", label: "Last 30 days" }, { id: "90", label: "Last 90 days" }]} />
      <ErrorLine error={report.error} />
      {data ? (
        <div className={`report${report.loading ? " refreshing" : ""}`}>
          <div className="kpis">
            <Kpi label="Chats" value={count(data.chats.total)} detail={`Website ${count(data.chats.web)} · WhatsApp ${count(data.chats.whatsapp)}`} />
            <Kpi label="Handled by Zaina alone" value={percent(data.resolvedWithoutStaff.share)} detail={`${count(data.resolvedWithoutStaff.chats)} of ${count(data.chats.total)} chats`} />
            <Kpi
              label="Handoffs picked up within 15 minutes"
              value={percent(data.handoffs.shareClaimedWithin15Minutes)}
              detail={`${data.handoffs.claimedWithin15Minutes} of ${data.handoffs.reachedTeam} · target 90%`}
              status={data.handoffs.shareClaimedWithin15Minutes === null ? null : data.handoffs.shareClaimedWithin15Minutes >= 0.9 ? "good" : "warning"}
            />
            <Kpi label="Bookings made in chat" value={count(data.outcomes.bookings)} detail={data.outcomes.depositsRequested.length ? `Deposits asked: ${data.outcomes.depositsRequested.map(money).join(" · ")}` : "No deposits asked yet"} />
          </div>

          <section className="card">
            <h2>Chats per day</h2>
            <p className="muted small">Conversations started each day ({data.timeZone.replace(/_/g, " ")} time). Hover or focus a day for its handoffs and bookings.</p>
            <DailyChart daily={data.daily} />
          </section>

          <div className="report-grid">
            <section className="card">
              <h2>The team</h2>
              <dl className="facts">
                <div><dt>Chats handed to the team</dt><dd>{count(data.handoffs.total)}</dd></div>
                <div><dt>Callbacks asked for</dt><dd>{count(data.handoffs.callbacks)}</dd></div>
                <div><dt>Claimed</dt><dd>{count(data.handoffs.claimed)}</dd></div>
                <div><dt>Typical time to claim</dt><dd>{data.handoffs.medianMinutesToClaim === null ? "—" : `${data.handoffs.medianMinutesToClaim} min`}</dd></div>
                <div><dt>Typical time to the team's first reply</dt><dd>{data.handoffs.medianMinutesToFirstReply === null ? "—" : `${data.handoffs.medianMinutesToFirstReply} min`}</dd></div>
              </dl>
            </section>
            <section className="card">
              <h2>Zaina</h2>
              <dl className="facts">
                <div><dt>Replies</dt><dd>{count(data.zaina.replies)}</dd></div>
                <div><dt>Typical reply time</dt><dd>{data.zaina.medianSeconds === null ? "—" : `${data.zaina.medianSeconds} s`}</dd></div>
                <div><dt>Slowest replies (95th percentile)</dt><dd>{data.zaina.p95Seconds === null ? "—" : `${data.zaina.p95Seconds} s`}</dd></div>
                <div><dt>Turns that failed</dt><dd>{count(data.zaina.failedTurns)}</dd></div>
                <div><dt>Customer messages</dt><dd>{count(data.customerMessages)}</dd></div>
              </dl>
            </section>
            <section className="card">
              <h2>Made in chat</h2>
              <dl className="facts">
                <div><dt>Bookings</dt><dd>{count(data.outcomes.bookings)}</dd></div>
                <div><dt>Booking totals</dt><dd>{data.outcomes.bookingTotals.length ? data.outcomes.bookingTotals.map(money).join(" · ") : "—"}</dd></div>
                <div><dt>Custom requests</dt><dd>{count(data.outcomes.customOffers)}</dd></div>
                <div><dt>Listing verifications</dt><dd>{count(data.outcomes.verifications)}</dd></div>
                <div><dt>Request fees asked</dt><dd>{data.outcomes.feesRequested.length ? data.outcomes.feesRequested.map(money).join(" · ") : "—"}</dd></div>
                <div><dt>Leads for the team</dt><dd>{count(data.outcomes.leads)}</dd></div>
              </dl>
            </section>
            <section className="card">
              <h2>Cost</h2>
              <dl className="facts">
                <div><dt>Model cost</dt><dd>{usd(data.cost.costUsd)}</dd></div>
                <div><dt>Per chat</dt><dd>{usd(data.cost.perChatUsd)}</dd></div>
                <div><dt>Tokens in / out</dt><dd>{count(data.cost.inputTokens)} / {count(data.cost.outputTokens)}</dd></div>
                <div><dt>Of which cached</dt><dd>{count(data.cost.cachedTokens)}</dd></div>
              </dl>
            </section>
          </div>

          <section className="card">
            <h2>Questions nothing answered <span className="muted">({count(data.unanswered.total)})</span></h2>
            {data.unanswered.top.length === 0 ? (
              <p className="muted">Every question found an answer in your documents.</p>
            ) : (
              <>
                <ol className="questions">
                  {data.unanswered.top.map((row) => <li key={row.question}><span>{row.question}</span><span className="muted">{row.times}×</span></li>)}
                </ol>
                <button type="button" className="link" onClick={() => go({ businessId: props.businessId, page: "knowledge" })}>Add answers in Knowledge</button>
              </>
            )}
          </section>
        </div>
      ) : report.loading ? <p className="muted">Loading…</p> : null}
    </div>
  );
}

function Kpi(props: { label: string; value: string; detail: string; status?: "good" | "warning" | null }) {
  return (
    <div className="kpi">
      <p className="kpi-label">{props.label}</p>
      <p className="kpi-value">{props.value}</p>
      <p className="kpi-detail">
        {props.status ? (
          <span className={`status ${props.status}`}>
            <Icon name={props.status === "good" ? "check" : "alert"} size={13} />
            {props.status === "good" ? "On target" : "Below target"}
          </span>
        ) : null}
        {props.detail}
      </p>
    </div>
  );
}

/** Clean axis ticks: 0 and three or four round steps up to the largest value. */
function ticksFor(max: number): number[] {
  if (max <= 0) return [0, 1];
  const rough = max / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= rough) ?? magnitude * 10;
  const ticks: number[] = [];
  for (let value = 0; value < max + step; value += step) ticks.push(Math.round(value));
  return ticks;
}

function DailyChart(props: { daily: Report["daily"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const days = props.daily;
  const width = 760;
  const height = 240;
  const margin = { top: 12, right: 8, bottom: 30, left: 40 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const ticks = ticksFor(Math.max(...days.map((entry) => entry.chats), 0));
  const top = ticks[ticks.length - 1] || 1;
  const band = plotWidth / Math.max(days.length, 1);
  const barWidth = Math.max(2, Math.min(24, band - 2));
  const every = days.length <= 10 ? 1 : days.length <= 31 ? 5 : 15;
  const y = (value: number) => margin.top + plotHeight - (value / top) * plotHeight;

  const bar = (index: number, value: number) => {
    const x = margin.left + index * band + (band - barWidth) / 2;
    const base = margin.top + plotHeight;
    const topY = y(value);
    const r = Math.min(4, barWidth / 2, base - topY);
    return `M${x},${base} V${topY + r} Q${x},${topY} ${x + r},${topY} H${x + barWidth - r} Q${x + barWidth},${topY} ${x + barWidth},${topY + r} V${base} Z`;
  };

  const hovered = hover === null ? null : days[hover];
  return (
    <div className="chart">
      <div className="chart-toolbar">
        <button type="button" className="link" onClick={() => setTable(!table)}>{table ? "Show chart" : "Show as a table"}</button>
      </div>
      {table ? (
        <table className="table">
          <thead><tr><th>Day</th><th className="number">Chats</th><th className="number">Handed to the team</th><th className="number">Bookings</th></tr></thead>
          <tbody>
            {days.map((entry) => (
              <tr key={entry.day}><td>{day(entry.day)}</td><td className="number">{entry.chats}</td><td className="number">{entry.handoffs}</td><td className="number">{entry.bookings}</td></tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="chart-plot">
          <svg viewBox={`0 0 ${width} ${height}`} role="group" aria-label="Chats per day">
            {ticks.map((tick) => (
              <g key={tick}>
                <line className="grid" x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} />
                <text className="axis" x={margin.left - 8} y={y(tick)} dy="0.32em" textAnchor="end">{tick.toLocaleString("en-US")}</text>
              </g>
            ))}
            <line className="baseline" x1={margin.left} x2={width - margin.right} y1={margin.top + plotHeight} y2={margin.top + plotHeight} />
            {days.map((entry, index) => (
              <g key={entry.day}>
                {entry.chats > 0 ? <path className={`bar${hover === index ? " hovered" : ""}`} d={bar(index, entry.chats)} /> : null}
                {index % every === 0 || index === days.length - 1 ? (
                  <text className="axis" x={margin.left + index * band + band / 2} y={height - 10} textAnchor="middle">{day(entry.day).replace(/^\w+,?\s/, "")}</text>
                ) : null}
                <rect
                  className="hit"
                  x={margin.left + index * band}
                  y={margin.top}
                  width={band}
                  height={plotHeight}
                  tabIndex={0}
                  aria-label={`${day(entry.day)}: ${entry.chats} chats, ${entry.handoffs} handed to the team, ${entry.bookings} bookings`}
                  onMouseEnter={() => setHover(index)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(index)}
                  onBlur={() => setHover(null)}
                />
              </g>
            ))}
          </svg>
          {hovered && hover !== null ? (
            <div
              className={`tooltip${hover / days.length < 0.2 ? " from-left" : hover / days.length > 0.8 ? " from-right" : ""}`}
              role="status"
              style={{
                left: `${((margin.left + hover * band + band / 2) / width) * 100}%`,
                top: `${(y(hovered.chats) / height) * 100}%`,
              }}
            >
              <p className="tooltip-title">{day(hovered.day)}</p>
              <p><strong>{hovered.chats}</strong> chats</p>
              <p><strong>{hovered.handoffs}</strong> handed to the team</p>
              <p><strong>{hovered.bookings}</strong> bookings</p>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
