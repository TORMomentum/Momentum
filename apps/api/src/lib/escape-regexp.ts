/** Text as a literal pattern: nothing a user typed is read as regex syntax. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
