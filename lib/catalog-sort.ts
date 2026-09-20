import type { CatalogItem } from "../app/(dashboard)/page";

export type SortColumn =
  | "number"
  | "title"
  | "category"
  | "language"
  | "titlecount"
  | "categorycount"
  | "categoryindex"
  | "sheetId"
  | "pubyear"
  | "author"
  | "editedTranslated";

export const SORT_COLUMNS: { key: SortColumn; label: string }[] = [
  { key: "number", label: "Acquisition #" },
  { key: "title", label: "Title" },
  { key: "category", label: "Category" },
  { key: "language", label: "Language" },
  { key: "titlecount", label: "Title Count" },
  { key: "categorycount", label: "Category Count" },
  { key: "categoryindex", label: "Category Index" },
  { key: "sheetId", label: "ID" },
  { key: "pubyear", label: "Pub. Year" },
  { key: "author", label: "Author" },
  { key: "editedTranslated", label: "Edited/Translated" },
];

export function getSortValue(item: CatalogItem, column: SortColumn): string | number | null {
  switch (column) {
    case "number":
      return item.number;
    case "title":
      return item.title;
    case "category":
      return item.category;
    case "language":
      return Array.isArray(item.language) ? item.language.join(", ") : item.language;
    case "titlecount":
      return item.titlecount;
    case "categorycount":
      return item.categorycount;
    case "categoryindex":
      return item.categoryindex;
    case "sheetId":
      return item.sheetId;
    case "pubyear":
      return item.pubyear;
    case "author":
      return `${item.firstname} ${item.lastname}`.trim();
    case "editedTranslated":
      return item.editedTranslated ? item.editedTranslated.join(", ") : null;
  }
}

// Nulls/empty values always sort last, regardless of direction — flipping
// the comparator's sign for "desc" would otherwise put them first.
export function compareSortValues(
  a: string | number | null,
  b: string | number | null,
  direction: "asc" | "desc"
): number {
  const aEmpty = a == null || a === "";
  const bEmpty = b == null || b === "";
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;

  const cmp =
    typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));
  return direction === "asc" ? cmp : -cmp;
}
