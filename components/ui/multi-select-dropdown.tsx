"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "./button";
import { Input } from "./input";

export interface MultiSelectOption {
  code: string;
  name: string;
}

interface MultiSelectDropdownProps {
  label: string;
  options: MultiSelectOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  className?: string;
}

// Tap-to-open checklist with a search box, used to collapse a long list of
// filter values (categories, languages) into a single fixed-width control
// instead of a horizontally-scrolling or multi-row tab strip.
export function MultiSelectDropdown({
  label,
  options,
  selected,
  onChange,
  className,
}: MultiSelectDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) setQuery("");
  }, [isOpen]);

  const filteredOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (opt) => opt.code.toLowerCase().includes(q) || opt.name.toLowerCase().includes(q)
    );
  }, [options, query]);

  const toggle = (code: string) => {
    onChange(selected.includes(code) ? selected.filter((c) => c !== code) : [...selected, code]);
  };

  return (
    <div ref={containerRef} className={`relative ${className ?? ""}`}>
      <Button
        type="button"
        variant="outline"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`w-full justify-between text-xs md:text-sm h-9 md:h-10 ${
          selected.length > 0 ? "bg-primary text-primary-foreground hover:bg-primary/90" : ""
        }`}
      >
        <span className="flex items-center gap-1.5 truncate">
          {label}
          {selected.length > 0 && (
            <span className="inline-flex items-center justify-center rounded-full bg-white/90 text-primary text-[10px] font-bold min-w-[18px] h-[18px] px-1">
              {selected.length}
            </span>
          )}
        </span>
        <ChevronDown className="h-3.5 w-3.5 opacity-70 shrink-0" />
      </Button>

      {isOpen && (
        <div className="absolute z-50 mt-1 w-64 max-w-[85vw] bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
          <div className="p-2 border-b border-gray-100">
            <Input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Filter ${label.toLowerCase()}...`}
              className="h-8 text-xs"
            />
          </div>
          <div className="max-h-64 overflow-y-auto">
            {filteredOptions.length === 0 ? (
              <div className="p-3 text-xs text-gray-400 text-center">No matches</div>
            ) : (
              filteredOptions.map((opt) => {
                const isChecked = selected.includes(opt.code);
                return (
                  <button
                    type="button"
                    key={opt.code}
                    onClick={() => toggle(opt.code)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 border-b border-gray-50 last:border-b-0"
                  >
                    <span
                      className={`flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center ${
                        isChecked ? "bg-primary border-primary" : "border-gray-300"
                      }`}
                    >
                      {isChecked && (
                        <svg viewBox="0 0 24 24" className="w-3 h-3 text-white" fill="none" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                      )}
                    </span>
                    <span className="font-medium text-xs w-9 flex-shrink-0">{opt.code}</span>
                    <span className="text-xs text-gray-500 truncate">{opt.name}</span>
                  </button>
                );
              })
            )}
          </div>
          <div className="flex gap-2 p-2 border-t border-gray-100">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="flex-1 text-xs h-8"
              onClick={() => onChange([])}
              disabled={selected.length === 0}
            >
              Clear
            </Button>
            <Button type="button" size="sm" className="flex-1 text-xs h-8" onClick={() => setIsOpen(false)}>
              Done
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
