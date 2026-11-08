/**
 * Turns short texts into vectors whose closeness means closeness of meaning
 * (TOR-202). The port speaks texts and numbers; the adapter knows the model.
 * Throws `ExtractionError` on failure - never a partial result.
 */
export interface Embedder {
  /** One vector per text, in the same order. */
  embed(texts: string[]): Promise<number[][]>;
  /** The model that produced them, kept beside every stored vector so mixed models are never compared. */
  readonly model: string;
}

/** Cosine similarity, 0 for a zero vector or vectors of different length. */
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  return normA === 0 || normB === 0 ? 0 : dot / Math.sqrt(normA * normB);
}
