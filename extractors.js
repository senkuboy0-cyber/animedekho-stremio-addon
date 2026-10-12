const axios = require("axios");
const cheerio = require("cheerio");
const crypto = require("crypto");

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const client = axios.create({
  timeout: 20000,
  headers: {
    "User-Agent": DEFAULT_UA,
  },
});

function unpackJs(packed) {
  try {
    const regex =
      /}\('(.*)',\s*(\d+|\[.*\]),\s*(\d+),\s*'(.*)'\.split\('\|'\)/s;
    const match = regex.exec(packed);
    if (!match) return null;

    let payload = match[1];
    const radix = parseInt(match[2], 10) || 36;
    const count = parseInt(match[3], 10);
    const symtab = match[4].split("|");

    const unbase = (str) => parseInt(str, radix);

    return payload.replace(/\b\w+\b/g, (word) => {
      const idx = unbase(word);
      return idx < count && symtab[idx] ? symtab[idx] : word;
    });
  } catch (err) {
    return null;
  }
}

function getBaseUrl(targetUrl) {
  try {
    const parsed = new URL(targetUrl);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return "";
  }
}

async function extractAWSStream(url, label = "AWSStream") {
  const streams = [];
  const subtitles = [];
  try {
    const baseUrl = getBaseUrl(url) || "https://z.awstream.net";
    const extractedHash = url.split("/").filter(Boolean).pop();
    const pageRes = await client.get(url, {
      headers: { Referer: baseUrl },
    });
    const $ = cheerio.load(pageRes.data);

    const apiUrl = `${baseUrl}/player/index.php?data=${extractedHash}&do=getVideo`;
    const form = new URLSearchParams({
      hash: extractedHash,
      r: baseUrl,
    });

    const res = await client.post(apiUrl, form.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
        Referer: url,
      },
    });

    if (res.data && res.data.videoSource) {
      streams.push({
        name: "Toonify Stream",
        title: `${label} - 1080p`,
        url: res.data.videoSource,
      });
    }

    const scriptContent = $("script")
      .map((_, el) => $(el).html())
      .get()
      .find((s) => s && s.includes("function(p,a,c,k,e,d)"));

    if (scriptContent) {
      const unpacked = unpackJs(scriptContent);
      if (unpacked) {
        const subRegex = /"kind":\s*"captions"\s*,\s*"file":\s*"(https.*?\.srt)"/g;
        let match;
        let idx = 0;
        while ((match = subRegex.exec(unpacked)) !== null) {
          subtitles.push({
            id: `aws-sub-${idx + 1}`,
            url: match[1],
            lang: idx === 0 ? "eng" : `sub-${idx + 1}`,
          });
          idx++;
        }
      }
    }
  } catch (err) {
    // Ignore individual extractor errors
  }
  return { streams, subtitles };
}

async function extractVidMoly(url) {
  const streams = [];
  const subtitles = [];
  try {
    const baseUrl = getBaseUrl(url) || "https://vidmoly.net";
    const res = await client.get(url, {
      headers: { Referer: baseUrl },
    });
    const html = res.data;

    const m3u8Match =
      /file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i.exec(html) ||
      /(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i.exec(html);

    const subMatch =
      /file\s*:\s*["'](https?:\/\/[^"']+\.vtt[^"']*)["'][\s\S]{0,200}?label\s*:\s*["']([^"']*)["']/i.exec(
        html
      );

    if (subMatch) {
      subtitles.push({
        id: "vidmoly-sub-1",
        url: subMatch[1],
        lang: subMatch[2] || "eng",
      });
    }

    if (m3u8Match) {
      streams.push({
        name: "Toonify Stream",
        title: "VidMoly - Auto",
        url: m3u8Match[1],
        behaviorHints: {
          notWebReady: false,
          proxyHeaders: {
            request: {
              Referer: baseUrl,
              "User-Agent": DEFAULT_UA,
            },
          },
        },
      });
    }
  } catch (err) {
    // Ignore error
  }
  return { streams, subtitles };
}

async function extractStreamRuby(url) {
  const streams = [];
  const subtitles = [];
  try {
    const cleanedUrl = url.replace("/e/", "/");
    const baseUrl = getBaseUrl(cleanedUrl) || "https://rubystm.com";
    const res = await client.get(cleanedUrl, {
      headers: {
        Referer: cleanedUrl,
        "X-Requested-With": "XMLHttpRequest",
      },
    });
    const $ = cheerio.load(res.data);

    let scriptData = $("script")
      .map((_, el) => $(el).html())
      .get()
      .join("\n");

    const packedScript = $("script")
      .map((_, el) => $(el).html())
      .get()
      .find((s) => s && s.includes("function(p,a,c,k,e,d)"));

    if (packedScript) {
      const unpacked = unpackJs(packedScript);
      if (unpacked) scriptData += "\n" + unpacked;
    }

    const fileMatch = /file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i.exec(
      scriptData
    );
    if (fileMatch) {
      streams.push({
        name: "Toonify Stream",
        title: "StreamRuby - 1080p",
        url: fileMatch[1],
        behaviorHints: {
          proxyHeaders: {
            request: {
              Referer: baseUrl,
              Origin: cleanedUrl,
            },
          },
        },
      });
    }
  } catch (err) {
    // Ignore error
  }
  return { streams, subtitles };
}

