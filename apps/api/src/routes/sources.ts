// Read-only pass-through to the BMA eGP source API, normalized for the team.
// Callers (web app, ingestion jobs, teammates exploring the data) use these routes instead of
// talking to egp2.bangkok.go.th directly, so upstream quirks stay in one place.
import { Router } from "express";
import { resolveBmaAgency } from "../sources/bmaAgencies";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../sources/bma-egp/config";
import {
  BmaEgpSourceError,
  buildFileUrl,
  buildProjectUrl,
  getProjectAnnouncements,
  searchTorProjects,
  selectTorAnnouncements,
  type BmaEgpProject,
} from "../sources/bma-egp/client";

export const sourcesRouter = Router();

/** Clamp a user-supplied positive integer, falling back when absent or malformed. */
function positiveInt(raw: unknown, fallback: number, max: number): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return fallback;
  return Math.min(n, max);
}

function normalizeProject(p: BmaEgpProject) {
  const agency = resolveBmaAgency(p.masterOrgGroupName);
  return {
    projectId: p.projectId,
    projectNumber: p.projectNumber,
    title: p.projectName,
    agencyName: p.masterOrgGroupName ?? null,
    agencyId: agency?.agency_id ?? null,
    agencyCategory: agency?.category ?? null,
    // FR-A4: anything the canonical BMA list does not recognise is tagged, not silently ingested.
    isBmaAgency: agency !== undefined,
    department: p.masterOrgDepartmentName ?? null,
    budget: p.projectBudget ?? null,
    // The search response carries no date; publish dates come from the documents route.
    projectUrl: buildProjectUrl(p.projectId),
  };
}

/** GET /sources/bma-egp/tors — paginated TOR announcements from the source system. */
sourcesRouter.get("/bma-egp/tors", async (req, res, next) => {
  try {
    const page = positiveInt(req.query.page, 1, Number.MAX_SAFE_INTEGER);
    const pageSize = positiveInt(req.query.pageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const result = await searchTorProjects({
      pageNo: page,
      pageSize,
      keyword: typeof req.query.q === "string" ? req.query.q : undefined,
      agencyId: typeof req.query.agencyId === "string" ? req.query.agencyId : undefined,
    });
    res.json({
      source: "egp2.bangkok.go.th",
      retrievedAt: new Date().toISOString(),
      page: result.currentPage,
      pageSize,
      pageCount: result.pageCount,
      totalCount: result.totalCount,
      data: (result.data ?? []).map(normalizeProject),
    });
  } catch (err) {
    next(err);
  }
});

/** GET /sources/bma-egp/tors/:projectId/documents — the project's TOR files, with source URLs. */
sourcesRouter.get("/bma-egp/tors/:projectId/documents", async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const torAnnouncements = selectTorAnnouncements(await getProjectAnnouncements(projectId));
    res.json({
      source: "egp2.bangkok.go.th",
      retrievedAt: new Date().toISOString(),
      projectId,
      projectUrl: buildProjectUrl(projectId),
      data: torAnnouncements.map((a) => ({
        documentId: a.id,
        filename: a.projectAnnouncementPath,
        publishedAt: a.projectAnnouncementPublishDate ?? null,
        // Immutable public original — every displayed record links back here (FR-A2, NFR-2).
        sourceUrl: buildFileUrl(a.id, a.projectAnnouncementPath as string),
      })),
    });
  } catch (err) {
    next(err);
  }
});

/** Upstream failures are the source's fault, not the caller's — report them as a bad gateway. */
sourcesRouter.use(
  (
    err: unknown,
    _req: import("express").Request,
    res: import("express").Response,
    next: import("express").NextFunction,
  ) => {
    if (err instanceof BmaEgpSourceError) {
      res.status(502).json({ error: "source_unavailable", message: err.message });
      return;
    }
    next(err);
  },
);
