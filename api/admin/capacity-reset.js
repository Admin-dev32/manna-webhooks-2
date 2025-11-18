export const config = { runtime: 'nodejs' };

import { resetDaySnapshot } from '../_capacityStore.js';

function authorize(req) {
  const expected = process.env.ADMIN_CAPACITY_SECRET;
  const provided = req.headers['x-admin-secret'] || req.query.secret;
  if (!expected) throw new Error('ADMIN_CAPACITY_SECRET not configured');
  if (provided !== expected) return false;
  return true;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 1e6) {
        reject(new Error('payload_too_large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
    const ok = authorize(req);
    if (!ok) return res.status(401).json({ error: 'unauthorized' });

    const body = req.body && Object.keys(req.body).length ? req.body : await readBody(req);
    const date = body?.date;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'invalid_date', detail: 'Use YYYY-MM-DD' });
    }
    const previous = resetDaySnapshot(date);
    return res.json({
      ok: true,
      date,
      previousCount: previous?.count ?? 0,
      limit: previous?.limit ?? null,
      message: previous ? 'Capacity snapshot cleared for this date.' : 'No stored snapshot for this date.'
    });
  } catch (err) {
    if (err.message.includes('ADMIN_CAPACITY_SECRET')) {
      return res.status(500).json({ error: 'secret_not_configured' });
    }
    console.error('[admin/capacity-reset] error', err);
    return res.status(500).json({ error: 'server_error', detail: err.message });
  }
}
