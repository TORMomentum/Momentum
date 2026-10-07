import { Router } from "express";
import { z } from "zod";
import { TAXONOMY_VERSION, WHOLE_COUNTRY_AREA, WORK_CATEGORIES, WORK_CATEGORY_LEAVES, PROVINCES } from "@tor-radar/seeds";
import type { Config } from "../../core/config.js";
import { UnauthorizedError } from "../../core/errors.js";
import { requireSameOrigin } from "../../core/require-same-origin.js";
import { ProfileRepository } from "./profile.repository.js";
import type { NotifyPreferences } from "../../core/db.js";

const taxonomyIds = new Set([...WORK_CATEGORIES.map((group) => group.id), ...WORK_CATEGORY_LEAVES.map((leaf) => leaf.id)]);
const areaIds = new Set([WHOLE_COUNTRY_AREA, ...PROVINCES.map((province) => province.id)]);

const profileSchema = z.object({
  categories: z.array(z.string()).max(100).refine((ids) => ids.every((id) => taxonomyIds.has(id)), "มีหมวดหมู่งานที่ไม่อยู่ในรายการ"),
  /**
   * Work a vendor does that the taxonomy has no node for. Stored as the vendor
   * wrote it and NOT used for matching — free text is the thing the taxonomy
   * exists to replace, and scoring against it would reintroduce exactly the
   * problem that put a procurement method in the category field. It is kept
   * because it is the only evidence of what the vocabulary is missing, and the
   * screen says plainly that it does not match yet.
   */
  otherCategories: z.array(z.string().trim().min(1).max(80)).max(10).optional().default([]),
  areas: z.array(z.string()).min(1).max(78).refine((ids) => ids.every((id) => areaIds.has(id)), "มีพื้นที่ให้บริการที่ไม่อยู่ในรายการ"),
  budget: z.object({ minThb: z.number().finite().nonnegative(), maxThb: z.number().finite().nonnegative() }).nullable()
    .refine((value) => value === null || value.minThb <= value.maxThb, "งบประมาณต่ำสุดต้องไม่เกินงบประมาณสูงสุด"),
  /**
   * How often, and how closely matched, a vendor wants to be emailed. Stored
   * now and acted on when matching and dispatch exist (design §7.8) — a stated
   * preference is the vendor's to make whether or not we can honour it yet.
   */
  notify: z.object({
    preset: z.enum(["all", "daily", "high"]),
    minMatch: z.number().int().min(50).max(95),
    leadDays: z.number().int().min(1).max(30),
    deadlineReminder: z.boolean(),
    anomalyAlert: z.boolean(),
  }).optional().default({
    preset: "daily", minMatch: 70, leadDays: 7, deadlineReminder: true, anomalyAlert: false,
  }),
}).strict();

/**
 * What a caller is given, whether the profile was just written or merely read.
 * Both routes go through here so the two can never drift into different shapes,
 * and so the database's own `_id` — which belongs to the collection, not to the
 * vendor — stays out of the API.
 */
/** What a vendor gets before stating a preference: a daily digest of close matches. */
const DEFAULT_NOTIFY = {
  preset: "daily" as const,
  minMatch: 70,
  leadDays: 7,
  deadlineReminder: true,
  anomalyAlert: false,
};

function profileResponse(profile: {
  categories: string[];
  areas: string[];
  otherCategories?: string[];
  budget: { minThb: number; maxThb: number } | null;
  notify?: NotifyPreferences;
  taxonomyVersion: string;
  updatedAt: Date | null;
}) {
  return {
    categories: profile.categories,
    areas: profile.areas,
    otherCategories: profile.otherCategories ?? [],
    budget: profile.budget,
    notify: profile.notify ?? DEFAULT_NOTIFY,
    taxonomyVersion: profile.taxonomyVersion,
    updatedAt: profile.updatedAt ? profile.updatedAt.toISOString() : null,
  };
}

/**
 * A vendor who has not filled anything in has an EMPTY profile, not a missing
 * one: the screen has something to render and matching has something to read
 * that says "no preference stated" rather than "no answer".
 */
function emptyProfile() {
  return { categories: [], areas: [WHOLE_COUNTRY_AREA], otherCategories: [], budget: null, notify: DEFAULT_NOTIFY, taxonomyVersion: TAXONOMY_VERSION, updatedAt: null };
}

export function buildProfileRouter(deps: { config: Config; profiles: ProfileRepository }): Router {
  const router = Router();
  router.get("/me/profile", async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const profile = await deps.profiles.findByAccountId(req.auth.account._id.toString());
    res.json(profile ? profileResponse(profile) : emptyProfile());
  });
  router.put("/me/profile", requireSameOrigin(deps.config.appOrigin), async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const input = profileSchema.parse(req.body);
    // Deduplication keeps a replace semantically stable and prevents needless score work.
    const profile = await deps.profiles.replace(req.auth.account._id.toString(), {
      categories: [...new Set(input.categories)], areas: [...new Set(input.areas)], otherCategories: [...new Set(input.otherCategories)], budget: input.budget, notify: input.notify, taxonomyVersion: TAXONOMY_VERSION,
    });
    res.json(profileResponse(profile));
  });
  return router;
}
