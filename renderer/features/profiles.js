// Profile picker/management UI. Plain global-scope script — see updater.js for
// the load-order note.

/* ---------- Profiles ---------- */

function profileInitial(profile) {
  if (profile && profile.initial) return profile.initial.trim().toUpperCase();
  const name = profile && profile.name;
  return (name || '?').trim().charAt(0).toUpperCase() || '?';
}

function avatarInnerHtml(profile) {
  if (profile && profile.avatarUrl) {
    return `<img class="avatar-img" src="${profile.avatarUrl}" alt="">`;
  }
  return escapeHtml(profileInitial(profile));
}

async function resolveActiveProfile() {
  const data = await window.api.listProfiles();
  allProfiles = data.profiles || [];
  if (sessionStorage.getItem('skipProfilePicker') === '1') {
    sessionStorage.removeItem('skipProfilePicker');
    const last = allProfiles.find((p) => p.id === data.lastActiveProfileId);
    if (last) {
      activeProfileId = last.id;
      return;
    }
  }
  const chosen = await showProfilePicker({ forced: true });
  activeProfileId = chosen.id;
  await window.api.setActiveProfile(chosen.id);
}

function updateProfileBadge() {
  const profile = allProfiles.find((p) => p.id === activeProfileId);
  const nameEl = $('#profile-name');
  const avatarEl = $('#profile-avatar');
  if (!nameEl || !avatarEl || !profile) return;
  nameEl.textContent = profile.name;
  avatarEl.innerHTML = avatarInnerHtml(profile);
  avatarEl.style.background = profile.avatarUrl ? 'transparent' : profileColorValue(profile.color);
}

const PROFILE_COLORS = [
  'series-1', 'series-2', 'series-3', 'series-4', 'series-5', 'series-6', 'series-7', 'series-8',
  '#14b8a6', '#84cc16', '#f97316', '#6366f1', '#10b981', '#ff6f59', '#d6409f', '#ca8a04',
  '#0ea5e9', '#a855f7', '#ec4899', '#eab308', '#059669', '#dc2626', '#64748b', '#0891b2',
];

function profileColorValue(color) {
  if (!color) return 'var(--series-1)';
  return color.startsWith('series-') ? `var(--${color})` : color;
}

function renderProfileGrid(mode) {
  const grid = $('#profile-grid');
  grid.innerHTML = allProfiles.map((p) => `
    <div class="profile-card" data-id="${p.id}">
      <div class="profile-card-avatar" style="background:${p.avatarUrl ? 'transparent' : escapeHtml(profileColorValue(p.color))}">${avatarInnerHtml(p)}</div>
      <div class="profile-card-name">${escapeHtml(p.name)}</div>
      ${mode === 'manage' ? `
        <div class="profile-card-actions">
          <button type="button" class="profile-card-rename" data-id="${p.id}" title="Renombrar">✎</button>
          <button type="button" class="profile-card-delete" data-id="${p.id}" title="Eliminar">✕</button>
        </div>
      ` : ''}
    </div>
  `).join('') + `
    <div class="profile-card profile-card-add" id="profile-add-card">
      <div class="profile-card-avatar profile-card-avatar-add">+</div>
      <div class="profile-card-name">Nuevo perfil</div>
    </div>
  `;
}

