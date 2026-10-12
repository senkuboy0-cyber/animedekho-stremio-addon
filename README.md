# Toonify Stream (AnimeDekho) - Stremio Addon

Stremio extension converted from the `Anime-Dekho` CloudStream provider (`AnimeDekhoProvider.kt` & `Extractor.kt`).

## Features
- **Catalogs:** Series, Movies, Anime, Cartoon, Hindi Dub, Tamil, and Telugu
- **Search:** Full search support across AnimeDekho
- **Rich Metadata:** Automatic TMDB Logo and Backdrop resolution
- **Extractors Supported:**
  - AWSStream, Zephyrflick, Ravok
  - VidMoly (`.net` & `.biz`)
  - StreamRuby
  - Abyss / Hydrax
  - Byse (AES-256-GCM decryption)
  - GDMirrorbot & Techinmind
  - XerverMirror & VidSrcGet
  - NeoCDN
  - Blakite & EarnVids

## Deploy on Render
1. Go to [Render Dashboard](https://dashboard.render.com/) and click **New +** -> **Web Service**.
2. Connect this repository: `senkuboy0-cyber/animedekho-stremio-addon`.
3. Use the following settings:
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
4. Click **Create Web Service**.
5. Once deployed, copy your Render URL and append `/manifest.json` (e.g., `https://animedekho-stremio-addon.onrender.com/manifest.json`) to install it in Stremio.
