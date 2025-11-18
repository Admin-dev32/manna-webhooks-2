export const config = { runtime: 'nodejs' };

import { listDaySnapshots } from '../_capacityStore.js';

function authorize(req) {
  const expected = process.env.ADMIN_CAPACITY_SECRET;
  const provided = req.headers['x-admin-secret'] || req.query.secret;
  if (!expected) throw new Error('ADMIN_CAPACITY_SECRET not configured');
  if (provided !== expected) return false;
  return true;
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
    const ok = authorize(req);
    if (!ok) return res.status(401).json({ error: 'unauthorized' });

    const tz = process.env.TIMEZONE || 'America/Los_Angeles';
    const { date } = req.query;
    const days = listDaySnapshots(date);
    return res.json({ ok: true, timezone: tz, days });
  } catch (err) {
    if (err.message.includes('ADMIN_CAPACITY_SECRET')) {
      return res.status(500).json({ error: 'secret_not_configured' });
    }
    console.error('[admin/capacity-debug] error', err);
    return res.status(500).json({ error: 'server_error', detail: err.message });
  }
}
