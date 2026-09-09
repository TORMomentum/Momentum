export interface Job {
  id: string;
  torId: string;
  type: "extract";
  attempts: number;
}

export interface Queue {
  /** Idempotent per record: a second call while a job is live is a no-op. */
  enqueue(torId: string): Promise<void>;
  /** Atomically claims one due job, or returns null. */
  claim(): Promise<Job | null>;
  complete(jobId: string): Promise<void>;
  /** Records the failure and either schedules a retry or gives up permanently. */
  fail(jobId: string, reason: string): Promise<{ willRetry: boolean }>;
  /** Gives up immediately, no retry - for a failure that retrying cannot fix. */
  abandon(jobId: string, reason: string): Promise<void>;
}
