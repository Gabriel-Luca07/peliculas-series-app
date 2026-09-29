const test = require('node:test');
const assert = require('node:assert/strict');
const { createTmdbApi } = require('../lib/tmdb-api');

const CTX = { apiKey: 'KEY', language: 'es-ES', region: 'ES' };

// Fake fetch: `routes` maps a path prefix (after /3) to a JSON body, or to
// { httpStatus, body }. Records every call so tests can check URLs and headers.
function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, options) => {
    calls.push({ url, options });
    const pathAndQuery = url.replace('https://api.themoviedb.org/3', '');
    const match = Object.keys(routes)
      .filter((prefix) => pathAndQuery.startsWith(prefix))
      .sort((a, b) => b.length - a.length)[0];
    if (!match) return { ok: false, status: 404, json: async () => ({}) };
    const route = routes[match];
    const status = route && route.httpStatus ? route.httpStatus : 200;
    const body = route && route.httpStatus ? route.body : route;
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  impl.calls = calls;
  return impl;
}

test('requests carry the key and a timeout signal', async () => {
  const fetch = fakeFetch({ '/movie/1': { runtime: 100 } });
  await createTmdbApi(fetch).details(CTX, 1, 'movie');
  assert.equal(fetch.calls[0].options.headers.Authorization, 'Bearer KEY');
  assert.ok(fetch.calls[0].options.signal instanceof AbortSignal);
});

test('a request that hangs is aborted after the timeout', async () => {
  const hanging = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason));
  });
  const api = createTmdbApi(hanging, { timeoutMs: 20 });
  await assert.rejects(api.details(CTX, 1, 'movie'), { name: 'TimeoutError' });
});

test('search', async (t) => {
  await t.test('maps movies and series with genre names and skips people', async () => {
    const fetch = fakeFetch({
      '/search/multi': {
        results: [
          { id: 1, media_type: 'movie', title: 'Dune', release_date: '2021-09-15', poster_path: '/d.jpg', genre_ids: [878], overview: 'Arena' },
          { id: 2, media_type: 'person', name: 'Alguien' },
          { id: 3, media_type: 'tv', name: 'Dark', first_air_date: '2017-12-01', genre_ids: [18, 999] },
        ],
      },
      '/genre/movie/list': { genres: [{ id: 878, name: 'Ciencia ficción' }] },
      '/genre/tv/list': { genres: [{ id: 18, name: 'Drama' }] },
    });
    const res = await createTmdbApi(fetch).search(CTX, 'du ne');
    assert.ok(fetch.calls[0].url.includes('query=du%20ne'));
    assert.deepEqual(res.results, [
      { tmdbId: 1, mediaType: 'movie', title: 'Dune', year: '2021', poster: 'https://image.tmdb.org/t/p/w200/d.jpg', genres: ['Ciencia ficción'], overview: 'Arena' },
      { tmdbId: 3, mediaType: 'tv', title: 'Dark', year: '2017', poster: '', genres: ['Drama'], overview: '' },
    ]);
  });

  await t.test('401 means the key is wrong', async () => {
    const fetch = fakeFetch({ '/search/multi': { httpStatus: 401, body: {} } });
    assert.deepEqual(await createTmdbApi(fetch).search(CTX, 'x'), { error: 'INVALID_API_KEY' });
  });

  await t.test('genre lists are fetched once per language', async () => {
    const fetch = fakeFetch({
      '/search/multi': { results: [] },
      '/genre/movie/list': { genres: [] },
      '/genre/tv/list': { genres: [] },
    });
    const api = createTmdbApi(fetch);
    await api.search(CTX, 'a');
    await api.search(CTX, 'b');
    assert.equal(fetch.calls.filter((c) => c.url.includes('/genre/')).length, 2);
  });
});

