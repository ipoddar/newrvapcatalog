export function isWarmerPing(event: unknown): boolean {
  return (
    typeof event === 'object' &&
    event !== null &&
    (event as Record<string, unknown>).warmerPing === true
  );
}

// Module scope: true only once this execution environment has already
// handled one real (non-warmer) invocation, so a caller can tell a cold
// start apart from a reused warm environment via the response header.
let handledBefore = false;

export function warmHeader(): Record<string, string> {
  const header = { 'X-Lambda-Warm': String(handledBefore) };
  handledBefore = true;
  return header;
}

