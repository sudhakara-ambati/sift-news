import { ImageResponse } from "next/og";

export const size = { width: 192, height: 192 };
export const contentType = "image/png";

export default function Icon() {
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
          fontSize: 132,
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
