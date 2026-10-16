export function csvCell(value) {
  let text = String(value ?? "");
  // Quoting alone does not stop spreadsheets from evaluating formulas.
  // Preserve actual numeric cells, including legitimate negative amounts.
  if (typeof value !== "number" && /^[\s\uFEFF]*[=+\-@]/u.test(text)) text = `'${text}`;
  if (/^[\t\r\n]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
