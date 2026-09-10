import type { CortardoAssetFile, CortardoDesignTokens, CortardoScreen } from "@shared/schema";
import { completeJSON } from "./gateway";

const SCREENS_SYSTEM = `You are Cortardo, a code review agent. Based on the user's prompt, propose the review areas (checks) for the code they want reviewed.

Rules:
- Return 4 to 8 area names, ordered from most to least important.
- Names are short PascalCase labels like "Auth", "Database", "API", "Tests".
- Areas should be distinct and cover the core parts of the change described in the prompt.

Respond ONLY with JSON in this shape:
{
  "screens": ["Auth", "Database", "API", "Tests"]
}`;

const DESIGN_TOKENS_SYSTEM = `You are Cortardo, a code review agent. Based on the user's prompt, propose a cohesive design token set for the review workspace UI.

Respond ONLY with JSON in this exact shape (all values are strings):
{
  "fonts": { "Heading": "Inter", "Subheading": "Inter", "Body": "Inter" },
  "sizes": { "H1": "32px", "H2": "24px", "H3": "20px", "Body": "14px", "Small": "12px" },
  "colours": { "Primary": "#284B63", "Secondary": "#4A7A96", "Accent": "#F59E0B", "Background": "#FFFFFF", "Text": "#1A1A1A" },
  "radii": { "Small": "4", "Medium": "8", "Large": "12", "Extra Large": "20" }
}

Rules:
- Choose fonts, sizes, colours, and corner radii that fit the product's mood (e.g. playful, editorial, technical, luxury).
- Colours must be 6-digit hex codes (#RRGGBB). Keep Background light and Text dark unless the prompt clearly calls for a dark theme.
- Fonts come from this list: Inter, SF Pro, Roboto, Playfair Display, JetBrains Mono, DM Sans, Space Grotesk.
- Keep the same keys shown above; only change the values.`;

const ASSETS_SYSTEM = `You are Cortardo, a code review agent. Based on the user's prompt, propose the reusable check modules the review will need.

Rules:
- Return 4 to 10 module file names like "AuthCheck.jsx", "QueryAudit.jsx", "TypeGuard.jsx", "StyleRules.jsx".
- Names are PascalCase with a .jsx extension. No paths, no duplicates.
- Cover the core review areas implied by the prompt (auth, data access, types, tests, style, etc.).

Respond ONLY with JSON in this shape:
{
  "components": ["AuthCheck.jsx", "QueryAudit.jsx", "TypeGuard.jsx", "StyleRules.jsx"]
}`;

const FALLBACK_TOKENS: CortardoDesignTokens = {
  fonts: { Heading: "Inter", Subheading: "Inter", Body: "Inter" },
  sizes: { H1: "32px", H2: "24px", H3: "20px", Body: "14px", Small: "12px" },
  colours: {
    Primary: "#284B63",
    Secondary: "#4A7A96",
    Accent: "#F59E0B",
    Background: "#FFFFFF",
    Text: "#1A1A1A",
  },
  radii: { Small: "4", Medium: "8", Large: "12", "Extra Large": "20" },
};

const FALLBACK_SCREENS = ["Home", "About", "Features", "Pricing", "Contact"];

const FALLBACK_COMPONENTS = ["Navbar.jsx", "Hero.jsx", "FeatureCard.jsx", "Footer.jsx"];

/** Derive the list of screens (pages) for the product from the prompt + plan. */
export async function generateScreens(prompt: string, plan?: string): Promise<CortardoScreen[]> {
  try {
    const result = await completeJSON<{ screens?: string[] }>(
      [
        { role: "system", content: SCREENS_SYSTEM },
        { role: "user", content: plan ? `${prompt}\n\nPlan: ${plan}` : prompt },
      ],
      { maxTokens: 2500, temperature: 0.5 },
    );
    const names = Array.isArray(result?.screens)
      ? result.screens.filter((s): s is string => typeof s === "string" && s.trim().length > 0).slice(0, 8)
      : [];
    const list = names.length > 0 ? names : FALLBACK_SCREENS;
    return list.map((name) => ({ name: name.trim(), ready: true }));
  } catch (err) {
    console.error("[cortardo-agent] screen generation failed:", err);
    return FALLBACK_SCREENS.map((name) => ({ name, ready: true }));
  }
}

/** Derive a design token set (fonts/sizes/colours/radii) for the product. */
export async function generateDesignTokens(prompt: string): Promise<CortardoDesignTokens> {
  try {
    const result = await completeJSON<{ fonts?: Record<string, string>; sizes?: Record<string, string>; colours?: Record<string, string>; radii?: Record<string, string> }>(
      [
        { role: "system", content: DESIGN_TOKENS_SYSTEM },
        { role: "user", content: prompt },
      ],
      { maxTokens: 3000, temperature: 0.5 },
    );
    return {
      fonts: { ...FALLBACK_TOKENS.fonts, ...(result?.fonts ?? {}) },
      sizes: { ...FALLBACK_TOKENS.sizes, ...(result?.sizes ?? {}) },
      colours: { ...FALLBACK_TOKENS.colours, ...(result?.colours ?? {}) },
      radii: { ...FALLBACK_TOKENS.radii, ...(result?.radii ?? {}) },
    };
  } catch (err) {
    console.error("[cortardo-agent] design token generation failed:", err);
    return FALLBACK_TOKENS;
  }
}

/** Derive the reusable component files (and upload placeholders) for the product. */
export async function generateAssets(prompt: string): Promise<CortardoAssetFile[]> {
  try {
    const result = await completeJSON<{ components?: string[] }>(
      [
        { role: "system", content: ASSETS_SYSTEM },
        { role: "user", content: prompt },
      ],
      { maxTokens: 2500, temperature: 0.5 },
    );
    const names = Array.isArray(result?.components)
      ? result.components.filter((c): c is string => typeof c === "string" && c.trim().length > 0).slice(0, 10)
      : [];
    const list = names.length > 0 ? names : FALLBACK_COMPONENTS;
    return list.map((label) => ({ id: label, label, kind: "component" as const }));
  } catch (err) {
    console.error("[cortardo-agent] asset generation failed:", err);
    return FALLBACK_COMPONENTS.map((label) => ({ id: label, label, kind: "component" as const }));
  }
}
