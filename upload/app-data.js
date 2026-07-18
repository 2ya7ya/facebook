(function () {
  'use strict';

  const fallbackAvatar = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#e4e6eb"/><circle cx="100" cy="76" r="40" fill="#7b8087"/><path d="M30 200c5-54 36-80 70-80s65 26 70 80" fill="#7b8087"/></svg>');
  const profileCacheKey = 'facebookProfileCacheV2';
  const pageStateKey = 'facebookActivePageV1';
  const supportedPages = new Set(['home', 'reels', 'friends', 'marketplace', 'notifications', 'profile']);
  let profile = null;
  const wiredEditDocuments = new WeakSet();
  const wiredEditFrames = new WeakSet();
  let photoSaveTimer = 0;
  let frameSaveTimer = 0;

  function readCachedProfile() {
    try {
      const cached = JSON.parse(localStorage.getItem(profileCacheKey) || 'null');
      if (!cached || typeof cached !== 'object') return null;
      cached.profilePhoto = localStorage.getItem('profilePhoto') || cached.profilePhoto || '';
      cached.coverPhoto = localStorage.getItem('coverPhoto') || cached.coverPhoto || '';
      return cached;
    } catch (_error) {
      return null;
    }
  }

  function cacheProfile() {
    if (!profile) return;
    try {
      localStorage.setItem(profileCacheKey, JSON.stringify({
        id: profile.id,
        name: profile.name,
        profileFrameName: profile.profileFrameName || '',
        profileFrameSvg: profile.profileFrameSvg || ''
      }));
      putStoredPhoto('profilePhoto', profile.profilePhoto || '');
      putStoredPhoto('coverPhoto', profile.coverPhoto || '');
    } catch (_error) {}
  }

  function profileFrameUrl() {
    return profile && profile.profileFrameSvg
      ? 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(profile.profileFrameSvg)
      : '';
  }

  function installRuntimeStyles() {
    if (document.getElementById('fbPersistedProfileStyles')) return;
    const style = document.createElement('style');
    style.id = 'fbPersistedProfileStyles';
    style.textContent = [
      '#profile .avatar-container.has-selected-profile-photo .avatar-camera-icon,#profile .avatar-container.has-selected-profile-photo .avatar-add-text{display:none!important}',
      '.fb-global-profile-frame{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;object-fit:contain!important;border-radius:50%!important;pointer-events:none!important;z-index:20!important}',
      '.fb-framed-avatar{position:relative!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;flex:0 0 auto!important}',
      '.fb-framed-avatar>img:not(.fb-global-profile-frame){width:100%!important;height:100%!important;object-fit:cover!important;border-radius:50%!important}',
      'body .fb-create-story.fb-story-card{background:#fff!important;border:1px solid #d8dadf!important}',
      '.fb-create-story::after{display:none!important}',
      'body .fb-create-story.fb-story-card .fb-story-photo[data-home-avatar]{position:absolute!important;inset:auto 0 auto 0!important;top:0!important;bottom:auto!important;width:100%!important;height:70%!important;max-height:70%!important;min-height:0!important;object-fit:cover!important;object-position:center!important;border-radius:0!important;clip-path:none!important;transform:none!important}',
      'body .fb-create-story.fb-story-card .fb-story-plus{display:grid!important;visibility:visible!important;opacity:1!important;position:absolute!important;z-index:50!important;left:50%!important;top:70%!important;transform:translate(-50%,-50%)!important;width:40px!important;height:40px!important;border:4px solid #fff!important;border-radius:50%!important;background:#0866ff!important;color:#fff!important;place-items:center!important;font-size:30px!important;line-height:1!important}',
      'body .fb-create-story.fb-story-card .fb-story-label{display:block!important;visibility:visible!important;opacity:1!important;color:#050505!important;text-shadow:none!important;text-align:center!important;left:4px!important;right:4px!important;bottom:10px!important}'
    ].join('\n');
    document.head.appendChild(style);
  }

  async function api(url, options) {
    const response = await fetch(url, Object.assign({ headers: { 'Content-Type': 'application/json' } }, options || {}));
    const data = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(data.error || 'Something went wrong.');
    return data;
  }

  function message(text) {
    const toast = document.querySelector('#fbHomeToast');
    if (toast) {
      toast.textContent = text;
      toast.classList.add('is-visible');
      clearTimeout(message.timer);
      message.timer = setTimeout(function () { toast.classList.remove('is-visible'); }, 2200);
    } else {
      window.alert(text);
    }
  }

  function applyName() {
    if (!profile) return;
    document.querySelectorAll('.name,.fb-dialog-user strong').forEach(function (element) {
      if (element.textContent !== profile.name) element.textContent = profile.name;
    });
    document.querySelectorAll('.fb-post-name').forEach(function (element) {
      if (element.textContent.trim() === 'User Name') element.textContent = profile.name;
    });
  }

  function applyPhotos() {
    if (!profile) return;
    const avatar = profile.profilePhoto || fallbackAvatar;
    document.querySelectorAll('[data-home-avatar]:not(.fb-story-photo)').forEach(function (image) { image.src = avatar; });
    applyCreateStoryPhoto(avatar);
    const mainPhoto = document.querySelector('#profile .avatar-default-photo');
    const avatarContainer = document.querySelector('#profile .avatar-container');
    if (mainPhoto) {
      mainPhoto.src = profile.profilePhoto || fallbackAvatar;
      mainPhoto.style.filter = 'none';
    }
    if (avatarContainer) {
      avatarContainer.classList.toggle('has-selected-profile-photo', Boolean(profile.profilePhoto));
    }
    if (profile.profilePhoto) document.body.dataset.hasCachedProfilePhoto = 'true';
    else delete document.body.dataset.hasCachedProfilePhoto;
    const cover = document.querySelector('#profile > .cover');
    if (cover && profile.coverPhoto) {
      cover.style.backgroundImage = 'url("' + profile.coverPhoto + '")';
    }
    applyFrames();
  }

  function frameAvatar(image) {
    if (!image || image.classList.contains('fb-story-photo')) return;
    let host = image.parentElement;
    if (!host || !host.classList.contains('fb-framed-avatar')) {
      const rect = image.getBoundingClientRect();
      const computed = getComputedStyle(image);
      host = document.createElement('span');
      host.className = 'fb-framed-avatar';
      host.style.width = computed.width !== 'auto' ? computed.width : Math.max(1, rect.width) + 'px';
      host.style.height = computed.height !== 'auto' ? computed.height : Math.max(1, rect.height) + 'px';
      image.parentNode.insertBefore(host, image);
      host.appendChild(image);
    }
    let overlay = host.querySelector(':scope > .fb-global-profile-frame');
    if (!overlay) {
      overlay = document.createElement('img');
      overlay.className = 'fb-global-profile-frame';
      overlay.alt = '';
      overlay.setAttribute('aria-hidden', 'true');
      host.appendChild(overlay);
    }
    overlay.src = profileFrameUrl();
    overlay.hidden = !profileFrameUrl();
  }

  function applyFrames() {
    if (!profile) return;
    const url = profileFrameUrl();
    const container = document.querySelector('#profile .avatar-container');
    if (container) {
      let overlay = container.querySelector(':scope > .fb-global-profile-frame');
      if (!overlay) {
        overlay = document.createElement('img');
        overlay.className = 'fb-global-profile-frame';
        overlay.alt = '';
        overlay.setAttribute('aria-hidden', 'true');
        container.appendChild(overlay);
      }
      overlay.src = url;
      overlay.hidden = !url;
      delete document.body.dataset.hasCachedProfileFrame;
      container.style.removeProperty('--fb-prepaint-frame');
    }
    document.querySelectorAll('[data-home-avatar]:not(.fb-story-photo),.stored-user-post .fb-post-avatar[data-current-user-avatar]').forEach(frameAvatar);
  }

  function applyCreateStoryPhoto(source) {
    const target = document.querySelector('.app-page[data-page-content="home"] .fb-create-story .fb-story-photo');
    if (!target || !source) return;
    target.src = source;
    target.classList.toggle('fb-prepaint-story-crop', Boolean(profile && profile.profilePhoto));
    if (window.__facebookPrepaintProfile) window.__facebookPrepaintProfile.storyPhoto = source;
  }

  function readSavedPage() {
    try {
      const page = sessionStorage.getItem(pageStateKey) || '';
      return supportedPages.has(page) ? page : '';
    } catch (_error) {
      return '';
    }
  }

  function savePage(page) {
    if (!supportedPages.has(page)) return;
    try { sessionStorage.setItem(pageStateKey, page); } catch (_error) {}
  }

  function setActivePage(page, resetScroll) {
    if (!supportedPages.has(page)) page = 'home';
    document.body.dataset.page = page;
    document.querySelectorAll('.exact-bottom-nav .nav-item[data-page]').forEach(function (item) {
      const active = item.dataset.page === page;
      item.classList.toggle('is-active', active);
      item.classList.toggle('active', active);
      item.classList.toggle('profile-active', active && page === 'profile');
    });
    savePage(page);
    if (resetScroll) window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function installPagePersistence() {
    const savedPage = readSavedPage();
    if (savedPage) setActivePage(savedPage, false);

    document.querySelectorAll('.exact-bottom-nav .nav-item[data-page]').forEach(function (item) {
      item.addEventListener('click', function () {
        setActivePage(item.dataset.page, true);
      }, true);
    });

    const profileBack = document.querySelector('.app-page[data-page-content="profile"] .back-icon');
    if (profileBack) {
      profileBack.setAttribute('role', 'button');
      profileBack.setAttribute('tabindex', '0');
      profileBack.setAttribute('aria-label', 'Back to Home');
      const goHome = function (event) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        setActivePage('home', true);
      };
      profileBack.addEventListener('click', goHome, true);
      profileBack.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') goHome(event);
      }, true);
    }

    new MutationObserver(function () {
      const page = document.body.dataset.page;
      if (supportedPages.has(page)) savePage(page);
    }).observe(document.body, { attributes: true, attributeFilter: ['data-page'] });
  }

  function readImage(file, callback) {
    if (!file) return;
    if (!file.type.startsWith('image/')) return message('Choose an image file.');
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = function () {
      try {
        const maxSide = 1600;
        const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        canvas.getContext('2d', { alpha: false }).drawImage(image, 0, 0, canvas.width, canvas.height);
        const result = canvas.toDataURL('image/jpeg', 0.84);
        URL.revokeObjectURL(objectUrl);
        callback(result);
      } catch (_error) {
        URL.revokeObjectURL(objectUrl);
        message('Could not prepare this image.');
      }
    };
    image.onerror = function () {
      URL.revokeObjectURL(objectUrl);
      message('This image format is not supported.');
    };
    image.src = objectUrl;
  }

  function editContext() {
    try {
      const outerFrame = document.getElementById('mergedEditProfileFrame');
      const shellDocument = outerFrame && outerFrame.contentDocument;
      const pageFrame = shellDocument && shellDocument.getElementById('appFrame');
      const pageDocument = pageFrame && pageFrame.contentDocument;
      if (!outerFrame || !shellDocument || !pageFrame || !pageDocument || !pageDocument.body) return null;
      return { outerFrame: outerFrame, shellDocument: shellDocument, pageFrame: pageFrame, pageDocument: pageDocument, pageWindow: pageFrame.contentWindow };
    } catch (_error) {
      return null;
    }
  }

  function putStoredPhoto(key, value) {
    try {
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    } catch (_error) {}
  }

  function hydrateEditPhotos(context) {
    if (!profile || !context) return;
    putStoredPhoto('profilePhoto', profile.profilePhoto || '');
    putStoredPhoto('pendingProfilePhoto', profile.profilePhoto || '');
    putStoredPhoto('coverPhoto', profile.coverPhoto || '');
    putStoredPhoto('selectedProfileFrameName', profile.profileFrameName || '');
    putStoredPhoto('selectedProfileFrameSvg', profile.profileFrameSvg || '');

    const doc = context.pageDocument;
    const profileContainer = doc.getElementById('profilePhotoContainer');
    if (profileContainer && profile.profilePhoto) {
      let image = Array.from(profileContainer.querySelectorAll('img')).find(function (candidate) {
        return candidate.id !== 'profilePhotoFrameOverlay' && candidate.id !== 'profileSelectedCameraIcon';
      });
      if (!image) {
        image = doc.createElement('img');
        image.alt = 'Profile picture';
        profileContainer.insertBefore(image, profileContainer.firstChild);
      }
      image.src = profile.profilePhoto;
      image.style.display = 'block';
      const overlay = doc.getElementById('profileOverlay');
      if (overlay) {
        overlay.classList.add('hidden');
        overlay.style.display = 'none';
      }
      profileContainer.classList.add('has-selected-profile-photo');
    }

    const coverImage = doc.getElementById('coverPhoto');
    if (coverImage && profile.coverPhoto) {
      coverImage.src = profile.coverPhoto;
      coverImage.style.display = 'block';
      const gradient = doc.getElementById('coverGradient') || doc.querySelector('.cover-placeholder');
      if (gradient) gradient.style.display = 'none';
    }
  }

  async function persistEditPhotos() {
    if (!profile) return;
    let profilePhoto = '';
    let coverPhoto = '';
    try {
      profilePhoto = localStorage.getItem('pendingProfilePhoto') || localStorage.getItem('profilePhoto') || '';
      coverPhoto = localStorage.getItem('coverPhoto') || '';
    } catch (_error) {}

    const changes = {};
    if (/^data:image\//.test(profilePhoto) && profilePhoto !== profile.profilePhoto) changes.profilePhoto = profilePhoto;
    if (/^data:image\//.test(coverPhoto) && coverPhoto !== profile.coverPhoto) changes.coverPhoto = coverPhoto;
    if (!Object.keys(changes).length) return;

    try {
      const result = await api('/api/profile', { method: 'PUT', body: JSON.stringify(changes) });
      profile = Object.assign(profile, result);
      cacheProfile();
      putStoredPhoto('profilePhoto', profile.profilePhoto || '');
      putStoredPhoto('pendingProfilePhoto', profile.profilePhoto || '');
      putStoredPhoto('coverPhoto', profile.coverPhoto || '');
      applyPhotos();
      const currentContext = editContext();
      if (currentContext) hydrateEditPhotos(currentContext);
      message(changes.profilePhoto ? 'Profile picture saved' : 'Cover photo saved');
    } catch (error) {
      message(error.message);
    }
  }

  async function persistEditFrame() {
    if (!profile) return;
    let name = '';
    let svg = '';
    try {
      name = localStorage.getItem('selectedProfileFrameName') || '';
      svg = localStorage.getItem('selectedProfileFrameSvg') || '';
    } catch (_error) {}
    if (name === (profile.profileFrameName || '') && svg === (profile.profileFrameSvg || '')) return;
    const previousName = profile.profileFrameName || '';
    const previousSvg = profile.profileFrameSvg || '';
    profile.profileFrameName = name;
    profile.profileFrameSvg = svg;
    cacheProfile();
    applyFrames();
    try {
      const result = await api('/api/profile', {
        method: 'PUT',
        body: JSON.stringify({ profileFrameName: name, profileFrameSvg: svg })
      });
      profile = Object.assign(profile, result);
      cacheProfile();
      applyFrames();
    } catch (error) {
      profile.profileFrameName = previousName;
      profile.profileFrameSvg = previousSvg;
      cacheProfile();
      applyFrames();
      message(error.message);
    }
  }

  function scheduleFrameSave(delay) {
    clearTimeout(frameSaveTimer);
    frameSaveTimer = setTimeout(persistEditFrame, delay || 80);
  }

  function handleFrameChoice(event, context) {
    const row = event.target.closest && event.target.closest('#profileFramesScreen .pf-row');
    if (!row) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const doc = context.pageDocument;
    const isDefault = row.classList.contains('pf-default-frame');
    let name = '';
    let svg = '';
    if (!isDefault) {
      name = (row.querySelector('.pf-name')?.textContent || '').trim();
      const source = row.querySelector('.pf-thumb-frame')?.src || '';
      if (source.startsWith('data:image/svg+xml')) {
        try { svg = decodeURIComponent(source.slice(source.indexOf(',') + 1)); } catch (_error) {}
      }
    }
    putStoredPhoto('selectedProfileFrameName', name);
    putStoredPhoto('selectedProfileFrameSvg', svg);
    doc.querySelectorAll('#profilePreviewFrameOverlay,#profilePhotoFrameOverlay').forEach(function (overlay) { overlay.remove(); });
    if (svg) {
      const wrap = doc.querySelector('#profilePreviewScreen .preview-circle-wrap');
      if (wrap) {
        const overlay = doc.createElement('img');
        overlay.id = 'profilePreviewFrameOverlay';
        overlay.alt = '';
        overlay.src = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
        wrap.appendChild(overlay);
      }
    }
    doc.getElementById('profileFramesScreen')?.classList.remove('active');
    doc.body.style.overflow = '';
    scheduleFrameSave(20);
  }

  function schedulePhotoSave(delay) {
    clearTimeout(photoSaveTimer);
    photoSaveTimer = setTimeout(persistEditPhotos, delay || 250);
  }

  function wireEditDocument(context) {
    if (!context || wiredEditDocuments.has(context.pageDocument)) return;
    wiredEditDocuments.add(context.pageDocument);
    hydrateEditPhotos(context);
    context.pageDocument.addEventListener('click', function (event) {
      handleFrameChoice(event, context);
    }, true);
    context.pageDocument.addEventListener('click', function (event) {
      const save = event.target.closest && event.target.closest('#profilePreviewScreen .preview-save-btn, #coverPicturePreviewScreen .cover-preview-save, .profile-preview-screen .preview-save-btn, .cover-picture-preview-screen .cover-preview-save');
      if (save) {
        schedulePhotoSave(180);
        setTimeout(persistEditPhotos, 700);
      }
    }, true);
  }

  function connectEditFrame() {
    const outerFrame = document.getElementById('mergedEditProfileFrame');
    if (!outerFrame) return;

    function connectInner() {
      const context = editContext();
      if (!context) return;
      if (!wiredEditFrames.has(context.pageFrame)) {
        wiredEditFrames.add(context.pageFrame);
        context.pageFrame.addEventListener('load', function () {
          const next = editContext();
          if (next) wireEditDocument(next);
        });
      }
      wireEditDocument(context);
    }

    outerFrame.addEventListener('load', function () {
      connectInner();
      setTimeout(connectInner, 80);
    });
    connectInner();

    const layer = document.getElementById('mergedEditProfileLayer');
    if (layer) {
      new MutationObserver(function () {
        if (!layer.classList.contains('is-open')) {
          schedulePhotoSave(120);
          scheduleFrameSave(120);
        }
      }).observe(layer, { attributes: true, attributeFilter: ['class', 'aria-hidden'] });
    }
    window.addEventListener('message', function (event) {
      if (event.data && event.data.type === 'closeMergedEditProfile') {
        schedulePhotoSave(120);
        scheduleFrameSave(120);
      }
    });
  }

  function openEditPhotoPicker(kind) {
    const trigger = document.getElementById('openMergedEditProfile');
    if (trigger) trigger.click();

    let attempt = 0;
    (function openWhenReady() {
      const context = editContext();
      const input = context && context.pageDocument.getElementById(kind === 'cover' ? 'coverInput' : 'profileInput');
      if (context && input) {
        hydrateEditPhotos(context);
        wireEditDocument(context);
        input.click();
        return;
      }
      attempt += 1;
      if (attempt < 40) setTimeout(openWhenReady, 75);
      else message('Could not open the picture editor. Please try again.');
    })();
  }

  function installPhotoControls() {
    connectEditFrame();
    const avatarButton = document.querySelector('#profile .avatar-container');
    const coverButton = document.querySelector('#profile .cover-camera-btn');
    const coverSurface = document.querySelector('#profile > .cover');

    if (avatarButton) {
      avatarButton.style.cursor = 'pointer';
      avatarButton.setAttribute('role', 'button');
      avatarButton.setAttribute('aria-label', 'Change profile picture');
      avatarButton.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        openEditPhotoPicker('profile');
      }, true);
    }
    if (coverButton) {
      coverButton.style.cursor = 'pointer';
      coverButton.setAttribute('role', 'button');
      coverButton.setAttribute('aria-label', 'Change cover photo');
      coverButton.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        openEditPhotoPicker('cover');
      }, true);
    }
    if (coverSurface) {
      coverSurface.style.cursor = 'pointer';
      coverSurface.setAttribute('role', 'button');
      coverSurface.setAttribute('aria-label', 'Change cover photo');
      coverSurface.addEventListener('click', function (event) {
        if (event.target.closest && event.target.closest('.cover-camera-btn')) return;
        event.preventDefault();
        openEditPhotoPicker('cover');
      });
    }
  }

  function postArticle(post) {
    const article = document.createElement('article');
    article.className = 'fb-feed-post stored-user-post';
    article.dataset.postId = post.id;
    article.innerHTML = '<div class="fb-post-head"><img class="fb-post-avatar" alt=""><div class="fb-post-meta"><div class="fb-post-name-row"><span class="fb-post-name"></span></div><div class="fb-post-time">Posted recently · ●</div></div></div><div class="fb-post-text"></div><img class="fb-post-media" alt="Post photo"><div class="fb-post-stats">Be the first to react</div><div class="fb-post-actions"><button class="fb-action-button" type="button" data-stored-action="like">Like</button><button class="fb-action-button" type="button" data-stored-action="comment">Comment</button><button class="fb-action-button" type="button" data-stored-action="share">Share</button></div>';
    article.querySelector('.fb-post-avatar').src = post.profilePhoto || fallbackAvatar;
    if (String(post.userId) === String(profile.id)) {
      article.querySelector('.fb-post-avatar').setAttribute('data-current-user-avatar', 'true');
    }
    article.querySelector('.fb-post-name').textContent = post.author;
    const body = article.querySelector('.fb-post-text');
    body.textContent = post.body || '';
    if (!post.body) body.remove();
    const image = article.querySelector('.fb-post-media');
    if (post.image) image.src = post.image;
    else image.remove();
    article.addEventListener('click', async function (event) {
      const button = event.target.closest('[data-stored-action]');
      if (!button) return;
      if (button.dataset.storedAction === 'like') {
        button.classList.toggle('is-liked');
        button.textContent = button.classList.contains('is-liked') ? 'Liked' : 'Like';
      } else if (button.dataset.storedAction === 'share') {
        try {
          if (navigator.share) await navigator.share({ title: post.author + ' on Facebook', text: post.body || 'Facebook post', url: location.href });
          else await navigator.clipboard.writeText(location.href);
        } catch (_error) {}
      }
    });
    return article;
  }

  async function loadPosts() {
    const home = document.querySelector('.app-page[data-page-content="home"]');
    if (!home) return;
    try {
      const data = await api('/api/posts');
      let container = home.querySelector('#storedUserPosts');
      if (!container) {
        container = document.createElement('div');
        container.id = 'storedUserPosts';
        const stories = home.querySelector('.fb-stories-wrap');
        if (stories) stories.after(container);
      }
      container.replaceChildren.apply(container, data.posts.map(postArticle));
      const count = document.querySelector('.profileSecondaryStatsV125 strong');
      const ownPostCount = data.posts.filter(function (post) { return post.userId === profile.id; }).length;
      if (count) count.textContent = String(ownPostCount);
      try { localStorage.setItem('facebookProfilePostCountV1', String(ownPostCount)); } catch (_error) {}
      document.body.dataset.postCountReady = 'true';
    } catch (error) {
      console.error(error);
    }
  }

  function installPostSaving() {
    document.addEventListener('click', function (event) {
      const button = event.target.closest('#fbPublishPost');
      if (!button || button.disabled) return;
      const text = document.querySelector('#fbComposerText');
      const preview = document.querySelector('#fbComposerPreview');
      const body = text ? text.value.trim() : '';
      const image = preview && preview.style.display !== 'none' && /^data:image\//.test(preview.src) ? preview.src : '';
      api('/api/posts', { method: 'POST', body: JSON.stringify({ body: body, image: image }) })
        .then(function () { setTimeout(loadPosts, 250); })
        .catch(function (error) { message(error.message); });
    }, true);
  }

  async function start() {
    installRuntimeStyles();
    installPagePersistence();
    try {
      const freshProfile = await api('/api/profile');
      profile = freshProfile;
      cacheProfile();
      if (typeof window.__finishFacebookPrepaintProfile === 'function') {
        window.__finishFacebookPrepaintProfile();
      }
      applyName();
      applyPhotos();
      installPhotoControls();
      installPostSaving();
      await loadPosts();
      new MutationObserver(function () { applyName(); applyPhotos(); applyFrames(); }).observe(document.body, { childList: true, subtree: true });
    } catch (error) {
      console.error(error);
      message(error.message);
    }
  }

  installRuntimeStyles();
  const savedPageBeforePaint = readSavedPage();
  if (savedPageBeforePaint) setActivePage(savedPageBeforePaint, false);
  profile = readCachedProfile();
  if (profile) {
    applyName();
    applyPhotos();
    applyFrames();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
