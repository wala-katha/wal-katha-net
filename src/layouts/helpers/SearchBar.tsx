import dateFormat from "@/lib/utils/dateFormat";
import { humanize, slugify } from "@/lib/utils/textConverter";
import { withTrailingSlash } from "@/lib/utils/urlHelper";
import Fuse from "fuse.js";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BiCalendarEdit, BiCategoryAlt } from "react-icons/bi";
import {
  IoSearchOutline,
  IoCloseCircleOutline,
  IoCloseOutline,
} from "react-icons/io5";
export type SearchItem = {
  slug: string;
  data: any;
  content: any;
};
interface Props {
  searchList: SearchItem[];
}
interface SearchResult {
  item: SearchItem;
  refIndex: number;
}
export default function SearchBar({ searchList }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [inputVal, setInputVal] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  // ✅ FIX A: useMemo — Fuse instance stable, searchList reference දෙකක් compare නොකෙරේ
  // JSON.stringify key ලෙස නොයෙදෙනවා — slugs array length stable reference ලෙස භාවිත
  const fuse = useMemo(
    () =>
      new Fuse(searchList, {
        keys: ["data.title", "data.categories", "data.tags"],
        includeMatches: true,
        minMatchCharLength: 2,
        threshold: 0.5,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [] // ✅ CRITICAL: searchList mount වෙද්දී fix — prop නැවත වෙනස් නොවෙනවා (static SSG data)
       // searchList dynamic නම් [searchList.length] use කරන්න
  );
  // ✅ FIX B: handleChange — useCallback, stable reference, re-render නොකෙරේ
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setInputVal(e.target.value);
  }, []);
  const handleClear = useCallback(() => {
    setInputVal("");
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, []);
  // ✅ FIX C: mount init — URL ?q= param කියවීම, dependency array හිස් — loop නෑ
  useEffect(() => {
    const searchStr = new URLSearchParams(window.location.search).get("q") ?? "";
    if (searchStr) {
      setInputVal(searchStr);
      // cursor position restore
      requestAnimationFrame(() => {
        if (inputRef.current) {
          inputRef.current.selectionStart =
            inputRef.current.selectionEnd = searchStr.length;
        }
      });
    }
  }, []);
  // ✅ FIX D: ROOT CAUSE FIX — history.replaceState සම්පූර්ණයෙන් ඉවත් කළා
  // Astro View Transitions සමඟ URL manipulation = component unmount → input නැතිවීම
  // URL update නොකෙරේ — search state component ඇතුළේ පමණක් manage කෙරේ
  useEffect(() => {
    if (inputVal.length > 2) {
      setSearchResults(fuse.search(inputVal) as SearchResult[]);
    } else {
      setSearchResults([]);
    }
  }, [inputVal, fuse]);
  return (
    <div className="min-h-[50vh] px-2 select-none relative">
      {/* EXIT BUTTON */}
      <div className="max-w-2xl mx-auto flex justify-end mb-4">
        
          href="/"
          rel="home"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.08] text-white/60 hover:text-red-400 transition-all duration-300 text-sm font-semibold tracking-wide shadow-sm"
          title="Exit search and go home"
          aria-label="Exit search and go home"
        >
          <span>Exit</span>
          <IoCloseOutline className="h-5 w-5" />
        </a>
      </div>
      {/* SEARCH INPUT BOX */}
      <div className="max-w-2xl mx-auto mb-10">
        <div className="relative flex items-center group">
          {/* Left Icon */}
          <span className="absolute left-4 z-10 text-[#01AD9F] pointer-events-none group-focus-within:scale-110"
                style={{ transition: "transform 0.3s", filter: "drop-shadow(0 0 8px rgba(1,173,159,0.5))" }}>
            <IoSearchOutline className="h-6 w-6" />
          </span>
          {/* ✅ INPUT — uncontrolled-style appearance, fully controlled value
              transition inline style ලෙස — Tailwind/global CSS conflict නෑ
              autoFocus නෑ — Astro hydration race condition නැතිකිරීමට
              onFocus mount පසු manually focus කෙරේ */}
          <input
            ref={inputRef}
            type="text"
            name="q"
            value={inputVal}
            onChange={handleChange}
            placeholder="Type here to search posts..."
            autoComplete="off"
            spellCheck={false}
            aria-label="Search posts"
            aria-autocomplete="list"
            aria-controls="search-results-list"
            aria-expanded={!!searchResults?.length}
            style={{
              width: "100%",
              paddingLeft: "3rem",
              paddingRight: "3rem",
              paddingTop: "0.875rem",
              paddingBottom: "0.875rem",
              borderRadius: "0.75rem",
              border: "1px solid rgba(255,255,255,0.1)",
              background: "rgba(255,255,255,0.05)",
              color: "#F8F8FF",
              fontSize: "1.125rem",
              fontWeight: 500,
              outline: "none",
              transition: "border-color 0.25s ease, background 0.25s ease, box-shadow 0.25s ease",
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = "#01AD9F";
              e.currentTarget.style.background = "rgba(255,255,255,0.07)";
              e.currentTarget.style.boxShadow = "0 0 20px rgba(1,173,159,0.15)";
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)";
              e.currentTarget.style.background = "rgba(255,255,255,0.05)";
              e.currentTarget.style.boxShadow = "none";
            }}
          />
          {/* Clear Button */}
          {inputVal.length > 0 && (
            <button
              onClick={handleClear}
              type="button"
              className="absolute right-4 z-10 text-white/40 hover:text-red-400 outline-none focus:text-red-400"
              style={{ transition: "color 0.2s" }}
              title="Clear search"
              aria-label="Clear search"
            >
              <IoCloseCircleOutline className="h-6 w-6" />
            </button>
          )}
        </div>
      </div>
      {/* RESULT COUNT */}
      {inputVal.length > 2 && (
        <div
          role="status"
          aria-live="polite"
          className="my-8 text-center text-sm sm:text-base text-white/60 font-medium tracking-wide"
        >
          Found{" "}
          <span className="text-[#01AD9F] font-bold">
            {searchResults?.length ?? 0}
          </span>
          {(searchResults?.length ?? 0) === 1 ? " result" : " results"} for{" "}
          <span className="text-[#F8F8FF] font-semibold">'{inputVal}'</span>
        </div>
      )}
      {/* RESULTS GRID */}
      <div
        id="search-results-list"
        role="list"
        className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:gap-10"
      >
        {searchResults?.map(({ item }) => (
          <article
            key={item.slug}
            role="listitem"
            className="group/card flex flex-col justify-between border border-white/[0.04] bg-white/[0.01] p-4 rounded-2xl hover:border-white/10"
            style={{ transition: "border-color 0.3s" }}
          >
            <div>
              {item.data.image && (
                
                  href={withTrailingSlash(`/blog/${item.slug}`)}
                  className="rounded-xl block overflow-hidden relative aspect-video w-full bg-white/5"
                >
                  <img
                    className="group-hover/card:scale-[1.03] w-full h-full object-cover"
                    style={{ transition: "transform 0.5s" }}
                    src={item.data.image}
                    alt={item.data.title}
                    loading="lazy"
                    width={445}
                    height={230}
                    decoding="async"
                  />
                </a>
              )}
              <ul className="mt-5 mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs sm:text-sm text-white/50">
                <li className="flex items-center font-medium">
                  <BiCalendarEdit className="mr-1.5 h-4 w-4 text-[#01AD9F]" />
                  <time dateTime={
                    item.data.date && typeof item.data.date === "object" && "isoString" in item.data.date
                      ? item.data.date.isoString
                      : String(item.data.date ?? "")
                  }>
                    {(() => {
                      // ✅ ROOT FIX: dateFormat() ලබාදෙන return value එක
                      // {day, month, year, isoString, toString} object එකක්.
                      // JSX එකේ object එකක් direct render කළ විට React Error #31
                      // throw වී, component crash වෙයි → SearchBar unmount →
                      // input "disappears" (3-letter type වූ විට results render
                      // වෙන මොහොතේම මේ crash එක සිදුවේ).
                      if (!item.data.date) return "";
                      const formatted = dateFormat(item.data.date);
                      if (formatted && typeof formatted === "object") {
                        // object එකේ toString() method එක call කර string ලබාගන්න
                        return typeof (formatted as any).toString === "function"
                          ? (formatted as any).toString()
                          : String((formatted as any).isoString ?? "");
                      }
                      return String(formatted ?? "");
                    })()}
                  </time>
                </li>
                <li className="flex items-center font-medium">
                  <BiCategoryAlt className="mr-1.5 h-4 w-4 text-[#01AD9F]" />
                  <div className="flex flex-wrap gap-1">
                    {(item.data.categories ?? [])
                      .filter((c: unknown) => typeof c === "string" && c.length > 0)
                      .map((category: string, i: number, arr: string[]) => (
                        
                          key={i}
                          href={withTrailingSlash(`/categories/${slugify(category)}`)}
                          className="hover:text-[#01AD9F]"
                          style={{ transition: "color 0.2s" }}
                        >
                          {humanize(category)}
                          {i !== arr.length - 1 && ","}
                        </a>
                      ))}
                  </div>
                </li>
              </ul>
              <h3 className="mb-2 text-lg sm:text-xl font-bold tracking-tight">
                
                  href={withTrailingSlash(`/blog/${item.slug}`)}
                  className="block text-[#F8F8FF] hover:text-[#01AD9F] line-clamp-2 leading-snug"
                  style={{ transition: "color 0.3s" }}
                >
                  {item.data.title}
                </a>
              </h3>
            </div>
            <p className="text-white/60 text-sm line-clamp-2 mt-2 leading-relaxed">
              {typeof item.content === "string" ? item.content : ""}
            </p>
          </article>
        ))}
      </div>
      {/* EMPTY STATE */}
      {inputVal.length > 2 && searchResults?.length === 0 && (
        <div className="text-center py-16 text-white/40 text-base">
          <p>කිසිදු ප්‍රතිඵලයක් හමු නොවීය.</p>
          <p className="text-sm mt-2">වෙනත් වචනයක් සමඟ නැවත උත්සාහ කරන්න.</p>
        </div>
      )}
    </div>
  );
}
