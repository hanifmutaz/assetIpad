import express from 'express';
import { q } from '../db.js';
import { ah } from '../errors.js';
import { getRules, getMaster } from '../services/rules.js';
import { can } from '../services/policy.js';
import { progressMap } from '../services/guides.js';

export const router = express.Router();

router.get('/', ah(async (req, res) => {
  const u = req.user!;
  const R = await getRules();
  const all = can(u, 'device.viewAll');
  const S = `($1::boolean OR d.department_id = ANY($2::int[]))`;
  const P = [all, u.dept_ids];
  const oldModels = await getMaster('old_model');
  const [st, f, tk, months, lok, latest, tickets, old, acts, pend, setupDevs] = await Promise.all([
    q(`SELECT d.status, count(*)::int n FROM device d WHERE ${S} GROUP BY d.status`, P),
    q(`SELECT
        count(*) FILTER (WHERE d.status IN ('Available','Repair') AND (d.last_check IS NULL OR d.last_check < current_date - $3::int))::int stale,
        count(*) FILTER (WHERE d.status IN ('Available','Repair') AND d.apple_status <> 'Done')::int apple,
        count(*) FILTER (WHERE d.status IN ('Available','Repair') AND d.passcode_default)::int pcdefault,
        count(*) FILTER (WHERE d.arrival >= date_trunc('month', current_date))::int new_month
      FROM device d WHERE ${S}`, [...P, R.staleDays]),
    q(`SELECT count(*) FILTER (WHERE t.status<>'Closed')::int open,
        count(*) FILTER (WHERE t.status<>'Closed' AND (t.status='Eskalasi' OR t.created_at < now() - make_interval(days => $3)))::int esk,
        count(*) FILTER (WHERE t.created_at >= date_trunc('month', now()))::int this_m,
        count(*) FILTER (WHERE t.created_at >= date_trunc('month', now()) - interval '1 month' AND t.created_at < date_trunc('month', now()))::int last_m
      FROM ticket t JOIN device d ON d.id=t.device_id WHERE ${S}`, [...P, R.escalateDays]),
    q(`WITH m AS (SELECT generate_series(date_trunc('month', now()) - interval '5 months', date_trunc('month', now()), interval '1 month') AS m)
       SELECT to_char(m.m,'YYYY-MM') AS month,
         (SELECT count(*)::int FROM ticket t JOIN device d ON d.id=t.device_id WHERE ${S} AND date_trunc('month', t.created_at)=m.m) AS tickets,
         (SELECT count(*)::int FROM device_history h JOIN device d ON d.id=h.device_id WHERE ${S} AND h.to_status IN ('Repair','Damaged','Loss') AND date_trunc('month', h.at)=m.m) AS damaged
       FROM m ORDER BY m.m`, P),
    q(`SELECT dp.name, count(d.id)::int n FROM department dp LEFT JOIN device d ON d.department_id=dp.id AND d.status IN ('Setup','Available','Repair')
       WHERE ($1::boolean OR dp.id = ANY($2::int[])) GROUP BY dp.id ORDER BY n DESC, dp.name`, P),
    q(`SELECT d.id, d.name, d.serial, d.model, d.arrival, d.status FROM device d WHERE ${S} ORDER BY d.arrival DESC NULLS LAST, d.created_at DESC LIMIT 5`, P),
    q(`SELECT t.id, 'TK-'||lpad(t.id::text,4,'0') code, COALESCE(d.name,d.serial) device_name, t.type, t.created_at,
        CASE WHEN t.status='Closed' THEN 'Closed' WHEN t.status='Eskalasi' OR t.created_at < now() - make_interval(days => $3) THEN 'Eskalasi' ELSE t.status END state
       FROM ticket t JOIN device d ON d.id=t.device_id WHERE ${S} ORDER BY t.created_at DESC LIMIT 6`, [...P, R.escalateDays]),
    q(`SELECT d.id, d.name, d.model, d.arrival, (d.model = ANY($3)) AS old_model, (d.arrival < current_date - make_interval(years => $4)) AS too_old
       FROM device d WHERE ${S} AND d.status IN ('Available','Repair') AND (d.model = ANY($3) OR d.arrival < current_date - make_interval(years => $4))
       ORDER BY d.arrival NULLS LAST LIMIT 20`, [...P, oldModels, R.maxAgeYears]),
    q(`SELECT h.at, h.by_name, h.action, d.id device_id, COALESCE(d.name, d.serial) device FROM device_history h JOIN device d ON d.id=h.device_id WHERE ${S} ORDER BY h.at DESC LIMIT 6`, P),
    q(`SELECT (SELECT count(*)::int FROM transfer WHERE status='Pending') mt, (SELECT count(*)::int FROM status_request WHERE status='Pending') sr,
              (SELECT count(*)::int FROM access_alert WHERE ack_at IS NULL) al`),
    q(`SELECT d.id, s.lokasi_id, d.purpose, d.status FROM device d JOIN section s ON s.id=d.section_id WHERE d.status='Setup' AND ${S}`, P),
  ]);
  const by = Object.fromEntries(st.rows.map((r) => [r.status, r.n])) as Record<string, number>;
  const fr = f.rows[0];
  const t = tk.rows[0];
  const p = pend.rows[0];
  const pm = await progressMap(setupDevs.rows);
  let tot = 0;
  let done = 0;
  for (const v of pm.values()) { tot += v.total; done += v.done; }
  const active = (by.Setup ?? 0) + (by.Available ?? 0) + (by.Repair ?? 0);
  res.json({
    status: by,
    kpi: { active, available: by.Available ?? 0, newMonth: fr.new_month, openTickets: t.open, ticketsThisMonth: t.this_m, ticketsLastMonth: t.last_m,
      cfgDevices: setupDevs.rowCount, cfgPct: tot ? Math.round((done / tot) * 100) : 100 },
    actions: {
      esk: t.esk, stale: fr.stale, apple: fr.apple, pcdefault: fr.pcdefault,
      ...(can(u, 'device.config') ? { cfg: by.Setup ?? 0 } : {}),
      ...(can(u, 'approval.decide') ? { mt: p.mt, sr: p.sr, alerts: p.al } : {}),
    },
    trend: months.rows, departments: lok.rows, latest: latest.rows, tickets: tickets.rows, replace: old.rows, activity: acts.rows,
    rules: { staleDays: R.staleDays, maxAgeYears: R.maxAgeYears },
  });
}));
