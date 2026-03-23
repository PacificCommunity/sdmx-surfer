# Design System Document: The Oceanic Data-Scapes

## 1. Overview & Creative North Star
**Creative North Star: "The Modern Navigator"**

In designing for the Pacific Community (SPC), we must move beyond the sterile, "off-the-shelf" look of generic SaaS dashboards. The "Modern Navigator" vision treats statistical data as a vast, fluid ocean—vast but navigable, deep but clear. 

This design system avoids the rigid, boxy constraints of traditional grids. Instead, it utilizes **Editorial Asymmetry** and **Tonal Depth** to guide the eye. We break the "template" feel by overlapping data visualizations with translucent layers and using a typographic scale that feels like a premium economic journal. The interface doesn't just display data; it curates an authoritative narrative of development through soft minimalism and high-end glassmorphism.

---

## 2. Colors & Surface Philosophy
Our palette reflects the deep Pacific—ranging from the midnight blues of the trench to the vibrant teals of the reef—grounded by sophisticated, cool grays.

### Surface Hierarchy & The "No-Line" Rule
To achieve a premium feel, **1px solid borders for sectioning are strictly prohibited.** We define boundaries through tonal shifts and nesting.

*   **The Nesting Principle:** Use the `surface_container` tiers to create depth.
    *   **Base Layer:** `surface` (#f7fafc).
    *   **Sectioning:** `surface_container_low` (#f1f4f6) for large sidebars or secondary content areas.
    *   **Interactive Cards:** `surface_container_lowest` (#ffffff) to provide a "lifted" feel against the base.
    *   **Active Overlays:** `surface_container_high` (#e5e9eb) for modals or focused tooltips.

### The "Glass & Gradient" Rule
Standard flat colors feel "pasted on." To add "soul," apply a subtle linear gradient to primary CTAs: `primary` (#004467) transitioning to `primary_container` (#005c8a) at a 135-degree angle. For floating dashboard panels, use **Glassmorphism**: set the background to a semi-transparent `surface_container_lowest` (85% opacity) with a `20px` backdrop-blur to allow underlying data trends to subtly bleed through.

---

## 3. Typography
We use a dual-font strategy to balance authoritative headers with technical legibility.

*   **Display & Headlines (Manrope):** Chosen for its modern, geometric construction. Use `display-lg` (3.5rem) for high-level regional stats to create an editorial, "impact-first" feel.
*   **Interface & Data (Inter):** Used for all functional text. Inter’s tall x-height ensures that complex data tables remain legible even at `body-sm` (0.75rem).
*   **Visual Hierarchy:** Always pair a `headline-sm` in `on_surface` (#181c1e) with a `label-md` in `on_tertiary_fixed_variant` (#2c4c4c) for metadata. This contrast in weight and tone signals "Trustworthy Expertise."

---

## 4. Elevation & Depth
In this system, elevation is an environmental property, not a drop-shadow effect.

*   **Tonal Layering:** Achieve hierarchy by "stacking." A `surface_container_lowest` card sitting on a `surface_container_low` background creates a natural, soft lift without a single line of CSS shadow.
*   **Ambient Shadows:** Where floating elements (like chat bubbles or popovers) are required, use an extra-diffused shadow: `box-shadow: 0 12px 40px rgba(24, 28, 30, 0.06);`. Note the use of the `on_surface` color tinted at 6% rather than pure black.
*   **The "Ghost Border" Fallback:** If a border is required for accessibility (e.g., input fields), use the `outline_variant` token at **20% opacity**. Never use 100% opaque outlines.

---

## 5. Components

### Cards & Data Panels
*   **Rule:** Forbid divider lines within cards. 
*   **Execution:** Separate header, body, and footer using vertical white space (Scale `8`: 1.75rem) or a subtle background shift to `surface_container_highest` for the header bar.
*   **Corner Radius:** Use `DEFAULT` (0.5rem/8px) for all data cards to maintain a professional, crisp edge.

### Professional Data Tables
*   **Header:** `surface_container_high` with `label-md` uppercase text.
*   **Rows:** Alternating `surface` and `surface_container_low`. No horizontal lines. 
*   **Loading State:** Use a "Shimmer" effect transitioning between `surface_container` and `surface_variant`. Avoid static "Loading..." text.

### Buttons & Inputs
*   **Primary Button:** Gradient-filled (`primary` to `primary_container`), `xl` roundedness (1.5rem) for a modern, pill-shaped feel.
*   **Input Fields:** Ghost borders (20% `outline_variant`). On focus, transition to a `2px` `primary` bottom-border only, mimicking high-end architectural forms.

### Chat & Collaboration
*   **Chat Bubbles:** User messages in `primary` (#004467) with `on_primary` text. System/Data responses in `secondary_container` (#8aeff9) to reflect the teal oceanic theme.

### Highcharts-Compatible Palette
For data visualizations, use this sequence to ensure high contrast and brand alignment:
1.  **Deep Sea:** `#004467` (Primary)
2.  **Reef Teal:** `#006970` (Secondary)
3.  **Lagoon:** `#6fd6df` (Secondary Fixed Dim)
4.  **Kelp:** `#244445` (Tertiary)
5.  **Soft Mist:** `#abcdcd` (Tertiary Fixed Dim)

---

## 6. Do's and Don'ts

### Do:
*   **Do** use asymmetrical margins (e.g., a wider left margin for headlines) to create an editorial feel.
*   **Do** use `surface_tint` (#146492) at low opacities (5-10%) as an overlay for empty states to give them a "submerged" oceanic quality.
*   **Do** ensure all text/background combinations meet WCAG AA standards using the `on_` color tokens.

### Don't:
*   **Don't** use pure black (#000000) for text. Use `on_surface` (#181c1e) to keep the palette sophisticated.
*   **Don't** use traditional "Dividers" (split-panes). Use a `2.5` (0.5rem) gap from the spacing scale or a change in surface color.
*   **Don't** use sharp 0px corners. Every element must feel "weathered" by the sea, adhering to the `0.5rem` minimum radius.