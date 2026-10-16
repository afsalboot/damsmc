// Keep client-controlled searches literal and database limits finite integers.
export function boundedInteger(value, fallback, min, max) {
  const number = Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

export function searchText(value, maxLength = 100) {
  const text = String(value ?? "").trim();
  if (text.length > maxLength) throw Object.assign(new Error(`Search cannot exceed ${maxLength} characters`), { status: 400 });
  return text;
}

export function literalPattern(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