async function extractStreamhg(url, label = "StreamHG") {
  const streams = [];
  const subtitles = [];
  try {
    const baseUrl = getBaseUrl(url);
    const res = await client.get(url, {
      headers: { Referer: baseUrl },
    });
    const $ = cheerio.load(res.data);
    let scriptData = $("script")
      .map((_, el) => $(el).html())
      .get()
      .join("\n");

    const packedScript = $("script")
      .map((_, el) => $(el).html())
      .get()
      .find((s) => s && s.includes("function(p,a,c,k,e,d)"));

    if (packedScript) {
      const unpacked = unpackJs(packedScript);
      if (unpacked) scriptData += "\n" + unpacked;
    }

    const m3u8Match = /file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i.exec(
      scriptData
    );
    if (m3u8Match) {
      streams.push({
        name: "Toonify Stream",
        title: `${label} - Auto`,
        url: m3u8Match[1],
        behaviorHints: {
          proxyHeaders: {
            request: {
              Referer: baseUrl,
              "User-Agent": DEFAULT_UA,
            },
          },
        },
      });
    }
  } catch (err) {
    // Ignore error
  }
  return { streams, subtitles };
}

async function extractAbyss(url) {
  const streams = [];
  const subtitles = [];
  try {
    const headers = {
      "User-Agent": DEFAULT_UA,
      Origin: "https://playhydrax.com",
      Referer: "https://playhydrax.com/",
    };

    const res = await client.get(url, { headers });
    const $ = cheerio.load(res.data);
    const scripts = $("script")
      .map((_, el) => $(el).html())
      .get()
      .join("\n");

    const encMatch = /const\s+datas\s*=\s*"([^"]*)"/.exec(scripts);
    if (!encMatch) return { streams, subtitles };

    const decRes = await client.post(
      "https://enc-dec.app/api/dec-abyss",
      { text: encMatch[1] },
      { headers: { ...headers, "Content-Type": "application/json" } }
    );

    const sources = decRes.data?.result?.sources || [];
    for (const src of sources) {
      if (src.status && src.url) {
        streams.push({
          name: "Toonify Stream",
          title: `Abyss [${(src.codec || "MP4").toUpperCase()}] - ${src.type || "Auto"}`,
          url: src.url,
          behaviorHints: {
            proxyHeaders: {
              request: {
                Referer: "https://playhydrax.com/",
              },
            },
          },
        });
      }
    }
  } catch (err) {
    // Ignore error
  }
  return { streams, subtitles };
}

function base64UrlDecode(str) {
  let b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4 !== 0) {
    b64 += "=";
  }
  return Buffer.from(b64, "base64");
}

async function extractByse(url, referer) {
  const streams = [];
  const subtitles = [];
  try {
    const baseUrl = getBaseUrl(url) || "https://bysetayico.com";
    const codeMatch = /\/e\/([A-Za-z0-9]+)/.exec(url);
    const code = codeMatch
      ? codeMatch[1]
      : url.replace(/\/+$/, "").split("/").pop().split("?")[0];
    if (!code) return { streams, subtitles };

    const apiUrl = `${baseUrl}/api/videos/${code}`;
    const res = await client.get(apiUrl, {
      headers: {
        Accept: "application/json",
        Referer: referer || url,
      },
    });

    const root = typeof res.data === "string" ? JSON.parse(res.data) : res.data;
    if (Array.isArray(root.tracks)) {
      root.tracks.forEach((t, idx) => {
        const subUrl = t.url || t.file || t.src;
        if (subUrl && subUrl.startsWith("http")) {
          subtitles.push({
            id: `byse-sub-${idx}`,
            url: subUrl,
            lang: t.label || t.language || t.lang || "eng",
          });
        }
      });
    }

    const playback = root.playback;
    if (!playback) return { streams, subtitles };

    const v = parseInt(String(playback.version).trim(), 10);
    const keyParts = playback.key_parts || [];
    const i1 = v;
    const i2 = 31 - v;
    if (i1 < 1 || i2 < 1 || i1 > keyParts.length || i2 > keyParts.length) {
      return { streams, subtitles };
    }

    const keyBytes = Buffer.concat([
      base64UrlDecode(keyParts[i1 - 1]),
      base64UrlDecode(keyParts[i2 - 1]),
    ]);
    const iv = base64UrlDecode(playback.iv);
    const ciphertextWithTag = base64UrlDecode(playback.payload);

    const authTag = ciphertextWithTag.subarray(ciphertextWithTag.length - 16);
    const ciphertext = ciphertextWithTag.subarray(
      0,
      ciphertextWithTag.length - 16
    );

    const decipher = crypto.createDecipheriv("aes-256-gcm", keyBytes, iv);
    decipher.setAuthTag(authTag);
    const decryptedBuf = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    const decrypted = JSON.parse(decryptedBuf.toString("utf8"));

    if (Array.isArray(decrypted.sources)) {
      for (const src of decrypted.sources) {
        if (src.url && src.url.startsWith("http")) {
          const label = src.label || src.quality || "Auto";
          streams.push({
            name: "Toonify Stream",
            title: `Byse - ${label}`,
            url: src.url,
            behaviorHints: {
              proxyHeaders: {
                request: {
                  Referer: `${baseUrl}/`,
                  "User-Agent": DEFAULT_UA,
                },
              },
            },
          });
        }
      }
    }
  } catch (err) {
    // Ignore error
  }
  return { streams, subtitles };
}

