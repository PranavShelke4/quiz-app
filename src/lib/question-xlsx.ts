/**
 * Browser-side .xlsx reader for the question import. Reads the first worksheet and
 * returns its rows keyed by the header row, so the server validates Excel and CSV
 * imports the same way. Uses fflate to unzip and the browser's DOMParser for the XML.
 */
import { unzipSync } from "fflate";

export interface XlsxReadResult {
  sheetName: string;
  records: Record<string, string>[];
  /** Non-fatal notes, e.g. other sheets that were ignored. */
  warnings: string[];
}

const decoder = new TextDecoder();

function xml(files: Record<string, Uint8Array>, path: string): Document | null {
  const data = files[path];
  return data ? new DOMParser().parseFromString(decoder.decode(data), "application/xml") : null;
}

/** Elements by local name, regardless of namespace prefix (some writers use `x:c`). */
const byName = (root: Document | Element, name: string) => Array.from(root.getElementsByTagNameNS("*", name));
const childByName = (el: Element, name: string) => Array.from(el.children).find((c) => c.localName === name);

/** "C12" → 2 (zero-based column index). */
function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? "";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Text of a string item, skipping phonetic runs (<rPh>). */
function stringItemText(si: Element): string {
  return byName(si, "t")
    .filter((t) => t.parentElement?.localName !== "rPh")
    .map((t) => t.textContent ?? "")
    .join("");
}

/** Numbers come back as text; tidy float artifacts like 0.30000000000000004. */
function numberText(v: string): string {
  const n = Number(v);
  return Number.isFinite(n) ? String(Number(n.toPrecision(15))) : v;
}

function resolveTarget(target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  return `xl/${target.replace(/^\.\//, "")}`;
}

export function readXlsx(buffer: ArrayBuffer): XlsxReadResult {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(buffer));
  } catch {
    throw new Error("This file isn't a valid .xlsx workbook. Old .xls files aren't supported — open it in Excel and save as .xlsx.");
  }
  const workbook = xml(files, "xl/workbook.xml");
  if (!workbook) throw new Error("This file isn't a valid .xlsx workbook.");

  const sheets = byName(workbook, "sheet");
  if (!sheets.length) throw new Error("The workbook has no sheets.");
  const first = sheets[0]!;
  const sheetName = first.getAttribute("name") ?? "Sheet1";
  const relId = Array.from(first.attributes).find((a) => a.localName === "id")?.value;
  const rels = xml(files, "xl/_rels/workbook.xml.rels");
  const target = rels && relId ? byName(rels, "Relationship").find((r) => r.getAttribute("Id") === relId)?.getAttribute("Target") : null;
  const sheetPath = target ? resolveTarget(target) : "xl/worksheets/sheet1.xml";
  const sheet = xml(files, sheetPath);
  if (!sheet) throw new Error(`Couldn't find the data for sheet "${sheetName}".`);

  const shared = xml(files, "xl/sharedStrings.xml");
  const sharedStrings = shared ? byName(shared, "si").map(stringItemText) : [];

  const rows: string[][] = [];
  for (const row of byName(sheet, "row")) {
    const cells: string[] = [];
    let next = 0;
    for (const c of Array.from(row.children).filter((el) => el.localName === "c")) {
      const ref = c.getAttribute("r");
      const col = ref ? columnIndex(ref) : next;
      next = col + 1;
      const type = c.getAttribute("t");
      const v = childByName(c, "v")?.textContent ?? "";
      let value: string;
      if (type === "s") value = sharedStrings[Number(v)] ?? "";
      else if (type === "inlineStr") value = (() => { const is = childByName(c, "is"); return is ? stringItemText(is) : ""; })();
      // Excel turns typed "True"/"False" into boolean cells; keep them readable as option text.
      else if (type === "b") value = v === "1" ? "True" : "False";
      else if (type === "str" || type === "e") value = v;
      else value = v === "" ? "" : numberText(v);
      cells[col] = value.trim();
    }
    rows.push(Array.from(cells, (x) => x ?? ""));
  }

  const nonEmpty = rows.filter((r) => r.some((c) => c !== ""));
  if (nonEmpty.length < 2) throw new Error(`Sheet "${sheetName}" needs a header row and at least one question row.`);
  const [header, ...data] = nonEmpty;
  const records = data.map((r) => {
    const rec: Record<string, string> = {};
    header!.forEach((h, i) => {
      if (h) rec[h] = r[i] ?? "";
    });
    return rec;
  });

  const warnings = sheets.length > 1 ? [`Only the first sheet ("${sheetName}") was imported; ${sheets.length - 1} other sheet(s) were ignored.`] : [];
  return { sheetName, records, warnings };
}
