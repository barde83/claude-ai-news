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
import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const TWITTER_HANDLES = ['claudeai', 'darioamodei'];

const NITTER_RSS_BASE = 'https://nitter.net';

const HTTP_CONFIG = {
  timeout: 5_000, // Réduit de 10s à 5s pour fail faster
  headers: {
    'User-Agent':
      'Mozilla/5.0 (compatible; claude-ai-news-scraper/1.0; +https://github.com/anthropic)',
    Accept: 'application/rss+xml, application/xml, text/xml, */*',
  },
};

const RETRY_DELAYS_MS = [500]; // Une seule tentative après 500ms (vs 3 tentatives avant)

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
// Tâche #4 — scrapeReleaseNotes
// ---------------------------------------------------------------------------

/**
 * URL de la page de release notes Anthropic (Zendesk / Intercom Help Center).
 */
const RELEASE_NOTES_URL =
  'https://support.claude.com/en/articles/12138966-release-notes';

/**
 * Nombre maximum d'entrées retournées.
 */
const MAX_RELEASE_ENTRIES = 10;

/**
 * Scrape les release notes Anthropic depuis la page support.claude.com.
 *
 * Structure HTML attendue (Intercom Help Center, vérifié 2026-03-31) :
 *   <h2 id="h_xxx">Month YYYY</h2>        — en-tête de mois (ignoré)
 *   <h3 id="h_yyy">Month DD, YYYY</h3>     — date de chaque release
 *   <div class="intercom-interblocks-paragraph …">
 *     <p><b>Feature title</b></p>           — titre (premier <p><b> après le h3)
 *   </div>
 *   <div class="intercom-interblocks-paragraph …">
 *     <p>Description text…</p>              — description
 *   </div>
 *
 * Si la structure change, la fonction log un warning et retourne [].
 *
 * @returns {Promise<Array<{id: string, title: string, date: string, tag: null, link: string}>>}
 */
export async function scrapeReleaseNotes() {
  console.log(`[scrapeReleaseNotes] Fetching ${RELEASE_NOTES_URL}`);

  let response;
  try {
    response = await fetchWithRetry(RELEASE_NOTES_URL);
  } catch (error) {
    console.error(
      `[scrapeReleaseNotes] Echec définitif après ${RETRY_DELAYS_MS.length + 1} tentatives :`,
      error.message
    );
    return [];
  }

  const html = response.data;
  const $ = cheerio.load(html);

  // Sélectionne tous les <h3> avec un id commençant par "h_" — ce sont les entrées de release
  const h3Elements = $('h3[id^="h_"]');

  if (h3Elements.length === 0) {
    console.warn(
      '[scrapeReleaseNotes] Aucun <h3 id="h_…"> trouvé — la structure HTML a peut-être changé'
    );
    return [];
  }

  const entries = [];

  h3Elements.each((_i, h3) => {
    if (entries.length >= MAX_RELEASE_ENTRIES) return false; // stop à 10

    try {
      const $h3 = $(h3);
      const anchorId = $h3.attr('id');
      const rawDate = $h3.text().trim();

      // Valide que le texte du h3 ressemble à une date (ex: "March 25, 2026")
      const parsedDate = new Date(rawDate);
      if (Number.isNaN(parsedDate.getTime())) return; // pas une date, on skip

      // Cherche le titre : premier <b> dans un <p> après ce h3.
      // On parcourt les siblings suivants (dans le DOM Intercom, les divs suivent le h3).
      let title = '';
      let description = '';
      let sibling = $h3.parent().next();

      // Parcours des blocs paragraphes après le h3
      while (sibling.length && !sibling.find('h2, h3').length) {
        const pBold = sibling.find('p > b').first();
        const pText = sibling.find('p').first();

        if (!title && pBold.length) {
          // Premier paragraphe avec du gras = titre
          title = pBold.text().trim();
        } else if (title && !description && pText.length) {
          // Deuxième paragraphe avec du texte non-vide = description
          const text = pText.text().trim();
          if (text && text !== '\u00a0') {
            description = text;
          }
        }

        if (title && description) break;
        sibling = sibling.next();
      }

      if (!title) return; // entrée sans titre, on skip

      // Slug basé sur la date ISO pour un ID stable
      const dateIso = parsedDate.toISOString();
      const dateSlug = dateIso.slice(0, 10); // "2026-03-25"
      const titleSlug = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
        .slice(0, 40);
      const id = `release-${dateSlug}-${titleSlug}`;

      const link = `${RELEASE_NOTES_URL}#${anchorId}`;

      entries.push({
        id,
        title: truncate(title),
        date: dateIso,
        tag: null,
        link,
      });
    } catch (parseError) {
      console.warn(
        '[scrapeReleaseNotes] Erreur parsing entrée :',
        parseError.message
      );
    }
  });

  console.log(
    `[scrapeReleaseNotes] ${entries.length} entrées extraites (sur ${h3Elements.length} h3 trouvés)`
  );
  return entries;
}

