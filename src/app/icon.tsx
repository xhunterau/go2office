import { ImageResponse } from "next/og";

export const size = {
  width: 32,
  height: 32,
};
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
          background: "#E8A9BC",
          borderRadius: 7,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            width: 16,
            height: 20,
            background: "#ffffff",
            borderRadius: 2,
            padding: 2,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <div
              style={{
                width: 4,
                height: 4,
                background: "#4A2530",
                borderRadius: 1,
              }}
            />
            <div
              style={{
                width: 4,
                height: 4,
                background: "#4A2530",
                borderRadius: 1,
              }}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <div
              style={{
                width: 4,
                height: 4,
                background: "#4A2530",
                borderRadius: 1,
              }}
            />
            <div
              style={{
                width: 4,
                height: 4,
                background: "#4A2530",
                borderRadius: 1,
              }}
            />
          </div>
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
