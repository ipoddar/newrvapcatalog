"use client";

import { Modal } from "./modal";
import { Button } from "./button";
import { Input } from "./input";
import { useState, useEffect, useMemo } from "react";
import Fuse from "fuse.js";

export interface AvailableBook {
  id: string;
  title: string;
  category: string;
  firstname: string;
  lastname: string;
}

interface AdminCheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (bookId: string) => void;
  books: AvailableBook[];
  userName: string;
  isSaving?: boolean;
}

export function AdminCheckoutModal({
  isOpen,
  onClose,
  onSave,
  books,
  userName,
  isSaving = false,
}: AdminCheckoutModalProps) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedId(null);
    }
  }, [isOpen]);

  const fuse = useMemo(
    () => new Fuse(books, { keys: ["title", "firstname", "lastname"], threshold: 0.4 }),
    [books]
  );

  const results = query.trim() ? fuse.search(query.trim()).map((r) => r.item) : books;

  const handleClose = () => {
    if (!isSaving) onClose();
  };

  const handleSave = () => {
    if (selectedId) onSave(selectedId);
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose}>
      <div className="p-6 bg-white">
        <div className="mb-4">
          <h3 className="text-lg font-medium text-gray-900 mb-1">Check Out Book</h3>
          <p className="text-sm text-gray-500">On behalf of {userName}</p>
        </div>

        <Input
          type="text"
          placeholder="Search by title or author…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="mb-3"
        />

        <div className="max-h-72 overflow-y-auto border rounded-md divide-y">
          {results.length === 0 ? (
            <div className="p-4 text-sm text-gray-500 text-center">No available books found</div>
          ) : (
            results.slice(0, 50).map((book) => (
              <div
                key={book.id}
                onClick={() => setSelectedId(book.id)}
                className={`p-3 cursor-pointer hover:bg-gray-50 ${selectedId === book.id ? "bg-blue-50" : ""}`}
              >
                <div className="font-medium text-sm text-gray-900">{book.title}</div>
                <div className="text-xs text-gray-500">
                  {book.category} · {book.firstname} {book.lastname}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="flex justify-end space-x-3 mt-6 pt-4 border-t border-gray-200">
          <Button type="button" variant="outline" onClick={handleClose} disabled={isSaving} className="px-4 py-2">
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={isSaving || !selectedId}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white border-blue-600"
          >
            {isSaving ? "Checking out..." : "Check Out"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
