export interface KeyedContent {
  fingerprint: string;
  key: string;
}

// A retry of the same form content must reuse its Idempotency-Key so the server replays the
// first result instead of creating a second booking; changed content gets a fresh key.
export function nextIdempotencyKey(prev: KeyedContent | null, fingerprint: string, generate: () => string): KeyedContent {
  return prev && prev.fingerprint === fingerprint ? prev : { fingerprint, key: generate() };
}
