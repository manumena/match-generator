// Reviewed identities for IDs already published in the autocomplete catalog.
// Keep these compatible with pinned catalogs and stored room song sequences;
// matching titles alone would also accept unrelated releases and remakes.
const answerRedirects: Readonly<Partial<Record<number, number>>> = {
  // MAL 210 (ID 51) covers all 161 episodes of the original Ranma series.
  // AniList splits the same series into 18 episodes (210 / ID 714) and
  // 143 episodes (149939 / ID 520). The 2024 remake remains a separate answer.
  714: 51,
  520: 51,
};

export function canonicalAnswerId(animeId: number): number {
  return answerRedirects[animeId] ?? animeId;
}
