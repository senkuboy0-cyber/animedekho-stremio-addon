const { addonBuilder, getRouter } = require("stremio-addon-sdk");
const express = require("express");
const cors = require("cors");
const cheerio = require("cheerio");
const { client, DEFAULT_UA, invokeExtractor } = require("./extractors");

const MAIN_URL = "https://animedekho.tv";
const ID_PREFIX = "animedekho:";

const TMDB_API = "https://api.themoviedb.org/3";
const TMDB_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
const TMDB_IMG = "https://image.tmdb.org/t/p/original";

const CATALOG_MAP = {
  "animedekho-series": { type: "series", mode: "series", path: "/series-hindi/" },
  "animedekho-movies": { type: "movie", mode: "movie", path: "/movie-hindi/" },
  "animedekho-anime": { type: "series", mode: "category", term: "anime" },
  "animedekho-cartoon": { type: "series", mode: "category", term: "cartoon" },
};

const manifest = {
  id: "com.senkuboy.animedekho",
  version: "1.1.0",
  name: "Toonify Stream",
  description:
    "Watch Hindi, Tamil, Telugu Dubbed Anime, Cartoons, Series & Movies from AnimeDekho",
  logo: "https://raw.githubusercontent.com/senkuboy0-cyber/Anime-Dekho/main/Icons/animedekho.png",
  types: ["series", "movie"],
  idPrefixes: [ID_PREFIX],
  resources: ["catalog", "meta", "stream"],
  catalogs: [
    {
      type: "series",
      id: "animedekho-series",
      name: "Toonify - Series",
      extra: [
        { name: "search", isRequired: false },
        { name: "skip", isRequired: false },
      ],
    },
    {
      type: "movie",
      id: "animedekho-movies",
      name: "Toonify - Movies",
      extra: [
        { name: "search", isRequired: false },
        { name: "skip", isRequired: false },
      ],
    },
    {
      type: "series",
      id: "animedekho-anime",
      name: "Toonify - Anime",
      extra: [{ name: "skip", isRequired: false }],
    },
    {
      type: "series",
      id: "animedekho-cartoon",
      name: "Toonify - Cartoon",
      extra: [{ name: "skip", isRequired: false }],
    },
  ],
};

function fixUrl(url) {
  if (!url) return "";
  const trimmed = String(url).trim();
  if (!trimmed || trimmed.startsWith("data:image")) return "";
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  if (trimmed.startsWith("/")) return `${MAIN_URL}${trimmed}`;
  return trimmed;
}

function encodeId(payload) {
  return (
    ID_PREFIX + Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")
  );
}

function decodeId(stremioId) {
  const raw = stremioId.replace(ID_PREFIX, "");
  return JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
}

function cleanTitle(raw) {
  if (!raw) return "";
  return raw
    .replace(/^Watch Online\s+/i, "")
    .replace(/\s+Anime\s*$/i, "")
    .replace(/\s*Movie\s*\(.*Dubbed.*\).*$/i, "")
    .split(" Movie in Hindi")[0]
    .split(" Series in Hindi")[0]
    .split(" in Hindi")[0]
    .split(" Hindi Dubbed")[0]
    .split(" | AnimeDekho")[0]
    .split("| AnimeDekho")[0]
    .replace(/^AnimeDekho\s*[-–]\s*/i, "")
    .trim();
}

async function fetchTmdbDetails($, title, isSeries) {
  try {
    const mediaType = isSeries ? "tv" : "movie";
    const imdbHref = $("a[href*='imdb.com/title']").attr("href") || "";
    const imdbId = imdbHref.split("title/")[1]?.split("/")[0] || "";

    let tmdbId = null;
    if (imdbId.startsWith("tt")) {
      const findRes = await client.get(
        `${TMDB_API}/find/${imdbId}?api_key=${TMDB_KEY}&external_source=imdb_id`
      );
      const list = isSeries
        ? findRes.data?.tv_results
        : findRes.data?.movie_results;
      tmdbId = list?.[0]?.id || null;
    } else if (title) {
      const searchRes = await client.get(
        `${TMDB_API}/search/${mediaType}?api_key=${TMDB_KEY}&query=${encodeURIComponent(
          title
        )}`
      );
      tmdbId = searchRes.data?.results?.[0]?.id || null;
    }

    if (!tmdbId) return { logo: null, backdrop: null };

    const imgRes = await client.get(
      `${TMDB_API}/${mediaType}/${tmdbId}/images?api_key=${TMDB_KEY}&include_image_language=en,null`
    );
    const logos = (imgRes.data?.logos || []).filter(
      (l) => !String(l.file_path || "").toLowerCase().endsWith(".svg")
    );
    const backdrops = imgRes.data?.backdrops || [];

    const bestLogo =
      logos.find((l) => l.iso_639_1 === "en") || logos[0] || null;
    const bestBackdrop = backdrops[0] || null;

    return {
      logo: bestLogo?.file_path ? `${TMDB_IMG}${bestLogo.file_path}` : null,
      backdrop: bestBackdrop?.file_path
        ? `${TMDB_IMG}${bestBackdrop.file_path}`
        : null,
    };
  } catch {
    return { logo: null, backdrop: null };
  }
}

