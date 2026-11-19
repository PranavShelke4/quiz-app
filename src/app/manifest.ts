import type { MetadataRoute } from "next";

/** Lets phones "Add to Home Screen" — required for push notifications on iPhone (iOS 16.4+). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Daily Quiz",
    short_name: "Quiz",
    description: "Answer one question a day.",
    start_url: "/quiz",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ad1e23",
    icons: [{ src: "/brand/icicibank-com-brandmark.png", sizes: "any", type: "image/png", purpose: "any" }],
  };
}
