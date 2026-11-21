"use client";

import { z } from "zod";

// Zod 4 probes `new Function("")` to decide whether it may compile validators. Under our CSP (no
// 'unsafe-eval') that probe is caught and harmless, but the browser still reports it as a violation.
// Turning the JIT path off up front keeps the console and any CSP report clean (TOR-321).
z.config({ jitless: true });
