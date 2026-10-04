"use client";

import { useState, useCallback } from "react";
import { isLoggedIn } from "@/utils/cognito/client";

// Wraps an action so it only runs once the caller is signed in — if not,
// opens a login modal first and re-runs the action automatically on
// success, instead of the action's own handler failing with a 401/403.
export function useLoginGate() {
  const [isGateOpen, setGateOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  const withLoginGate = useCallback(
    (action: () => void) => async () => {
      if (await isLoggedIn()) {
        action();
        return;
      }
      setPendingAction(() => action);
      setGateOpen(true);
    },
    []
  );

  const handleGateSuccess = useCallback(() => {
    setGateOpen(false);
    pendingAction?.();
    setPendingAction(null);
  }, [pendingAction]);

  const handleGateClose = useCallback(() => {
    setGateOpen(false);
    setPendingAction(null);
  }, []);

  return { isGateOpen, withLoginGate, handleGateSuccess, handleGateClose };
}
