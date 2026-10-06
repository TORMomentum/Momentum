// Reads e-GP's public announcement list (procsearch.sch, FPRO9965) — the page a visitor sees for
// "ค้นหาประกาศเชิญชวน" or the draft-TOR announcements, newest first, nationally.
//
// Each row is a <tr id="trDetailN"> of seven cells: number, agency, title ending in
// "(เลขที่โครงการ : <11 digits>)", date ("06/10/2569", and for a draft TOR " - 14/10/2569", the end
// of its public comment period), budget ("2,311,200.00"), status, and a link. Dates are Buddhist
// Era. A row this parser cannot read is dropped rather than guessed at.

export interface ListItem {
  projectId: string;
  title: string;
  agency: string;
  /** The announcement's date, as `YYYY-MM-DD` (Gregorian). */
  announcedOn: string;
  /** A draft TOR's public comment period ends on this `YYYY-MM-DD`; absent for other types. */
  commentEndsOn?: string;
  /** วงเงินงบประมาณโครงการ, as the list states it. */
  budget?: { raw: string; value: number };
  status?: string;
}

const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" };

function cellText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (_, name: string) => ENTITIES[name])
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

/** "06/10/2569" (Buddhist Era) → "2026-10-06"; null for anything that is not a real date. */
function isoFromBuddhist(day: string, month: string, beYear: string): string | null {
  const iso = `${Number(beYear) - 543}-${month}-${day}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(iso) ? iso : null;
}

const PROJECT_NUMBER = /\(\s*เลขที่โครงการ\s*:\s*(\d{11})\s*\)\s*$/;

export function parseAnnouncementList(html: string): ListItem[] {
  const items: ListItem[] = [];
  const seen = new Set<string>();
  for (const [, row] of html.matchAll(/<tr[^>]*\bid="trDetail\d+"[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(([, cell]) => cellText(cell));
    if (cells.length < 6) continue;
    const [, agency, titleCell, dateCell, budgetCell, status] = cells;

    const projectId = PROJECT_NUMBER.exec(titleCell)?.[1];
    const dates = [...dateCell.matchAll(/(\d{2})\/(\d{2})\/(\d{4})/g)].map(([, d, m, y]) => isoFromBuddhist(d, m, y));
    const announcedOn = dates[0];
    if (!projectId || !announcedOn || seen.has(projectId)) continue;
    seen.add(projectId);

    const item: ListItem = {
      projectId,
      title: titleCell.replace(PROJECT_NUMBER, "").trim(),
      agency,
      announcedOn,
    };
    if (dates[1]) item.commentEndsOn = dates[1];
    const amount = Number(budgetCell.replace(/,/g, ""));
    if (budgetCell && Number.isFinite(amount) && amount > 0) item.budget = { raw: budgetCell, value: amount };
    if (status) item.status = status;
    items.push(item);
  }
  return items;
}
