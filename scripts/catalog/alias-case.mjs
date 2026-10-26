/** Keep the spelling that the existing exporter would encounter first. */
export function uniqueCaseAliases(title, aliases) {
  const seen = new Set([title.toLowerCase()]);
  return [...new Set(aliases)].sort().filter((alias) => {
    const key = alias.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Deduplicate within each original anime ID, never between unrelated answers. */
export function planAliasCaseDuplicates(aliases) {
  // Use JavaScript ordering/lowercasing, matching the browser and exporter.
  // Do not fold accents, punctuation or whitespace as part of this cleanup.
  const ordered = [...aliases].sort(
    (left, right) =>
      left.anime_id - right.anime_id ||
      (left.alias < right.alias ? -1 : left.alias > right.alias ? 1 : 0),
  );
  const retained = new Map();
  const excluded = [];
  for (const row of ordered) {
    const key = JSON.stringify([row.anime_id, row.alias.toLowerCase()]);
    const first = retained.get(key);
    if (first) {
      excluded.push({
        ...row,
        languages: [],
        reason: `capitalization-duplicate; retained spelling: ${first.alias}`,
      });
    } else retained.set(key, row);
  }
  return { excluded, retainedAliasRows: retained.size };
}
