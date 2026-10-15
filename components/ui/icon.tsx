import type { CSSProperties } from "react";
import styles from "./icon.module.css";

const paths = {
  heart: "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z",
  church: "M12 2v5m-2-3h4M4 21V11l8-5 8 5v10H4Zm5 0v-7h6v7M2 21h20",
  list: "M9 6h12M9 12h12M9 18h12M3 6h.01M3 12h.01M3 18h.01",
  fields: "M4 4h16v16H4ZM4 9h16M9 9v11",
  key: "M15 3a6 6 0 1 1-5.7 8L3 17v4h4v-3h3l3-3M17 7h.01",
  user: "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 8 0 0 1 16 0v2",
  logout: "M9 3H4v18h5M9 12h12m-4-4 4 4-4 4",
  plus: "M12 5v14M5 12h14",
  close: "m6 6 12 12M6 18 18 6",
  chevronRight: "m9 5 7 7-7 7",
  chevronLeft: "m15 5-7 7 7 7",
  chevronDown: "m5 9 7 7 7-7",
  chevronUp: "m5 15 7-7 7 7",
  arrowUp: "M12 20V4m-6 6 6-6 6 6",
  arrowDown: "M12 4v16m-6-6 6 6 6-6",
  filter: "M4 7h16M7 12h10M10 17h4",
  group: "M4 4h6v6H4ZM14 4h6v6h-6ZM4 14h6v6H4ZM14 14h6v6h-6Z",
  chart: "M4 3v18h17M8 16v-5m5 5V6m5 10v-8",
  sheet: "M5 3h14v18H5ZM5 8h14M5 13h14M5 17h14M10 8v13",
  download: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
  upload: "M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5",
  edit: "m15 4 5 5M4 20l4-1L21 6a2.8 2.8 0 0 0-4-4L4 15l-1 6Z",
  trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7",
  save: "M4 3h13l4 4v14H3V3h1Zm3 0v6h10V3M7 21v-8h10v8",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  eyeOff: "m3 3 18 18M10.5 5.1 12 5c6.5 0 10 7 10 7a19 19 0 0 1-3 3.7M6.5 6.5C3.5 8.5 2 12 2 12s3.5 7 10 7a12 12 0 0 0 5.5-1.5M10 10a3 3 0 0 0 4 4",
  refresh: "M20 7V3m0 4h-4M4 17v4m0-4h4M20 7a8 8 0 0 0-14-2M4 17a8 8 0 0 0 14 2",
  check: "m5 12 4 4L19 6",
  warning: "m12 3 10 18H2L12 3Zm0 6v5m0 3h.01",
  file: "M14 2H4v20h16V8l-6-6Zm0 0v6h6M8 13h8m-8 4h5",
  image: "M3 3h18v18H3ZM3 16l5-5 5 5 3-3 5 5M14 8h.01",
  text: "M4 5h16M4 10h16M4 15h16M4 20h10",
  number: "m10 3-4 18M18 3l-4 18M3 9h18M2 15h18",
  calendar: "M4 5h16v16H4ZM8 3v4m8-4v4M4 11h16",
  link: "M14 3h7v7m0-7L10 14M10 3H3v18h18v-7",
} as const;

export type IconName = keyof typeof paths;
export function Icon({ name, size = 18, tone }: { name: IconName; size?: number; tone?: "sage" | "blue" | "rose" | "purple" | "amber" }) {
  return <svg className={styles.icon} style={{ "--icon-size": `${size}px` } as CSSProperties} data-tone={tone} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={paths[name]} /></svg>;
}
