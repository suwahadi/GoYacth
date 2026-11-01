import { ApiError } from "~/lib/api";

import type { SerializedError } from "./types";

// responseStatus gives an SSR page the status code of the API error it is showing, so missing
// bookings answer 404 instead of 200.
export function responseStatus(e: SerializedError): number {
  if (e.status === 0) return 503;
  return e.status >= 400 ? e.status : 500;
}

export function serializeError(err: unknown): SerializedError {
  if (err instanceof ApiError) return { status: err.status, code: err.code, fields: err.fields };
  return { status: 500, code: "UNKNOWN", fields: {} };
}

export function deserializeError(e: SerializedError | null | undefined): ApiError | null {
  return e ? new ApiError(e.status, e.code, e.code, e.fields) : null;
}
