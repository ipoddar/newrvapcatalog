"use client";

import { Modal } from "./modal";
import { Button } from "./button";
import { Input } from "./input";
import { useState, useEffect } from "react";

interface AddUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (user: NewUser) => void;
  isSaving?: boolean;
}

export interface NewUser {
  email: string;
  firstName: string;
  lastName: string;
  isAdmin: boolean;
}

export function AddUserModal({
  isOpen,
  onClose,
  onSave,
  isSaving = false,
}: AddUserModalProps) {
  const [formData, setFormData] = useState<NewUser>({
    email: "",
    firstName: "",
    lastName: "",
    isAdmin: false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (isOpen) {
      setFormData({ email: "", firstName: "", lastName: "", isAdmin: false });
      setErrors({});
    }
  }, [isOpen]);

  const handleClose = () => {
    if (!isSaving) onClose();
  };

  const handleChange = (field: keyof NewUser, value: string | boolean) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: "" }));
    }
  };

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!formData.email.trim()) {
      newErrors.email = "Email is required";
    } else if (!emailRegex.test(formData.email.trim())) {
      newErrors.email = "Enter a valid email address";
    }
    if (!formData.firstName.trim()) newErrors.firstName = "First name is required";
    if (!formData.lastName.trim()) newErrors.lastName = "Last name is required";

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;
    onSave(formData);
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose}>
      <div className="p-6 bg-white">
        <div className="mb-4">
          <h3 className="text-lg font-medium text-gray-900 mb-2">Add New User</h3>
          <p className="text-sm text-gray-500">
            A welcome email with a temporary password, sign-in link, and catalog
            instructions will be sent automatically. They'll be asked to set
            their own password on first sign-in.
          </p>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">First Name *</label>
              <Input
                type="text"
                value={formData.firstName}
                onChange={(e) => handleChange("firstName", e.target.value)}
                className={errors.firstName ? "border-red-500" : ""}
              />
              {errors.firstName && <p className="text-red-500 text-xs mt-1">{errors.firstName}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Last Name *</label>
              <Input
                type="text"
                value={formData.lastName}
                onChange={(e) => handleChange("lastName", e.target.value)}
                className={errors.lastName ? "border-red-500" : ""}
              />
              {errors.lastName && <p className="text-red-500 text-xs mt-1">{errors.lastName}</p>}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
            <Input
              type="email"
              value={formData.email}
              onChange={(e) => handleChange("email", e.target.value)}
              className={errors.email ? "border-red-500" : ""}
            />
            {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email}</p>}
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={formData.isAdmin}
              onChange={(e) => handleChange("isAdmin", e.target.checked)}
              className="h-4 w-4"
            />
            Grant admin access
          </label>
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
            {isSaving ? "Creating..." : "Add User"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
