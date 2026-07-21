import React, { useEffect } from "react";

interface YoutubeProps {
  id: string;
  title: string;
  uploadDate?: string; // SEO සඳහා dynamic අප්ලෝඩ් දිනයක් දීමට
  [key: string]: any;
}

const Youtube = ({
  id,
  title,
  uploadDate = "2026-06-08T00:00:00+05:30", // ඩිෆෝල්ට් අද දිනය (ISO Format)
  ...rest
}: YoutubeProps) => {
  
  useEffect(() => {
    // සයිට් එකේ Speed එක උපරිම කිරීමට Lazy Load වෙබ් කම්පෝනන්ට් එකක් ලෙස ඉම්පෝර්ට් කිරීම
    import("@justinribeiro/lite-youtube");
  }, []);

  // YouTube thumbnail සහ embed URL එක ස්මාර්ට් විදිහට සකස් කිරීම
  const thumbnailUrl = `https://img.youtube.com/vi/${id}/maxresdefault.jpg`;
  const embedUrl = `https://www.youtube.com/embed/${id}`;
  const watchUrl = `https://www.youtube.com/watch?v=${id}`;

  // 🎯 2026 SCHEMA UPGRADE: JSON-LD VideoObject added alongside the
  // existing itemScope/itemProp Microdata block below. Google's
  // structured-data docs prioritize JSON-LD as the recommended format
  // (Microdata remains technically valid and is left untouched here so
  // nothing that already depends on it breaks), so adding a JSON-LD
  // script gives search engines the more reliably-parsed version too.
  // "contentUrl" (the canonical watch-page URL) is included since it's
  // a recommended VideoObject field the Microdata block didn't have.
  const videoObjectSchema = {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    "name": title,
    "description": `${title} - Watch High Quality Video on Wal Katha`,
    "thumbnailUrl": thumbnailUrl,
    "uploadDate": uploadDate,
    "embedUrl": embedUrl,
    "contentUrl": watchUrl,
  };

  return (
    <div 
      className="youtube-wrapper my-6 overflow-hidden rounded-2xl border border-neutral-800/80 bg-[#0a0b0d] p-1 transition-all duration-300 hover:border-[#01AD9F]/30 hover:shadow-lg hover:shadow-[#01AD9F]/5"
      itemScope 
      itemType="https://schema.org/VideoObject"
    >
      {/* 📊 Google Video SEO සඳහා අවශ්‍ය සැඟවුණු මෙටා ඩේටා (Dynamic) */}
      <meta itemProp="name" content={title} />
      <meta itemProp="description" content={`${title} - Watch High Quality Video on Wal Katha`} />
      <meta itemProp="thumbnailUrl" content={thumbnailUrl} />
      <meta itemProp="embedUrl" content={embedUrl} />
      <meta itemProp="uploadDate" content={uploadDate} />

      {/* 🎯 JSON-LD VideoObject — Google's preferred structured-data format,
          added alongside the Microdata block above without removing it */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(videoObjectSchema) }}
      />

      {/* 🎬 ASPECT-VIDEO FOR 100% STABLE RENDERING (NO LAYOUT SHIFT) */}
      <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-black">
        {/* @ts-ignore */}
        <lite-youtube 
          className="absolute top-0 left-0 w-full h-full border-0" 
          videoid={id} 
          videotitle={title} 
          {...rest} 
        />
      </div>
    </div>
  );
};

export default Youtube;