// ---------------------------------------------------------------------------
// Tâche #5 — generateTag (placeholder)
// ---------------------------------------------------------------------------

/**
 * Génère un tag catégoriel à partir du titre d'un item.
 * Détection simple basée sur mots-clés.
 *
 * @param {string} title
 * @returns {string} "Release" | "Code" | "Misc"
 */
export function generateTag(title) {
  if (!title) return 'Misc';

  const lowerTitle = title.toLowerCase();

  // Mots-clés pour "Release"
  if (/release|version|update|improved/i.test(lowerTitle)) {
    return 'Release';
  }

  // Mots-clés pour "Code"
  if (/api|function|model/i.test(lowerTitle)) {
    return 'Code';
  }

  // Défaut
  return 'Misc';
}

// ---------------------------------------------------------------------------
// Tâche #6b — Cache pour tweets (fallback quand Nitter down)
// ---------------------------------------------------------------------------

/**
 * Sauvegarde les tweets scrappés dans un cache local (public/tweets.json).
 * Utilisé en fallback si Nitter est down.
 *
 * @param {Array<{id, title, date, link}>} tweets
 * @returns {Promise<void>}
 */
export async function saveTweetsCache(tweets) {
  try {
    const publicDir = process.env.PUBLISH_DIR || path.join(process.cwd(), 'public');
    const cacheFile = path.join(publicDir, 'tweets.json');

    const cachePayload = {
      timestamp: new Date().toISOString(),
      status: 'fresh', // 'fresh' ou 'cached'
      tweets,
      note: 'Cache des tweets — mis à jour quand Nitter répond',
    };

    fs.writeFileSync(cacheFile, JSON.stringify(cachePayload, null, 2), 'utf8');
    console.log(`[saveTweetsCache] Cache tweets sauvegardé (${tweets.length} items)`);
  } catch (error) {
    console.warn('[saveTweetsCache] Erreur sauvegarde cache :', error.message);
    // Failsoft — on continue
  }
}

/**
 * Charge le cache tweets si disponible (fallback si Nitter down).
 *
 * @returns {Promise<Array>}
 */
export async function loadTweetsCache() {
  try {
    const publicDir = process.env.PUBLISH_DIR || path.join(process.cwd(), 'public');
    const cacheFile = path.join(publicDir, 'tweets.json');

    if (!fs.existsSync(cacheFile)) {
      console.log('[loadTweetsCache] Pas de cache disponible');
      return [];
    }

    const data = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    const tweets = data.tweets || [];
    console.log(`[loadTweetsCache] ${tweets.length} tweets chargés du cache`);
    return tweets;
  } catch (error) {
    console.warn('[loadTweetsCache] Erreur chargement cache :', error.message);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Tâche #7 — writeNews (placeholder)
// ---------------------------------------------------------------------------

/**
 * Persiste le tableau de news dans public/news.json.
 * Format : { timestamp: ISO8601, news: [...] }
 *
 * @param {Array<{id, title, date, tag, link}>} news
 * @returns {Promise<void>}
 */
export async function writeNews(news) {
  try {
    // Détermine le chemin du fichier output.
    // En local : ../public/news.json (relative au dossier functions/)
    // En Netlify : process.env.PUBLISH_DIR pointe au répertoire public
    const publicDir = process.env.PUBLISH_DIR || path.join(process.cwd(), 'public');
    const outputPath = path.join(publicDir, 'news.json');

    const payload = {
      timestamp: new Date().toISOString(),
      news,
    };

    fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2), 'utf8');
    console.log(`[writeNews] Données persistées dans ${outputPath} (${news.length} items)`);
  } catch (error) {
    console.error('[writeNews] Erreur lors de la sauvegarde :', error.message);
    // failsoft — on continue sans lever l'erreur
  }
}

