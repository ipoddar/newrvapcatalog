"use client";

import { Modal } from "./modal";
import { History, Mail } from "lucide-react";

export interface BookHistoryEvent {
  bookId: string;
  eventAt: string;
  eventType: "checked_out" | "returned" | "requested" | "hold_granted" | "hold_expired" | "email_sent";
  userId: string | null;
  userName: string;
  userEmail: string;
  emailSubject?: string | null;
}

interface BookHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  bookTitle: string;
  events: BookHistoryEvent[];
  isLoading: boolean;
  error?: string;
}

type ActionEventType = Exclude<BookHistoryEvent["eventType"], "email_sent">;

const EVENT_LABELS: Record<ActionEventType, string> = {
  checked_out: "Checked out",
  returned: "Returned",
  requested: "Requested",
  hold_granted: "Hold reserved",
  hold_expired: "Hold expired, unclaimed",
};

const EVENT_COLORS: Record<ActionEventType, string> = {
  checked_out: "bg-amber-100 text-amber-800",
  returned: "bg-green-100 text-green-800",
  requested: "bg-blue-100 text-blue-800",
  hold_granted: "bg-purple-100 text-purple-800",
  hold_expired: "bg-gray-200 text-gray-700",
};

function formatEventAt(eventAt: string): string {
  // eventAt is `${isoTimestamp}#${ulid}` — strip the dedup suffix.
  const iso = eventAt.split("#")[0];
  return new Date(iso).toLocaleString();
}

export function BookHistoryModal({
  isOpen,
  onClose,
  bookTitle,
  events,
  isLoading,
  error,
}: BookHistoryModalProps) {
  const actionEvents = events.filter(
    (event): event is BookHistoryEvent & { eventType: ActionEventType } => event.eventType !== "email_sent"
  );
  const emailEvents = events.filter((event) => event.eventType === "email_sent");

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <div className="p-2 max-w-lg mx-auto">
        <div className="flex items-center gap-2 mb-1">
          <History className="h-5 w-5 text-gray-500" />
          <h3 className="text-lg font-semibold text-gray-900">History</h3>
        </div>
        <p className="text-sm text-gray-500 mb-4 truncate">{bookTitle}</p>

        {isLoading ? (
          <div className="text-sm text-gray-500 py-8 text-center">Loading history...</div>
        ) : error ? (
          <div className="text-sm text-red-600 bg-red-50 p-3 rounded border border-red-200">
            {error}
          </div>
        ) : events.length === 0 ? (
          <div className="text-sm text-gray-500 py-8 text-center">
            No history yet for this book.
          </div>
        ) : (
          <div className="space-y-5 max-h-[32rem] overflow-y-auto">
            <div className="space-y-2">
              {actionEvents.length === 0 ? (
                <div className="text-sm text-gray-500 py-2">No actions yet for this book.</div>
              ) : (
                actionEvents.map((event) => (
                  <div
                    key={event.eventAt}
                    className="flex items-start justify-between gap-3 border-l-2 border-gray-200 pl-3 py-1"
                  >
                    <div>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${EVENT_COLORS[event.eventType]}`}
                      >
                        {EVENT_LABELS[event.eventType]}
                      </span>
                      <div className="text-sm text-gray-800 mt-1">
                        {event.userName || event.userEmail || "Unknown member"}
                      </div>
                      {event.userEmail && (
                        <div className="text-xs text-gray-500">{event.userEmail}</div>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 whitespace-nowrap shrink-0">
                      {formatEventAt(event.eventAt)}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div>
              <div className="flex items-center gap-2 mb-2 pt-2 border-t border-gray-100">
                <Mail className="h-4 w-4 text-gray-400" />
                <h4 className="text-sm font-semibold text-gray-700">
                  Emails sent{emailEvents.length > 0 ? ` (${emailEvents.length})` : ""}
                </h4>
              </div>
              {emailEvents.length === 0 ? (
                <div className="text-sm text-gray-500 py-2">No emails sent for this book yet.</div>
              ) : (
                <div className="space-y-1.5">
                  {emailEvents.map((event) => (
                    <div
                      key={event.eventAt}
                      className="flex items-start justify-between gap-3 text-sm"
                    >
                      <div className="min-w-0">
                        <div className="text-gray-800 truncate">
                          {event.emailSubject || "Email"}
                        </div>
                        <div className="text-xs text-gray-500 truncate">
                          To: {event.userName ? `${event.userName} — ` : ""}{event.userEmail || "unknown"}
                        </div>
                      </div>
                      <div className="text-xs text-gray-500 whitespace-nowrap shrink-0">
                        {formatEventAt(event.eventAt)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
