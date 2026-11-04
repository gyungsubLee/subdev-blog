export const THEME_STORAGE_KEY = "second-brain:theme-colors:v1";

export const palettes = [
  {
    id: "linen",
    name: "리넨 에디토리얼",
    dark: false,
    paper: "#f6f3eb",
    surface: "#fdfbf6",
    soft: "#eae3d5",
    ink: "#302e28",
    muted: "#706b61",
    accent: "#a84629",
    lineSoft: "#d9d2c4"
  },
  {
    id: "swiss",
    name: "화이트 · 기본",
    dark: false,
    paper: "#ffffff",
    surface: "#ffffff",
    soft: "#f1f1ee",
    ink: "#161616",
    muted: "#626262",
    accent: "#b82927",
    lineSoft: "#d7d7d4"
  },
  {
    id: "cobalt",
    name: "코발트 스튜디오",
    dark: false,
    paper: "#f3f6fc",
    surface: "#ffffff",
    soft: "#e5edff",
    ink: "#172b4d",
    muted: "#5b6b83",
    accent: "#2458ce",
    lineSoft: "#d3ddec"
  },
  {
    id: "sage",
    name: "세이지 라이브러리",
    dark: false,
    paper: "#eef1e9",
    surface: "#f8faf4",
    soft: "#dce6d5",
    ink: "#293b30",
    muted: "#626e60",
    accent: "#346345",
    lineSoft: "#cbd5c5"
  },
  {
    id: "midnight",
    name: "미드나이트 터미널",
    dark: true,
    paper: "#101923",
    surface: "#172330",
    soft: "#203a40",
    ink: "#e0eaf1",
    muted: "#a3b4c4",
    accent: "#7cddc2",
    lineSoft: "#304252"
  },
  {
    id: "graphite",
    name: "그래파이트 앰버",
    dark: true,
    paper: "#1b1c1e",
    surface: "#252628",
    soft: "#393229",
    ink: "#f0ede5",
    muted: "#b6b3aa",
    accent: "#efbd75",
    lineSoft: "#43413c"
  },
  {
    id: "plum",
    name: "플럼 아틀리에",
    dark: false,
    paper: "#f6f0f5",
    surface: "#fffafe",
    soft: "#ecdfeb",
    ink: "#3e2a40",
    muted: "#7a657b",
    accent: "#814677",
    lineSoft: "#dfcfdf"
  },
  {
    id: "terracotta",
    name: "테라코타 저널",
    dark: false,
    paper: "#f7eee6",
    surface: "#fff8f0",
    soft: "#efdbcc",
    ink: "#492f27",
    muted: "#84675b",
    accent: "#a3442a",
    lineSoft: "#dec3b1"
  },
  {
    id: "frost",
    name: "노르딕 프로스트",
    dark: false,
    paper: "#eef5f6",
    surface: "#ffffff",
    soft: "#dceef1",
    ink: "#1c3a40",
    muted: "#567279",
    accent: "#176578",
    lineSoft: "#cbdfe3"
  },
  {
    id: "mono",
    name: "모노 프레스",
    dark: false,
    paper: "#f4f2e9",
    surface: "#fffef8",
    soft: "#e5eaa8",
    ink: "#22241f",
    muted: "#626459",
    accent: "#3b4f23",
    lineSoft: "#22241f"
  }
] as const;

export const accents = [
  { id: "red", name: "레드", light: "#b82927", dark: "#f08b86" },
  { id: "blue", name: "블루", light: "#2458ce", dark: "#89afff" },
  { id: "green", name: "그린", light: "#346345", dark: "#8ad4a5" },
  { id: "purple", name: "퍼플", light: "#814677", dark: "#d8a0d1" },
  { id: "teal", name: "청록", light: "#176578", dark: "#7cddc2" },
  { id: "amber", name: "앰버", light: "#885400", dark: "#efbd75" },
] as const;

type PaletteId = (typeof palettes)[number]["id"];
type AccentId = "palette" | (typeof accents)[number]["id"];
export type ThemeSettings = { palette: PaletteId; accent: AccentId };
export const DEFAULT_SETTINGS: ThemeSettings = { palette: "swiss", accent: "palette" };

let appliedSettings: ThemeSettings = { ...DEFAULT_SETTINGS };
let settingsPersisted = true;

export function getThemeState() {
  return { settings: { ...appliedSettings }, persisted: settingsPersisted };
}

function validatedSettings(value: unknown): ThemeSettings {
  if (!value || typeof value !== "object") return { ...DEFAULT_SETTINGS };
  const candidate = value as Record<string, unknown>;
  const palette = palettes.find(item => item.id === candidate.palette);
  const accent = accents.find(item => item.id === candidate.accent);
  if (!palette || (candidate.accent !== "palette" && !accent)) return { ...DEFAULT_SETTINGS };
  return { palette: palette.id, accent: accent?.id ?? "palette" };
}

export function readThemeSettings(storage?: Pick<Storage, "getItem">): ThemeSettings {
  try {
    const raw = (storage ?? window.localStorage).getItem(THEME_STORAGE_KEY);
    return raw ? validatedSettings(JSON.parse(raw)) : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveThemeSettings(settings: ThemeSettings, storage?: Pick<Storage, "setItem">): boolean {
  try {
    (storage ?? window.localStorage).setItem(THEME_STORAGE_KEY, JSON.stringify(validatedSettings(settings)));
    settingsPersisted = true;
    return true;
  } catch {
    settingsPersisted = false;
    return false;
  }
}

export function applyThemeSettings(settings: ThemeSettings, root: HTMLElement = document.documentElement) {
  const selected = validatedSettings(settings);
  appliedSettings = selected;
  const palette = palettes.find(item => item.id === selected.palette)!;
  const override = accents.find(item => item.id === selected.accent);
  const accent = override ? (palette.dark ? override.dark : override.light) : palette.accent;
  const colors = {
    "--paper": palette.paper,
    "--surface": palette.surface,
    "--soft": palette.soft,
    "--ink": palette.ink,
    "--muted": palette.muted,
    "--accent": accent,
    "--accent-hover": `color-mix(in srgb, ${accent} 84%, #000000)`,
    "--on-accent": palette.dark ? "#161616" : "#ffffff",
    "--line": palette.ink,
    "--line-soft": palette.lineSoft,
    "--surface-overlay": palette.surface + "ee",
    "--overlay": "#00000080",
    // The installed highlighter uses github-light, including in dark palettes.
    "--syntax-paper": palette.dark ? "#f1f1ee" : palette.soft,
    "--syntax-ink": "#161616",
    "--syntax-muted": "#626262",
    "--syntax-line": "#d7d7d4",
  };
  for (const [name, color] of Object.entries(colors)) root.style.setProperty(name, color);
  root.style.colorScheme = palette.dark ? "dark" : "light";
}

export function initializeTheme() {
  applyThemeSettings(readThemeSettings());
}
