/**
 * Browser-side XML → import rows. The rows use the CSV column names, so XML and CSV
 * share the exact same server-side validation and import path.
 *
 * Supported shapes (element and attribute names are case-insensitive):
 *
 * 1. Simple format
 *    <questions>
 *      <question day="1" category="Geography" difficulty="EASY" points="2">
 *        <text>Which of these are in Europe?</text>
 *        <option correct="true">France</option>
 *        <option>Brazil</option>
 *        <option correct="true">Spain</option>
 *        <explanation>…</explanation>
 *      </question>
 *    </questions>
 *    Fields may also be child elements/attributes named like the CSV columns
 *    (dayNumber, question, optionA…optionF, correctOption="A,C", …).
 *
 * 2. Moodle XML (multichoice / truefalse): <answer fraction="100"> marks correct answers,
 *    <generalfeedback> becomes the explanation, <defaultgrade> the points, and
 *    category pseudo-questions set the category of the questions that follow.
 *
 * Questions without a day are placed on the given free days, in file order.
 */

const LETTERS = ["A", "B", "C", "D", "E", "F"] as const;
const CONTAINER_TAGS = new Set(["question", "item", "mcq", "quizquestion"]);
const OPTION_TAGS = new Set(["option", "answer", "choice"]);
const OPTION_GROUP_TAGS = new Set(["options", "answers", "choices"]);
const SUPPORTED_MOODLE_TYPES = new Set(["multichoice", "truefalse", "multichoiceset"]);

export interface XmlParseResult {
  records: Record<string, string>[];
  /** Non-fatal notes, e.g. skipped unsupported question types. */
  warnings: string[];
}

const lower = (el: Element) => el.localName.toLowerCase();
const children = (el: Element) => Array.from(el.children);

function stripHtml(s: string): string {
  if (!/[<&]/.test(s)) return s;
  const doc = new DOMParser().parseFromString(s, "text/html");
  return doc.body.textContent ?? "";
}

const clean = (s: string | null | undefined) => stripHtml(s ?? "").replace(/\s+/g, " ").trim();

/** Text of an element; Moodle wraps text in a <text> child next to <feedback> etc. */
function textOf(el: Element): string {
  const t = children(el).find((c) => lower(c) === "text");
  return clean(t ? t.textContent : el.textContent);
}

function attr(el: Element, ...names: string[]): string | undefined {
  for (const a of Array.from(el.attributes)) {
    if (names.includes(a.name.toLowerCase())) return a.value.trim();
  }
  return undefined;
}

function child(el: Element, ...names: string[]): Element | undefined {
  return children(el).find((c) => names.includes(lower(c)));
}

function field(el: Element, ...names: string[]): string | undefined {
  const a = attr(el, ...names);
  if (a !== undefined && a !== "") return a;
  const c = child(el, ...names);
  return c ? textOf(c) : undefined;
}

const truthy = (v: string | undefined) => !!v && ["true", "1", "yes", "y", "correct"].includes(v.toLowerCase());

function isContainer(el: Element): boolean {
  return CONTAINER_TAGS.has(lower(el)) && el.children.length > 0;
}

