// TMDB requests and the mapping of their responses into what the renderer
// uses. Takes the fetch implementation as a parameter so the tests can run
// every call against canned responses (main.js passes the real fetch).
// Every function gets `ctx` = { apiKey, language, region } first.

const TMDB_API = 'https://api.themoviedb.org/3';
// A TMDB request that hangs would otherwise leave Novedades, Viendo or
// "Próximos estrenos" loading forever; after this it fails like being offline.
const TMDB_TIMEOUT_MS = 10000;

function tmdbImage(size, imagePath) {
  return imagePath ? `https://image.tmdb.org/t/p/${size}${imagePath}` : '';
}

function mapTmdbResult(kind) {
  return (m) => {
    const date = kind === 'tv' ? m.first_air_date : m.release_date;
    return {
      tmdbId: m.id,
      mediaType: kind,
      title: kind === 'tv' ? m.name : m.title,
      year: date ? date.slice(0, 4) : '',
      poster: tmdbImage('w200', m.poster_path),
    };
  };
}

function mapEpisode(ep) {
  return ep ? {
    airDate: ep.air_date || null,
    seasonNumber: ep.season_number || null,
    episodeNumber: ep.episode_number || null,
    name: ep.name || null,
  } : null;
}

// `baseUrl` is only overridden by the end-to-end tests, which point it at a
// local fake TMDB.
function createTmdbApi(fetchImpl, { timeoutMs = TMDB_TIMEOUT_MS, baseUrl = TMDB_API } = {}) {
  function get(apiKey, pathAndQuery) {
    return fetchImpl(`${baseUrl}${pathAndQuery}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  // Parsed JSON of a TMDB request, or `fallback` when it doesn't come back OK.
  async function jsonOr(apiKey, pathAndQuery, fallback) {
    const res = await get(apiKey, pathAndQuery);
    return res.ok ? res.json() : fallback;
  }

  // Genre id -> name maps, per language. They practically never change, so
  // they're fetched once per session instead of on every search.
  const genreMapsCache = new Map();

  async function getGenreMaps(apiKey, language) {
    if (genreMapsCache.has(language)) return genreMapsCache.get(language);
    const [movieRes, tvRes] = await Promise.all([
      get(apiKey, `/genre/movie/list?language=${language}`),
      get(apiKey, `/genre/tv/list?language=${language}`),
    ]);
    const movieGenres = movieRes.ok ? await movieRes.json() : { genres: [] };
    const tvGenres = tvRes.ok ? await tvRes.json() : { genres: [] };
    const maps = {
      movie: new Map(movieGenres.genres.map((g) => [g.id, g.name])),
      tv: new Map(tvGenres.genres.map((g) => [g.id, g.name])),
    };
    // Only keep complete results, so a failed request is retried next search.
    if (movieRes.ok && tvRes.ok) genreMapsCache.set(language, maps);
    return maps;
  }

  async function search({ apiKey, language }, query) {
    const res = await get(apiKey, `/search/multi?query=${encodeURIComponent(query)}&language=${language}&include_adult=false`);
    if (!res.ok) {
      if (res.status === 401) return { error: 'INVALID_API_KEY' };
      return { error: 'REQUEST_FAILED', status: res.status };
    }
    const json = await res.json();
    const genreMaps = await getGenreMaps(apiKey, language);

    const results = (json.results || [])
      .filter((m) => m.media_type === 'movie' || m.media_type === 'tv')
      .slice(0, 12)
      .map((m) => {
        const kind = m.media_type === 'tv' ? 'tv' : 'movie';
        return {
          ...mapTmdbResult(kind)(m),
          genres: (m.genre_ids || []).map((id) => genreMaps[kind].get(id)).filter(Boolean),
          overview: m.overview || '',
        };
      });
    return { results };
  }

  async function details({ apiKey, language }, tmdbId, mediaType) {
    const kind = mediaType === 'tv' ? 'tv' : 'movie';
    const res = await get(apiKey, `/${kind}/${tmdbId}?language=${language}`);
    if (!res.ok) return { error: 'REQUEST_FAILED', status: res.status };
    const json = await res.json();
    if (kind === 'tv') {
      const next = json.next_episode_to_air;
      const last = json.last_episode_to_air;
      const episodes = json.number_of_episodes || null;
      // Many series have no average runtime in TMDB; fall back to the runtime
      // of the latest (or next) episode so the total isn't left empty.
      const episodeRuntime = (Array.isArray(json.episode_run_time) && json.episode_run_time[0])
        || (last && last.runtime)
        || (next && next.runtime)
        || null;
      return {
        seasons: json.number_of_seasons || null,
        episodes,
        runtime: episodes && episodeRuntime ? episodes * episodeRuntime : null,
        status: json.status || null,
        poster: tmdbImage('w200', json.poster_path) || null,
        seasonsList: (json.seasons || []).map((season) => ({
          seasonNumber: season.season_number,
          airDate: season.air_date || null,
          episodeCount: season.episode_count || null,
        })),
        nextEpisode: mapEpisode(next),
        lastEpisode: mapEpisode(last),
      };
    }
    return {
      runtime: json.runtime || null,
      releaseDate: json.release_date || null,
      collectionId: json.belongs_to_collection ? json.belongs_to_collection.id : null,
    };
  }

  async function collection({ apiKey, language }, collectionId) {
    const res = await get(apiKey, `/collection/${collectionId}?language=${language}`);
    if (!res.ok) return { error: 'REQUEST_FAILED', status: res.status };
    const json = await res.json();
    return {
      name: json.name || '',
      parts: (json.parts || []).map((p) => ({
        tmdbId: p.id,
        title: p.title,
        releaseDate: p.release_date || null,
        poster: tmdbImage('w200', p.poster_path),
      })),
    };
  }

  // `providers` are the ones included in a subscription (flatrate), free or
  // with ads; `rentBuy` the ones where it's only for rent or sale.
  async function providers({ apiKey, region }, tmdbId, mediaType) {
    const kind = mediaType === 'tv' ? 'tv' : 'movie';
    const res = await get(apiKey, `/${kind}/${tmdbId}/watch/providers`);
    if (!res.ok) return { error: 'REQUEST_FAILED', status: res.status };
    const json = await res.json();
    const local = (json.results && json.results[region]) || null;
    if (!local) return { providers: [], rentBuy: [], link: null };
    const names = new Set();
    ['flatrate', 'free', 'ads'].forEach((key) => {
      (local[key] || []).forEach((p) => names.add(p.provider_name));
    });
    const rentBuy = new Set();
    ['rent', 'buy'].forEach((key) => {
      (local[key] || []).forEach((p) => rentBuy.add(p.provider_name));
    });
    return {
      providers: [...names],
      rentBuy: [...rentBuy],
      link: local.link || null,
    };
  }

  // YouTube URL of the best trailer (official first), trying the configured
  // language and then any language.
  async function trailerUrl({ apiKey, language }, tmdbId, mediaType) {
    const kind = mediaType === 'tv' ? 'tv' : 'movie';
    const res = await get(apiKey, `/${kind}/${tmdbId}/videos?language=${language}`);
    if (!res.ok) return { error: 'REQUEST_FAILED', status: res.status };
    const json = await res.json();
    let videos = (json.results || []).filter((v) => v.site === 'YouTube');
    if (!videos.length) {
      const jsonAny = await jsonOr(apiKey, `/${kind}/${tmdbId}/videos`, { results: [] });
      videos = (jsonAny.results || []).filter((v) => v.site === 'YouTube');
    }
    if (!videos.length) return { error: 'NOT_FOUND' };
    const best = videos.find((v) => v.type === 'Trailer' && v.official)
      || videos.find((v) => v.type === 'Trailer')
      || videos[0];
    return { url: `https://www.youtube.com/watch?v=${encodeURIComponent(best.key)}` };
  }

  async function recommendations({ apiKey, language }, tmdbId, mediaType) {
    const kind = mediaType === 'tv' ? 'tv' : 'movie';
    const res = await get(apiKey, `/${kind}/${tmdbId}/recommendations?language=${language}`);
    if (!res.ok) return { error: 'REQUEST_FAILED', status: res.status };
    const json = await res.json();
    return { results: (json.results || []).slice(0, 20).map(mapTmdbResult(kind)) };
  }

  async function trending({ apiKey, language }) {
    const [movieJson, tvJson] = await Promise.all([
      jsonOr(apiKey, `/trending/movie/week?language=${language}`, { results: [] }),
      jsonOr(apiKey, `/trending/tv/week?language=${language}`, { results: [] }),
    ]);
    return {
      movies: (movieJson.results || []).slice(0, 20).map(mapTmdbResult('movie')),
      tv: (tvJson.results || []).slice(0, 20).map(mapTmdbResult('tv')),
    };
  }

  async function providerLogos({ apiKey, language, region }) {
    const [movieJson, tvJson] = await Promise.all([
      jsonOr(apiKey, `/watch/providers/movie?language=${language}&watch_region=${region}`, { results: [] }),
      jsonOr(apiKey, `/watch/providers/tv?language=${language}&watch_region=${region}`, { results: [] }),
    ]);
    const logos = {};
    const providerIds = {};
    [...(movieJson.results || []), ...(tvJson.results || [])].forEach((p) => {
      if (p.provider_name && p.logo_path && !logos[p.provider_name]) {
        logos[p.provider_name] = tmdbImage('original', p.logo_path);
      }
      if (p.provider_name && p.provider_id && !providerIds[p.provider_name]) {
        providerIds[p.provider_name] = p.provider_id;
      }
    });
    return { logos, providerIds };
  }

  async function discoverByProviders({ apiKey, language, region }, providerIds, mediaTypes) {
    if (!Array.isArray(providerIds) || !providerIds.length) return { movies: [], tv: [] };
    const idsParam = providerIds.map(Number).filter(Number.isFinite).join('|');
    const wantMovie = !mediaTypes || mediaTypes.includes('movie');
    const wantTv = !mediaTypes || mediaTypes.includes('tv');
    const query = `language=${language}&watch_region=${region}&with_watch_providers=${idsParam}&sort_by=popularity.desc`;
    const [movieJson, tvJson] = await Promise.all([
      wantMovie ? jsonOr(apiKey, `/discover/movie?${query}`, { results: [] }) : { results: [] },
      wantTv ? jsonOr(apiKey, `/discover/tv?${query}`, { results: [] }) : { results: [] },
    ]);
    return {
      movies: (movieJson.results || []).slice(0, 20).map(mapTmdbResult('movie')),
      tv: (tvJson.results || []).slice(0, 20).map(mapTmdbResult('tv')),
    };
  }

  return {
    search, details, collection, providers, trailerUrl, recommendations,
    trending, providerLogos, discoverByProviders,
  };
}

module.exports = { createTmdbApi, tmdbImage, TMDB_TIMEOUT_MS };
