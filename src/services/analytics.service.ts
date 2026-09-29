import { connectDb } from "@/lib/db/mongoose";
import { now } from "@/lib/time/clock";
import { addDaysToLocalDate, localDateInZone, startOfLocalDay } from "@/lib/time/zoned";
import type { ICompetition } from "@/models/Competition";
import { CompetitionParticipant } from "@/models/CompetitionParticipant";
import { DailyAnswer } from "@/models/DailyAnswer";
import { Question } from "@/models/Question";
import { SuspicionFlag } from "@/models/SuspicionFlag";
import { User } from "@/models/User";
import { clockFor, getCurrentCompetition } from "@/services/competition.service";

const DAY_MS = 86_400_000;

function pct(n: number, d: number) {
  return d ? Math.round((n / d) * 1000) / 10 : 0;
}

/** Per-day participation counts for a competition (days that have opened). */
export async function participationByDay(comp: ICompetition, at: Date = now()) {
  const clock = clockFor(comp, at);
  const openedDays = clock.phase === "ENDED" ? comp.durationDays : clock.phase === "ACTIVE" ? clock.currentDay! : 0;
  const [rows, participants] = await Promise.all([
    DailyAnswer.aggregate<{ _id: { day: number; status: string }; count: number; correct: number }>([
      { $match: { competitionId: comp._id } },
      {
        $group: {
          _id: { day: "$dayNumber", status: "$status" },
          count: { $sum: 1 },
          correct: { $sum: { $cond: [{ $eq: ["$isCorrect", true] }, 1, 0] } },
        },
      },
    ]),
    CompetitionParticipant.countDocuments({ competitionId: comp._id }),
  ]);
  const days = Array.from({ length: openedDays }, (_, i) => ({ day: i + 1, answered: 0, missed: 0, correct: 0, participation: 0 }));
  for (const r of rows) {
    const d = days[r._id.day - 1];
    if (!d) continue;
    if (r._id.status === "ANSWERED") {
      d.answered = r.count;
      d.correct = r.correct;
    } else d.missed = r.count;
  }
  for (const d of days) d.participation = pct(d.answered, participants);
  return { participants, days };
}

export async function questionPerformance(comp: ICompetition) {
  const [questions, stats] = await Promise.all([
    Question.find({ competitionId: comp._id }).sort({ dayNumber: 1 }).select("dayNumber questionText category difficulty status").lean(),
    DailyAnswer.aggregate<{ _id: number; attempts: number; correct: number; missed: number }>([
      { $match: { competitionId: comp._id } },
      {
        $group: {
          _id: "$dayNumber",
          attempts: { $sum: { $cond: [{ $eq: ["$status", "ANSWERED"] }, 1, 0] } },
          correct: { $sum: { $cond: [{ $eq: ["$isCorrect", true] }, 1, 0] } },
          missed: { $sum: { $cond: [{ $eq: ["$status", "MISSED"] }, 1, 0] } },
        },
      },
    ]),
  ]);
  const byDay = new Map(stats.map((s) => [s._id, s]));
  return questions.map((q) => {
    const s = byDay.get(q.dayNumber);
    const attempts = s?.attempts ?? 0;
    const correct = s?.correct ?? 0;
    const accuracy = pct(correct, attempts);
    let signal: "TOO_EASY" | "TOO_HARD" | "NORMAL" | "NO_DATA" = "NO_DATA";
    if (attempts >= 5) signal = accuracy >= 90 ? "TOO_EASY" : accuracy <= 20 ? "TOO_HARD" : "NORMAL";
    return {
      id: String(q._id),
      dayNumber: q.dayNumber,
      questionText: q.questionText,
      category: q.category,
      difficulty: q.difficulty,
      attempts,
      correct,
      wrong: attempts - correct,
      missed: s?.missed ?? 0,
      accuracy,
      signal,
    };
  });
}

