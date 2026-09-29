import { describe, expect, it } from "vitest";
import { hasPermission } from "@/lib/auth/rbac";
import { parseCsv, parseCsvWithHeader, toCsv } from "@/lib/csv";
import { passwordSchema, signupSchema } from "@/lib/validation/auth";
import { escapeRegex } from "@/lib/validation/common";
import { createQuestionSchema, csvQuestionRowSchema, submitAnswerSchema } from "@/lib/validation/quiz";

describe("answer submission validation", () => {
  it("strips client-supplied score, isCorrect, userId and status", () => {
    const parsed = submitAnswerSchema.parse({ optionId: "B", score: 100, isCorrect: true, userId: "x", status: "ANSWERED" });
    expect(parsed).toEqual({ optionId: "B" });
  });

  it("rejects options outside A–D", () => {
    expect(submitAnswerSchema.safeParse({ optionId: "E" }).success).toBe(false);
    expect(submitAnswerSchema.safeParse({ optionId: { $ne: null } }).success).toBe(false);
  });
});

describe("password policy", () => {
  it.each(["short1!A", "alllowercase1!", "ALLUPPERCASE1!", "NoNumbersHere!", "NoSymbols12345"])("rejects %s", (pw) => {
    expect(passwordSchema.safeParse(pw).success).toBe(false);
  });
  it("accepts a strong password", () => {
    expect(passwordSchema.safeParse("Str0ng!Passw0rd").success).toBe(true);
  });
  it("signup ignores a client-supplied role", () => {
    const r = signupSchema.parse({ name: "Ann", email: "ANN@Example.com ", password: "Str0ng!Passw0rd", acceptTerms: true, role: "SUPER_ADMIN" });
    expect(r).not.toHaveProperty("role");
    expect(r.email).toBe("ann@example.com");
  });
});

describe("question validation", () => {
  const base = {
    competitionId: "a".repeat(24),
    dayNumber: 1,
    questionText: "What is 2 + 2?",
    options: [
      { id: "A", text: "3" },
      { id: "B", text: "4" },
      { id: "C", text: "5" },
      { id: "D", text: "22" },
    ],
    correctOptionId: "B",
  };
  it("accepts exactly four A–D options", () => {
    expect(createQuestionSchema.safeParse(base).success).toBe(true);
  });
  it("rejects 3 options, empty options and duplicates", () => {
    expect(createQuestionSchema.safeParse({ ...base, options: base.options.slice(0, 3) }).success).toBe(false);
    expect(createQuestionSchema.safeParse({ ...base, options: [...base.options.slice(0, 3), { id: "D", text: " " }] }).success).toBe(false);
    expect(createQuestionSchema.safeParse({ ...base, options: [...base.options.slice(0, 3), { id: "D", text: "3" }] }).success).toBe(false);
  });
  it("requires question text and a day number", () => {
    expect(createQuestionSchema.safeParse({ ...base, questionText: "" }).success).toBe(false);
    expect(createQuestionSchema.safeParse({ ...base, dayNumber: undefined }).success).toBe(false);
  });
});

describe("CSV", () => {
  it("parses quoted fields, escaped quotes and CRLF", () => {
    expect(parseCsv('a,"b,c","say ""hi"""\r\n1,2,3\r\n')).toEqual([["a", "b,c", 'say "hi"'], ["1", "2", "3"]]);
  });

  it("parses multi-line quoted fields and skips blank lines", () => {
    expect(parseCsv('x,y\n"line1\nline2",2\n\n')).toEqual([["x", "y"], ["line1\nline2", "2"]]);
  });

  it("maps header rows to records", () => {
    const { headers, records } = parseCsvWithHeader("dayNumber,question\n1,Hello?\n");
    expect(headers).toEqual(["dayNumber", "question"]);
    expect(records[0]).toEqual({ dayNumber: "1", question: "Hello?" });
  });

  it("neutralises spreadsheet formula injection on export", () => {
    expect(toCsv(["v"], [["=HYPERLINK(\"x\")"], ["+1"], ["safe"]])).toBe('v\r\n"\'=HYPERLINK(""x"")"\r\n\'+1\r\nsafe\r\n');
  });

  it("validates import rows", () => {
    const ok = csvQuestionRowSchema.safeParse({ dayNumber: "3", question: "Capital of France?", optionA: "Paris", optionB: "Rome", optionC: "Berlin", optionD: "Madrid", correctOption: "a", difficulty: "easy" });
    expect(ok.success && ok.data.correctOption).toBe("A");
    const bad = csvQuestionRowSchema.safeParse({ dayNumber: "x", question: "", optionA: "", optionB: "b", optionC: "c", optionD: "d", correctOption: "E" });
    expect(bad.success).toBe(false);
  });
});

describe("RBAC", () => {
  it("users have no admin permissions", () => {
    expect(hasPermission("USER", "admin:access")).toBe(false);
  });
  it("admins manage content but not audit logs or sensitive settings", () => {
    expect(hasPermission("ADMIN", "questions:manage")).toBe(true);
    expect(hasPermission("ADMIN", "audit:view")).toBe(false);
    expect(hasPermission("ADMIN", "settings:update:sensitive")).toBe(false);
    expect(hasPermission("ADMIN", "admins:manage")).toBe(false);
  });
  it("super admins can do everything", () => {
    expect(hasPermission("SUPER_ADMIN", "audit:view")).toBe(true);
    expect(hasPermission("SUPER_ADMIN", "sessions:global-logout")).toBe(true);
  });
});

describe("regex escaping (search injection)", () => {
  it("escapes regex metacharacters", () => {
    expect(new RegExp(escapeRegex("a.*(b)")).test("a.*(b)")).toBe(true);
    expect(new RegExp(escapeRegex("a.*")).test("abc")).toBe(false);
  });
});
