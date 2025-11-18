// Shared calendar scheduling helpers + rules
import { getLocalDateKey } from './_dates.js';

export const PREP_HOURS = 1;
export const CLEAN_HOURS = 1;
export const HOURS_RANGE = { start: 9, end: 22 }; // inclusive hours in local tz
export const MAX_EVENTS_PER_DAY = 3;
export const MAX_CONCURRENT_EVENTS = 2;

export function addHours(date, hours) {
  return new Date(date.getTime() + hours * 3600e3);
}

export function blockWindow(startISO, liveHours) {
  const start = new Date(startISO);
  const blockStart = addHours(start, -PREP_HOURS);
  const blockEnd = addHours(start, liveHours + CLEAN_HOURS);
  return { blockStart, blockEnd };
}

export function overlaps(aStart, aEnd, bStart, bEnd) {
  return !(aEnd <= bStart || aStart >= bEnd);
}

export function mapEvents(items = []) {
  return items.map(e => ({
    id: e.id,
    start: new Date(e.start?.dateTime || e.start?.date),
    end: new Date(e.end?.dateTime || e.end?.date)
  }));
}

export function countOverlaps(events, blockStart, blockEnd, ignoreId) {
  return events.filter(ev => (ignoreId ? ev.id !== ignoreId : true) && overlaps(blockStart, blockEnd, ev.start, ev.end)).length;
}

function countEventsOnDate(events, dateKey, tz, ignoreId) {
  return events.filter(ev => {
    if (ignoreId && ev.id === ignoreId) return false;
    return getLocalDateKey(ev.start, tz) === dateKey;
  }).length;
}

export function slotCapacityState({ events, blockStart, blockEnd, tz, ignoreId }) {
  const dateKey = getLocalDateKey(blockStart, tz);
  const dayCount = countEventsOnDate(events, dateKey, tz, ignoreId);
  const overlapCount = countOverlaps(events, blockStart, blockEnd, ignoreId);
  const dayFull = dayCount >= MAX_EVENTS_PER_DAY;
  const concurrentFull = overlapCount >= MAX_CONCURRENT_EVENTS;
  return { dateKey, dayCount, overlapCount, dayFull, concurrentFull };
}

export function dayCapacityReached(events, dateKey, tz, ignoreId) {
  return countEventsOnDate(events, dateKey, tz, ignoreId) >= MAX_EVENTS_PER_DAY;
}

export function evaluateSlotAllowance({ events = [], startISO, liveHours, tz, ignoreId }) {
  const { blockStart, blockEnd } = blockWindow(startISO, liveHours);
  const state = slotCapacityState({ events, blockStart, blockEnd, tz, ignoreId });
  return { ...state, blockStart, blockEnd };
}
