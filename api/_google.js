// /api/_google.js (o dentro de tu webhook)
import { google } from 'googleapis';

export function getCalendarClient() {
  let clientEmail = process.env.GCP_CLIENT_EMAIL;
  let privateKey = (process.env.GCP_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
      const json = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
      clientEmail = json.client_email;
      privateKey = (json.private_key || '').replace(/\\n/g, '\n');
    } catch (err) {
      console.error('[google] failed to parse GOOGLE_SERVICE_ACCOUNT_JSON', err.message);
    }
  }
  const auth = new google.auth.JWT(
    clientEmail,
    undefined,
    privateKey,
    ['https://www.googleapis.com/auth/calendar']
  );
  return google.calendar({ version: 'v3', auth });
}
