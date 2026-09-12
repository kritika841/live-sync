/** Return the newest human-written part of an email without quoted thread history. */
export function visibleEmailBody(value: unknown) {
  const text = String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .trim();
  if (!text) return "";
  const boundaries = [
    /^On .+wrote:\s*$/im,
    /^-{2,}\s*Original Message\s*-{2,}\s*$/im,
    /^From:\s.+\nSent:\s.+\nTo:\s/im,
    /^_{5,}\s*$/m,
  ];
  let end = text.length;
  for (const boundary of boundaries) {
    const match = boundary.exec(text);
    if (match && match.index < end) end = match.index;
  }
  return text
    .slice(0, end)
    .split("\n")
    .filter((line) => !/^\s*>/.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
