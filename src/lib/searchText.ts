/**
 * Case- and accent-insensitive name matching for in-app list search, so
 * "penelope" finds "Penélope Cruz" and "nyongo" finds "Lupita Nyong'o".
 */

// Letters that canonical decomposition (NFD) doesn't split into a base letter
// plus a combining mark.
const SPECIAL_LETTERS: Record<string, string> = {
  ø: 'o',
  æ: 'ae',
  œ: 'oe',
  ß: 'ss',
  ł: 'l',
  đ: 'd',
  ð: 'd',
  þ: 'th',
  ı: 'i',
};
const SPECIAL_LETTER_RE = /[øæœßłđðþı]/g;
const COMBINING_MARKS_RE = /[\u0300-\u036f]/g;
// Joiners inside a name ("Nyong'o", "Jr.", "Coster-Waldau") are dropped rather
// than treated as word breaks, so "costerwaldau" and "coster waldau" both match.
const JOINERS_RE = /['’‘ʼ`.,\-‐‑–]/g;
const WHITESPACE_RE = /\s+/g;

function stripMarks(text: string): string {
  try {
    return text.normalize('NFD').replace(COMBINING_MARKS_RE, '');
  } catch {
    return text;
  }
}

/** Lowercased, accent-free, punctuation-light form of `text` for matching. */
export function foldForSearch(text: string): string {
  return stripMarks(text.toLowerCase())
    .replace(SPECIAL_LETTER_RE, (ch) => SPECIAL_LETTERS[ch] ?? ch)
    .replace(JOINERS_RE, '')
    .replace(WHITESPACE_RE, ' ')
    .trim();
}

/** The folded words of a search query (empty when there's nothing to match). */
export function queryWords(query: string): string[] {
  const folded = foldForSearch(query);
  return folded ? folded.split(' ') : [];
}

/** True when every query word appears somewhere in the folded text, in any order. */
export function matchesAllWords(foldedText: string, words: readonly string[]): boolean {
  return words.every((w) => foldedText.includes(w));
}
