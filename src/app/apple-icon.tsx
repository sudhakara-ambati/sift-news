import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0b0b0c",
          color: "#f5f5f4",
          fontFamily: "serif",
          fontSize: 124,
          fontWeight: 600,
          letterSpacing: -6,
        }}
      >
        S
      </div>
    ),
    size,
  );
}
