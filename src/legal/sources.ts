// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Official sources the course may cite, and an offline check that a link
 * points at one of them.
 *
 * Every EUR-Lex link in the course must use the form
 * `https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:<celex>#<anchor>`
 * with a CELEX number listed here and an anchor that exists in that
 * document on EUR-Lex. The anchor lists were taken from the EUR-Lex HTML of
 * each document on 8 November 2026.
 *
 * @packageDocumentation
 */

/** A legal act on EUR-Lex the course may cite. */
export interface LegalAct {
  /** Short key used in this code base. */
  readonly key: string;
  /** CELEX number, including the consolidation date for consolidated texts. */
  readonly celex: string;
  /** Human-readable title. */
  readonly title: string;
  /** Highest article number with an `art_<n>` anchor. */
  readonly articles: number;
  /** Article anchors with letter suffixes (for example `4a`). */
  readonly extraArticles: readonly string[];
  /** Highest recital number with an `rct_<n>` anchor (0: none). */
  readonly recitals: number;
  /** Annex anchors (Roman numerals). */
  readonly annexes: readonly string[];
}

const ROMAN_I_TO_XIV = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV'] as const;

/** Acts the course cites. */
export const LEGAL_ACTS: readonly LegalAct[] = [
  {
    key: 'ai-act',
    celex: '32024R1689',
    title: 'Regulation (EU) 2024/1689 (Artificial Intelligence Act), as published in the Official Journal',
    articles: 113,
    extraArticles: [],
    recitals: 180,
    annexes: ROMAN_I_TO_XIV.slice(0, 13),
  },
  {
    key: 'ai-act-consolidated',
    celex: '02024R1689-20260727',
    title: 'Regulation (EU) 2024/1689, consolidated text of 27 July 2026 (includes Regulation (EU) 2026/1744)',
    articles: 113,
    extraArticles: ['4a', '60a', '75a', '75b', '75c', '75d'],
    recitals: 0,
    annexes: ROMAN_I_TO_XIV,
  },
  {
    key: 'ai-omnibus',
    celex: '32026R1744',
    title: 'Regulation (EU) 2026/1744 (Digital Omnibus on AI)',
    articles: 4,
    extraArticles: [],
    recitals: 47,
    annexes: [],
  },
  {
    key: 'gdpr',
    celex: '32016R0679',
    title: 'Regulation (EU) 2016/679 (General Data Protection Regulation)',
    articles: 99,
    extraArticles: [],
    recitals: 173,
    annexes: [],
  },
];

/**
 * Official non-EUR-Lex pages the course may link to. Exact URLs only. These
 * are Commission guidance pages: helpful, but not legally binding.
 */
export const OFFICIAL_PAGES: ReadonlyMap<string, string> = new Map([
  ['https://digital-strategy.ec.europa.eu/en/faqs/ai-literacy-questions-answers', 'European Commission, AI Literacy - Questions & Answers'],
  [
    'https://digital-strategy.ec.europa.eu/en/library/living-repository-foster-learning-and-exchange-ai-literacy',
    'European Commission, Living repository to foster learning and exchange on AI literacy',
  ],
]);

const EURLEX_PREFIX = 'https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:';

/** Result of checking a citation URL. */
export type CitationCheck =
  | { readonly ok: true; readonly kind: 'eur-lex'; readonly act: LegalAct; readonly anchor: string }
  | { readonly ok: true; readonly kind: 'official-page'; readonly title: string }
  | { readonly ok: false; readonly reason: string };

function anchorExists(act: LegalAct, anchor: string): boolean {
  const article = /^art_([1-9][0-9]{0,2}[a-z]?)$/.exec(anchor);
  if (article) {
    const id = article[1] ?? '';
    if (/^[0-9]+$/.test(id)) return Number(id) <= act.articles;
    return act.extraArticles.includes(id);
  }
  const recital = /^rct_([1-9][0-9]{0,2})$/.exec(anchor);
  if (recital) return Number(recital[1]) <= act.recitals;
  const annex = /^anx_([IVX]+)$/.exec(anchor);
  if (annex) return act.annexes.includes(annex[1] ?? '');
  return false;
}

/**
 * Checks that `url` is a citation the course allows: an EUR-Lex link to a
 * listed act with an existing anchor, or an exact listed official page.
 *
 * @example
 * ```ts
 * checkCitation('https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_4').ok; // true
 * ```
 */
export function checkCitation(url: string): CitationCheck {
  const page = OFFICIAL_PAGES.get(url);
  if (page !== undefined) return { ok: true, kind: 'official-page', title: page };
  if (!url.startsWith(EURLEX_PREFIX)) return { ok: false, reason: 'not an EUR-Lex link in the expected form or a listed official page' };
  const rest = url.slice(EURLEX_PREFIX.length);
  const hash = rest.indexOf('#');
  if (hash < 0) return { ok: false, reason: 'EUR-Lex link without an article, recital or annex anchor' };
  const celex = rest.slice(0, hash);
  const anchor = rest.slice(hash + 1);
  const act = LEGAL_ACTS.find((a) => a.celex === celex);
  if (!act) return { ok: false, reason: `CELEX ${celex} is not a listed act` };
  if (!anchorExists(act, anchor)) return { ok: false, reason: `anchor #${anchor} does not exist in CELEX ${celex}` };
  return { ok: true, kind: 'eur-lex', act, anchor };
}

/** Builds an EUR-Lex link for a listed act and anchor; throws if invalid. */
export function eurLexUrl(actKey: string, anchor: string): string {
  const act = LEGAL_ACTS.find((a) => a.key === actKey);
  if (!act) throw new Error(`Unknown act ${actKey}`);
  const url = `${EURLEX_PREFIX}${act.celex}#${anchor}`;
  if (!checkCitation(url).ok) throw new Error(`Invalid anchor ${anchor} for ${actKey}`);
  return url;
}