async function extractNeoCDN(url, referer) {
  const streams = [];
  const subtitles = [];
  try {
    const baseUrl = getBaseUrl(url) || "https://animedekho.tv";
    const pageRes = await client.get(url, {
      headers: { Referer: referer || baseUrl },
    });
    const html = pageRes.data;

    const fetchMatch = /(fetch\.php\?id=[^"'\s&]+)/i.exec(html);
    if (!fetchMatch) return { streams, subtitles };

    const fetchUrl = `${baseUrl}/aaa/myth/${fetchMatch[1]}`;
    const jsonRes = await client.get(fetchUrl, {
      headers: { Referer: url },
    });

    const data =
      typeof jsonRes.data === "string" ? JSON.parse(jsonRes.data) : jsonRes.data;
    const sources = data?.sources || [];
    for (const s of sources) {
      const streamUrl = s.file || s.url;
      if (streamUrl && streamUrl.startsWith("http")) {
        streams.push({
          name: "Toonify Stream",
          title: `NeoCDN - ${s.label || "Auto"}`,
          url: streamUrl,
        });
      }
    }
  } catch (err) {
    // Ignore error
  }
  return { streams, subtitles };
}

async function extractXerverMirror(url, labelName = "XerverMirror") {
  const streams = [];
  const subtitles = [];
  try {
    const fetchUrl = url.includes("fetch=1")
      ? url
      : `${url}${url.includes("?") ? "&" : "?"}fetch=1`;
    const res = await client.get(fetchUrl, {
      headers: { Referer: url },
    });
    const data = typeof res.data === "string" ? JSON.parse(res.data) : res.data;
    const results = data?.results || data || {};

    for (const [key, entry] of Object.entries(results)) {
      if (key.toLowerCase().includes("gofile")) continue;
      if (entry && typeof entry.url === "string" && entry.url.startsWith("http")) {
        streams.push({
          name: "Toonify Stream",
          title: `${labelName} [${entry.label || key}]`,
          url: entry.url,
        });
      }
    }
  } catch (err) {
    // Ignore error
  }
  return { streams, subtitles };
}

async function extractBlakite(url) {
  const streams = [];
  const subtitles = [];
  try {
    const mainUrl = "https://blakiteapi.xyz";
    const id = url.split("/").pop();
    const tmdbId = url.split("embed/")[1]?.split("/")[0] || "";
    const apiUrl = `${mainUrl}/api/get.php?id=${id}&tmdbId=${tmdbId}`;

    const res = await client.get(apiUrl);
    const data = typeof res.data === "string" ? JSON.parse(res.data) : res.data;
    if (data?.success && data?.data) {
      const quality = data.data.quality || "720p";
      const format = data.data.format || "mp4";
      const dataId = data.data.dataId || "";
      if (dataId) {
        streams.push({
          name: "Toonify Stream",
          title: `Blakite - ${quality}`,
          url: `${mainUrl}/stream/${dataId}.${format}`,
        });
      }
    }
  } catch (err) {
    // Ignore error
  }
  return { streams, subtitles };
}

async function extractGDMirrorbot(url, referer) {
  const streams = [];
  const subtitles = [];
  try {
    let sid = "";
    let host = getBaseUrl(url) || "https://gdmirrorbot.nl";

    if (!url.includes("key=")) {
      const res = await client.get(url);
      const finalUrl = res.request?.res?.responseUrl || url;
      host = getBaseUrl(finalUrl) || host;
      sid = url.split("embed/").pop();
    } else {
      const pageRes = await client.get(url);
      let pageText = pageRes.data;
      const finalId = /FinalID\s*=\s*"([^"]+)"/.exec(pageText)?.[1];
      const myKey = /myKey\s*=\s*"([^"]+)"/.exec(pageText)?.[1];
      const idType = /idType\s*=\s*"([^"]+)"/.exec(pageText)?.[1] || "imdbid";
      const baseUrlMatch = /let\s+baseUrl\s*=\s*"([^"]+)"/.exec(pageText)?.[1];
      if (baseUrlMatch) host = getBaseUrl(baseUrlMatch) || host;

      if (finalId && myKey) {
        let apiUrl = `${host}/mymovieapi?${idType}=${finalId}&key=${myKey}`;
        if (url.includes("/tv/")) {
          const season = /\/tv\/\d+\/(\d+)\//.exec(url)?.[1] || "1";
          const episode = /\/tv\/\d+\/\d+\/(\d+)/.exec(url)?.[1] || "1";
          apiUrl = `${host}/myseriesapi?tmdbid=${finalId}&season=${season}&epname=${episode}&key=${myKey}`;
        }
        const apiRes = await client.get(apiUrl);
        pageText =
          typeof apiRes.data === "string"
            ? apiRes.data
            : JSON.stringify(apiRes.data);
      }

      const jsonObj = JSON.parse(pageText);
      const embedId = url.split("/").pop();
      sid = jsonObj?.data?.[0]?.fileslug || embedId;
    }

    const postForm = new URLSearchParams({ sid });
    const helperRes = await client.post(
      `${host}/embedhelper.php`,
      postForm.toString(),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }
    );

    const root =
      typeof helperRes.data === "string"
        ? JSON.parse(helperRes.data)
        : helperRes.data;
    const siteUrls = root?.siteUrls || {};
    let decodedMresult = {};

    if (typeof root?.mresult === "object" && root.mresult !== null) {
      decodedMresult = root.mresult;
    } else if (typeof root?.mresult === "string") {
      decodedMresult = JSON.parse(
        Buffer.from(root.mresult, "base64").toString("utf8")
      );
    }

    const tasks = [];
    for (const key of Object.keys(siteUrls)) {
      if (decodedMresult[key]) {
        const base = String(siteUrls[key]).replace(/\/+$/, "");
        const path = String(decodedMresult[key]).replace(/^\/+/, "");
        const fullUrl = `${base}/${path}`;
        tasks.push(invokeExtractor(fullUrl, referer || host));
      }
    }

    const results = await Promise.allSettled(tasks);
    for (const r of results) {
      if (r.status === "fulfilled" && r.value) {
        streams.push(...r.value.streams);
        subtitles.push(...r.value.subtitles);
      }
    }
  } catch (err) {
    // Ignore error
  }
  return { streams, subtitles };
}

