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

  test('tras actualizar, enseña una vez qué hay de nuevo en la versión', async () => {
    const shown = await page.waitFor(() => {
      const overlay = document.querySelector('#update-notes-overlay');
      return !overlay.classList.contains('hidden') && {
        heading: document.querySelector('#update-notes-heading').textContent,
        items: document.querySelectorAll('#update-notes-body li').length,
        installHidden: document.querySelector('#update-notes-install').classList.contains('hidden'),
        seen: localStorage.getItem('app-last-seen-version'),
        version: document.querySelector('#update-notes-version').textContent,
      };
    }, { message: 'what\'s new dialog' });
    assert.match(shown.heading, /Qué hay de nuevo en la versión/);
    assert.ok(shown.items > 3, 'the notes are rendered as a list');
    assert.equal(shown.installHidden, true);
    assert.equal(shown.seen, shown.version);
    await page.eval(() => document.querySelector('#update-notes-later').click());
    await page.waitFor(() => document.querySelector('#update-notes-overlay').classList.contains('hidden'), { message: 'dialog closed' });
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
    assert.deepEqual(notice.target, { view: 'novedades', movieId: 'p101' });
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
    assert.deepEqual(notice.target, { view: 'viendo', movieId: 's201' });
  });

  test('pulsar un aviso abre su apartado y la ficha del título', async () => {
    const opened = await page.eval(async () => {
      openNotificationTarget({ view: 'viendo', movieId: 's201' });
      await new Promise((r) => setTimeout(r, 100));
      const result = {
        view: document.querySelector('.view.active').id,
        modalOpen: !document.querySelector('#modal-overlay').classList.contains('hidden'),
        title: document.querySelector('#f-title').value,
      };
      closeModal();
      await new Promise((r) => setTimeout(r, 300));
      return result;
    });
    assert.deepEqual(opened, { view: 'view-viendo', modalOpen: true, title: 'Serie en curso' });
  });

  test('resumen diario de avisos en lugar de uno por novedad', async () => {
    const count = () => app.notifications().length;
    const before = count();
    const retrigger = () => page.eval(async () => {
      localStorage.setItem(pk('episodes-notified'), '[]');
      await loadFollowups(true);
    });
    await page.eval(() => {
      $('#pref-notify-mode').value = 'digest';
      $('#pref-notify-mode').dispatchEvent(new Event('change'));
      $('#pref-notify-hour').value = '0';
      $('#pref-notify-hour').dispatchEvent(new Event('change'));
    });
    await retrigger();
    const digest = app.notifications().slice(before);
    assert.equal(digest.length, 1);
    assert.equal(digest[0].title, 'Tu resumen de hoy: 1 novedad');
    assert.match(digest[0].body, /Serie en curso: T3 · E3/);

    // Today's digest is out: more notices wait for tomorrow's...
    await retrigger();
    assert.equal(count(), before + 1);
    // ...unless you go back to instant notices, which sends them right away.
    await page.eval(() => {
      $('#pref-notify-mode').value = 'instant';
      $('#pref-notify-mode').dispatchEvent(new Event('change'));
    });
    assert.equal(count(), before + 2);
    await retrigger();
    assert.equal(app.notifications()[count() - 1].title, 'Episodio nuevo de lo que estás viendo');
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

  test('con el teclado: moverse por las tarjetas, abrirlas, atajos y volver al sitio', async () => {
    await page.eval(() => {
      switchView('pendientes');
      document.querySelector('#list-pendientes .card').focus();
    });
    const focused = () => page.eval(() => document.activeElement && (document.activeElement.dataset.id || document.activeElement.id || document.activeElement.tagName));
    const cards = await page.eval(() => [...document.querySelectorAll('#list-pendientes > .card')].map((c) => c.dataset.id));

    await page.press('ArrowRight');
    assert.equal(await focused(), cards[1]);
    await page.press('ArrowLeft');
    assert.equal(await focused(), cards[0]);

    await page.press('Enter');
    await page.waitFor(() => !document.querySelector('#modal-overlay').classList.contains('hidden'), { message: 'card opened' });
    const opened = await page.eval(() => $('#f-title').value);
    assert.equal(opened, await page.eval((id) => movies.find((m) => m.id === id).title, cards[0]));
    await page.press('Escape');
    await page.waitFor((id) => document.querySelector('#modal-overlay').classList.contains('hidden') && document.activeElement.dataset.id === id,
      { args: [cards[0]], message: 'focus back on the card' });

    await page.eval(() => document.activeElement.blur());
    await page.press('n');
    await page.waitFor(() => !document.querySelector('#modal-overlay').classList.contains('hidden') && $('#modal-title').textContent === 'Añadir título',
      { message: 'N opens a new title' });
    await page.press('Escape');
    await page.waitFor(() => document.querySelector('#modal-overlay').classList.contains('hidden'), { message: 'closed' });

    await page.press('3', { alt: true });
    assert.equal(await page.eval(() => document.querySelector('.view.active').id), 'view-viendo');
    assert.equal(await page.eval(() => document.querySelector('.nav-item[aria-current="page"]').dataset.view), 'viendo');
    await page.press('/');
    assert.equal(await focused(), 'search-viendo');
  });

  test('todo botón y campo visible tiene nombre para lectores de pantalla', async () => {
    const offenders = await page.eval(async () => {
      const problems = [];
      const visible = (el) => el.offsetParent !== null;
      for (const view of ['dashboard', 'pendientes', 'viendo', 'vistas', 'novedades', 'suscripciones', 'ajustes']) {
        await switchView(view);
        await new Promise((r) => setTimeout(r, 50));
        document.querySelectorAll('.view.active button, .sidebar button').forEach((b) => {
          if (visible(b) && !(b.textContent.trim() || b.getAttribute('aria-label'))) problems.push(`${view}: button ${b.id || b.className}`);
        });
        document.querySelectorAll('.view.active input:not([type=hidden]), .view.active select, .view.active textarea').forEach((f) => {
          const labelled = (f.labels && f.labels.length) || f.getAttribute('aria-label');
          if (visible(f) && !labelled) problems.push(`${view}: field ${f.id || f.className}`);
        });
      }
      // The add/edit dialog, with every section visible.
      openModal(null);
      $('#f-type').value = 'serie';
      $('#f-status').value = 'viendo';
      updateTypeFieldVisibility();
      updateProgressVisibility();
      await new Promise((r) => setTimeout(r, 300));
      document.querySelectorAll('#modal-overlay button').forEach((b) => {
        if (visible(b) && !(b.textContent.trim() || b.getAttribute('aria-label'))) problems.push(`form: button ${b.id || b.className}`);
      });
      document.querySelectorAll('#modal-overlay input:not([type=hidden]), #modal-overlay select, #modal-overlay textarea').forEach((el) => {
        const labelled = (el.labels && el.labels.length) || el.getAttribute('aria-label');
        if (visible(el) && !labelled) problems.push(`form: field ${el.id || el.className}`);
      });
      closeModal();
      await new Promise((r) => setTimeout(r, 300));
      return problems;
    });
    assert.deepEqual(offenders, []);
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

describe('carpeta de datos compartida entre dos ordenadores', () => {
  const path = require('node:path');
  let tmdb;
  let first;
  let second;
  let shared;
  let app;

  const sharedData = () => path.join(shared, 'Peliculas y Series');
  const sharedMovies = () => path.join(sharedData(), 'profiles', ANA, 'movies.json');
  const readShared = () => JSON.parse(fs.readFileSync(sharedMovies(), 'utf8'));
  // What the other computer's save looks like once OneDrive brings it here.
  const writeShared = (list) => fs.writeFileSync(sharedMovies(), JSON.stringify(list, null, 2));

  async function openProfile(page, count) {
    await page.waitFor((id) => {
      const card = document.querySelector(`#profile-overlay .profile-card[data-id="${id}"]`);
      return card && !document.querySelector('#profile-overlay').classList.contains('hidden') && (card.click(), true);
    }, { args: [ANA], message: 'profile picker' });
    await page.waitFor((n) => activeProfileId && movies.length === n, { args: [count], message: 'profile loaded' });
  }

  // The page reloads after switching folders; `beforeSwitch` doesn't survive it.
  const waitForReload = (page) => page.waitFor(() => !window.beforeSwitch && document.readyState === 'complete', { message: 'page reloaded' });

  // Picks `dir` in Ajustes → Carpeta de datos, accepting the confirmation;
  // the page reloads afterwards.
  async function pickFolder(page, dir) {
    const info = await page.eval((d) => window.api.inspectDataLocation(d), dir);
    await page.eval((i) => {
      window.confirm = () => true;
      window.beforeSwitch = true;
      setTimeout(() => applyDataLocation(i));
    }, info);
    await waitForReload(page);
    return info;
  }

  before(async () => {
    tmdb = await startFakeTmdb(tmdbRoutes());
    first = makeUserData(fixtureFiles());
    second = makeUserData({ 'global-settings.json': { tmdbApiKey: 'test-key' } });
    shared = makeUserData({});
  });

  after(async () => {
    if (app) await app.close();
    if (tmdb) await tmdb.close();
    [first, second, shared].forEach((d) => d && removeDir(d));
  });

  test('mover los datos a la carpeta compartida los copia y la app sigue igual', async () => {
    app = await launchApp({ userDataDir: first, tmdbUrl: tmdb.url });
    await openProfile(app.page, 6);
    const info = await pickFolder(app.page, shared);
    assert.equal(info.hasData, false);
    assert.equal(info.dir, sharedData());
    await openProfile(app.page, 6);
    assert.equal(readShared().length, 6);
    assert.equal(readUserDataJson(first, 'data-location.json').dir, sharedData());
    // This computer's settings (the TMDB key) stay in its own folder.
    assert.equal(fs.existsSync(path.join(sharedData(), 'global-settings.json')), false);
    await app.page.eval(() => switchView('ajustes'));
    assert.equal(await app.page.eval(() => $('#data-location-path').textContent), sharedData());
  });

  test('cambios a la vez en los dos ordenadores: se juntan en lugar de pisarse', async () => {
    const { page } = app;
    // The other computer rated one title and added another...
    const other = readShared().map((m) => (m.id === 'p102' ? { ...m, rating: 4 } : m));
    other.push(title({ id: 'x1', title: 'Añadida en el otro' }));
    writeShared(other);
    // ...while this one, without having seen that, edits a different title.
    await page.eval(async () => {
      movies.find((m) => m.id === 'p104').notes = 'nota de aquí';
      await saveMovies();
    });
    const onDisk = readShared();
    assert.equal(onDisk.find((m) => m.id === 'p102').rating, 4);
    assert.equal(onDisk.find((m) => m.id === 'p104').notes, 'nota de aquí');
    assert.ok(onDisk.some((m) => m.id === 'x1'));
    const shown = await page.eval(() => ({ count: movies.length, x1: movies.some((m) => m.id === 'x1') }));
    assert.deepEqual(shown, { count: 7, x1: true });
  });

  test('al volver a la ventana se ve lo que cambió el otro ordenador', async () => {
    const { page } = app;
    writeShared(readShared().filter((m) => m.id !== 'x1'));
    await page.eval(() => reloadSharedChanges());
    assert.equal(await page.eval(() => movies.some((m) => m.id === 'x1')), false);
    assert.deepEqual(page.problems, []);
    await app.close();
    app = null;
  });

  test('otro ordenador elige la misma carpeta y usa esos datos', async () => {
    app = await launchApp({ userDataDir: second, tmdbUrl: tmdb.url });
    const { page } = app;
    await page.waitFor(() => !document.querySelector('#profile-overlay').classList.contains('hidden'), { message: 'profile picker' });
    // Picking the parent folder again finds the data inside it.
    const info = await pickFolder(page, shared);
    assert.equal(info.hasData, true);
    await openProfile(page, 6);
    assert.equal(await page.eval(() => movies.find((m) => m.id === 'p104').notes), 'nota de aquí');
  });

  test('volver a guardar solo en este ordenador se lleva los datos de ahora', async () => {
    const { page } = app;
    await page.eval(() => {
      window.confirm = () => true;
      window.beforeSwitch = true;
      setTimeout(() => resetDataLocation());
    });
    await waitForReload(page);
    await openProfile(page, 6);
    assert.equal(fs.existsSync(path.join(second, 'data-location.json')), false);
    assert.equal(readUserDataJson(second, `profiles/${ANA}/movies.json`).length, 6);
    // What this computer had before (an empty profile list) is kept aside.
    assert.ok(fs.readdirSync(second).some((f) => f.startsWith('datos-anteriores-')));
    assert.deepEqual(page.problems, []);
    await app.close();
    app = null;
  });

  test('si la carpeta compartida no está (OneDrive sin sincronizar), usa la de este ordenador y lo avisa', async () => {
    const gone = path.join(shared, 'no-existe');
    fs.writeFileSync(path.join(first, 'data-location.json'), JSON.stringify({ dir: gone }));
    app = await launchApp({ userDataDir: first, tmdbUrl: tmdb.url });
    await openProfile(app.page, 6);
    const warning = await app.page.eval(() => {
      switchView('ajustes');
      const el = $('#data-location-missing');
      return !el.classList.contains('hidden') && el.textContent;
    });
    assert.ok(warning && warning.includes(gone), warning);
    // Nothing is rewritten: once the folder is back, a restart uses it again.
    assert.equal(readUserDataJson(first, 'data-location.json').dir, gone);
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
    // The notice is sent after the platform changes and reaches stdout a bit later.
    const noticed = () => app.notifications().some((n) => n.title === 'Un pendiente ya está en tus plataformas');
    for (let t = Date.now(); !noticed() && Date.now() - t < 5000;) await sleep(100);
    assert.ok(noticed(), app.output().slice(-600));
    assert.deepEqual(app.page.problems, []);
  });
});
