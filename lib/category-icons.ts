/**
 * Pacific Data Hub pictograms for the categories our dataflows already carry.
 *
 * The categories come from SPC's own category schemes, `CAS_COM_TOPIC` and
 * `CAS_COM_DEV`, recorded per dataflow in the index. The pictograms come from
 * the PDH visual identity (guidelines p21, p22). Using PDH's own icons for
 * SPC's own categories is alignment rather than decoration: both sides of the
 * mapping already exist, so nothing new is being invented.
 *
 * WHAT IS DELIBERATELY UNMAPPED. There are fifteen pictograms and ten
 * categories, and they are not the same taxonomy:
 *
 *  - `XDO` (Multi-domain) and `IND` (Industry and Services) have no pictogram
 *    that means them. Reaching for a near-miss would label a dataflow with the
 *    wrong domain, which is worse than labelling it with none.
 *  - `SDG`, `BP50` and `NMDI` are indicator frameworks, not subject domains. A
 *    Blue Pacific 2050 dataflow is about whatever it measures; giving it a
 *    single icon would assert a subject it does not have.
 *
 * Callers get null and should render no icon rather than a fallback glyph.
 * The guidelines are also explicit that these are "not subject or secondary
 * logos" and should not be used in a way that suggests they are (p21).
 */

/** Category id (scheme-qualified) to pictogram file stem. */
const CATEGORY_ICONS: Record<string, string> = {
  "CAS_COM_TOPIC:ECO": "economy",
  "CAS_COM_TOPIC:ENV": "environment",
  "CAS_COM_TOPIC:HEA": "health",
  "CAS_COM_TOPIC:POP": "population",
  "CAS_COM_TOPIC:SOC": "social",
};

export interface CategoryTag {
  scheme: string;
  id: string;
  name?: string;
}

/** Pictogram path for a category, or null when none honestly applies. */
export function categoryIconPath(tag: CategoryTag): string | null {
  const stem = CATEGORY_ICONS[tag.scheme + ":" + tag.id];
  return stem ? "/brand/icons/icon_" + stem + ".svg" : null;
}

/**
 * The first category of a dataflow that has a pictogram.
 *
 * A dataflow can carry several tags, typically one subject and one framework.
 * Preferring the subject is why this scans rather than taking the first tag.
 */
export function primaryCategoryIcon(
  tags: readonly CategoryTag[] | undefined,
): { tag: CategoryTag; src: string } | null {
  for (const tag of tags ?? []) {
    const src = categoryIconPath(tag);
    if (src) return { tag, src };
  }
  return null;
}

/** Category ids that have no pictogram, exported so tests can pin the choice. */
export const UNMAPPED_CATEGORIES = [
  "CAS_COM_TOPIC:XDO",
  "CAS_COM_TOPIC:IND",
  "CAS_COM_DEV:SDG",
  "CAS_COM_DEV:BP50",
  "CAS_COM_DEV:NMDI",
] as const;