function parseArticle($, el, catalogType = "series") {
  const $el = $(el);
  const rawHref =
    $el.find("a.lnk-blk").attr("href") || $el.find("a").first().attr("href");
  const href = fixUrl(rawHref);
  if (!href) return null;

  const $img = $el.find("div figure img, figure img, img").first();
  const poster =
    fixUrl($img.attr("data-lazy-src")) ||
    fixUrl($img.attr("data-src")) ||
    fixUrl($img.attr("src"));

  const imgAlt = ($img.attr("alt") || "").trim();
  const h2Text = ($el.find("header h2, h2.entry-title, h2").text() || "").trim();

  let title = "";
  if (imgAlt && imgAlt.length > 2 && !imgAlt.toLowerCase().includes("anime")) {
    title = imgAlt;
  } else if (
    h2Text &&
    h2Text.length > 2 &&
    !h2Text.toLowerCase().includes("animedekho")
  ) {
    title = h2Text;
  } else {
    const slug = href.replace(/\/+$/, "").split("/").pop() || "Unknown";
    title = slug.replace(/-/g, " ");
    title = title.charAt(0).toUpperCase() + title.slice(1);
  }

  return {
    id: encodeId({ url: href, poster, type: catalogType }),
    type: catalogType,
    name: cleanTitle(title) || title,
    poster: poster || undefined,
  };
}

const builder = new addonBuilder(manifest);

builder.defineCatalogHandler(async ({ type, id, extra }) => {
  try {
    if (extra && extra.search) {
      const searchUrl = `${MAIN_URL}/?s=${encodeURIComponent(extra.search)}`;
      const res = await client.get(searchUrl, {
        headers: { Referer: MAIN_URL },
      });
      const $ = cheerio.load(res.data);
      const metas = [];
      let elements = $("ul[data-results] li article");
      if (elements.length === 0) elements = $("article");

      elements.each((_, el) => {
        const item = parseArticle($, el, type);
        if (item) metas.push(item);
      });
      return { metas };
    }

    const cat = CATALOG_MAP[id];
    if (!cat) return { metas: [] };

    const skip = parseInt(extra?.skip || "0", 10);
    const page = Math.floor(skip / 20) + 1;

    if (cat.mode === "category") {
      const basePageUrl = `${MAIN_URL}/category/${cat.term}/`;
      const pagedUrl = page === 1 ? basePageUrl : `${basePageUrl}page/${page}/`;
      const res = await client.get(pagedUrl, { headers: { Referer: MAIN_URL } });
      const $ = cheerio.load(res.data);
      const metas = [];
      $("article").each((_, el) => {
        const item = parseArticle($, el, type);
        if (item) metas.push(item);
      });
      return { metas };
    }

    const pageUrl = `${MAIN_URL}${cat.path}`;
    if (page === 1) {
      const res = await client.get(pageUrl, { headers: { Referer: MAIN_URL } });
      const $ = cheerio.load(res.data);
      const metas = [];
      $("article").each((_, el) => {
        const item = parseArticle($, el, type);
        if (item) metas.push(item);
      });
      return { metas };
    }

    const pageRes = await client.get(pageUrl, { headers: { Referer: MAIN_URL } });
    const pageHtml = pageRes.data;
    const $page = cheerio.load(pageHtml);
    const nonce = /"nonce"\s*:\s*"([^"]+)"/.exec(pageHtml)?.[1] || "";
    const filterEl = $page("[data-taxonomy]").first();
    const taxonomy = filterEl.attr("data-taxonomy") || "none";
    const termVal = filterEl.attr("data-term") || "none";
    const searchVal = filterEl.attr("data-search") || "none";
    const typeVal = filterEl.attr("data-type") || "none";

    const vars = JSON.stringify({
      _wpsearch: nonce,
      taxonomy,
      search: searchVal,
      term: termVal,
      type: typeVal,
      genres: [],
      years: [],
      sort: 1,
      page,
    });

    const form = new URLSearchParams({
      action: "action_search",
      vars,
    });

    const ajaxRes = await client.post(
      `${MAIN_URL}/wp-admin/admin-ajax.php`,
      form.toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-WP-Nonce": nonce,
          "X-Requested-With": "XMLHttpRequest",
          Referer: pageUrl,
        },
      }
    );

    const ajaxJson =
      typeof ajaxRes.data === "string" ? JSON.parse(ajaxRes.data) : ajaxRes.data;
    const $ajax = cheerio.load(ajaxJson?.html || "");
    const metas = [];
    $ajax("article").each((_, el) => {
      const item = parseArticle($ajax, el, type);
      if (item) metas.push(item);
    });
    return { metas };
  } catch (err) {
    console.error("Catalog error:", err.message);
    return { metas: [] };
  }
});

