import express from 'express';
import { q } from '../db.js';
import { ah } from '../errors.js';
import { getRules, getMaster } from '../services/rules.js';

export const router = express.Router();

router.get('/', ah(async (req, res) => {
  const R = await getRules();
  const role = req.user.role;
  const oldModels = await getMaster('old_model');
  const [st, flags, tk, months, lok, latest, tickets, old, acts, cfg, orphans, pend] = await Promise.all([
    q('SELECT status, count(*)::int n FROM device GROUP BY status'),
    q(`SELECT
        count(*) FILTER (WHERE d.status IN ('Available','Repair') AND (d.last_check IS NULL OR d.last_check < current_date - $1::int))::int stale,
        count(*) FILTER (WHERE d.status IN ('Available','Repair') AND d.apple_status <> 'Done')::int apple,
        count(*) FILTER (WHERE d.status IN ('Pending','Setup','Available','Repair') AND vp.device_id IS NULL)::int nopic,
        count(*) FILTER (WHERE d.status IN ('Available','Repair') AND jsonb_array_length(COALESCE(d.reconfig->'done','[]'::jsonb)) > 0
                           AND (d.reconfig->>'actual') IS NULL AND (d.reconfig->>'plan') < to_char(current_date,'YYYY-MM-DD'))::int rcdelay,
        (SELECT count(*) FROM device_credential c JOIN device x ON x.id=c.device_id WHERE c.field='passcode' AND c.weak AND x.status IN ('Pending','Setup','Available','Repair'))::int weak,
        count(*) FILTER (WHERE d.arrival >= date_trunc('month', current_date))::int new_month
      FROM device d LEFT JOIN v_device_pic vp ON vp.device_id=d.id`, [R.staleDays]),
    q(`SELECT
        count(*) FILTER (WHERE status<>'Closed')::int open,
        count(*) FILTER (WHERE status<>'Closed' AND (status='Eskalasi' OR created_at < now() - make_interval(days => $1)))::int esk,
        count(*) FILTER (WHERE created_at >= date_trunc('month', now()))::int this_m,
        count(*) FILTER (WHERE created_at >= date_trunc('month', now()) - interval '1 month' AND created_at < date_trunc('month', now()))::int last_m
      FROM ticket`, [R.escalateDays]),
    q(`WITH m AS (SELECT generate_series(date_trunc('month', now()) - interval '5 months', date_trunc('month', now()), interval '1 month') AS m)
       SELECT to_char(m.m,'YYYY-MM') AS month,
         (SELECT count(*)::int FROM ticket t WHERE date_trunc('month', t.created_at)=m.m) AS tickets,
         (SELECT count(*)::int FROM device_history h WHERE h.to_status IN ('Repair','Damaged','Loss') AND date_trunc('month', h.at)=m.m) AS damaged
       FROM m ORDER BY m.m`),
    q(`SELECT l.name, count(d.id)::int n FROM lokasi l LEFT JOIN section s ON s.lokasi_id=l.id
       LEFT JOIN device d ON d.section_id=s.id AND d.status IN ('Pending','Setup','Available','Repair') GROUP BY l.id ORDER BY l.sort, l.name`),
    q('SELECT d.id, d.name, d.serial, d.model, d.arrival, d.status FROM device d ORDER BY d.arrival DESC NULLS LAST, d.created_at DESC LIMIT 5'),
    q(`SELECT t.id, 'TK-'||lpad(t.id::text,4,'0') code, d.name device_name, t.type, t.created_at,
        CASE WHEN t.status='Closed' THEN 'Closed' WHEN t.status='Eskalasi' OR t.created_at < now() - make_interval(days => $1) THEN 'Eskalasi' ELSE t.status END state
       FROM ticket t JOIN device d ON d.id=t.device_id ORDER BY t.created_at DESC LIMIT 6`, [R.escalateDays]),
    q(`SELECT id, name, model, arrival, (model = ANY($1)) AS old_model, (arrival < current_date - make_interval(years => $2)) AS too_old
       FROM device WHERE status IN ('Available','Repair') AND (model = ANY($1) OR arrival < current_date - make_interval(years => $2))
       ORDER BY arrival NULLS LAST LIMIT 20`, [oldModels, R.maxAgeYears]),
    q(`SELECT h.at, h.by_name, h.action, d.id device_id, COALESCE(d.name, d.serial) device FROM device_history h JOIN device d ON d.id=h.device_id ORDER BY h.at DESC LIMIT 6`),
    q(`SELECT count(*)::int n, COALESCE(sum(vc.total),0)::int total, COALESCE(sum(vc.done),0)::int done FROM device d JOIN v_device_cfg vc ON vc.device_id=d.id WHERE d.status IN ('Pending','Setup')`),
    q(`SELECT l.name lokasi, s.name section, count(*)::int n FROM device d JOIN section s ON s.id=d.section_id JOIN lokasi l ON l.id=s.lokasi_id
       LEFT JOIN v_device_pic vp ON vp.device_id=d.id WHERE d.status IN ('Pending','Setup','Available','Repair') AND vp.device_id IS NULL GROUP BY 1,2 ORDER BY 1,2`),
    q(`SELECT (SELECT count(*)::int FROM transfer WHERE status='Pending') mt,
              (SELECT count(*)::int FROM status_request WHERE status='Pending' AND requested_by<>$1) sr,
              (SELECT count(*)::int FROM access_alert WHERE ack_at IS NULL) al`, [req.user.id]),
  ]);
  const byStatus = Object.fromEntries(st.rows.map((r) => [r.status, r.n]));
  const f = flags.rows[0];
  const p = pend.rows[0];
  const admin = role === 'admin';
  res.json({
    status: byStatus,
    kpi: {
      active: ['Pending', 'Setup', 'Available', 'Repair'].reduce((a, s) => a + (byStatus[s] || 0), 0),
      available: byStatus.Available || 0, newMonth: f.new_month,
      openTickets: tk.rows[0].open, ticketsThisMonth: tk.rows[0].this_m, ticketsLastMonth: tk.rows[0].last_m,
      cfgDevices: cfg.rows[0].n, cfgPct: cfg.rows[0].total ? Math.round((cfg.rows[0].done / cfg.rows[0].total) * 100) : 100,
    },
    actions: role === 'user' ? { esk: tk.rows[0].esk } : {
      esk: tk.rows[0].esk, mt: p.mt, cfg: (byStatus.Pending || 0) + (byStatus.Setup || 0), stale: f.stale, nopic: f.nopic, rcdelay: f.rcdelay,
      ...(['admin', 'manager'].includes(role) ? { sr: p.sr } : {}),
      ...(admin ? { apple: f.apple, weak: f.weak, alerts: p.al } : {}),
    },
    orphans: role === 'user' ? [] : orphans.rows,
    trend: months.rows,
    lokasi: lok.rows,
    latest: latest.rows,
    tickets: tickets.rows,
    replace: old.rows,
    activity: acts.rows,
    rules: { staleDays: R.staleDays, maxAgeYears: R.maxAgeYears },
  });
}));
