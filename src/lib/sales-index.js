export const normalizeSearch = value => String(value ?? "").normalize("NFKC").toLowerCase().trim();
export const INDEX_FIELDS = "name sku barcode manufacturer categoryId packageSellingPrice loosePricePerUnit baseUnit packageUnit packageType packageSize looseUnit loosePricingMethod allowPackageSale allowLooseSale allowMixture wholesaleEnabled updatedAt";
export function productRevision(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}
export function indexRow(product) {
  // Exact barcode responses contain full details; project those too before adding a row.
  const metadata = Object.fromEntries(INDEX_FIELDS.split(" ").filter(key => product[key] !== undefined).map(key => [key, product[key]]));
  return { ...metadata, _id: String(product._id), revision: productRevision(product.updatedAt),
    searchName: normalizeSearch(product.name), searchSku: normalizeSearch(product.sku),
    searchText: normalizeSearch([product.name, product.sku, product.barcode, product.manufacturer, product.categoryId?.name].join(" ")) };
}
export function searchIndex(rows, query, { mode = "PRODUCT", filter = "All", membership } = {}) {
  const q = normalizeSearch(query);
  const rank = p => p.barcode === String(query).trim() ? 0 : p.searchSku === q ? 1 : p.searchName.startsWith(q) ? 2 : p.searchName.includes(q) ? 3 : 4;
  const result = rows.filter(p => (!q || p.searchText.includes(q)) &&
    (mode !== "MIX" || p.allowMixture) && (mode === "MIX" || filter === "All" ||
      (filter === "Loose Sale" ? p.allowLooseSale : ["Low Stock", "Opened Stock"].includes(filter) ? membership?.has(p._id) : p.categoryId?.name === filter)));
  return q ? result.sort((a, b) => rank(a) - rank(b)) : result;
}
