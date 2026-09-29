import type { Types } from "mongoose";
import { connectDb } from "@/lib/db/mongoose";
import { logger } from "@/lib/logger";
import {
  sendDailyReminder,
  sendDeadlineReminder,
  sendLeaderboardRevealEmail,
} from "@/lib/notifications/email";
import { now } from "@/lib/time/clock";
import { zonedParts } from "@/lib/time/zoned";
import type { ICompetition } from "@/models/Competition";
import { CompetitionParticipant } from "@/models/CompetitionParticipant";
import { DailyAnswer } from "@/models/DailyAnswer";
import { Notification, type NotificationType } from "@/models/Notification";
import { User } from "@/models/User";
import { clockFor } from "@/services/competition.service";
import { runWithConcurrency } from "@/services/participant.service";
import { getSettings } from "@/services/settings.service";

/**
 * Notification pipeline: an in-app Notification row is the idempotent record
 * (unique dedupeKey) and each channel (email today; push later) is delivered
 * only for rows that were newly inserted.
 */
interface Draft {
  userId: Types.ObjectId;
  type: NotificationType;
  title: string;
  body: string;
  link: string | null;
  dedupeKey: string;
}

async function insertNew(drafts: Draft[]): Promise<Draft[]> {
  if (!drafts.length) return [];
  const existing = await Notification.find({ dedupeKey: { $in: drafts.map((d) => d.dedupeKey) } }).select("dedupeKey").lean();
  const have = new Set(existing.map((e) => e.dedupeKey));
  const fresh = drafts.filter((d) => !have.has(d.dedupeKey));
  if (!fresh.length) return [];
  try {
    await Notification.insertMany(fresh, { ordered: false });
    return fresh;
  } catch (e) {
    // Concurrent cron runs: keep only those we actually inserted.
    const inserted = (e as { insertedDocs?: { dedupeKey: string }[] }).insertedDocs ?? [];
    const keys = new Set(inserted.map((d) => d.dedupeKey));
    return fresh.filter((d) => keys.has(d.dedupeKey));
  }
}

async function deliverEmails(drafts: Draft[], send: (to: string, name: string) => Promise<boolean>) {
  const users = await User.find({ _id: { $in: drafts.map((d) => d.userId) }, isActive: true, isEmailVerified: true }).select("email name").lean();
  const userMap = new Map(users.map((u) => [String(u._id), u]));
  await runWithConcurrency(drafts, 5, async (d) => {
    const u = userMap.get(String(d.userId));
    if (!u) return;
    if (await send(u.email, u.name)) await Notification.updateOne({ dedupeKey: d.dedupeKey }, { $set: { emailedAt: now() } });
  });
}

async function unansweredParticipants(comp: ICompetition, dayNumber: number) {
  const participants = await CompetitionParticipant.find({ competitionId: comp._id }).select("userId").lean();
  const answered = await DailyAnswer.find({ competitionId: comp._id, dayNumber }).select("userId").lean();
  const done = new Set(answered.map((a) => String(a.userId)));
  return participants.map((p) => p.userId).filter((id) => !done.has(String(id)));
}

/** Reminders for an ACTIVE competition. Safe to call every few minutes. */
export async function runReminders(comp: ICompetition, at: Date = now()) {
  await connectDb();
  const settings = await getSettings();
  const clock = clockFor(comp, at);
  if (clock.phase !== "ACTIVE" || !clock.today) return { daily: 0, deadline: 0, ending: 0 };
  const day = clock.currentDay!;
  const localHour = zonedParts(at, comp.timezone).hour;
  const result = { daily: 0, deadline: 0, ending: 0 };
  const cid = String(comp._id);

  if (settings.notifications.dailyReminderEnabled && localHour >= settings.notifications.dailyReminderHour) {
    const users = await unansweredParticipants(comp, day);
    const created = await insertNew(
      users.map((userId) => ({
        userId,
        type: "DAILY_REMINDER",
        title: "Today's quiz is waiting for you",
        body: `Day ${day} of ${comp.name} is open. Submit your answer before midnight.`,
        link: "/quiz",
        dedupeKey: `DAILY_REMINDER:${cid}:${day}:${String(userId)}`,
      })),
    );
    await deliverEmails(created, (to, name) => sendDailyReminder(to, name, comp.name, day));
    result.daily = created.length;
  }

  const hoursBefore = settings.notifications.deadlineReminderHoursBefore;
  const msLeft = clock.today.closesAt.getTime() - at.getTime();
  if (settings.notifications.deadlineReminderEnabled && msLeft <= hoursBefore * 3_600_000) {
    const users = await unansweredParticipants(comp, day);
    const created = await insertNew(
      users.map((userId) => ({
        userId,
        type: "DEADLINE_REMINDER",
        title: `Only ${hoursBefore} hours left`,
        body: "Only a little time left to answer today's question.",
        link: "/quiz",
        dedupeKey: `DEADLINE_REMINDER:${cid}:${day}:${String(userId)}`,
      })),
    );
    await deliverEmails(created, (to, name) => sendDeadlineReminder(to, name, hoursBefore));
    result.deadline = created.length;
  }

  if (day === comp.durationDays - 1) {
    const participants = await CompetitionParticipant.find({ competitionId: comp._id }).select("userId").lean();
    const created = await insertNew(
      participants.map((p) => ({
        userId: p.userId,
        type: "COMPETITION_ENDING",
        title: "The competition ends tomorrow",
        body: `Tomorrow is the final day of ${comp.name}. Don't miss it!`,
        link: "/dashboard",
        dedupeKey: `COMPETITION_ENDING:${cid}:${String(p.userId)}`,
      })),
    );
    result.ending = created.length;
  }
  return result;
}

export async function notifyResultsRevealed(comp: ICompetition) {
  await connectDb();
  const settings = await getSettings();
  const participants = await CompetitionParticipant.find({ competitionId: comp._id }).select("userId").lean();
  const created = await insertNew(
    participants.map((p) => ({
      userId: p.userId,
      type: "RESULTS_REVEALED",
      title: "The final leaderboard is now available",
      body: `See how you did in ${comp.name}.`,
      link: "/leaderboard",
      dedupeKey: `RESULTS_REVEALED:${String(comp._id)}:${String(p.userId)}`,
    })),
  );
  if (settings.notifications.resultEmailEnabled) {
    await deliverEmails(created, (to, name) => sendLeaderboardRevealEmail(to, name, comp.name));
  }
  logger.info("notifications.results_revealed", { competitionId: String(comp._id), count: created.length });
  return created.length;
}

export async function listNotifications(userId: Types.ObjectId, limit = 20) {
  await connectDb();
  const items = await Notification.find({ userId }).sort({ createdAt: -1 }).limit(limit).lean();
  const unread = await Notification.countDocuments({ userId, readAt: null });
  return {
    unread,
    items: items.map((n) => ({
      id: String(n._id),
      type: n.type,
      title: n.title,
      body: n.body,
      link: n.link,
      read: !!n.readAt,
      createdAt: n.createdAt.toISOString(),
    })),
  };
}

export async function markNotificationsRead(userId: Types.ObjectId, ids?: string[]) {
  await connectDb();
  // Scoped by userId: a user can never mark someone else's notifications.
  const filter = ids?.length ? { userId, _id: { $in: ids } } : { userId, readAt: null };
  await Notification.updateMany(filter, { $set: { readAt: now() } });
}
