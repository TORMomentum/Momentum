import type { ObjectId } from "mongodb";
import { decodeCursor, type SearchRequest } from "../tors/tors.query.js";
import type { TorsService } from "../tors/tors.service.js";
import { CSV_BOM, csvLine, EXPORT_HEADER, exportRow, type ExportItem } from "./export.csv.js";

export interface ExportServiceDeps {
  tors: TorsService;
  maxRows: number;
  /** Rows read per search page; the search's own ceiling. */
  pageSize: number;
  appOrigin: string;
}

export interface ExportFile {
  csv: string;
  rows: number;
  total: number;
  truncated: boolean;
}

/**
 * The filtered list as CSV (FR-E-7). Rows come from `TorsService.search`, page by page and in the
 * list's own order, so the file holds exactly what the reader sees on `/search` (spec 2026-11-23).
 */
export class ExportService {
  constructor(private readonly deps: ExportServiceDeps) {}

  async csv(request: Pick<SearchRequest, "filter">, matchIds?: ObjectId[]): Promise<ExportFile> {
    const { maxRows, pageSize } = this.deps;
    const items: ExportItem[] = [];
    let cursor: SearchRequest["cursor"] = null;
    let total = 0;

    for (;;) {
      const page = await this.deps.tors.search(
        { filter: request.filter, cursor, pageSize: Math.min(pageSize, maxRows - items.length) },
        matchIds,
      );
      total = page.total;
      items.push(...page.items);
      if (!page.nextCursor || items.length >= maxRows) break;
      cursor = decodeCursor(page.nextCursor);
    }

    const provenance = await this.deps.tors.provenanceFor(items.map((item) => item.id));
    let csv = CSV_BOM + csvLine([...EXPORT_HEADER]);
    for (const item of items) csv += csvLine(exportRow(item, provenance.get(item.id), this.deps.appOrigin));

    return { csv, rows: items.length, total, truncated: total > items.length };
  }
}