export function parseQuestionsXml(xml: string, freeDays: number[]): XmlParseResult {
  const doc = new DOMParser().parseFromString(xml.replace(/^﻿/, ""), "application/xml");
  const parserError = doc.getElementsByTagName("parsererror")[0];
  if (parserError) {
    throw new Error(`The XML file is not well-formed: ${clean(parserError.textContent).slice(0, 200)}`);
  }

  // Outermost question containers, in document order.
  const insideContainer = (el: Element) => {
    for (let p = el.parentElement; p; p = p.parentElement) if (isContainer(p)) return true;
    return false;
  };
  const containers = Array.from(doc.getElementsByTagName("*")).filter((el) => isContainer(el) && !insideContainer(el));
  if (!containers.length) throw new Error("No <question> elements were found in the XML file.");

  const records: Record<string, string>[] = [];
  const warnings: string[] = [];
  const takenDays = new Set<number>();
  let nextFree = 0;
  let moodleCategory = "";

  containers.forEach((q, index) => {
    const type = attr(q, "type")?.toLowerCase();
    if (type === "category") {
      const path = field(q, "category") ?? "";
      moodleCategory = path.split("/").filter((p) => p && !p.startsWith("$")).pop() ?? "";
      return;
    }
    if (type && !SUPPORTED_MOODLE_TYPES.has(type)) {
      warnings.push(`Question ${index + 1}: type "${type}" isn't a multiple-choice question and was skipped.`);
      return;
    }

    // Options: <option>/<answer>/<choice>, directly or inside <options>/<answers>/<choices>.
    const optionEls = children(q).flatMap((c) => (OPTION_GROUP_TAGS.has(lower(c)) ? children(c) : [c])).filter((c) => OPTION_TAGS.has(lower(c)));
    const rec: Record<string, string> = {};

    if (optionEls.length) {
      const correct: string[] = [];
      optionEls.forEach((o, i) => {
        const letter = LETTERS[i];
        if (!letter) return; // > 6 options → reported below
        rec[`option${letter}`] = textOf(o);
        const fraction = Number(attr(o, "fraction") ?? "0");
        if (truthy(attr(o, "correct", "iscorrect", "answer")) || fraction > 0) correct.push(letter);
      });
      if (optionEls.length > LETTERS.length) {
        warnings.push(`Question ${index + 1}: has ${optionEls.length} options; only the first ${LETTERS.length} are supported.`);
      }
      rec.correctOption = correct.join(",");
    } else {
      for (const l of LETTERS) {
        const v = field(q, `option${l.toLowerCase()}`, l.toLowerCase());
        if (v !== undefined) rec[`option${l}`] = v;
      }
    }
    const explicitKey = field(q, "correctoption", "correctoptions", "correct", "answerkey");
    if (explicitKey && !rec.correctOption) rec.correctOption = explicitKey;
    rec.correctOption ??= "";

    rec.question = field(q, "questiontext", "question", "text", "prompt") ?? "";
    rec.category = field(q, "category") ?? moodleCategory;
    rec.difficulty = field(q, "difficulty") ?? "";
    rec.explanation = field(q, "explanation", "generalfeedback", "feedback") ?? "";
    const points = field(q, "points", "score", "defaultgrade") ?? "";
    // Moodle writes grades like "1.0000000".
    rec.points = points && Number.isFinite(Number(points)) && Number.isInteger(Number(points)) ? String(Number(points)) : points;

    const day = field(q, "daynumber", "day");
    if (day) {
      rec.dayNumber = day;
      if (/^\d+$/.test(day)) takenDays.add(Number(day));
    } else {
      // Fill in after the loop so explicit days are never handed out twice.
      rec.dayNumber = "";
    }
    records.push(rec);
  });

  for (const rec of records) {
    if (rec.dayNumber) continue;
    while (nextFree < freeDays.length && takenDays.has(freeDays[nextFree]!)) nextFree++;
    const d = freeDays[nextFree++];
    if (d === undefined) {
      warnings.push("There are more questions without a day than free days in this competition; the extra ones will be rejected.");
      break;
    }
    rec.dayNumber = String(d);
    takenDays.add(d);
  }

  if (!records.length) throw new Error("The XML file contains no multiple-choice questions.");
  return { records, warnings };
}

export const XML_TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<!-- day is optional: questions without one go to the next free days.
     Points by difficulty: EASY = 1, MEDIUM = 2, HARD = 3. -->
<questions>
  <question day="1" category="Geography" difficulty="EASY" points="1">
    <text>What is the capital of France?</text>
    <option correct="true">Paris</option>
    <option>Rome</option>
    <option>Berlin</option>
    <option>Madrid</option>
    <explanation>Paris has been France's capital since 508 AD.</explanation>
  </question>
  <question day="2" category="Science" difficulty="EASY" points="1">
    <text>The Sun is a star.</text>
    <option correct="true">True</option>
    <option>False</option>
  </question>
  <question day="3" category="Science" difficulty="MEDIUM" points="2">
    <text>Which planet is known as the Red Planet?</text>
    <option>Venus</option>
    <option correct="true">Mars</option>
    <option>Jupiter</option>
    <option>Saturn</option>
  </question>
  <question day="4" category="Geography" difficulty="MEDIUM" points="2">
    <text>Which of these countries are in Europe? (select all that apply)</text>
    <option correct="true">Spain</option>
    <option>Brazil</option>
    <option correct="true">Poland</option>
    <option>Kenya</option>
  </question>
  <question day="5" category="Literature" difficulty="HARD" points="3">
    <text>Who wrote the play Hamlet?</text>
    <option>Charles Dickens</option>
    <option correct="true">William Shakespeare</option>
    <option>Jane Austen</option>
    <option>Mark Twain</option>
  </question>
  <question day="6" category="Math" difficulty="HARD" points="3">
    <text>Which of these numbers are prime? (select all that apply)</text>
    <option correct="true">2</option>
    <option>4</option>
    <option correct="true">7</option>
    <option>9</option>
    <option correct="true">11</option>
    <option>15</option>
  </question>
</questions>
`;
