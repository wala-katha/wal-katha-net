import React, { useEffect, useState, useCallback } from "react";
import { BiBookmark, BiSolidBookmark } from "react-icons/bi";

export interface BookmarkPost {
  id: string;
  title: string;
  image?: string;
  url: string;
  savedAt: number;
}

const STORAGE_KEY = "wk-bookmarks";

function readBookmarks(): BookmarkPost[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeBookmarks(list: BookmarkPost[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    window.dispatchEvent(new CustomEvent("wk-bookmarks-updated"));
  } catch {
    // localStorage quota/private-mode issue — fail silently, don't crash UI
  }
}

interface Props {
  postId: string;
  title: string;
  image?: string;
  url: string;
}

export default function BookmarkButton({ postId, title, image, url }: Props) {
  const [saved, setSaved] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const list = readBookmarks();
    setSaved(list.some((b) => b.id === postId));
    setReady(true);
  }, [postId]);

  const toggle = useCallback(() => {
    const list = readBookmarks();
    const exists = list.some((b) => b.id === postId);
    const next = exists
      ? list.filter((b) => b.id !== postId)
      : [{ id: postId, title, image, url, savedAt: Date.now() }, ...list];
    writeBookmarks(next);
    setSaved(!exists);
  }, [postId, title, image, url]);

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={saved}
      aria-label={saved ? "බුක්මාක් එකෙන් ඉවත් කරන්න" : "බුක්මාක් කරන්න"}
      title={saved ? "බුක්මාක් එකෙන් ඉවත් කරන්න" : "පසුව කියවීමට බුක්මාක් කරන්න"}
      disabled={!ready}
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-full border text-sm font-bold transition-colors duration-200 ${
        saved
          ? "bg-[#01AD9F] border-[#01AD9F] text-[#010203]"
          : "bg-white/[0.03] border-white/10 text-[#F8F8FF]/80 hover:border-[#01AD9F]/50 hover:text-[#01AD9F]"
      }`}
    >
      {saved ? <BiSolidBookmark className="h-4 w-4" /> : <BiBookmark className="h-4 w-4" />}
      <span>{saved ? "බුක්මාක් කළා" : "බුක්මාක් කරන්න"}</span>
    </button>
  );
}