// ---------------------------------------------------------------------------
// Tâche #8 — Handler Netlify Function (à faire)
// ---------------------------------------------------------------------------

/**
 * Handler principal Netlify Function.
 * Orchestre les scrapers, génère les tags et persiste les données.
 *
 * Flux :
 * 1. Scraper Twitter (2 comptes en parallèle)
 * 2. Scraper Release Notes
 * 3. Merger + trier par date (récent en premier)
 * 4. Appliquer generateTag à chaque item
 * 5. Persister dans news.json
 * 6. Retourner response avec count + timestamp
 *
 * @param {import('@netlify/functions').HandlerEvent} _req
 * @param {import('@netlify/functions').HandlerContext} _context
 */
export default async (_req, _context) => {
  try {
    console.log('[handler] Démarrage du job de scraping…');

    // 1. Scraping Twitter pour les 2 comptes en parallèle avec timeout global
    // Promise.race avec timeout pour éviter que tout bloque
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Scraping timeout')), 8000)
    );

    let claudeaiTweets, darioTweets, releaseNotesNews;
    let isUsingCache = false;

    try {
      [claudeaiTweets, darioTweets, releaseNotesNews] = await Promise.race([
        Promise.all([
          scrapeTwitter('claudeai'),
          scrapeTwitter('darioamodei'),
          scrapeReleaseNotes(),
        ]),
        timeoutPromise,
      ]);
    } catch (error) {
      console.warn('[handler] Scraping timeout ou erreur:', error.message);
      // Fallback: charger le cache tweets, vider Release Notes en attente de retry
      const cachedTweets = await loadTweetsCache();
      claudeaiTweets = []; // Impossible de différencier, donc vide
      darioTweets = [];
      releaseNotesNews = [];
      // Merger le cache tweets ancien s'il existe
      if (cachedTweets.length > 0) {
        console.log('[handler] Utilisant cache tweets en fallback');
        isUsingCache = true;
        // Les tweets du cache sont mélangés dans allNews plus bas
        claudeaiTweets = cachedTweets; // Simplification: tous dans claudeai
      }
    }

    console.log(`[handler] Twitter @claudeai: ${claudeaiTweets.length} tweets ${isUsingCache ? '(CACHE)' : '(fresh)'}`);
    console.log(`[handler] Twitter @darioamodei: ${darioTweets.length} tweets`);
    console.log(`[handler] Release Notes: ${releaseNotesNews.length} entrées`);

    // 2. Merger tous les items
    let allNews = [...claudeaiTweets, ...darioTweets, ...releaseNotesNews];

    // 3. Trier par date (plus récent d'abord)
    allNews.sort((a, b) => new Date(b.date) - new Date(a.date));

    // 4. Appliquer generateTag à chaque item
    allNews = allNews.map((item) => ({
      ...item,
      tag: generateTag(item.title),
    }));

    console.log(`[handler] Total items après fusion : ${allNews.length}`);
    console.log('[handler] Aperçu (3 premiers) :', JSON.stringify(allNews.slice(0, 3), null, 2));

    // 5. Persister les données (failsoft — writeFileSync() peut ne pas marcher en Netlify)
    await writeNews(allNews);

    // 5b. Sauvegarder le cache tweets si on a des tweets frais (pas du cache)
    if (!isUsingCache && claudeaiTweets.length > 0) {
      const allTweets = [...claudeaiTweets, ...darioTweets];
      await saveTweetsCache(allTweets);
    }

    // 6. Retourner Response avec données COMPLÈTES (Netlify Functions v2 expects Response object)
    const responseData = {
      message: isUsingCache ? 'Scraping partial (usando cache)' : 'Scraping complet',
      status: isUsingCache ? 'degraded' : 'ok',
      count: allNews.length,
      timestamp: new Date().toISOString(),
      sources: {
        twitter_claudeai: claudeaiTweets.length,
        twitter_darioamodei: darioTweets.length,
        release_notes: releaseNotesNews.length,
      },
      // 🔑 Données complètes retournées (pas juste preview)
      news: allNews,
    };

    return new Response(JSON.stringify(responseData), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[handler] Erreur critique :', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