builder.defineMetaHandler(async ({ type, id }) => {
  try {
    const media = decodeId(id);
    const res = await client.get(media.url, {
      headers: {
        Referer: MAIN_URL,
        "User-Agent": DEFAULT_UA,
      },
    });
    const $ = cheerio.load(res.data);

    const rawTitle =
      cleanTitle($("h1.entry-title").text()) ||
      cleanTitle($('meta[property="og:title"]').attr("content")) ||
      cleanTitle($("title").text()) ||
      "Unknown Title";

    const $thumb = $("div.post-thumbnail figure img").first();
    const poster =
      fixUrl($thumb.attr("data-lazy-src")) ||
      fixUrl($thumb.attr("data-src")) ||
      fixUrl($thumb.attr("src")) ||
      media.poster ||
      "";

    const description =
      $("div.entry-content p").first().text().trim() ||
      $('meta[name="twitter:description"]').attr("content") ||
      "";

    const yearText =
      $("span.year").text().trim() ||
      ($('meta[property="og:updated_time"]').attr("content") || "").split("-")[0];

    const episodeEls = $("ul.seasons-lst li");
    const isSeries = episodeEls.length > 0;

    const tmdb = await fetchTmdbDetails($, rawTitle, isSeries);

    if (!isSeries) {
      if (type === "series") {
        return {
          meta: {
            id,
            type: "series",
            name: rawTitle,
            poster,
            background: tmdb.backdrop || poster,
            logo: tmdb.logo || undefined,
            description,
            releaseInfo: yearText || undefined,
            videos: [
              {
                id: encodeId({ url: media.url, mediaType: 1 }),
                title: rawTitle,
                season: 1,
                episode: 1,
                thumbnail: poster || undefined,
              },
            ],
          },
        };
      }

      return {
        meta: {
          id,
          type: "movie",
          name: rawTitle,
          poster,
          background: tmdb.backdrop || poster,
          logo: tmdb.logo || undefined,
          description,
          releaseInfo: yearText || undefined,
        },
      };
    }

    const videos = [];
    const seasonCounters = {};

    episodeEls.each((idx, el) => {
      const $li = $(el);
      const href = fixUrl($li.find("a").attr("href"));
      if (!href) return;

      const epTitle =
        $li.find("h3.title").clone().children().remove().end().text().trim() ||
        `Episode ${idx + 1}`;
      const spanText = $li.find("h3.title > span").text().trim();
      const seasonMatch = /S(\d+)/i.exec(spanText);
      const season = seasonMatch ? parseInt(seasonMatch[1], 10) : 1;

      seasonCounters[season] = (seasonCounters[season] || 0) + 1;
      const episode = seasonCounters[season];

      const $epImg = $li.find("figure img").first();
      const thumb =
        fixUrl($epImg.attr("data-lazy-src")) ||
        fixUrl($epImg.attr("data-src")) ||
        fixUrl($epImg.attr("src")) ||
        poster;

      videos.push({
        id: encodeId({ url: href, mediaType: 2 }),
        title: epTitle,
        season,
        episode,
        thumbnail: thumb || undefined,
      });
    });

    return {
      meta: {
        id,
        type: type || "series",
        name: rawTitle,
        poster,
        background: tmdb.backdrop || poster,
        logo: tmdb.logo || undefined,
        description,
        releaseInfo: yearText || undefined,
        videos,
      },
    };
  } catch (err) {
    console.error("Meta error:", err.message);
    return { meta: null };
  }
});

