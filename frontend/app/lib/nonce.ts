import { createContext, useContext } from "react";

// NonceContext carries the per-request CSP nonce from entry.server to <Scripts>. On the client
// the value is empty; browsers hide nonce attributes, so hydration is unaffected.
export const NonceContext = createContext("");

export function useNonce(): string {
  return useContext(NonceContext);
}
