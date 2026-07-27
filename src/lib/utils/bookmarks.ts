// ==========================================================
// 🎯 BOOKMARK / READ-LATER ENGINE — 100% CLIENT-SIDE (localStorage)
//
// SINGLE SOURCE OF TRUTH: every component that needs bookmark
// functionality (Posts.astro card overlay, SimilarPosts.astro card
// overlay, PostSingle.astro inline button, Header.astro badge counter,
// saved.astro listing page) imports from THIS file only — no
// duplicated localStorage read/write logic anywhere else in the
// codebase. This guarantees the storage schema can never drift out
// of sync between components.
//
// SELF-HEALING GUARDS:
// - SSR-safe: every function checks `isBrowser()` first, since Astro
//   components render server-side at build time where `window`/
//   `localStorage` do not exist. Calling any of these functions during
//   SSR silently returns a safe default (empty array / false) instead
//   of crashing the build.
// - Corrupted JSON in localStorage (manual tampering, browser bugs,
//   partial writes) -> safeParse() catches the exception and resets
//   to an empty array, rather than breaking every page that reads
//   bookmarks.
// - Storage quota exceeded / Safari private-browsing mode (throws on
//   .setItem) -> persist() catches the exception and fails silently;
//   core site functionality (reading/viewing posts) is never affected
//   by a bookmark-save failure.
// - Duplicate bookmarks (same post saved twice) are structurally
//   impossible: addBookmark() checks for an existing id before adding.
// ==========================================================

export interface BookmarkItem {
  id: string;
  title: string;
  image?: string;
  date?: string;
  categories?: string[];
  savedAt: number;
}

const STORAGE_KEY = "wk_bookmarks_v1";

// Custom event name — other parts of the site (Header.astro's badge
// counter) listen for this to stay in sync the instant a bookmark is
// added/removed anywhere on the page, without polling localStorage.
export const BOOKMARKS_EVENT = "wk:bookmarks-changed";

function isBrowser(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
  } catch {
    return false;
  }
}

function safeParse(raw: string | null): BookmarkItem[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is BookmarkItem =>
        !!item && typeof item === "object" && typeof item.id === "string" && item.id.length > 0
    );
  } catch {
    // Corrupted JSON — treat as empty rather than crashing every page
    // that reads bookmarks.
    return [];
  }
}

export function getBookmarks(): BookmarkItem[] {
  if (!isBrowser()) return [];
  try {
    return safeParse(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

export function isBookmarked(id: string): boolean {
  if (!id) return false;
  return getBookmarks().some((item) => item.id === id);
}

export function getBookmarkCount(): number {
  return getBookmarks().length;
}

function persist(items: BookmarkItem[]): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    window.dispatchEvent(new CustomEvent(BOOKMARKS_EVENT, { detail: { count: items.length } }));
  } catch {
    // Quota exceeded or private-browsing restriction — fail silently.
    // The UI's optimistic state (handled by each button's own script)
    // is the only feedback the user needs in this rare edge case.
  }
}

export function addBookmark(item: Omit<BookmarkItem, "savedAt">): void {
  if (!item?.id) return;
  const current = getBookmarks();
  if (current.some((b) => b.id === item.id)) return; // already saved
  const next: BookmarkItem[] = [{ ...item, savedAt: Date.now() }, ...current];
  persist(next);
}

export function removeBookmark(id: string): void {
  if (!id) return;
  const current = getBookmarks();
  const next = current.filter((b) => b.id !== id);
  if (next.length === current.length) return; // nothing removed
  persist(next);
}

export function clearAllBookmarks(): void {
  persist([]);
}

/**
 * Toggles the bookmark state for a post. Returns the NEW state
 * (true = now bookmarked, false = now removed).
 */
export function toggleBookmark(item: Omit<BookmarkItem, "savedAt">): boolean {
  if (!item?.id) return false;
  if (isBookmarked(item.id)) {
    removeBookmark(item.id);
    return false;
  }
  addBookmark(item);
  return true;
}
