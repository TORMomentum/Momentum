export type IntakeRoute = "upload" | "url" | "api";

export type PipelineState = "queued" | "extracting" | "published" | "failed";

export interface SourceRef {
  route: IntakeRoute;
  url?: string;
  submittedBy: string;
  submittedAt: string;
}

/** Every extracted value carries its own confidence and provenance (NFR-F6). */
export interface ExtractedField<T = string> {
  raw: string;
  value?: T;
  confidence: number;
  verified: boolean;
}

export interface TorRecord {
  id: string;
  contentHash: string;
  storage: { bucket: string; key: string; contentType: string; bytes: number };
  sourceRefs: SourceRef[];
  pipeline: { state: PipelineState; attempts: number; failedReason?: string };
  fields: Record<string, ExtractedField>;
  confidenceLevel?: "high" | "medium" | "low";
  unverified: boolean;
  access: { restricted: boolean; reason?: string };
  duplicateOf: string | null;
  createdAt: string;
  updatedAt: string;
}
