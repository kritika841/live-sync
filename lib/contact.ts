/** Accept complete international/local numbers; never display masked digits as dialable. */
export function completePhone(...values: unknown[]): string {
  return values.map(value => String(value ?? "").trim()).find(value => /^[+\d\s().-]+$/.test(value) && value.replace(/\D/g, "").length >= 7 && value.replace(/\D/g, "").length <= 15) || "";
}
