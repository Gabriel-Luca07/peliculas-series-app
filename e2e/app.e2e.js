// End-to-end tests: the real app (Electron) against a temporary data folder
// and a fake TMDB. Run with `npm run test:e2e` (they need a desktop, so CI
// runs them on Windows). Each `test` builds on the state the previous one
// left, like a user going through the app.
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  dayOffset, startFakeTmdb, makeUserData, readUserDataJson, launchApp, sleep,
} = require('./harness');

const ANA = 'aaaaaaaa-0000-4000-8000-000000000001';
const BETO = 'bbbbbbbb-0000-4000-8000-000000000002';

function tmdbRoutes() {
  return {
    '/genre/movie/list': { genres: [] },
    '/genre/tv/list': { genres: [] },
    '/watch/providers/movie': {
      results: [
        { provider_id: 1899, provider_name: 'HBO Max', logo_path: '/hbo.png' },
        { provider_id: 8, provider_name: 'Netflix', logo_path: '/netflix.png' },
      ],
    },
    '/watch/providers/tv': { results: [] },
    '/movie/101/watch/providers': { results: { ES: { flatrate: [{ provider_name: 'HBO Max' }, { provider_name: 'Filmin ' }] } } },
    '/movie/102/watch/providers': { results: { ES: { flatrate: [{ provider_name: 'Netflix' }] } } },
    '/tv/201/watch/providers': { results: { ES: { ads: [{ provider_name: 'Netflix basic with Ads' }] } } },
    '/tv/201': {
      number_of_seasons: 3,
      number_of_episodes: 26,
      episode_run_time: [45],
      status: 'Returning Series',
      seasons: [
        { season_number: 1, air_date: '2020-01-01', episode_count: 8 },
        { season_number: 2, air_date: '2022-01-01', episode_count: 10 },
        { season_number: 3, air_date: dayOffset(-20), episode_count: 8 },
      ],
      last_episode_to_air: { air_date: dayOffset(-1), season_number: 3, episode_number: 3, name: 'Tres' },
      next_episode_to_air: { air_date: dayOffset(6), season_number: 3, episode_number: 4, name: 'Cuatro' },
    },
    '/tv/202': {
      number_of_seasons: 2,
      seasons: [
        { season_number: 1, air_date: '2018-01-01', episode_count: 8 },
        { season_number: 2, air_date: dayOffset(30), episode_count: 8 },
      ],
      last_episode_to_air: null,
      next_episode_to_air: null,
    },
    '/movie/103': { runtime: 100, release_date: '2019-10-10', belongs_to_collection: null },
  };
}

function title(fields) {
  return {
    tmdbId: null, mediaType: null, type: 'pelicula', year: '2020', runtime: 100, seasons: null, genres: [], tags: [],
    poster: '', platform: '', status: 'pendiente', rating: null, notes: '', dateWatched: null, watchCount: null,
    dateAdded: '2026-01-01T00:00:00.000Z', ...fields,
  };
}

function fixtureFiles() {
  return {
    'global-settings.json': { tmdbApiKey: 'test-key' },
    'profiles.json': {
      profiles: [
        { id: ANA, name: 'Ana', color: 'series-1', createdAt: '2026-01-01T00:00:00.000Z' },
        { id: BETO, name: 'Beto', color: 'series-2', createdAt: '2026-01-01T00:00:00.000Z' },
      ],
      lastActiveProfileId: ANA,
    },
    [`profiles/${ANA}/settings.json`]: { language: 'es-ES', region: 'ES', autoBackupEnabled: false },
    [`profiles/${ANA}/movies.json`]: [
      title({ id: 'p101', tmdbId: 101, mediaType: 'movie', title: 'Pendiente en HBO', platform: 'Cine', genres: ['Drama'] }),
      title({ id: 'p102', tmdbId: 102, mediaType: 'movie', title: 'Pendiente en Netflix', platform: 'Netflix' }),
      title({ id: 'p104', title: 'Pendiente sin TMDB', platform: 'HBO Max', runtime: 90 }),
      title({
        id: 's201', tmdbId: 201, mediaType: 'tv', type: 'serie', title: 'Serie en curso', platform: 'Otra',
        status: 'viendo', seasons: 3, currentSeason: 3, currentEpisode: 2,
      }),
      title({
        id: 's202', tmdbId: 202, mediaType: 'tv', type: 'serie', title: 'Serie vista', platform: 'Netflix',
        status: 'vista', seasons: 1, rating: 9, dateWatched: '2019-01-01', watchCount: 1, genres: ['Drama'],
      }),
      title({
        id: 'v103', tmdbId: 103, mediaType: 'movie', title: 'Vista con etiqueta', platform: 'HBO Max',
        status: 'vista', rating: 8, dateWatched: dayOffset(-3), watchCount: 1, genres: ['Terror'], tags: ['halloween'],
      }),
    ],
    [`profiles/${ANA}/subscriptions.json`]: [
      { platform: 'HBO Max', price: 9.99, active: true, startDate: dayOffset(-5), cycleDays: 30, willRenew: true, historyId: 'h1' },
    ],
    [`profiles/${ANA}/subscription-history.json`]: [
      { id: 'h1', platform: 'HBO Max', price: 9.99, cycleDays: 30, startDate: dayOffset(-5), cancelledAt: null },
    ],
  };
}

function removeDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* files still locked: leave it in %TEMP% */ }
}

describe('la app, de principio a fin', () => {
  let tmdb;
  let userData;
  let app;
  let page;

  before(async () => {
    tmdb = await startFakeTmdb(tmdbRoutes());
    userData = makeUserData(fixtureFiles());
    app = await launchApp({ userDataDir: userData, tmdbUrl: tmdb.url });
    page = app.page;
  });

  after(async () => {
    if (app) await app.close();
    if (tmdb) await tmdb.close();
    if (userData) removeDir(userData);
  });

  test('pregunta "¿Quién ve ahora?" y abre el perfil elegido', async () => {
    const names = await page.waitFor(() => {
      const cards = [...document.querySelectorAll('#profile-overlay .profile-card:not(.profile-card-add) .profile-card-name')];
      return cards.length === 2 && cards.map((c) => c.textContent);
    }, { message: 'profile picker' });
    assert.deepEqual(names, ['Ana', 'Beto']);

    await page.eval((id) => document.querySelector(`.profile-card[data-id="${id}"]`).click(), ANA);
    await page.waitFor(
      () => activeProfileId && movies.length === 6 && !followupsLoading
        && document.querySelectorAll('#followups-available .followup-item').length === 1,
      { message: 'profile loaded and TMDB checks done' },
    );
  });

  test('la clave de TMDB se guarda cifrada y se envía en cada petición', () => {
    const global = readUserDataJson(userData, 'global-settings.json');
    assert.ok(global.tmdbApiKeyEnc, 'encrypted key stored');
    assert.equal(global.tmdbApiKey, undefined, 'no plain-text key left');
    assert.ok(tmdb.requests.length > 0);
    assert.ok(tmdb.requests.every((r) => r.auth === 'Bearer test-key'));
  });

  test('un pendiente que llega a una plataforma que pagas: aviso, plataforma cambiada y sección en Novedades', async () => {
    const state = await page.eval(() => ({
      platform: movies.find((m) => m.id === 'p101').platform,
      availableOn: movies.find((m) => m.id === 'p101').availableOn,
      card: document.querySelector('#list-pendientes .card[data-id="p101"]').innerText,
      item: document.querySelector('#followups-available .followup-item').innerText,
      badge: document.querySelector('#followups-badge').textContent,
    }));
    assert.equal(state.platform, 'HBO Max');
    assert.deepEqual(state.availableOn, ['HBO Max', 'Filmin']);
    assert.match(state.card, /En tu HBO Max/);
    assert.match(state.item, /antes: Cine/);
    assert.ok(Number(state.badge) >= 1);

    const onDisk = readUserDataJson(userData, `profiles/${ANA}/movies.json`).find((m) => m.id === 'p101');
    assert.equal(onDisk.platform, 'HBO Max');

    const notice = app.notifications().find((n) => n.title === 'Un pendiente ya está en tus plataformas');
    assert.ok(notice, `notifications: ${JSON.stringify(app.notifications())}`);
    assert.match(notice.body, /Pendiente en HBO: incluida en HBO Max \(plataforma actualizada\)/);
  });

  test('deshacer el cambio de plataforma se mantiene al volver a comprobar', async () => {
    await page.eval(async () => {
      document.querySelector('#followups-available .followup-undo-platform').click();
      await new Promise((r) => setTimeout(r, 300));
      await loadFollowups(true);
    });
    assert.equal(await page.eval(() => movies.find((m) => m.id === 'p101').platform), 'Cine');
    const onDisk = readUserDataJson(userData, `profiles/${ANA}/movies.json`).find((m) => m.id === 'p101');
    assert.equal(onDisk.platform, 'Cine');
  });

  test('episodio nuevo de una serie en Viendo: distintivo y aviso', async () => {
    const card = await page.eval(() => document.querySelector('#list-viendo .card[data-id="s201"]').innerText);
    assert.match(card, /Nuevo: T3 · E3/);
    assert.match(card, /T3 · E2\/8/);

    // The first check only records what's there; pretend it had seen nothing.
    await page.eval(async () => {
      localStorage.setItem(pk('episodes-notified'), '[]');
      await loadFollowups(true);
    });
    const notice = app.notifications().find((n) => n.title === 'Episodio nuevo de lo que estás viendo');
    assert.ok(notice);
    assert.match(notice.body, /Serie en curso: T3 · E3 ya disponible/);
  });

  test('filtros: en mis suscripciones activas y por etiqueta', async () => {
    const result = await page.eval(() => {
      const titles = (sel) => [...document.querySelectorAll(`${sel} .card .title`)].map((e) => e.textContent);
      switchView('pendientes');
      $('#filter-platform').value = ON_MY_SUBSCRIPTIONS;
      $('#filter-platform').dispatchEvent(new Event('change'));
      const subs = titles('#list-pendientes');
      $('#filter-platform').value = '';
      $('#filter-platform').dispatchEvent(new Event('change'));
      switchView('vistas');
      const tagHidden = $('#filter-tag-vistas').classList.contains('hidden');
      $('#filter-tag-vistas').value = 'halloween';
      $('#filter-tag-vistas').dispatchEvent(new Event('change'));
      const tagged = titles('#list-vistas');
      $('#filter-tag-vistas').value = '';
      $('#filter-tag-vistas').dispatchEvent(new Event('change'));
      return { subs, tagHidden, tagged };
    });
    assert.deepEqual(result.subs, ['Pendiente en HBO']);
    assert.equal(result.tagHidden, false);
    assert.deepEqual(result.tagged, ['Vista con etiqueta']);
  });

  test('añadir un título a mano lo guarda con sus etiquetas', async () => {
    await page.eval(async () => {
      switchView('pendientes');
      openModal(null);
      $('#f-title').value = 'Título manual';
      $('#f-tags').value = 'prueba, con Ana, prueba';
      $('#movie-form').requestSubmit();
      await new Promise((r) => setTimeout(r, 500));
    });
    const added = readUserDataJson(userData, `profiles/${ANA}/movies.json`).find((m) => m.title === 'Título manual');
    assert.ok(added);
    assert.equal(added.status, 'pendiente');
    assert.deepEqual(added.tags, ['prueba', 'con Ana']);
    const shown = await page.eval(() => [...document.querySelectorAll('#list-pendientes .card .title')].map((e) => e.textContent));
    assert.ok(shown.includes('Título manual'));
  });

  test('importar un diario de Letterboxd sin duplicar lo que ya hay', async () => {
    const status = await page.eval(async () => {
      window.confirm = () => true;
      const csv = 'Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date\n'
        + '2026-01-02,Pendiente en Netflix,2020,u,4,,,2026-01-01\n'
        + '2026-01-03,Película nueva,1999,u,3.5,,cine,2026-01-03\n';
      csvParsed = parseImportFile(csv, 'diary.csv');
      showCsvMappingPanel('diary.csv');
      await applyCsvImport();
      return $('#csv-import-status').textContent;
    });
    assert.match(status, /1 añadido, 1 actualizado/);
    const onDisk = readUserDataJson(userData, `profiles/${ANA}/movies.json`);
    const updated = onDisk.find((m) => m.id === 'p102');
    assert.equal(updated.status, 'vista');
    assert.equal(updated.rating, 8);
    assert.equal(onDisk.filter((m) => m.title === 'Película nueva').length, 1);
  });

  test('resumen, planificador de suscripciones y listas para compartir', async () => {
    const result = await page.eval(async () => {
      switchView('dashboard');
      renderDashboard();
      await new Promise((r) => setTimeout(r, 200));
      const genreBars = document.querySelectorAll('#chart-genres .bar-row').length;
      await switchView('suscripciones');
      const ranking = $('#sub-planner-ranking').innerText;
      const items = buildShareList({
        types: new Set(['pelicula', 'serie']), genres: new Set(), platforms: new Set(),
        count: 3, useRated: true, usePending: true, useDiscovery: false,
      });
      return { genreBars, ranking, shareTitles: items.map((i) => i.title) };
    });
    assert.ok(result.genreBars > 0);
    assert.match(result.ranking, /HBO Max/);
    assert.equal(result.shareTitles.length, 3);
  });

  test('exportar al calendario: episodios, temporadas nuevas y renovaciones', async () => {
    const result = await page.eval(() => {
      const events = collectCalendarEvents();
      return { uids: events.map((e) => e.uid), ics: buildCalendar(events, new Date()) };
    });
    assert.ok(result.uids.includes('ep-201-3-4'), result.uids.join(', '));
    assert.ok(result.uids.includes('season-202-2'), result.uids.join(', '));
    assert.ok(result.uids.some((u) => u.startsWith('renewal-hbo-max-')), result.uids.join(', '));
    assert.match(result.ics, /^BEGIN:VCALENDAR\r\n/);
    assert.match(result.ics, /SUMMARY:Serie en curso · T3 E4/);
  });

  test('sin errores en la consola hasta aquí', () => {
    assert.deepEqual(page.problems, []);
  });

  test('la ventana no abre otras páginas ni ejecuta código ajeno', async () => {
    const result = await page.eval(async () => {
      const before = location.href;
      const popup = window.open('file:///C:/Windows/win.ini');
      location.href = 'file:///C:/Windows/win.ini';
      await new Promise((r) => setTimeout(r, 800));
      let ran = false;
      window.__probe = () => { ran = true; };
      const s = document.createElement('script');
      s.textContent = 'window.__probe()';
      document.body.appendChild(s);
      return { popupBlocked: popup === null, stayed: location.href === before, inlineBlocked: !ran, node: typeof require };
    });
    assert.deepEqual(result, { popupBlocked: true, stayed: true, inlineBlocked: true, node: 'undefined' });
  });

  test('al cerrar la ventana la app sigue en la bandeja', async () => {
    await app.closeWindow();
    await sleep(1500);
    assert.equal(app.exited(), false, 'still running');
    assert.ok(app.notifications().some((n) => n.title === 'Películas y Series sigue abierta'), app.output().slice(-600));
    assert.equal(readUserDataJson(userData, 'global-settings.json').trayHintShown, true);
    // The hidden window keeps working in the background.
    assert.equal(await page.eval(() => activeProfileId), ANA);
  });
});

describe('arranque con Windows (--hidden)', () => {
  let tmdb;
  let userData;
  let app;

  before(async () => {
    tmdb = await startFakeTmdb(tmdbRoutes());
    userData = makeUserData(fixtureFiles());
    app = await launchApp({ userDataDir: userData, tmdbUrl: tmdb.url, args: ['--hidden'] });
  });

  after(async () => {
    if (app) await app.close();
    if (tmdb) await tmdb.close();
    if (userData) removeDir(userData);
  });

  test('no pregunta perfil: usa el último y hace las comprobaciones en segundo plano', async () => {
    const { page } = app;
    await page.waitFor(
      () => activeProfileId && movies.length === 6 && !followupsLoading
        && movies.find((m) => m.id === 'p101').platform === 'HBO Max',
      { message: 'background checks with the last profile' },
    );
    const pickerHidden = await page.eval(() => document.querySelector('#profile-overlay').classList.contains('hidden'));
    assert.equal(pickerHidden, true);
    assert.equal(await page.eval(() => activeProfileId), ANA);
    assert.ok(app.notifications().some((n) => n.title === 'Un pendiente ya está en tus plataformas'));
    assert.deepEqual(app.page.problems, []);
  });
});