test('details', async (t) => {
  await t.test('series: seasons, episodes and runtime from the last episode', async () => {
    const fetch = fakeFetch({
      '/tv/5': {
        number_of_seasons: 2,
        number_of_episodes: 10,
        episode_run_time: [],
        status: 'Returning Series',
        poster_path: '/p.jpg',
        seasons: [{ season_number: 0, air_date: null, episode_count: 3 }, { season_number: 1, air_date: '2020-01-01', episode_count: 5 }],
        last_episode_to_air: { air_date: '2026-09-20', season_number: 2, episode_number: 4, name: 'Cuatro', runtime: 50 },
        next_episode_to_air: { air_date: '2026-10-04', season_number: 2, episode_number: 5, name: 'Cinco' },
      },
    });
    const res = await createTmdbApi(fetch).details(CTX, 5, 'tv');
    assert.equal(res.runtime, 500);
    assert.equal(res.seasons, 2);
    assert.deepEqual(res.seasonsList[1], { seasonNumber: 1, airDate: '2020-01-01', episodeCount: 5 });
    assert.deepEqual(res.lastEpisode, { airDate: '2026-09-20', seasonNumber: 2, episodeNumber: 4, name: 'Cuatro' });
    assert.equal(res.nextEpisode.episodeNumber, 5);
  });

  await t.test('movie: runtime, release date and saga', async () => {
    const fetch = fakeFetch({ '/movie/7': { runtime: 120, release_date: '2020-02-02', belongs_to_collection: { id: 99 } } });
    assert.deepEqual(await createTmdbApi(fetch).details(CTX, 7, 'movie'), { runtime: 120, releaseDate: '2020-02-02', collectionId: 99 });
  });

  await t.test('failed request', async () => {
    const fetch = fakeFetch({ '/movie/7': { httpStatus: 500, body: {} } });
    assert.deepEqual(await createTmdbApi(fetch).details(CTX, 7, 'movie'), { error: 'REQUEST_FAILED', status: 500 });
  });
});

test('providers', async (t) => {
  await t.test('splits subscription/free from rent/buy for the region', async () => {
    const fetch = fakeFetch({
      '/movie/1/watch/providers': {
        results: {
          ES: {
            link: 'https://x',
            flatrate: [{ provider_name: 'Netflix' }],
            ads: [{ provider_name: 'Pluto TV' }],
            rent: [{ provider_name: 'Apple TV' }],
            buy: [{ provider_name: 'Apple TV' }],
          },
          US: { flatrate: [{ provider_name: 'Hulu' }] },
        },
      },
    });
    assert.deepEqual(await createTmdbApi(fetch).providers(CTX, 1, 'movie'), {
      providers: ['Netflix', 'Pluto TV'], rentBuy: ['Apple TV'], link: 'https://x',
    });
  });

  await t.test('no data for the region', async () => {
    const fetch = fakeFetch({ '/tv/1/watch/providers': { results: {} } });
    assert.deepEqual(await createTmdbApi(fetch).providers(CTX, 1, 'tv'), { providers: [], rentBuy: [], link: null });
  });
});

test('trailerUrl prefers an official trailer and falls back to any language', async () => {
  const fetch = fakeFetch({
    '/movie/1/videos?language=es-ES': { results: [] },
    '/movie/1/videos': {
      results: [
        { site: 'YouTube', type: 'Teaser', key: 'teaser' },
        { site: 'YouTube', type: 'Trailer', official: false, key: 'fan' },
        { site: 'YouTube', type: 'Trailer', official: true, key: 'official' },
      ],
    },
  });
  assert.deepEqual(await createTmdbApi(fetch).trailerUrl(CTX, 1, 'movie'), { url: 'https://www.youtube.com/watch?v=official' });
});

test('discoverByProviders only sends numeric provider ids', async () => {
  const fetch = fakeFetch({ '/discover/movie': { results: [{ id: 1, title: 'A', release_date: '2000-01-01' }] } });
  const res = await createTmdbApi(fetch).discoverByProviders(CTX, [8, '337', 'x&y'], ['movie']);
  assert.ok(fetch.calls[0].url.includes('with_watch_providers=8|337&'));
  assert.equal(fetch.calls.length, 1);
  assert.equal(res.movies[0].title, 'A');
});
