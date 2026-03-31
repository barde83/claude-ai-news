/**
 * Netlify Function — scrape.js
 *
 * Sources Twitter via le flux RSS de nitter.net (miroir open-source de Twitter/X).
 * Twitter public et x.com bloquent systématiquement le scraping HTML (403/JS rendu côté client).
 * nitter.net/rss est la seule source qui fonctionne sans auth ni navigateur headless.
 *
 * Handles testés et leur statut (2026-03-31) :
 *   - twitter.com / x.com        : bloqué (rendu JS, pas de HTML exploitable)
 *   - nitter.net/rss              : FONCTIONNE — utilisé ici
 *   - nitter.privacydev.net       : ECONNREFUSED
 *   - nitter.poast.org            : 503
 *   - nitter.tiekoetter.com       : bot-protection (Anubis)
 *   - nitter.1d4.us               : ECONNREFUSED
 *   - nitter.catsarch.com         : 403
 *   - xcancel.com                 : 503
 *   - rsshub.app/twitter/user/... : redirige vers 404
 *
 * Note : @daioamodei dans le brief est une coquille — le handle correct est @darioamodei.
 */

import axios from 'axios';
import * as cheerio from 'cheerio';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const TWITTER_HANDLES = ['claudeai', 'darioamodei'];

const NITTER_RSS_BASE = 'https://nitter.net';

const HTTP_CONFIG = {
  timeout: 10_000,
  headers: {
    'User-Agent':
      'Mozilla/5.0 (compatible; claude-ai-news-scraper/1.0; +https://github.com/anthropic)',
    Accept: 'application/rss+xml, application/xml, text/xml, */*',
  },
};

const RETRY_DELAYS_MS = [1000, 2000, 4000]; // backoff exponentiel, 3 tentatives max

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

/**
 * Pause asynchrone.
 * @param {number} ms
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetch avec retry et backoff exponentiel.
 * @param {string} url
 * @param {number} [attempt=0]
 * @returns {Promise<import('axios').AxiosResponse>}
 */
async function fetchWithRetry(url, attempt = 0) {
  try {
    return await axios.get(url, HTTP_CONFIG);
  } catch (error) {
    if (attempt < RETRY_DELAYS_MS.length) {
      const delay = RETRY_DELAYS_MS[attempt];
      console.warn(
        `[scrapeTwitter] Tentative ${attempt + 1} échouée pour ${url} — retry dans ${delay}ms`,
        error.message
      );
      await sleep(delay);
      return fetchWithRetry(url, attempt + 1);
    }
    throw error;
  }
}

/**
 * Tronque une chaîne à maxLen caractères en ajoutant "…" si nécessaire.
 * @param {string} text
 * @param {number} maxLen
 * @returns {string}
 */
function truncate(text, maxLen = 120) {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.slice(0, maxLen - 1) + '…';
}

/**
 * Convertit un lien nitter.net en lien twitter.com canonique.
 * Exemple : https://nitter.net/claudeai/status/123456#m
 *        -> https://twitter.com/claudeai/status/123456
 * @param {string} nitterUrl
 * @param {string} handle
 * @returns {string}
 */
function toTwitterUrl(nitterUrl, handle) {
  // Extrait l'ID numérique depuis le lien nitter ou depuis le guid
  const match = nitterUrl.match(/\/status\/(\d+)/);
  if (match) {
    return `https://twitter.com/${handle}/status/${match[1]}`;
  }
  // Fallback : profil du compte
  return `https://twitter.com/${handle}`;
}

// ---------------------------------------------------------------------------
// Tâches #2 et #3 — scrapeTwitter
// ---------------------------------------------------------------------------

/**
 * Scrape les tweets récents d'un compte Twitter via le flux RSS de nitter.net.
 *
 * @param {string} handle - Nom du compte sans "@" (ex: "claudeai", "darioamodei")
 * @returns {Promise<Array<{id: string, title: string, date: string, tag: null, link: string}>>}
 */
