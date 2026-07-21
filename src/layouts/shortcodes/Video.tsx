import React from "react";

interface VideoProps {
  title: string;
  src: string;
  width?: number | string;
  height?: number | string;
  uploadDate?: string; // SEO සඳහා dynamic අප්ලෝඩ් දිනයක් දීමට
  thumbnail?: string;  // Google සර්ච් එකට පේන dynamic thumbnail එකක් දීමට
  [key: string]: any;
}

function Video({
  title,
  src,
  width = "100%",
  height = "auto",
  uploadDate = "2026-06-08T00:00:00+05:30", // ඩිෆෝල්ට් අද දිනය (ISO Format)
  thumbnail = "/images/default-video-thumbnail.jpg", // ඩිෆෝල්ට් fallback
  ...rest
}: VideoProps) {
  
  // වීඩියෝ එකේ ඇත්තම URL එක කෝඩ් එක ඇතුළෙන් තහවුරු කර ගැනීම
  const videoUrl = src.match(/^http/) ? src : `/videos/${src}`;

  // 🎯 2026 SCHEMA UPGRADE: JSON-LD VideoObject added alongside the
  // existing itemScope/itemProp Microdata block below. Google's
  // structured-data docs prioritize JSON-LD as the recommended format
  // (Microdata remains technically valid and is left untouched here so
  // nothing that already depends on it breaks), so adding a JSON-LD
  // script gives search engines the more reliably-parsed version too.
  //
  // Field parity note (consistency with Youtube.tsx's VideoObject):
  // this is a self-hosted <video> file, not an embeddable third-party
  // player, so "contentUrl" (the direct file URL) is the correct
  // primary field here -- "embedUrl" is intentionally omitted since
  // there is no embeddable player page for a raw video file. This
  // mirrors the same schema.org VideoObject spec that Youtube.tsx
  // follows, just with the field that matches this component's actual
  // content type instead of copying Youtube.tsx's field set verbatim.
  const videoObjectSchema = {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    "name": title,
    "description": `${title} - Watch High Quality Content on Wal Katha`,
    "thumbnailUrl": thumbnail,
    "uploadDate": uploadDate,
    "contentUrl": videoUrl,
  };

  return (
    <div 
      className="video-wrapper my-6 overflow-hidden rounded-2xl border border-neutral-800/80 bg-[#0a0b0d] p-1 transition-all duration-300 hover:border-[#01AD9F]/30 hover:shadow-lg hover:shadow-[#01AD9F]/5"
      itemScope 
      itemType="https://schema.org/VideoObject"
    >
      {/* 📊 Google Video SEO සඳහා අවශ්‍ය අනිවාර්ය මෙටා ඩේටා (Dynamic) */}
      <meta itemProp="name" content={title} />
      <meta itemProp="description" content={`${title} - Watch High Quality Content on Wal Katha`} />
      <meta itemProp="contentUrl" content={videoUrl} />
      <meta itemProp="uploadDate" content={uploadDate} />
      <meta itemProp="thumbnailUrl" content={thumbnail} />

      {/* 🎯 JSON-LD VideoObject — Google's preferred structured-data format,
          added alongside the Microdata block above without removing it */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(videoObjectSchema) }}
      />

      {/* 🎬 ASPECT-VIDEO FOR REPREVENTING LAYOUT SHIFTS (SEO STABLE) */}
      <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-black">
        <video
          className="absolute top-0 left-0 w-full h-full object-cover"
          width={width}
          height={height}
          controls
          preload="metadata" 
          playsInline // මොබයිල් බ්‍රවුසර්ස් වල ෆුල් ස්ක්‍රීන් නොවී එතනම ප්ලේ වීමට (UX)
          {...rest}
        >
          <source src={videoUrl} type="video/mp4" />
          <p className="p-4 text-center text-neutral-400 text-sm">
            Your browser does not support the video tag. Here is a link to the video: 
            <a href={videoUrl} className="text-[#01AD9F] underline ml-1">{title}</a>
          </p>
        </video>
      </div>
    </div>
  );
}

export default Video;
