/**
 * Strip Space prefix from a channelID component.
 * "sd7d36a_uid" → "uid", "uid" → "uid"
 */
export function stripSpacePrefix(s: string): string {
  if (s.startsWith("s")) {
    const idx = s.indexOf("_");
    if (idx > 0) return s.substring(idx + 1);
  }
  return s;
}