export async function scrapeTwitter(handle) {
  const url = `${NITTER_RSS_BASE}/${handle}/rss`;
  console.log(`[scrapeTwitter] Fetching RSS pour @${handle} : ${url}`);

  let response;
  try {
    response = await fetchWithRetry(url);
  } catch (error) {
    console.error(
      `[scrapeTwitter] Echec définitif pour @${handle} après ${RETRY_DELAYS_MS.length + 1} tentatives :`,
      error.message
    );
    return [];
  }

  const xml = response.data;

  // Cheerio parse le XML RSS (mode xml pour respecter la casse des tags)
  const $ = cheerio.load(xml, { xmlMode: true });

  const items = [];

  $('item').each((_i, el) => {
    try {
      const rawTitle = $(el).find('title').first().text();
      const rawLink = $(el).find('link').first().text();
      const rawGuid = $(el).find('guid').first().text();
      const rawDate = $(el).find('pubDate').first().text();

      if (!rawTitle) return; // ignorer les items sans contenu

      // ID stable : préfixe + handle + guid numérique
      // Le guid nitter est l'ID numérique du tweet
      const tweetId = rawGuid.match(/\d+/)?.[0] ?? Date.now().toString();
      const id = `twitter-${handle}-${tweetId}`;

      const title = truncate(rawTitle);

      // Conversion en ISO 8601
      const date = rawDate ? new Date(rawDate).toISOString() : new Date().toISOString();

      // Lien twitter.com canonique (pas nitter, plus stable pour les utilisateurs)
      const link = toTwitterUrl(rawLink || rawGuid, handle);

      items.push({ id, title, date, tag: null, link });
    } catch (parseError) {
      console.warn(`[scrapeTwitter] Erreur parsing item pour @${handle} :`, parseError.message);
    }
  });

  console.log(`[scrapeTwitter] @${handle} — ${items.length} tweets extraits`);
  return items;
}

// ---------------------------------------------------------------------------
// Tâche #4 — scrapeReleaseNotes (placeholder)
// ---------------------------------------------------------------------------

/**
 * Scrape les release notes Anthropic.
 * @returns {Promise<Array>}
 * TODO: à implémenter (tâche #4)
 */
export async function scrapeReleaseNotes() {
  console.log('[scrapeReleaseNotes] Placeholder — non implémenté');
  return [];
}

// ---------------------------------------------------------------------------
// Tâche #5 — generateTag (placeholder)
// ---------------------------------------------------------------------------

/**
 * Génère un tag catégoriel à partir du titre d'un item.
 * @param {string} _title
 * @returns {string} "Code" | "Cowork" | "Misc"
 * TODO: à implémenter (tâche #5)
 */
export function generateTag(_title) {
  return 'Misc';
}

// ---------------------------------------------------------------------------
// Tâche #7 — writeNews (placeholder)
// ---------------------------------------------------------------------------

/**
 * Persiste le tableau de news dans news.json.
 * @param {Array} _news
 * @returns {Promise<void>}
 * TODO: à implémenter (tâche #7)
 */
export async function writeNews(_news) {
  console.log('[writeNews] Placeholder — non implémenté');
}

// ---------------------------------------------------------------------------
// Tâche #8 — Handler Netlify Function (à faire)
// ---------------------------------------------------------------------------

/**
 * Handler principal Netlify Function.
 * Orchestre les scrapers, génère les tags et persiste les données.
 * TODO: orchestration complète (tâche #8)
 *
 * @param {import('@netlify/functions').HandlerEvent} _req
 * @param {import('@netlify/functions').HandlerContext} _context
 */
export default async (_req, _context) => {
  try {
    console.log('[handler] Démarrage du job de scraping…');

    // Scraping Twitter pour les 2 comptes en parallèle
    const [claudeaiTweets, darioTweets] = await Promise.all(
      TWITTER_HANDLES.map((handle) => scrapeTwitter(handle))
    );

    const allNews = [...claudeaiTweets, ...darioTweets];

    console.log(`[handler] Total items récupérés : ${allNews.length}`);
    console.log('[handler] Aperçu (3 premiers) :', JSON.stringify(allNews.slice(0, 3), null, 2));

    // TODO: appeler scrapeReleaseNotes(), generateTag(), writeNews() (tâches #4, #5, #7, #8)

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Scraping Twitter OK',
        count: allNews.length,
        timestamp: new Date().toISOString(),
        preview: allNews.slice(0, 3),
      }),
    };
  } catch (error) {
    console.error('[handler] Erreur critique :', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
