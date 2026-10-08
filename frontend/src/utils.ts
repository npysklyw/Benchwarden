export const navigate = (path: string) => {
  window.location.hash = path;
};
export const link = (path: string) => `#${path}`;
export const short = (id: string) => id.slice(0, 8);
export const label = (text: string) => text.replaceAll("_", " ");
export const value = (item: unknown) => {
  if (item === null || item === undefined) return "Unavailable";
  const numeric =
    typeof item === "number" ||
    (typeof item === "string" && /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(item));
  if (numeric && Number.isFinite(Number(item))) {
    return Number(item).toLocaleString("en", { maximumSignificantDigits: 6 });
  }
  return String(item);
};
export const percent = (item: number | null) =>
  item === null ? "Unavailable" : `${(item * 100).toFixed(1)}%`;