export async function getCompetitionAnalytics(comp: ICompetition, at: Date = now()) {
  await connectDb();
  const [participation, performance, scoreBuckets] = await Promise.all([
    participationByDay(comp, at),
    questionPerformance(comp),
    CompetitionParticipant.aggregate<{ _id: number; count: number }>([
      { $match: { competitionId: comp._id } },
      { $group: { _id: "$totalScore", count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
  ]);

  const checkpoints = [1, 5, 10, 20, comp.durationDays].filter((d, i, a) => d <= comp.durationDays && a.indexOf(d) === i);
  const dropOff = [
    { label: "Registered", value: participation.participants },
    ...checkpoints.map((d) => ({ label: `Day ${d}`, value: participation.days[d - 1]?.answered ?? 0 })),
  ];

  const group = (key: "difficulty" | "category") => {
    const map = new Map<string, { attempts: number; correct: number }>();
    for (const q of performance) {
      const k = q[key];
      const cur = map.get(k) ?? { attempts: 0, correct: 0 };
      cur.attempts += q.attempts;
      cur.correct += q.correct;
      map.set(k, cur);
    }
    return [...map.entries()].map(([name, v]) => ({ name, attempts: v.attempts, accuracy: pct(v.correct, v.attempts) }));
  };

  return {
    participation,
    dropOff,
    performance,
    scoreDistribution: scoreBuckets.map((b) => ({ score: b._id, count: b.count })),
    byDifficulty: group("difficulty"),
    byCategory: group("category"),
  };
}

/** Registrations per day over the last `days` days (UTC). */
export async function registrationGrowth(days = 30, at: Date = now()) {
  const since = new Date(at.getTime() - days * DAY_MS);
  const rows = await User.aggregate<{ _id: string; count: number }>([
    { $match: { createdAt: { $gte: since } } },
    { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 } } },
  ]);
  const map = new Map(rows.map((r) => [r._id, r.count]));
  const base = await User.countDocuments({ createdAt: { $lt: since } });
  let running = base;
  const start = localDateInZone(since, "UTC");
  return Array.from({ length: days + 1 }, (_, i) => {
    const date = addDaysToLocalDate(start, i);
    const n = map.get(date) ?? 0;
    running += n;
    return { date, newUsers: n, totalUsers: running };
  });
}

export async function getAdminDashboard(at: Date = now()) {
  await connectDb();
  const comp = await getCurrentCompetition(at);
  const todayStartUtc = startOfLocalDay(localDateInZone(at, comp?.timezone ?? "UTC"), comp?.timezone ?? "UTC");
  const weekAgo = new Date(at.getTime() - 7 * DAY_MS);

  const [totalUsers, verifiedUsers, activeUsers, inactiveUsers, newToday, newWeek, openFlags] = await Promise.all([
    User.countDocuments({}),
    User.countDocuments({ isEmailVerified: true }),
    User.countDocuments({ isActive: true, lastLoginAt: { $gte: new Date(at.getTime() - 30 * DAY_MS) } }),
    User.countDocuments({ isActive: false }),
    User.countDocuments({ createdAt: { $gte: todayStartUtc } }),
    User.countDocuments({ createdAt: { $gte: weekAgo } }),
    SuspicionFlag.countDocuments({ status: "OPEN" }),
  ]);

  let competition = null;
  let quiz = null;
  let charts = null;
  if (comp) {
    const clock = clockFor(comp, at);
    const [participation, questionsCreated, questionsPublished, totalAnswers, missedAnswers, correctAnswers, answeredAnswers] = await Promise.all([
      participationByDay(comp, at),
      Question.countDocuments({ competitionId: comp._id }),
      Question.countDocuments({ competitionId: comp._id, status: "PUBLISHED" }),
      DailyAnswer.countDocuments({ competitionId: comp._id }),
      DailyAnswer.countDocuments({ competitionId: comp._id, status: "MISSED" }),
      DailyAnswer.countDocuments({ competitionId: comp._id, isCorrect: true }),
      DailyAnswer.countDocuments({ competitionId: comp._id, status: "ANSWERED" }),
    ]);
    const today = clock.currentDay ? participation.days[clock.currentDay - 1] : undefined;
    const yesterday = clock.lastClosedDay ? participation.days[clock.lastClosedDay - 1] : undefined;
    const closedDays = participation.days.slice(0, clock.lastClosedDay);
    competition = {
      id: String(comp._id),
      name: comp.name,
      status: comp.status,
      phase: clock.phase,
      currentDay: clock.currentDay,
      durationDays: comp.durationDays,
      startsAt: clock.startsAt.toISOString(),
      endsAt: clock.endsAt.toISOString(),
      timezone: comp.timezone,
      registered: participation.participants,
      activeParticipants: await DailyAnswer.distinct("userId", { competitionId: comp._id, status: "ANSWERED", answeredAt: { $gte: weekAgo } }).then((r) => r.length),
      answersToday: today?.answered ?? 0,
      missedYesterday: yesterday ? participation.participants - yesterday.answered : 0,
      averageParticipation: closedDays.length ? Math.round((closedDays.reduce((s, d) => s + d.participation, 0) / closedDays.length) * 10) / 10 : 0,
      leaderboardRevealed: comp.leaderboardRevealed,
    };
    quiz = {
      questionsCreated,
      questionsPublished,
      todaysAnswers: today?.answered ?? 0,
      totalAnswers,
      missedAnswers,
      averageAccuracy: pct(correctAnswers, answeredAnswers),
      averageParticipation: competition.averageParticipation,
    };
    charts = { participation: participation.days };
  }

  return {
    competition,
    users: { totalUsers, verifiedUsers, activeUsers, inactiveUsers, newToday, newWeek },
    quiz,
    charts,
    openFlags,
    registrations: await registrationGrowth(30, at),
  };
}

export type CompetitionAnalytics = Awaited<ReturnType<typeof getCompetitionAnalytics>>;
