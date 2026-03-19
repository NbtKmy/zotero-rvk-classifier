export function getExtraField(item: { getField(f: string): string }, key: string): string | null {
  const extra = item.getField("extra") || "";
  const match = extra.match(new RegExp(`^${escapeRegex(key)}:\\s*(.+)$`, "m"));
  return match ? match[1].trim() : null;
}

export function setExtraField(
  item: { getField(f: string): string; setField(f: string, v: string): void },
  key: string,
  value: string
): void {
  let extra = item.getField("extra") || "";
  const line = `${key}: ${value}`;
  const regex = new RegExp(`^${escapeRegex(key)}:.*$`, "m");
  extra = regex.test(extra)
    ? extra.replace(regex, line)
    : extra
    ? `${extra}\n${line}`
    : line;
  item.setField("extra", extra);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