function showProfilePicker({ forced }) {
  return new Promise((resolve) => {
    const overlay = $('#profile-overlay');
    const closeBtn = $('#profile-close-btn');
    const manageBtn = $('#profile-manage-btn');
    const form = $('#profile-form');
    const deleteConfirm = $('#profile-delete-confirm');
    const deleteNameLabel = $('#profile-delete-name-label');
    const deleteConfirmInput = $('#profile-delete-confirm-input');
    const deleteConfirmBtn = $('#profile-delete-confirm-btn');
    const deleteCancelBtn = $('#profile-delete-cancel');
    const deletedSection = $('#profile-deleted-section');
    const deletedList = $('#profile-deleted-list');
    let mode = 'pick';
    let pendingDeleteProfile = null;
    let deletedProfiles = [];

    closeBtn.classList.toggle('hidden', forced);
    manageBtn.classList.toggle('hidden', allProfiles.length === 0);
    manageBtn.textContent = 'Gestionar perfiles';
    form.classList.add('hidden');
    deleteConfirm.classList.add('hidden');
    deletedSection.classList.add('hidden');

    function renderGrid() {
      renderProfileGrid(mode);
    }
    renderGrid();

    function renderDeletedList() {
      deletedSection.classList.toggle('hidden', mode !== 'manage' || deletedProfiles.length === 0);
      deletedList.innerHTML = deletedProfiles.map((p) => {
        const days = Math.floor((Date.now() - new Date(p.deletedAt).getTime()) / 86400000);
        const daysLeft = Math.max(30 - days, 0);
        return `
          <div class="profile-deleted-item" data-id="${p.id}">
            <div class="profile-deleted-avatar" style="background:${p.avatarUrl ? 'transparent' : escapeHtml(profileColorValue(p.color))}">${avatarInnerHtml(p)}</div>
            <div class="profile-deleted-info">
              <div class="profile-deleted-name">${escapeHtml(p.name)}</div>
              <div class="profile-deleted-meta">Eliminado hace ${days} día${days === 1 ? '' : 's'} · disponible ${daysLeft} día${daysLeft === 1 ? '' : 's'} más</div>
            </div>
            <div class="profile-deleted-actions">
              <button type="button" class="btn profile-restore-btn" data-id="${p.id}">Restaurar</button>
            </div>
          </div>
        `;
      }).join('');
      deletedList.querySelectorAll('.profile-restore-btn').forEach((btn) => {
        btn.addEventListener('click', () => restoreDeletedProfile(btn.dataset.id));
      });
    }

    async function loadDeletedProfiles() {
      deletedProfiles = await window.api.listDeletedProfiles();
      renderDeletedList();
    }

    async function restoreDeletedProfile(id) {
      const res = await window.api.restoreProfile(id);
      if (res.error) return;
      deletedProfiles = deletedProfiles.filter((p) => p.id !== id);
      allProfiles.push(res.profile);
      renderGrid();
      renderDeletedList();
      showToast(`${res.profile.name} restaurado`);
    }

    function cleanup() {
      overlay.removeEventListener('click', onGridClick);
      manageBtn.removeEventListener('click', onToggleManage);
      closeBtn.removeEventListener('click', onClose);
      $('#profile-form-cancel').removeEventListener('click', onFormCancel);
      $('#profile-form').removeEventListener('submit', onFormSubmit);
      deleteConfirmInput.removeEventListener('input', onDeleteConfirmInput);
      deleteConfirmBtn.removeEventListener('click', onDeleteConfirmClick);
      deleteCancelBtn.removeEventListener('click', closeDeleteConfirm);
      $('#profile-form-avatar-pick').removeEventListener('click', onAvatarPick);
      $('#profile-form-avatar-clear').removeEventListener('click', onAvatarClear);
      hideOverlay(overlay);
    }

    function onToggleManage() {
      mode = mode === 'manage' ? 'pick' : 'manage';
      manageBtn.textContent = mode === 'manage' ? 'Listo' : 'Gestionar perfiles';
      renderGrid();
      if (mode === 'manage') {
        loadDeletedProfiles();
      } else {
        deletedSection.classList.add('hidden');
      }
    }

    function openDeleteConfirm(profile) {
      form.classList.add('hidden');
      pendingDeleteProfile = profile;
      deleteNameLabel.textContent = profile.name;
      deleteConfirmInput.value = '';
      deleteConfirmBtn.disabled = true;
      deleteConfirm.classList.remove('hidden');
      deleteConfirmInput.focus();
    }

    function closeDeleteConfirm() {
      pendingDeleteProfile = null;
      deleteConfirm.classList.add('hidden');
    }

    function onDeleteConfirmInput() {
      deleteConfirmBtn.disabled = !pendingDeleteProfile
        || deleteConfirmInput.value.trim() !== pendingDeleteProfile.name;
    }

    async function onDeleteConfirmClick() {
      if (!pendingDeleteProfile) return;
      const profile = pendingDeleteProfile;
      const res = await window.api.deleteProfile(profile.id);
      if (res.error === 'LAST_PROFILE') {
        alert('No puedes eliminar el único perfil.');
        return;
      }
      allProfiles = allProfiles.filter((p) => p.id !== profile.id);
      closeDeleteConfirm();
      renderGrid();
      await loadDeletedProfiles();
      showToast(`${profile.name} eliminado. Puedes restaurarlo desde "Perfiles eliminados".`);
      if (res.wasActive) {
        cleanup();
        location.reload();
      }
    }

    function openCreateForm() {
      closeDeleteConfirm();
      form.classList.remove('hidden');
      form.dataset.editId = '';
      $('#profile-form-title').textContent = 'Nuevo perfil';
      $('#profile-form-name').value = '';
      $('#profile-form-initial').value = '';
      renderColorSwatches(PROFILE_COLORS[allProfiles.length % PROFILE_COLORS.length]);
      renderAvatarSection(null);
      $('#profile-form-name').focus();
    }

    function openEditForm(profile) {
      closeDeleteConfirm();
      form.classList.remove('hidden');
      form.dataset.editId = profile.id;
      $('#profile-form-title').textContent = 'Editar perfil';
      $('#profile-form-name').value = profile.name;
      $('#profile-form-initial').value = profile.initial || '';
      renderColorSwatches(profile.color || 'series-1');
      renderAvatarSection(profile);
      $('#profile-form-name').focus();
    }

    function renderAvatarSection(profile) {
      const section = $('#profile-form-avatar-section');
      const preview = $('#profile-form-avatar-preview');
      const clearBtn = $('#profile-form-avatar-clear');
      if (!profile) {
        section.classList.add('hidden');
        return;
      }
      section.classList.remove('hidden');
      preview.style.background = profile.avatarUrl ? 'transparent' : profileColorValue(profile.color);
      preview.innerHTML = avatarInnerHtml(profile);
      clearBtn.classList.toggle('hidden', !profile.avatarUrl);
    }

    function applyProfileUpdate(updatedProfile) {
      const idx = allProfiles.findIndex((p) => p.id === updatedProfile.id);
      if (idx !== -1) allProfiles[idx] = { ...allProfiles[idx], ...updatedProfile };
      renderAvatarSection(updatedProfile);
      renderGrid();
      if (updatedProfile.id === activeProfileId) updateProfileBadge();
    }

    async function onAvatarPick() {
      const id = form.dataset.editId;
      if (!id) return;
      const res = await window.api.pickProfileAvatar(id);
      if (res.canceled || res.error) return;
      applyProfileUpdate(res.profile);
    }

    async function onAvatarClear() {
      const id = form.dataset.editId;
      if (!id) return;
      const res = await window.api.clearProfileAvatar(id);
      if (res.error) return;
      applyProfileUpdate(res.profile);
    }

    function renderColorSwatches(selected) {
      const wrap = $('#profile-form-colors');
      wrap.innerHTML = PROFILE_COLORS.map((c) => `
        <button type="button" class="profile-color-swatch${c === selected ? ' selected' : ''}" data-color="${c}" style="background:${profileColorValue(c)}"></button>
      `).join('');
      wrap.dataset.selected = selected;
      Array.from(wrap.querySelectorAll('.profile-color-swatch')).forEach((btn) => {
        btn.addEventListener('click', () => {
          wrap.dataset.selected = btn.dataset.color;
          Array.from(wrap.querySelectorAll('.profile-color-swatch')).forEach((b) => b.classList.toggle('selected', b === btn));
        });
      });
    }

    async function onGridClick(e) {
      if (e.target.id === 'profile-overlay' && !forced) {
        cleanup();
        return;
      }
      const renameBtn = e.target.closest('.profile-card-rename');
      const deleteBtn = e.target.closest('.profile-card-delete');
      const addCard = e.target.closest('#profile-add-card');
      const card = e.target.closest('.profile-card:not(.profile-card-add)');

      if (renameBtn) {
        const profile = allProfiles.find((p) => p.id === renameBtn.dataset.id);
        if (profile) openEditForm(profile);
        return;
      }
      if (deleteBtn) {
        const profile = allProfiles.find((p) => p.id === deleteBtn.dataset.id);
        if (profile) openDeleteConfirm(profile);
        return;
      }
      if (addCard) {
        openCreateForm();
        return;
      }
      if (card && deleteConfirm.classList.contains('hidden')) {
        const profile = allProfiles.find((p) => p.id === card.dataset.id);
        if (!profile) return;
        form.classList.add('hidden');
        if (forced) {
          cleanup();
          resolve(profile);
          return;
        }
        if (profile.id === activeProfileId) {
          cleanup();
          return;
        }
        await window.api.setActiveProfile(profile.id);
        sessionStorage.setItem('skipProfilePicker', '1');
        cleanup();
        location.reload();
      }
    }

    function onFormCancel() {
      form.classList.add('hidden');
    }

    async function onFormSubmit(e) {
      e.preventDefault();
      const name = $('#profile-form-name').value.trim();
      if (!name) return;
      const color = $('#profile-form-colors').dataset.selected;
      const initial = $('#profile-form-initial').value.trim().slice(0, 2);
      const editId = form.dataset.editId;
      if (editId) {
        const res = await window.api.updateProfile(editId, { name, color, initial });
        if (res.profile) applyProfileUpdate(res.profile);
        form.classList.add('hidden');
        return;
      }
      const created = await window.api.createProfile(name, color, initial);
      allProfiles.push(created);
      form.classList.add('hidden');
      if (forced) {
        cleanup();
        resolve(created);
        return;
      }
      renderGrid();
    }

    function onClose() {
      cleanup();
    }

    overlay.addEventListener('click', onGridClick);
    manageBtn.addEventListener('click', onToggleManage);
    closeBtn.addEventListener('click', onClose);
    $('#profile-form-cancel').addEventListener('click', onFormCancel);
    $('#profile-form').addEventListener('submit', onFormSubmit);
    deleteConfirmInput.addEventListener('input', onDeleteConfirmInput);
    deleteConfirmBtn.addEventListener('click', onDeleteConfirmClick);
    deleteCancelBtn.addEventListener('click', closeDeleteConfirm);
    $('#profile-form-avatar-pick').addEventListener('click', onAvatarPick);
    $('#profile-form-avatar-clear').addEventListener('click', onAvatarClear);

    showOverlay(overlay);
  });
}


function bindProfileEvents() {
  $('#profile-switcher-btn').addEventListener('click', () => {
    showProfilePicker({ forced: false });
  });
}