async function invokeExtractor(url, referer = "https://animedekho.app") {
  if (!url) return { streams: [], subtitles: [] };
  const lower = url.toLowerCase();

  if (lower.includes("zephyrflick") || lower.includes("as-cdn")) {
    return extractAWSStream(url, "Zephyrflick");
  }
  if (lower.includes("ravok")) {
    return extractAWSStream(url, "Ravok");
  }
  if (lower.includes("awstream")) {
    return extractAWSStream(url, "AWSStream");
  }
  if (lower.includes("vidmoly")) {
    return extractVidMoly(url);
  }
  if (lower.includes("rubystm") || lower.includes("streamruby")) {
    return extractStreamRuby(url);
  }
  if (lower.includes("abyssplayer") || lower.includes("playhydrax")) {
    return extractAbyss(url);
  }
  if (lower.includes("bysetayico") || lower.includes("byse")) {
    return extractByse(url, referer);
  }
  if (lower.includes("aaa/myth")) {
    return extractNeoCDN(url, referer);
  }
  if (lower.includes("aaa/get")) {
    return extractXerverMirror(url, "VidSrcGet");
  }
  if (lower.includes("mirror.xerver.xyz")) {
    return extractXerverMirror(url, "XerverMirror");
  }
  if (lower.includes("blakite")) {
    return extractBlakite(url);
  }
  if (lower.includes("morencius") || lower.includes("earnvids") || lower.includes("streamhg")) {
    return extractStreamhg(url, "EarnVids");
  }
  if (lower.includes("gdmirrorbot") || lower.includes("techinmind")) {
    return extractGDMirrorbot(url, referer);
  }

  return { streams: [], subtitles: [] };
}

module.exports = {
  client,
  DEFAULT_UA,
  invokeExtractor,
};
