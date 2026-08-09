import React from "react";

interface OgImageProps {
  title: string;
  category?: string;
  siteTitle: string;
}

// Satori only supports a limited Flexbox-based subset of CSS - every
// element with children needs display:flex explicitly. This function
// is called as a plain function (OgImageTemplate({...})), not as a
// JSX component (<OgImageTemplate />), so it returns a fully-resolved
// tree of intrinsic elements (div/span) that Satori can read directly
// without needing to resolve custom components itself.
export function OgImageTemplate({ title, category, siteTitle }: OgImageProps) {
  // Longer titles get a smaller font size so the rendered text stays
  // inside the 630px canvas height without overflowing. Satori's
  // line-clamp/text-overflow support is inconsistent across versions,
  // so scaling the font size is the safer approach here.
  const titleLength = title.length;
  const titleFontSize = titleLength > 70 ? 44 : titleLength > 45 ? 54 : 64;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "1200px",
        height: "630px",
        backgroundColor: "#050505",
        padding: "64px",
        position: "relative",
        fontFamily: "Noto Sans Sinhala",
      }}
    >
      <div
        style={{
          display: "flex",
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "10px",
          backgroundColor: "#01AD9F",
        }}
      />

      <div style={{ display: "flex", alignItems: "center" }}>
        <div
          style={{
            display: "flex",
            width: "14px",
            height: "14px",
            borderRadius: "999px",
            backgroundColor: "#01AD9F",
            marginRight: "12px",
          }}
        />
        <div style={{ display: "flex", color: "#01AD9F", fontSize: "28px", fontWeight: 700 }}>
          {siteTitle}
        </div>
      </div>

      {category ? (
        <div style={{ display: "flex", marginTop: "40px" }}>
          <div
            style={{
              display: "flex",
              backgroundColor: "rgba(1,173,159,0.12)",
              color: "#01AD9F",
              fontSize: "24px",
              fontWeight: 700,
              padding: "8px 20px",
              borderRadius: "999px",
              border: "1px solid rgba(1,173,159,0.4)",
            }}
          >
            {category}
          </div>
        </div>
      ) : null}

      <div
        style={{
          display: "flex",
          flex: 1,
          alignItems: "center",
          marginTop: category ? "24px" : "56px",
        }}
      >
        <div
          style={{
            display: "flex",
            color: "#F8F8FF",
            fontSize: `${titleFontSize}px`,
            fontWeight: 700,
            lineHeight: 1.3,
          }}
        >
          {title}
        </div>
      </div>

      <div style={{ display: "flex", color: "rgba(248,248,255,0.45)", fontSize: "22px" }}>
        walakatha.net
      </div>
    </div>
  );
}
