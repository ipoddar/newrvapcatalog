"use client";

import { useState, useEffect } from "react";
import { Modal } from "./modal";
import { Button } from "./button";
import { Input } from "./input";
import { signIn, completeNewPasswordChallenge } from "@/utils/cognito/client";
import type { CognitoUser } from "amazon-cognito-identity-js";

interface LoginGateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

// Interrupts a catalog action (checkout/return/request/admin edit) with an
// inline sign-in form instead of redirecting to /login — closes and lets
// the caller re-run the original action once signed in. Mirrors the form
// in app/login/page.tsx (including the first-sign-in NEW_PASSWORD_REQUIRED
// branch); kept as a separate copy since the two live in different contexts
// (full page vs. modal) and the form itself is short.
export function LoginGateModal({ isOpen, onClose, onSuccess }: LoginGateModalProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const [pendingUser, setPendingUser] = useState<CognitoUser | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");

  useEffect(() => {
    if (isOpen) {
      setEmail("");
      setPassword("");
      setError("");
      setPendingUser(null);
      setNewPassword("");
      setConfirmNewPassword("");
    }
  }, [isOpen]);

  const handleClose = () => {
    if (!isLoading) onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      const result = await signIn(email, password);
      if (result.type === "newPasswordRequired") {
        setPendingUser(result.cognitoUser);
        return;
      }
      onSuccess();
    } catch (err: any) {
      setError(err?.message || "An unexpected error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSetNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (newPassword.length < 6) {
      setError("Password must be at least 6 characters long");
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setError("Passwords do not match");
      return;
    }
    if (!pendingUser) return;

    setIsLoading(true);
    try {
      await completeNewPasswordChallenge(pendingUser, newPassword);
      onSuccess();
    } catch (err: any) {
      setError(err?.message || "An unexpected error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose}>
      <div className="p-2 max-w-sm mx-auto">
        {pendingUser ? (
          <>
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Set a new password</h3>
            <p className="text-sm text-gray-500 mb-4">
              This is your first sign-in. Choose a new password to continue.
            </p>
            <form onSubmit={handleSetNewPassword} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">New password</label>
                <Input
                  type="password"
                  placeholder="Enter a new password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Confirm new password</label>
                <Input
                  type="password"
                  placeholder="Re-enter the new password"
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  required
                />
              </div>
              {error && (
                <div className="text-sm text-red-600 bg-red-50 p-3 rounded border border-red-200">
                  {error}
                </div>
              )}
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? "Saving..." : "Set password and sign in"}
              </Button>
            </form>
          </>
        ) : (
          <>
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Sign in to continue</h3>
            <p className="text-sm text-gray-500 mb-4">
              You need an account to do this. Not registered yet? See the sign-in page for how to request access.
            </p>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <Input
                  type="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                <Input
                  type="password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              {error && (
                <div className="text-sm text-red-600 bg-red-50 p-3 rounded border border-red-200">
                  {error}
                </div>
              )}
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? "Signing in..." : "Sign in"}
              </Button>
            </form>
          </>
        )}
      </div>
    </Modal>
  );
}
