"use client";

import { Modal } from "./modal";
import { Button } from "./button";
import { Input } from "./input";
import { useState, useEffect } from "react";

interface SetPasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (password: string) => void;
  userName: string;
  isSaving?: boolean;
}

export function SetPasswordModal({
  isOpen,
  onClose,
  onSave,
  userName,
  isSaving = false,
}: SetPasswordModalProps) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (isOpen) {
      setPassword("");
      setError("");
    }
  }, [isOpen]);

  const handleClose = () => {
    if (!isSaving) onClose();
  };

  const handleSave = () => {
    if (!password || password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    onSave(password);
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose}>
      <div className="p-6 bg-white">
        <div className="mb-4">
          <h3 className="text-lg font-medium text-gray-900 mb-2">Reset Password</h3>
          <p className="text-sm text-gray-500">
            Choose a new password for {userName}. They'll receive an email with
            this password and can change it themselves later if they want to.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">New Password *</label>
          <Input
            type="text"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (error) setError("");
            }}
            placeholder="Min. 6 characters"
            className={error ? "border-red-500" : ""}
          />
          {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
        </div>

        <div className="flex justify-end space-x-3 mt-6 pt-4 border-t border-gray-200">
          <Button type="button" variant="outline" onClick={handleClose} disabled={isSaving} className="px-4 py-2">
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white border-blue-600"
          >
            {isSaving ? "Saving..." : "Reset Password"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
