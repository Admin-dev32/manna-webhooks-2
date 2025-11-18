# Manna Snack Bars booking bundle

A single-page widget (`index.html`) plus Vercel API routes for availability lookups, Stripe Checkout, Stripe webhooks, Google Calendar automation, and email reminders.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `ALLOWED_ORIGINS` | Comma-separated list of origins allowed to call the APIs (CORS). |
| `TIMEZONE` | IANA timezone used to build slots and calendar events (e.g. `America/Los_Angeles`). |
| `CALENDAR_ID` | Google Calendar ID that stores confirmed bookings. |
| `PUBLIC_URL` | Base URL used for Stripe success/cancel redirects. |
| `STRIPE_SECRET_KEY` | Server-side Stripe API key. |
| `STRIPE_WEBHOOK_SECRET` | Stripe signing secret for `/api/stripe/webhook`. |
| `GOOGLE_SERVICE_ACCOUNT_JSON` or `GCP_CLIENT_EMAIL` + `GCP_PRIVATE_KEY` | Credentials for Google Calendar access. |
| `SMTP_HOST` | Hostinger (or other) SMTP host, e.g. `smtp.hostinger.com`. |
| `SMTP_PORT` | SMTP port (`465` for SSL or `587` for STARTTLS). |
| `SMTP_USER` | Mailbox/user name used to authenticate. |
| `SMTP_PASS` | Mailbox password or app password. |
| `BOOKING_FROM_EMAIL` | From address that appears on confirmation/reminder emails (defaults to `SMTP_USER` if omitted). |
| `BOOKING_INTERNAL_NOTIFY_EMAIL` | Optional BCC/notification address for outgoing emails. |
| `REMINDER_CRON_SECRET` | Secret token required by `/api/reminders?secret=...` when triggered via Vercel Cron. |

## Email + reminders

* `/api/_email.js` centralizes SMTP transport creation and booking email templates.
* `/api/stripe/webhook` sends confirmation emails after a successful `checkout.session.completed` event and logs failures without breaking the webhook response.
* `/api/reminders` can be scheduled (e.g. hourly) with Vercel Cron. Pass `?secret=REMINDER_CRON_SECRET` to send reminder emails for events starting roughly 24 hours ahead. Each calendar event receives a `reminderSent` flag in its private extended properties to avoid duplicates.

## Calendar & slot rules

* Slots only start on the hour between **09:00** and **22:00** local time.
* Maximum **3 events per day** and **2 concurrent events** (prep + live + cleanup) enforced in both `/api/availability` and the webhook before inserting Google Calendar events.

## Stripe checkout

* Promotion codes are enabled by default (`allow_promotion_codes: true`).
* When the booking total is **≥ $600** the checkout session allows financing/Buynow-pay-later methods (e.g. Affirm) and the widget displays a financing hint.

## Reminders endpoint

Call `/api/reminders?secret=REMINDER_CRON_SECRET` with `GET` to scan for events whose start time is 24–26 hours away. Qualified events trigger reminder emails and store `reminderSent = '1'` in their `extendedProperties.private` block.