builder.defineStreamHandler(async ({ id }) => {
  try {
    const media = decodeId(id);
    const mediaType = media.mediaType || (media.type === "movie" ? 1 : 2);

    const res = await client.get(media.url, {
      headers: {
        Cookie: "toronites_server=vidstream",
        Referer: MAIN_URL,
      },
    });
    const $ = cheerio.load(res.data);

    const bodyClass = $("body").attr("class") || "";
    const termMatch = /(?:term|postid)-(\d+)/.exec(bodyClass);
    const term = termMatch ? termMatch[1] : null;

    const extractorPromises = [];

    // 1. Standard servers (iframe.serversel[src])
    $("iframe.serversel[src]").each((_, el) => {
      const serverUrl = fixUrl($(el).attr("src"));
      if (serverUrl) {
        extractorPromises.push(
          (async () => {
            try {
              const innerRes = await client.get(serverUrl, {
                headers: { Referer: media.url },
              });
              const $inner = cheerio.load(innerRes.data);
              const innerIframeUrl = fixUrl(
                $inner("iframe[src]").first().attr("src")
              );
              if (innerIframeUrl) {
                return await invokeExtractor(innerIframeUrl, media.url);
              }
            } catch {
              // Ignore
            }
            return { streams: [], subtitles: [] };
          })()
        );
      }
    });

    // 2. trembed endpoints (0..10)
    if (term) {
      for (let i = 0; i <= 10; i++) {
        const trembedUrl = `${MAIN_URL}/?trembed=${i}&trid=${term}&trtype=${mediaType}`;
        extractorPromises.push(
          (async () => {
            try {
              const trRes = await client.get(trembedUrl, {
                headers: { Referer: media.url },
              });
              const $tr = cheerio.load(trRes.data);
              const iframeUrl = fixUrl($tr("iframe").first().attr("src"));
              if (iframeUrl) {
                return await invokeExtractor(iframeUrl, media.url);
              }
            } catch {
              // Ignore
            }
            return { streams: [], subtitles: [] };
          })()
        );
      }
    }

    // 3. NeoCDN / VidSrcGet base64 options
    $("div.player aside.bx.options ul.bx-lst.aa-tbs li a[data-src]").each(
      (_, el) => {
        const b64 = ($(el).attr("data-src") || "").trim();
        if (b64) {
          try {
            const decoded = Buffer.from(b64, "base64").toString("utf8");
            if (decoded.startsWith("http")) {
              extractorPromises.push(invokeExtractor(decoded, media.url));
            }
          } catch {
            // Ignore
          }
        }
      }
    );

    const results = await Promise.allSettled(extractorPromises);
    const allStreams = [];
    const allSubtitles = [];

    for (const r of results) {
      if (r.status === "fulfilled" && r.value) {
        if (Array.isArray(r.value.streams)) allStreams.push(...r.value.streams);
        if (Array.isArray(r.value.subtitles))
          allSubtitles.push(...r.value.subtitles);
      }
    }

    if (allSubtitles.length > 0) {
      for (const s of allStreams) {
        s.subtitles = allSubtitles;
      }
    }

    return { streams: allStreams };
  } catch (err) {
    console.error("Stream error:", err.message);
    return { streams: [] };
  }
});

const app = express();
app.use(cors());

app.get("/debug", async (req, res) => {
  try {
    const response = await client.get(`${MAIN_URL}/series-hindi/`, {
      headers: { Referer: MAIN_URL },
    });
    const $ = cheerio.load(response.data);
    const count = $("article").length;
    res.json({
      status: "ok",
      mainUrl: MAIN_URL,
      httpStatus: response.status,
      articlesFound: count,
    });
  } catch (err) {
    res.status(500).json({
      status: "error",
      mainUrl: MAIN_URL,
      message: err.message,
    });
  }
});

const addonInterface = builder.getInterface();
app.use("/", getRouter(addonInterface));

app.get("/", (req, res) => {
  res.redirect("/manifest.json");
});

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
  console.log(`Toonify Stream (AnimeDekho) Stremio Addon running on port ${PORT}`);
});
