/** Free text from a model: a draft, not an extraction. The port speaks prompts; the adapter knows the model. */
export interface TextGenerator {
  generate(input: { system: string; prompt: string }): Promise<{ text: string; modelVersion: string }>;
}

/** The model could not produce text (unreachable, refused, empty). Nothing partial is ever returned. */
export class GenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GenerationError";
  }
}
