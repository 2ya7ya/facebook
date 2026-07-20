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
  let composerMode = 'post';
  let currentReel = null;

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
      'body .fb-create-story.fb-story-card .fb-story-label{display:block!important;visibility:visible!important;opacity:1!important;color:#050505!important;text-shadow:none!important;text-align:center!important;left:4px!important;right:4px!important;bottom:10px!important}',
      '.fb-stored-comments{padding:0 14px;background:#fff}',
      '.fb-stored-comment{padding:7px 11px;margin:5px 0;border-radius:14px;background:#f0f2f5;font-size:14px;line-height:19px}',
      '.fb-stored-comment strong{display:block;font-size:13px}',
      '.fb-stored-comment-form{display:none;gap:8px;padding:9px 14px 12px;border-top:1px solid #f0f2f5;background:#fff}',
      '.fb-stored-comment-form.is-open{display:flex}',
      '.fb-stored-comment-form input{height:38px;flex:1;border:0;border-radius:20px;background:#f0f2f5;padding:0 14px;font-size:15px;outline:none}',
      '.fb-stored-comment-form button{border:0;background:transparent;color:#0866ff;font-weight:700}',
      '.reels-avatar img{width:100%;height:100%;object-fit:cover;display:block}',
      '.reels-comment-entry{padding:8px 10px;margin-bottom:7px;border-radius:12px;background:#f0f2f5;color:#1c1e21;line-height:19px}',
      '.reels-comment-entry strong{display:block;font-size:13px}'
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
    const signature = source.length + ':' + source.slice(0, 64) + ':' + source.slice(-64);
    try {
      const cached = JSON.parse(localStorage.getItem('facebookCreateStoryPhotoCacheV2') || 'null');
      if (cached && cached.signature === signature && /^data:image\//.test(cached.image || '')) {
        target.src = cached.image;
        target.classList.remove('fb-prepaint-story-crop');
        if (typeof window.__markFacebookStoryReady === 'function') window.__markFacebookStoryReady(cached.image);
        return;
      }
    } catch (_error) {}

    if (!profile || !profile.profilePhoto) {
      target.src = source;
      target.classList.remove('fb-prepaint-story-crop');
      if (typeof window.__markFacebookStoryReady === 'function') window.__markFacebookStoryReady(source);
      return;
    }

    const image = new Image();
    image.onload = function () {
      try {
        const width = image.naturalWidth;
        const height = image.naturalHeight;
        const side = (Math.min(width, height) / Math.SQRT2) * 0.98;
        const output = document.createElement('canvas');
        const outputSize = Math.min(600, Math.max(320, Math.round(side)));
        output.width = outputSize;
        output.height = outputSize;
        output.getContext('2d', { alpha: false }).drawImage(
          image, (width - side) / 2, (height - side) / 2, side, side,
          0, 0, outputSize, outputSize
        );
        const result = output.toDataURL('image/jpeg', 0.84);
        target.src = result;
        target.classList.remove('fb-prepaint-story-crop');
        try { localStorage.setItem('facebookCreateStoryPhotoCacheV2', JSON.stringify({ signature: signature, image: result })); } catch (_error) {}
        if (window.__facebookPrepaintProfile) {
          window.__facebookPrepaintProfile.storyPhoto = result;
          window.__facebookPrepaintProfile.storyPhotoReady = true;
        }
        if (typeof window.__markFacebookStoryReady === 'function') window.__markFacebookStoryReady(result);
      } catch (_error) {
        target.src = source;
        target.classList.remove('fb-prepaint-story-crop');
        if (typeof window.__markFacebookStoryReady === 'function') window.__markFacebookStoryReady(source);
      }
    };
    image.onerror = function () {
      target.src = source;
      target.classList.remove('fb-prepaint-story-crop');
      if (typeof window.__markFacebookStoryReady === 'function') window.__markFacebookStoryReady(source);
    };
    image.src = source;
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

  function countText(count, singular) {
    return String(count) + ' ' + singular + (count === 1 ? '' : 's');
  }

  function renderPostComments(article, comments) {
    const list = article.querySelector('.fb-stored-comments');
    list.replaceChildren();
    comments.forEach(function (comment) {
      const item = document.createElement('div');
      item.className = 'fb-stored-comment';
      const author = document.createElement('strong');
      const body = document.createElement('span');
      author.textContent = comment.author || 'Facebook user';
      body.textContent = comment.body;
      item.append(author, body);
      list.appendChild(item);
    });
  }

  function postArticle(post) {
    const article = document.createElement('article');
    article.className = 'fb-feed-post stored-user-post';
    article.dataset.postId = post.id;
    article.innerHTML = '<div class="fb-post-head"><img class="fb-post-avatar" alt=""><div class="fb-post-meta"><div class="fb-post-name-row"><span class="fb-post-name"></span></div><div class="fb-post-time">Posted recently · ●</div></div></div><div class="fb-post-text"></div><img class="fb-post-media" alt="Post photo"><div class="fb-post-stats"><span data-post-like-count></span><span class="fb-stat-spacer"></span><span data-post-comment-count></span></div><div class="fb-post-actions"><button class="fb-action-button" type="button" data-stored-action="like">Like</button><button class="fb-action-button" type="button" data-stored-action="comment">Comment</button><button class="fb-action-button" type="button" data-stored-action="share">Share</button></div><div class="fb-stored-comments"></div><form class="fb-stored-comment-form"><input maxlength="1000" placeholder="Write a comment…" aria-label="Write a comment"><button type="submit">Post</button></form>';
    article.querySelector('.fb-post-avatar').src = post.profilePhoto || fallbackAvatar;
    if (String(post.userId) === String(profile.id)) article.querySelector('.fb-post-avatar').setAttribute('data-current-user-avatar', 'true');
    article.querySelector('.fb-post-name').textContent = post.author;
    const body = article.querySelector('.fb-post-text');
    body.textContent = post.body || '';
    if (!post.body) body.remove();
    const image = article.querySelector('.fb-post-media');
    if (post.image) image.src = post.image;
    else image.remove();
    const comments = Array.isArray(post.comments) ? post.comments.slice() : [];
    const likeButton = article.querySelector('[data-stored-action="like"]');
    likeButton.classList.toggle('is-liked', Boolean(post.likedByMe));
    likeButton.textContent = post.likedByMe ? 'Liked' : 'Like';
    article.querySelector('[data-post-like-count]').textContent = countText(Number(post.likeCount || 0), 'like');
    article.querySelector('[data-post-comment-count]').textContent = countText(comments.length, 'comment');
    renderPostComments(article, comments);
    article.addEventListener('click', async function (event) {
      const button = event.target.closest('[data-stored-action]');
      if (!button || button.disabled) return;
      if (button.dataset.storedAction === 'like') {
        button.disabled = true;
        try {
          const data = await api('/api/posts/' + encodeURIComponent(post.id) + '/like', { method: 'POST', body: '{}' });
          document.querySelectorAll('.stored-user-post[data-post-id="' + post.id + '"]').forEach(function (copy) {
            const copyButton = copy.querySelector('[data-stored-action="like"]');
            copyButton.classList.toggle('is-liked', data.liked);
            copyButton.textContent = data.liked ? 'Liked' : 'Like';
            copy.querySelector('[data-post-like-count]').textContent = countText(data.likeCount, 'like');
          });
        } catch (error) { message(error.message); }
        finally { button.disabled = false; }
      } else if (button.dataset.storedAction === 'comment') {
        const form = article.querySelector('.fb-stored-comment-form');
        form.classList.toggle('is-open');
        if (form.classList.contains('is-open')) form.querySelector('input').focus();
      } else if (button.dataset.storedAction === 'share') {
        try {
          if (navigator.share) await navigator.share({ title: post.author + ' on Facebook', text: post.body || 'Facebook post', url: location.href });
          else await navigator.clipboard.writeText(location.href);
        } catch (_error) {}
      }
    });
    article.querySelector('.fb-stored-comment-form').addEventListener('submit', async function (event) {
      event.preventDefault();
      const input = event.currentTarget.querySelector('input');
      const submit = event.currentTarget.querySelector('button');
      const value = input.value.trim();
      if (!value || submit.disabled) return;
      submit.disabled = true;
      try {
        const data = await api('/api/posts/' + encodeURIComponent(post.id) + '/comments', { method: 'POST', body: JSON.stringify({ body: value }) });
        comments.push(data.comment);
        renderPostComments(article, comments);
        article.querySelector('[data-post-comment-count]').textContent = countText(comments.length, 'comment');
        input.value = '';
        await loadPosts();
      } catch (error) { message(error.message); }
      finally { submit.disabled = false; }
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
      const profileSection = document.querySelector('#profile')?.parentElement?.querySelector('.posts-section');
      const ownPosts = data.posts.filter(function (post) { return String(post.userId) === String(profile.id); });
      if (profileSection) {
        let profilePosts = profileSection.querySelector('#profileStoredPosts');
        if (!profilePosts) {
          profilePosts = document.createElement('div');
          profilePosts.id = 'profileStoredPosts';
          const emptyState = profileSection.querySelector('.empty-state');
          profileSection.insertBefore(profilePosts, emptyState || null);
        }
        profilePosts.replaceChildren.apply(profilePosts, ownPosts.map(postArticle));
        const emptyState = profileSection.querySelector('.empty-state');
        if (emptyState) emptyState.style.display = ownPosts.length ? 'none' : '';
      }
      const count = document.querySelector('.profileSecondaryStatsV125 strong');
      const ownPostCount = ownPosts.length;
      if (count) count.textContent = String(ownPostCount);
      try { localStorage.setItem('facebookProfilePostCountV1', String(ownPostCount)); } catch (_error) {}
      document.body.dataset.postCountReady = 'true';
    } catch (error) {
      console.error(error);
    }
  }

  function storyCard(story) {
    const button = document.createElement('button');
    button.className = 'fb-story-card stored-story-card';
    button.type = 'button';
    button.dataset.storyName = story.author;
    button.dataset.storySrc = story.image;
    const photo = document.createElement('img');
    const ring = document.createElement('img');
    const label = document.createElement('span');
    photo.className = 'fb-story-photo';
    photo.src = story.image;
    photo.alt = story.author + ' story';
    ring.className = 'fb-story-ring';
    ring.src = story.profilePhoto || fallbackAvatar;
    ring.alt = '';
    label.className = 'fb-story-label';
    label.textContent = story.author;
    button.append(photo, ring, label);
    return button;
  }

  async function loadStories() {
    const rail = document.querySelector('.app-page[data-page-content="home"] .fb-stories');
    if (!rail) return;
    try {
      const data = await api('/api/stories');
      rail.querySelectorAll('.stored-story-card').forEach(function (card) { card.remove(); });
      data.stories.forEach(function (story) { rail.appendChild(storyCard(story)); });
    } catch (error) {
      console.error(error);
    }
  }

  function reelMessage(root, text) {
    const toast = root.querySelector('.reels-toast');
    if (!toast) return message(text);
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(reelMessage.timer);
    reelMessage.timer = setTimeout(function () { toast.classList.remove('show'); }, 2200);
  }

  function setReelCount(root, action, count) {
    const target = root.querySelector('[data-reel-action="' + action + '"] .reels-action-count');
    if (target) target.textContent = String(count || 0);
  }

  function renderReelComments(root, comments) {
    const list = root.querySelector('.reels-comments-list');
    list.replaceChildren();
    if (!comments.length) {
      list.textContent = 'No comments yet. Be the first to comment.';
      return;
    }
    comments.forEach(function (comment) {
      const item = document.createElement('div');
      item.className = 'reels-comment-entry';
      const author = document.createElement('strong');
      const body = document.createElement('span');
      author.textContent = comment.author || 'Facebook user';
      body.textContent = comment.body;
      item.append(author, body);
      list.appendChild(item);
    });
  }

  function showReel(root, reel) {
    currentReel = reel;
    const video = root.querySelector('#reelsVideo');
    const empty = root.querySelector('.reels-empty-state');
    const avatar = root.querySelector('.reels-avatar');
    const caption = root.querySelector('#reelsCaptionDisplay');
    video.src = reel.video;
    const edits = Object.assign({ trimStart: 0, trimEnd: 0, brightness: 1, contrast: 1, saturation: 1, effect: 'none', text: '', sticker: '', captions: false, overlay: false, fit: 'contain' }, reel.editData || {});
    const effectFilters = { none: '', warm: 'sepia(.22) hue-rotate(-8deg)', cool: 'hue-rotate(18deg) saturate(.9)', mono: 'grayscale(1)', vivid: 'saturate(1.45) contrast(1.08)' };
    video.style.filter = 'brightness(' + edits.brightness + ') contrast(' + edits.contrast + ') saturate(' + edits.saturation + ') ' + (effectFilters[edits.effect] || '');
    video.style.objectFit = edits.fit === 'cover' ? 'cover' : 'contain';
    video.dataset.trimStart = String(edits.trimStart || 0);
    video.dataset.trimEnd = String(edits.trimEnd || 0);
    let publishedOverlay = root.querySelector('.reels-published-overlay');
    if (!publishedOverlay) {
      publishedOverlay = document.createElement('div');
      publishedOverlay.className = 'reels-published-overlay';
      root.appendChild(publishedOverlay);
    }
    publishedOverlay.classList.toggle('has-vignette', Boolean(edits.overlay));
    publishedOverlay.replaceChildren();
    if (edits.text) {
      const text = document.createElement('span');
      text.className = 'reel-overlay-text';
      text.textContent = edits.text;
      publishedOverlay.appendChild(text);
    }
    if (edits.sticker) {
      const sticker = document.createElement('span');
      sticker.className = 'reel-overlay-sticker';
      sticker.textContent = edits.sticker;
      publishedOverlay.appendChild(sticker);
    }
    if (edits.captions) {
      const generatedCaption = document.createElement('span');
      generatedCaption.className = 'reel-overlay-captions';
      generatedCaption.textContent = reel.caption || 'Captions enabled';
      publishedOverlay.appendChild(generatedCaption);
    }
    video.classList.add('has-source');
    if (empty) empty.style.display = 'none';
    root.querySelector('#reelsCreatorName').textContent = reel.author || 'Facebook user';
    if (caption) {
      caption.textContent = reel.caption || '';
      caption.hidden = !reel.caption;
    }
    if (avatar) {
      const image = document.createElement('img');
      image.src = reel.profilePhoto || fallbackAvatar;
      image.alt = '';
      avatar.replaceChildren(image);
    }
    const like = root.querySelector('[data-reel-action="like"]');
    like.classList.toggle('is-active', Boolean(reel.likedByMe));
    if (like.querySelector('img') && window.__reelReactionIcons) like.querySelector('img').src = reel.likedByMe ? window.__reelReactionIcons.liked : window.__reelReactionIcons.outline;
    setReelCount(root, 'like', reel.likeCount);
    setReelCount(root, 'comments', reel.comments.length);
    renderReelComments(root, reel.comments);
    const commentForm = root.querySelector('.reels-comment-form');
    if (commentForm) {
      commentForm.querySelectorAll('input,button').forEach(function (control) { control.disabled = reel.allowComments === false; });
      if (reel.allowComments === false && !reel.comments.length) root.querySelector('.reels-comments-list').textContent = 'Comments are turned off for this Reel.';
    }
    video.addEventListener('loadedmetadata', function setPublishedTrim() {
      video.removeEventListener('loadedmetadata', setPublishedTrim);
      const start = Number(video.dataset.trimStart || 0);
      if (start > 0 && start < video.duration) video.currentTime = start;
    });
    video.play().catch(function () {});
  }

  async function loadLatestReel() {
    const root = document.querySelector('.app-page[data-page-content="reels"] .reels-page');
    if (!root) return;
    try {
      const data = await api('/api/reels');
      if (data.reels && data.reels[0]) showReel(root, data.reels[0]);
    } catch (error) {
      console.error(error);
    }
  }

  function fileData(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(new Error('Could not read the selected file.')); };
      reader.readAsDataURL(file);
    });
  }

  function installReels() {
    const root = document.querySelector('.app-page[data-page-content="reels"] .reels-page');
    if (!root || root.dataset.persistenceReady) return;
    root.dataset.persistenceReady = 'true';
    const file = root.querySelector('#reelsFile');
    const flow = root.querySelector('#reelCreateFlow');
    const publish = flow.querySelector('#reelCreatePublish');
    const caption = flow.querySelector('#reelCreateCaption');
    const settings = flow.querySelector('#reelSettingsLayer');
    const allowComments = flow.querySelector('#reelAllowComments');
    const audienceLabel = flow.querySelector('#reelAudienceLabel');
    const commentsLabel = flow.querySelector('#reelCommentsLabel');
    const previewVideos = Array.from(flow.querySelectorAll('video'));
    const form = root.querySelector('.reels-comment-form');
    const publishedVideo = root.querySelector('#reelsVideo');
    let selectedVideo = null;
    let selectedVideoData = '';
    let videoLoadGeneration = 0;
    let editState = freshEditState();
    const editVideo = flow.querySelector('#reelEditVideo');
    const editTime = flow.querySelector('#reelEditTime');
    const editPlayButton = flow.querySelector('[data-reel-flow-action="toggle-edit-play"]');
    const editPlayIcon = flow.querySelector('#reelEditPlayIcon');
    const editStage = flow.querySelector('[data-reel-create-stage="edit"]');
    const editCurrentLabel = flow.querySelector('#reelEditCurrent');
    const editTotalLabel = flow.querySelector('#reelEditTotal');
    const undoButton = flow.querySelector('#reelUndoButton');
    const redoButton = flow.querySelector('#reelRedoButton');
    const fullscreenButton = flow.querySelector('#reelFullscreenButton');
    const minimizeButton = flow.querySelector('#reelMinimizeButton');
    const fullscreenExitButton = flow.querySelector('#reelFullscreenExitButton');
    const fullscreenPausedOverlay = flow.querySelector('#reelFullscreenPausedOverlay');
    const editMeta = flow.querySelector('.reel-edit-meta');
    if (editMeta && fullscreenButton && fullscreenButton.parentElement !== editMeta) editMeta.appendChild(fullscreenButton);
    const fullscreenProgress = flow.querySelector('#reelFullscreenProgress');
    const fullscreenCurrent = flow.querySelector('#reelFullscreenCurrent');
    const fullscreenTotal = flow.querySelector('#reelFullscreenTotal');
    const undoStack = [];
    const redoStack = [];
    let restoringHistory = false;

    const timeline = flow.querySelector('.reel-timeline');
    const timelineScroll = document.createElement('div');
    const timelineContent = document.createElement('div');
    const timelineTicks = document.createElement('div');
    const timelineFilmstrip = document.createElement('div');
    const timelineAudio = document.createElement('div');
    const timelineSoundLabel = document.createElement('div');
    const timelinePlayhead = document.createElement('div');
    const timelineMuteRail = document.createElement('div');
    const timelineMuteButton = document.createElement('button');
    const timelineMutedIndicator = document.createElement('span');
    const timelineSelection = document.createElement('div');
    const trimStartHandle = document.createElement('button');
    const trimEndHandle = document.createElement('button');
    const trimDurationLabel = document.createElement('span');
    const timelineAdd = timeline.querySelector('.reel-timeline-add');
    const pixelsPerSecond = 82;
    let timelineDuration = 0;
    let timelineSyncing = false;
    let timelineBuildKey = '';
    let timelineAnimationFrame = 0;
    let timelineVideoFrameCallback = 0;
    let timelineLastTextUpdate = 0;
    let timelinePlaybackAnimation = null;
    let timelineDragging = false;
    let timelinePointerDown = false;
    let timelineSettleTimer = 0;
    let timelineSelected = false;
    let timelineStageVisible = false;
    let trimCounterFrozen = false;
    let staticCounterText = '00:00/00:00';
    let staticTrimDurationText = '0s';
    timelineScroll.className = 'reel-timeline-scroll';
    timelineContent.className = 'reel-timeline-content';
    timelineTicks.className = 'reel-timeline-ticks';
    timelineFilmstrip.className = 'reel-timeline-filmstrip';
    timelineAudio.className = 'reel-timeline-audio';
    timelineAudio.dataset.reelTool = 'sound';
    timelineSoundLabel.className = 'reel-timeline-sound-label';
    timelineSoundLabel.setAttribute('aria-hidden', 'true');
    timelineSoundLabel.innerHTML = '<span class="reel-add-sound-label-inner"><img class="reel-add-sound-note" src="data:image/png;base64,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" alt="">Add sound</span>';
    timelinePlayhead.className = 'reel-timeline-playhead';
    timelineMuteRail.className = 'reel-timeline-mute-rail';
    timelineMuteButton.className = 'reel-timeline-mute';
    timelineMuteButton.type = 'button';
    timelineMuteButton.setAttribute('aria-label', 'Mute video');
    timelineMuteButton.setAttribute('aria-pressed', 'false');
    timelineMuteButton.innerHTML = '';
    timelineMutedIndicator.className = 'reel-timeline-muted-indicator';
    timelineMutedIndicator.setAttribute('aria-hidden', 'true');
    timelineMutedIndicator.innerHTML = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 12h5l7-6v20l-7-6H5z"/><path d="M21 11l7 10M28 11l-7 10" class="mute-cross"/></svg>';
    function muteIconSvg(muted) {
      return muted
        ? '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 12h5l7-6v20l-7-6H5z"/><path d="M21 11l7 10M28 11l-7 10" class="mute-cross"/></svg>'
        : '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 12h5l7-6v20l-7-6H5z"/><path d="M21 11c2 2 2 8 0 10M24 8c5 5 5 11 0 16" class="sound-waves"/></svg>';
    }
    timelineSelection.className = 'reel-timeline-selection';
    trimStartHandle.className = 'reel-trim-handle reel-trim-start';
    trimEndHandle.className = 'reel-trim-handle reel-trim-end';
    trimStartHandle.type = trimEndHandle.type = 'button';
    trimStartHandle.setAttribute('aria-label', 'Trim video start');
    trimEndHandle.setAttribute('aria-label', 'Trim video end');
    trimStartHandle.textContent = '‹';
    trimEndHandle.textContent = '›';
    trimDurationLabel.className = 'reel-trim-duration';
    timelineSelection.append(trimStartHandle, trimEndHandle);
    timelineMuteRail.appendChild(timelineMuteButton);
    timelineContent.append(timelineFilmstrip, timelineAudio, timelineSelection, timelineMuteRail, trimDurationLabel, timelineMutedIndicator);
    timelineScroll.appendChild(timelineContent);
    timeline.replaceChildren(timelineScroll, timelineTicks, timelinePlayhead, timelineSoundLabel);
    if (timelineAdd) timeline.appendChild(timelineAdd);
    timelineMuteRail.hidden = true;
    function syncTimelineMuteButton() {
      // The audio row is visual only; keep the single playhead-anchored label.
      if (timelineAudio.textContent) timelineAudio.textContent = '';
      timeline.querySelectorAll('.reel-timeline-sound-label').forEach(function (label, index) {
        if (index > 0) label.remove();
      });
      const muted = Boolean(editVideo.muted);
      timelineMuteButton.setAttribute('aria-pressed', muted ? 'true' : 'false');
      timelineMuteButton.setAttribute('aria-label', muted ? 'Unmute video' : 'Mute video');
      timelineMuteButton.innerHTML = muteIconSvg(muted);
      updateMutedIndicatorPosition();
    }
    function updateMutedIndicatorPosition(previewTrimLeftPx) {
      const muted = Boolean(editVideo.muted);
      timelineMutedIndicator.classList.toggle('is-visible', muted);
      if (!muted) return;
      const durationVisible = trimDurationLabel.classList.contains('is-active');
      timelineMutedIndicator.classList.toggle('is-beside-duration', durationVisible);
      timelineMutedIndicator.classList.toggle('is-top-left', !durationVisible);
      const bounds = activeTrimBounds();
      const trimLeftPx = Number.isFinite(previewTrimLeftPx)
        ? previewTrimLeftPx
        : bounds.start * pixelsPerSecond;
      if (durationVisible) {
        // Use a fixed duration slot so values such as 30s and 30.1s never
        // shift the muted icon horizontally.
        timelineMutedIndicator.style.left = (trimLeftPx + 9 + 52) + 'px';
        timelineMutedIndicator.style.top = '32px';
      } else {
        // Keep the indicator inside the filmstrip, at its top-left corner.
        timelineMutedIndicator.style.left = (trimLeftPx + 8) + 'px';
        timelineMutedIndicator.style.top = '31px';
      }
    }
    ['pointerdown', 'pointerup', 'touchstart', 'touchend'].forEach(function (type) {
      timelineMuteButton.addEventListener(type, function (event) {
        event.stopPropagation();
      }, { passive: type.startsWith('touch') });
    });
    timelineMuteButton.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      const stayedPaused = editVideo.paused;
      const historyBeforeMute = captureEditorSnapshot();
      editVideo.muted = !editVideo.muted;
      if (stayedPaused && !editVideo.paused) editVideo.pause();
      syncTimelineMuteButton();
      recordEditorChange(historyBeforeMute);
    });
    syncTimelineMuteButton();
    const effectOrder = ['none', 'warm', 'cool', 'mono', 'vivid'];
    const stickers = ['', '✨', '❤️', '🔥', '😊'];
    const effectFilters = { none: '', warm: 'sepia(.22) hue-rotate(-8deg)', cool: 'hue-rotate(18deg) saturate(.9)', mono: 'grayscale(1)', vivid: 'saturate(1.45) contrast(1.08)' };
    const toolPanel = document.createElement('section');
    toolPanel.className = 'reel-tool-panel';
    toolPanel.setAttribute('aria-hidden', 'true');
    flow.appendChild(toolPanel);
    const loadingIndicator = document.createElement('div');
    loadingIndicator.className = 'reel-video-loading';
    loadingIndicator.innerHTML = '<span></span><strong>Loading video…</strong>';
    flow.appendChild(loadingIndicator);
    function freshEditState() {
      return { trimStart: 0, trimEnd: 0, brightness: 1, contrast: 1, saturation: 1, effect: 'none', text: '', sticker: '', captions: false, overlay: false, fit: 'contain' };
    }
    function captureEditorSnapshot() {
      return { state: JSON.parse(JSON.stringify(editState)), muted: Boolean(editVideo.muted) };
    }
    function snapshotsEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
    function updateHistoryButtons() {
      undoButton.disabled = undoStack.length === 0;
      redoButton.disabled = redoStack.length === 0;
    }
    function recordEditorChange(previousSnapshot) {
      if (restoringHistory) return;
      const previous = previousSnapshot || captureEditorSnapshot();
      const current = captureEditorSnapshot();
      if (snapshotsEqual(previous, current)) return;
      undoStack.push(previous);
      if (undoStack.length > 60) undoStack.shift();
      redoStack.length = 0;
      updateHistoryButtons();
    }
    function restoreEditorSnapshot(snapshot) {
      if (!snapshot) return;
      restoringHistory = true;
      editState = JSON.parse(JSON.stringify(snapshot.state));
      editVideo.muted = Boolean(snapshot.muted);
      previewVideos.forEach(function (video) { video.muted = Boolean(snapshot.muted); });
      applyPreviewEdits();
      updateTrimSelection();
      const bounds = activeTrimBounds();
      editVideo.currentTime = Math.max(bounds.start, Math.min(bounds.end, editVideo.currentTime || bounds.start));
      renderTimelineAt(editVideo.currentTime);
      updateEditTimeDisplay(editVideo.currentTime);
      updateTimelineRuler(editVideo.currentTime);
      syncTimelineMuteButton();
      restoringHistory = false;
      updateHistoryButtons();
    }
    undoButton.addEventListener('click', function (event) {
      event.preventDefault(); event.stopPropagation();
      if (!undoStack.length) return;
      redoStack.push(captureEditorSnapshot());
      restoreEditorSnapshot(undoStack.pop());
    });
    redoButton.addEventListener('click', function (event) {
      event.preventDefault(); event.stopPropagation();
      if (!redoStack.length) return;
      undoStack.push(captureEditorSnapshot());
      restoreEditorSnapshot(redoStack.pop());
    });
    updateHistoryButtons();

    function ensureUserOverlay(video) {
      const panel = video.closest('[data-reel-create-stage]');
      let overlay = panel.querySelector('.reel-user-overlay');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'reel-user-overlay';
        panel.appendChild(overlay);
      }
      overlay.classList.toggle('has-vignette', editState.overlay);
      overlay.replaceChildren();
      if (editState.text) {
        const text = document.createElement('span');
        text.className = 'reel-overlay-text';
        text.textContent = editState.text;
        overlay.appendChild(text);
      }
      if (editState.sticker) {
        const sticker = document.createElement('span');
        sticker.className = 'reel-overlay-sticker';
        sticker.textContent = editState.sticker;
        overlay.appendChild(sticker);
      }
      if (editState.captions) {
        const captions = document.createElement('span');
        captions.className = 'reel-overlay-captions';
        captions.textContent = caption.value.trim() || 'Captions enabled';
        overlay.appendChild(captions);
      }
    }
    function applyPreviewEdits() {
      const filter = 'brightness(' + editState.brightness + ') contrast(' + editState.contrast + ') saturate(' + editState.saturation + ') ' + (effectFilters[editState.effect] || '');
      previewVideos.forEach(function (video) {
        video.style.filter = filter;
        video.style.objectFit = editState.fit;
        ensureUserOverlay(video);
      });
    }
    function closeToolPanel() {
      toolPanel.classList.remove('is-open');
      toolPanel.setAttribute('aria-hidden', 'true');
    }
    function openToolPanel(title, body) {
      toolPanel.innerHTML = '<header><strong></strong><button type="button" aria-label="Close">×</button></header><div class="reel-tool-panel-body"></div>';
      toolPanel.querySelector('strong').textContent = title;
      toolPanel.querySelector('.reel-tool-panel-body').appendChild(body);
      toolPanel.classList.add('is-open');
      toolPanel.setAttribute('aria-hidden', 'false');
      toolPanel.querySelector('button').addEventListener('click', closeToolPanel);
    }
    function rangeControl(label, key, min, max, step) {
      const row = document.createElement('label');
      row.className = 'reel-tool-range';
      const name = document.createElement('span');
      const output = document.createElement('output');
      const input = document.createElement('input');
      name.textContent = label;
      output.textContent = editState[key];
      input.type = 'range'; input.min = min; input.max = max; input.step = step; input.value = editState[key];
      input.addEventListener('input', function () { editState[key] = Number(input.value); output.textContent = input.value; applyPreviewEdits(); });
      row.append(name, output, input);
      return row;
    }
    function previewTime(value) {
      value = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
      return String(Math.floor(value / 60)).padStart(2, '0') + ':' + String(value % 60).padStart(2, '0');
    }
    function activeTrimBounds() {
      const start = Math.min(timelineDuration, Math.max(0, Number(editState.trimStart) || 0));
      const requestedEnd = Number(editState.trimEnd);
      const end = requestedEnd > start ? Math.min(timelineDuration, requestedEnd) : timelineDuration;
      return { start: start, end: end };
    }
    function updateEditTimeDisplay(time) {
      const bounds = activeTrimBounds();
      const relative = Math.max(0, Math.min(bounds.end - bounds.start, (Number(time) || editVideo.currentTime || bounds.start) - bounds.start));
      const currentText = previewTime(relative);
      const totalText = previewTime(bounds.end - bounds.start);
      editCurrentLabel.textContent = currentText;
      editTotalLabel.textContent = totalText;
      fullscreenCurrent.textContent = currentText;
      fullscreenTotal.textContent = totalText;
      fullscreenProgress.max = Math.max(.01, bounds.end - bounds.start);
      fullscreenProgress.value = relative;
    }
    function syncFullscreenPauseUi() {
      if (!editStage) return;
      editStage.classList.toggle('is-video-paused', Boolean(editVideo.paused));
      if (fullscreenPausedOverlay) fullscreenPausedOverlay.setAttribute('aria-hidden', editVideo.paused ? 'false' : 'true');
    }
    function editorFullscreenElement() { return document.fullscreenElement || document.webkitFullscreenElement || null; }
    function setEditorFullscreenUi(enabled) {
      if (!editStage) return;
      editStage.classList.toggle('is-editor-fullscreen', Boolean(enabled));
      document.body.classList.toggle('reel-fullscreen-open', Boolean(enabled));
      if (enabled) updateEditTimeDisplay(editVideo.currentTime);
    }
    function enterEditorFullscreen() {
      if (!editStage) return;
      setEditorFullscreenUi(true);
      syncFullscreenPauseUi();
    }
    function exitEditorFullscreen() {
      setEditorFullscreenUi(false);
      if (editStage) editStage.classList.remove('is-video-paused');
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit && editorFullscreenElement()) Promise.resolve(exit.call(document)).catch(function () {});
    }
    ['fullscreenchange', 'webkitfullscreenchange'].forEach(function (eventName) {
      document.addEventListener(eventName, function () {
        if (!editorFullscreenElement()) setEditorFullscreenUi(false);
      });
    });
    fullscreenButton.addEventListener('click', function (event) { event.preventDefault(); event.stopPropagation(); enterEditorFullscreen(); });
    minimizeButton.addEventListener('click', function (event) { event.preventDefault(); event.stopPropagation(); exitEditorFullscreen(); });
    if (fullscreenExitButton) fullscreenExitButton.addEventListener('click', function (event) { event.preventDefault(); event.stopPropagation(); exitEditorFullscreen(); });
    if (fullscreenPausedOverlay) fullscreenPausedOverlay.addEventListener('click', function (event) {
      event.preventDefault(); event.stopPropagation();
      editVideo.play().catch(function () {});
    });
    editVideo.addEventListener('click', function (event) {
      if (!editStage.classList.contains('is-editor-fullscreen') && !editorFullscreenElement()) return;
      event.preventDefault();
      event.stopPropagation();
      if (editVideo.paused) editVideo.play().catch(function () {});
      else editVideo.pause();
    });
    fullscreenProgress.addEventListener('input', function () {
      const bounds = activeTrimBounds();
      editVideo.pause();
      editVideo.currentTime = bounds.start + Number(fullscreenProgress.value || 0);
      renderTimelineAt(editVideo.currentTime);
      updateEditTimeDisplay(editVideo.currentTime);
      updateTimelineRuler(editVideo.currentTime);
    });

    function updateTimelineRuler(time) {
      if (!timelineDuration) return;
      const bounds = activeTrimBounds();
      const relative = Math.max(0, Math.min(bounds.end - bounds.start, (Number(time) || bounds.start) - bounds.start));
      const viewportWidth = Math.max(1, timeline.clientWidth || 430);
      const center = viewportWidth / 2;
      const first = Math.max(0, Math.floor(relative - center / pixelsPerSecond) - 1);
      const last = Math.ceil(relative + center / pixelsPerSecond) + 1;
      timelineTicks.replaceChildren();
      for (let second = first; second <= last; second += 1) {
        if (second > Math.ceil(bounds.end - bounds.start)) break;
        const tick = document.createElement('span');
        tick.textContent = previewTime(second);
        tick.style.left = (center + (second - relative) * pixelsPerSecond) + 'px';
        timelineTicks.appendChild(tick);
      }
    }
    function updateTrimSelection(previewStart, previewEnd) {
      if (!timelineDuration) return;
      const isPreview = Number.isFinite(previewStart) && Number.isFinite(previewEnd);
      const startSource = isPreview ? previewStart : editState.trimStart;
      const endSource = isPreview ? previewEnd : editState.trimEnd;
      const start = Math.min(timelineDuration, Math.max(0, Number(startSource) || 0));
      const end = Math.min(timelineDuration, Math.max(start + .1, Number(endSource) || timelineDuration));
      if (!isPreview) {
        editState.trimStart = start;
        editState.trimEnd = end;
      }
      const trimLeftPx = start * pixelsPerSecond;
      timelineSelection.style.left = trimLeftPx + 'px';
      timelineSelection.style.width = Math.max(2, (end - start) * pixelsPerSecond) + 'px';
      // Keep the mute button immediately before the trimmed video strip. Because
      // it lives inside timelineContent, it follows timeline dragging; because
      // its left value follows trimStart, it also follows the left trim handle.
      timelineMuteRail.style.left = (trimLeftPx - 50) + 'px';
      // Show the pending trimmed duration live while a handle is moving.
      // The committed trim values are still written only on pointer release.
      trimDurationLabel.textContent = (end - start).toFixed(1).replace(/\.0$/, '') + 's';
      // Keep the duration badge attached to the trimmed clip so it moves with
      // timelineContent during dragging and momentum.
      trimDurationLabel.style.left = (trimLeftPx + 9) + 'px';
      // Use the same live preview left edge as the duration badge so the
      // muted indicator follows it exactly while a trim handle is dragged.
      updateMutedIndicatorPosition(trimLeftPx);
      const hiddenRight = Math.max(0, (timelineDuration - end) * pixelsPerSecond);
      const hiddenLeft = Math.max(0, start * pixelsPerSecond);
      const clip = 'inset(0 ' + hiddenRight + 'px 0 ' + hiddenLeft + 'px)';
      timelineFilmstrip.style.clipPath = clip;
      // Trim the Add sound row with the exact same bounds as the video strip.
      // This keeps both tracks aligned while either trim handle is dragged.
      timelineAudio.style.clipPath = clip;
      timelineSelection.classList.toggle('is-active', timelineSelected);
      trimDurationLabel.classList.toggle('is-active', timelineSelected);
      updateMutedIndicatorPosition(trimLeftPx);
    }
    function setTimelineSelected(selected) {
      timelineSelected = Boolean(selected);
      timeline.classList.toggle('is-selected', timelineSelected);
      flow.classList.toggle('is-timeline-selected', timelineSelected);
      editTime.setAttribute('aria-hidden', 'false');
      updateTrimSelection();
    }
    function installTrimHandle(handle, edge) {
      handle.addEventListener('pointerdown', function (event) {
        event.preventDefault();
        event.stopPropagation();
        setTimelineSelected(true);
        editVideo.pause();
        trimCounterFrozen = true;
        timelineDragging = true;
        timelinePointerDown = true;
        cancelTimelineFollow();
        renderTimelineAt(editVideo.currentTime);
        const startX = event.clientX;
        const initialStart = editState.trimStart;
        const initialEnd = editState.trimEnd || timelineDuration;
        let pendingStart = initialStart;
        let pendingEnd = initialEnd;
        function move(moveEvent) {
          moveEvent.preventDefault();
          const delta = (moveEvent.clientX - startX) / pixelsPerSecond;
          if (edge === 'start') pendingStart = Math.min(initialEnd - .1, Math.max(0, initialStart + delta));
          else pendingEnd = Math.max(initialStart + .1, Math.min(timelineDuration, initialEnd + delta));
          // Preview only: move the handles and clip masks, but do not alter the
          // committed trim bounds, video time, or Add sound data until release.
          updateTrimSelection(pendingStart, pendingEnd);
        }
        function finish(finishEvent) {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', finish);
          window.removeEventListener('pointercancel', finish);
          timelinePointerDown = false;
          trimCounterFrozen = false;
          if (finishEvent && finishEvent.type === 'pointerup') {
            const historyBeforeTrim = captureEditorSnapshot();
            editState.trimStart = pendingStart;
            editState.trimEnd = pendingEnd;
            recordEditorChange(historyBeforeTrim);
          }
          // pointercancel restores the previous committed trim; pointerup commits.
          updateTrimSelection();
          editVideo.currentTime = editState.trimStart;
          renderTimelineAt(editState.trimStart);
          updateEditTimeDisplay(editState.trimStart);
          updateTimelineRuler(editState.trimStart);
          scheduleTimelineDragFinish();
        }
        window.addEventListener('pointermove', move, { passive: false });
        window.addEventListener('pointerup', finish, { once: true });
        window.addEventListener('pointercancel', finish, { once: true });
      }, { passive: false });
    }
    installTrimHandle(trimStartHandle, 'start');
    installTrimHandle(trimEndHandle, 'end');
    function isInsideVisibleTimeline(clientX, clientY) {
      const viewportRect = timeline.getBoundingClientRect();
      const ticksRect = timelineTicks.getBoundingClientRect();
      const filmstripRect = timelineFilmstrip.getBoundingClientRect();
      const audioRect = timelineAudio.getBoundingClientRect();
      const left = Math.max(viewportRect.left, Math.min(filmstripRect.left, audioRect.left));
      const right = Math.min(viewportRect.right, Math.max(filmstripRect.right, audioRect.right));
      const top = Math.max(viewportRect.top, Math.min(ticksRect.top, filmstripRect.top));
      const bottom = Math.min(viewportRect.bottom, Math.max(filmstripRect.bottom, audioRect.bottom));
      return clientX >= left && clientX <= right && clientY >= top && clientY <= bottom;
    }
    document.addEventListener('pointerdown', function (event) {
      if (!timelineSelected) return;
      if (event.target.closest('.reel-timeline-audio,.reel-timeline-sound-label')) {
        setTimelineSelected(false);
        return;
      }
      // Playing or pausing the preview must not close the active trim controls.
      if (event.target.closest('[data-reel-flow-action="toggle-edit-play"]')) return;
      if (event.target.closest('.reel-timeline-mute')) return;
      if (event.target.closest('.reel-trim-handle')) return;
      // The timeline surface handles its own tap-vs-drag decision. A drag on
      // the black area must remain available even though a plain tap closes it.
      if (event.target.closest('.reel-timeline-scroll')) return;
      if (isInsideVisibleTimeline(event.clientX, event.clientY)) return;
      setTimelineSelected(false);
    }, true);
    function seekThumbnailVideo(video, time) {
      return new Promise(function (resolve) {
        if (Math.abs(video.currentTime - time) < .02) return resolve();
        let finished = false;
        function done() {
          if (finished) return;
          finished = true;
          video.removeEventListener('seeked', done);
          resolve();
        }
        video.addEventListener('seeked', done, { once: true });
        try { video.currentTime = time; } catch (error) { done(); }
        window.setTimeout(done, 900);
      });
    }
    async function buildTimelineThumbnails(duration) {
      if (!selectedVideoData || !Number.isFinite(duration) || duration <= 0) return;
      const buildKey = String(videoLoadGeneration) + ':' + duration;
      if (timelineBuildKey === buildKey) return;
      timelineBuildKey = buildKey;
      timelineDuration = duration;
      const width = Math.max(1, duration * pixelsPerSecond);
      timelineContent.style.width = width + 'px';
      timelineTicks.replaceChildren();
      timelineFilmstrip.replaceChildren();
      updateTrimSelection();
      const frameCount = Math.min(120, Math.max(1, Math.ceil(duration)));
      const frameDuration = 1;
      const source = document.createElement('video');
      source.className = 'reel-thumbnail-source';
      source.muted = true;
      source.playsInline = true;
      source.preload = 'auto';
      source.src = selectedVideoData;
      flow.querySelector('[data-reel-create-stage="edit"]').appendChild(source);
      await new Promise(function (resolve, reject) {
        if (source.readyState >= 2) return resolve();
        source.addEventListener('loadeddata', resolve, { once: true });
        source.addEventListener('error', reject, { once: true });
        source.load();
      }).catch(function () {});
      if (timelineBuildKey !== buildKey || !source.videoWidth || !source.videoHeight) {
        source.remove();
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.width = 112;
      canvas.height = 64;
      const context = canvas.getContext('2d');
      for (let index = 0; index < frameCount; index += 1) {
        if (timelineBuildKey !== buildKey) break;
        const time = Math.min(duration - .01, index + .5);
        await seekThumbnailVideo(source, Math.max(0, time));
        const sourceRatio = source.videoWidth / source.videoHeight;
        const targetRatio = canvas.width / canvas.height;
        let sx = 0, sy = 0, sw = source.videoWidth, sh = source.videoHeight;
        if (sourceRatio > targetRatio) { sw = source.videoHeight * targetRatio; sx = (source.videoWidth - sw) / 2; }
        else { sh = source.videoWidth / targetRatio; sy = (source.videoHeight - sh) / 2; }
        context.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        const image = document.createElement('img');
        image.alt = '';
        image.src = canvas.toDataURL('image/jpeg', .72);
        image.style.left = (index * pixelsPerSecond) + 'px';
        image.style.width = Math.max(1, Math.min(1, duration - index) * pixelsPerSecond + 1) + 'px';
        timelineFilmstrip.appendChild(image);
      }
      source.remove();
    }
    function setupTimeline(duration) {
      timelineDuration = Number.isFinite(duration) ? duration : 0;
      if (!editState.trimEnd || editState.trimEnd > timelineDuration) editState.trimEnd = timelineDuration;
      trimCounterFrozen = false;
      updateEditTimeDisplay(editState.trimStart);
      updateTimelineRuler(editState.trimStart);
      updateTrimSelection();
      buildTimelineThumbnails(timelineDuration).catch(function (error) { console.error(error); });
    }
    editVideo.addEventListener('loadedmetadata', function () { setupTimeline(editVideo.duration); });
    function syncTimelineMuteVisibility(time) {
      const relativeTime = Math.max(0, (Number(time) || 0) - (editState.trimStart || 0));
      timelineMuteRail.hidden = !timelineStageVisible || relativeTime >= 2;
    }
    function renderTimelineAt(time) {
      const offset = Math.max(0, Math.min(timelineDuration, Number(time) || 0)) * pixelsPerSecond;
      timelineContent.style.transform = 'translate3d(' + (-offset) + 'px,0,0)';
      updateTimelineRuler(time);
      syncTimelineMuteVisibility(time);
    }
    function syncEditPlayback(forceText) {
      if (!timelineDragging && editState.trimEnd > editState.trimStart && editState.trimEnd < timelineDuration && editVideo.currentTime >= editState.trimEnd) {
        editVideo.currentTime = Math.max(editState.trimStart, editState.trimEnd - .01);
        editVideo.pause();
      }
      const now = performance.now();
      syncTimelineMuteVisibility(editVideo.currentTime);
      if (forceText || now - timelineLastTextUpdate > 90) {
        timelineLastTextUpdate = now;
        updateEditTimeDisplay(editVideo.currentTime);
      }
      if (timelineDragging || editVideo.paused) renderTimelineAt(editVideo.currentTime);
    }
    function cancelTimelineFollow() {
      cancelAnimationFrame(timelineAnimationFrame);
      if (timelineVideoFrameCallback && typeof editVideo.cancelVideoFrameCallback === 'function') editVideo.cancelVideoFrameCallback(timelineVideoFrameCallback);
      if (timelinePlaybackAnimation) timelinePlaybackAnimation.cancel();
      timelineAnimationFrame = 0;
      timelineVideoFrameCallback = 0;
      timelinePlaybackAnimation = null;
    }
    function scheduleTimelineFollow() {
      if (editVideo.paused) return;
      cancelTimelineFollow();

      // Follow the decoded video time on every painted frame. This keeps the
      // moving second labels and filmstrip locked to the fixed white playhead,
      // instead of letting a separate CSS animation drift away from playback.
      function followFrame() {
        if (editVideo.paused || timelineDragging) return;
        renderTimelineAt(editVideo.currentTime);
        updateEditTimeDisplay(editVideo.currentTime);
        timelineAnimationFrame = requestAnimationFrame(followFrame);
      }
      renderTimelineAt(editVideo.currentTime);
      timelineAnimationFrame = requestAnimationFrame(followFrame);
    }
    editVideo.addEventListener('timeupdate', function () { syncEditPlayback(editVideo.paused); });
    editVideo.addEventListener('play', function () {
      syncFullscreenPauseUi();
      if (editPlayIcon) editPlayIcon.src = 'data:image/png;base64,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';
      cancelTimelineFollow();
      scheduleTimelineFollow();
    });
    editVideo.addEventListener('pause', function () {
      syncFullscreenPauseUi();
      if (editPlayIcon) editPlayIcon.src = 'data:image/png;base64,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';
      cancelTimelineFollow();
      syncEditPlayback(true);
    });
    function finishTimelineDrag() {
      if (timelinePointerDown) return;
      if (timelinePointerOnSound && timelinePointerMoved) editVideo.currentTime = timelineDragVisualTime;
      timelineDragging = false;
      renderTimelineAt(timelinePointerOnSound && timelinePointerMoved ? timelineDragVisualTime : editVideo.currentTime);
      if (!editVideo.paused) scheduleTimelineFollow();
    }
    function scheduleTimelineDragFinish() {
      window.clearTimeout(timelineSettleTimer);
      timelineSettleTimer = window.setTimeout(finishTimelineDrag, 160);
    }
    let timelineDragStartX = 0;
    let timelineDragStartTime = 0;
    let timelineLastPointerX = 0;
    let timelineLastPointerAt = 0;
    let timelineVelocity = 0;
    let timelineInertiaFrame = 0;
    let timelineInertiaTime = 0;
    let timelinePointerStartedVisible = false;
    let timelinePointerMoved = false;
    let timelinePointerOnSound = false;
    let suppressTimelineSoundClick = false;
    let timelineDragVisualTime = 0;
    let timelineSoundDragFrame = 0;
    let timelineSoundPendingTime = null;

    function cancelTimelineInertia() {
      if (timelineInertiaFrame) cancelAnimationFrame(timelineInertiaFrame);
      timelineInertiaFrame = 0;
      timelineInertiaTime = 0;
      timelineVelocity = 0;
    }

    function applyTimelineTime(nextTime, syncVideo) {
      const bounds = activeTrimBounds();
      const boundedTime = Math.min(bounds.end, Math.max(bounds.start, nextTime));
      if (syncVideo !== false) editVideo.currentTime = boundedTime;
      timelineDragVisualTime = boundedTime;
      renderTimelineAt(boundedTime);
      updateEditTimeDisplay(boundedTime);
      return boundedTime;
    }

    function queueSoundTimelineTime(nextTime) {
      const bounds = activeTrimBounds();
      timelineDragVisualTime = Math.min(bounds.end, Math.max(bounds.start, nextTime));
      timelineSoundPendingTime = timelineDragVisualTime;
      if (timelineSoundDragFrame) return timelineDragVisualTime;
      timelineSoundDragFrame = requestAnimationFrame(function () {
        timelineSoundDragFrame = 0;
        const time = timelineSoundPendingTime;
        timelineSoundPendingTime = null;
        renderTimelineAt(time);
        updateEditTimeDisplay(time);
      });
      return timelineDragVisualTime;
    }

    function flushSoundTimelineFrame() {
      if (timelineSoundDragFrame) cancelAnimationFrame(timelineSoundDragFrame);
      timelineSoundDragFrame = 0;
      if (timelineSoundPendingTime === null) return;
      const time = timelineSoundPendingTime;
      timelineSoundPendingTime = null;
      renderTimelineAt(time);
      updateEditTimeDisplay(time);
    }

    function finishTimelineInertia() {
      cancelTimelineInertia();
      if (timelinePointerOnSound && timelinePointerMoved) editVideo.currentTime = timelineDragVisualTime;
      timelineDragging = false;
      renderTimelineAt(timelinePointerOnSound && timelinePointerMoved ? timelineDragVisualTime : editVideo.currentTime);
      if (!editVideo.paused) scheduleTimelineFollow();
    }

    function startTimelineInertia() {
      const minimumVelocity = 0.0007;
      if (Math.abs(timelineVelocity) < minimumVelocity) {
        scheduleTimelineDragFinish();
        return;
      }
      timelineDragging = true;
      timelineInertiaTime = performance.now();
      const maximumVelocity = 0.012;
      timelineVelocity = Math.max(-maximumVelocity, Math.min(maximumVelocity, timelineVelocity));

      function glide(now) {
        if (timelinePointerDown) {
          cancelTimelineInertia();
          return;
        }
        const elapsed = Math.min(34, Math.max(1, now - timelineInertiaTime));
        timelineInertiaTime = now;
        const previousTime = timelinePointerOnSound ? timelineDragVisualTime : editVideo.currentTime;
        const nextTime = applyTimelineTime(previousTime + timelineVelocity * elapsed, !timelinePointerOnSound);

        // Exponential ease-out gives a native-feeling, frame-rate-independent slowdown.
        timelineVelocity *= Math.exp(-elapsed / 260);
        const bounds = activeTrimBounds();
        const reachedBoundary = (nextTime <= bounds.start && timelineVelocity < 0) || (nextTime >= bounds.end && timelineVelocity > 0);
        if (reachedBoundary || Math.abs(timelineVelocity) < 0.00018) {
          finishTimelineInertia();
          return;
        }
        timelineInertiaFrame = requestAnimationFrame(glide);
      }
      timelineInertiaFrame = requestAnimationFrame(glide);
    }

    function beginTimelineDrag(event) {
      if (event.target.closest('.reel-trim-handle')) return;
      if (event.target.closest('.reel-timeline-add')) return;
      if (event.target.closest('.reel-timeline-mute')) return;
      timelinePointerOnSound = Boolean(event.target.closest('.reel-timeline-audio,.reel-timeline-sound-label'));
      const stoppedSoundInertia = Boolean(timelineInertiaFrame && timelinePointerOnSound);
      cancelTimelineInertia();
      flushSoundTimelineFrame();
      if (stoppedSoundInertia) editVideo.currentTime = timelineDragVisualTime;
      if (!timelinePointerOnSound) editVideo.pause();
      timelinePointerStartedVisible = !timelinePointerOnSound && isInsideVisibleTimeline(event.clientX, event.clientY);
      timelinePointerMoved = false;
      if (timelinePointerOnSound) setTimelineSelected(false);
      // Do not select the timeline on pointer-down. Selection is reserved for
      // a stationary tap; a drag must scroll without revealing trim controls.
      timelinePointerDown = true;
      window.clearTimeout(timelineSettleTimer);
      timelineDragging = true;
      timelineSyncing = false;
      timelineDragStartX = event.clientX;
      timelineDragStartTime = editVideo.currentTime;
      timelineDragVisualTime = timelineDragStartTime;
      timelineLastPointerX = event.clientX;
      timelineLastPointerAt = performance.now();
      timelineVelocity = 0;
      cancelTimelineFollow();
      renderTimelineAt(editVideo.currentTime);
      const captureTarget = event.currentTarget && typeof event.currentTarget.setPointerCapture === 'function' ? event.currentTarget : timelineScroll;
      try { captureTarget.setPointerCapture(event.pointerId); } catch (error) {}
    }
    function moveTimelineDrag(event) {
      if (!timelinePointerDown || event.target.closest('.reel-trim-handle')) return;
      event.preventDefault();
      const now = performance.now();
      if (Math.abs(event.clientX - timelineDragStartX) >= 5 && !timelinePointerMoved) {
        timelinePointerMoved = true;
        // Any real drag hides the trim UI. Only a tap may reveal it.
        setTimelineSelected(false);
        if (timelinePointerOnSound) editVideo.pause();
      }
      const elapsed = Math.max(1, now - timelineLastPointerAt);
      const pointerDelta = timelineLastPointerX - event.clientX;
      const measuredVelocity = (pointerDelta / pixelsPerSecond) / elapsed;
      // Smooth noisy touch samples while keeping the latest swipe direction responsive.
      timelineVelocity = timelineVelocity * 0.68 + measuredVelocity * 0.32;
      timelineLastPointerX = event.clientX;
      timelineLastPointerAt = now;
      const nextTime = timelineDragStartTime + (timelineDragStartX - event.clientX) / pixelsPerSecond;
      // Seeking a video on every touch sample blocks the main thread on many
      // Android browsers. The Add sound row therefore moves the lightweight
      // timeline layer immediately and seeks the video once the gesture ends.
      if (timelinePointerOnSound) queueSoundTimelineTime(nextTime);
      else applyTimelineTime(nextTime, true);
    }
    function endTimelineDrag(cancelled) {
      if (!timelinePointerDown) return;
      flushSoundTimelineFrame();
      timelinePointerDown = false;
      if (cancelled) {
        cancelTimelineInertia();
        scheduleTimelineDragFinish();
        return;
      }
      if (timelinePointerOnSound && timelinePointerMoved) {
        suppressTimelineSoundClick = true;
        window.setTimeout(function () { suppressTimelineSoundClick = false; }, 0);
      }
      // A simple tap in the black area below/beside the clips closes the trim
      // controls. The same area remains a full drag surface once movement is detected.
      if (!timelinePointerMoved) {
        cancelTimelineInertia();
        // A stationary tap on the visible video strip selects it. A stationary
        // tap in the surrounding black area closes the trim controls.
        setTimelineSelected(timelinePointerStartedVisible);
        scheduleTimelineDragFinish();
        return;
      }
      startTimelineInertia();
    }
    timelineScroll.addEventListener('pointerdown', beginTimelineDrag, { passive: true });
    timelineScroll.addEventListener('pointermove', moveTimelineDrag, { passive: false });
    function blockDraggedSoundClick(event) {
      if (!suppressTimelineSoundClick) return;
      suppressTimelineSoundClick = false;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    }
    timelineAudio.addEventListener('click', blockDraggedSoundClick, true);
    window.addEventListener('pointerup', function () { endTimelineDrag(false); }, { passive: true });
    window.addEventListener('pointercancel', function () { endTimelineDrag(true); }, { passive: true });
    function loadVisibleVideo(video) {
      if (!selectedVideoData) return;
      const generation = videoLoadGeneration;
      flow.classList.add('is-video-loading');
      loadingIndicator.classList.remove('is-error');
      loadingIndicator.querySelector('strong').textContent = 'Loading video…';
      let settled = false;
      function ready() {
        if (settled || generation !== videoLoadGeneration) return;
        settled = true;
        flow.classList.remove('is-video-loading');
        if (video.duration && video.currentTime === 0) {
          try { video.currentTime = Math.min(.05, video.duration / 10); } catch (error) {}
        }
        applyPreviewEdits();
        video.play().catch(function () {});
      }
      function failed() {
        if (settled || generation !== videoLoadGeneration) return;
        settled = true;
        loadingIndicator.classList.add('is-error');
        loadingIndicator.querySelector('strong').textContent = 'This video format cannot be previewed.';
      }
      if (video.__reelSource !== selectedVideoData) {
        video.__reelSource = selectedVideoData;
        video.src = selectedVideoData;
      }
      if (video.readyState >= 2 && Number.isFinite(video.duration) && video.duration > 0) return ready();
      video.addEventListener('loadeddata', ready, { once: true });
      video.addEventListener('canplay', ready, { once: true });
      video.addEventListener('error', failed, { once: true });
      video.load();
    }
    function showStage(name) {
      flow.querySelectorAll('[data-reel-create-stage]').forEach(function (stage) { stage.classList.toggle('is-active', stage.dataset.reelCreateStage === name); });
      timelineStageVisible = name === 'edit';
      syncTimelineMuteVisibility(editVideo.currentTime);
      const videos = { preview: '#reelCreateVideo', edit: '#reelEditVideo', caption: '#reelCaptionVideo' };
      const video = flow.querySelector(videos[name]);
      if (video) loadVisibleVideo(video);
    }
    function openFlow() {
      flow.classList.add('is-open');
      flow.setAttribute('aria-hidden', 'false');
      document.body.classList.add('reel-create-open');
      showStage('preview');
    }
    function closeFlow() {
      flow.classList.remove('is-open');
      flow.setAttribute('aria-hidden', 'true');
      settings.classList.remove('is-open');
      closeToolPanel();
      flow.classList.remove('is-video-loading');
      document.body.classList.remove('reel-create-open');
      videoLoadGeneration += 1;
      cancelTimelineFollow();
      cancelTimelineInertia();
      window.clearTimeout(timelineSettleTimer);
      timelineDragging = false;
      timelinePointerDown = false;
      setTimelineSelected(false);
      timelineBuildKey = '';
      timelineDuration = 0;
      timelineScroll.scrollLeft = 0;
      timelineContent.style.transform = 'translate3d(0,0,0)';
      timelineTicks.replaceChildren();
      timelineFilmstrip.replaceChildren();
      previewVideos.forEach(function (video) { video.pause(); video.removeAttribute('src'); video.__reelSource = ''; video.load(); });
      selectedVideo = null;
      selectedVideoData = '';
      editState = freshEditState();
      undoStack.length = 0; redoStack.length = 0; updateHistoryButtons();
      file.value = '';
      caption.value = '';
    }
    file.addEventListener('change', async function () {
      const selected = file.files && file.files[0];
      if (!selected) return;
      if (selected.size > 7 * 1024 * 1024) {
        file.value = '';
        reelMessage(root, 'Choose a video smaller than 7 MB.');
        return;
      }
      selectedVideo = selected;
      selectedVideoData = '';
      videoLoadGeneration += 1;
      editState = freshEditState();
      undoStack.length = 0; redoStack.length = 0; updateHistoryButtons();
      reelMessage(root, 'Preparing video…');
      try {
        const data = await fileData(selected);
        if (selectedVideo !== selected) return;
        selectedVideoData = data;
        previewVideos.forEach(function (video) {
          video.muted = true;
          video.playsInline = true;
          video.preload = 'auto';
          video.removeAttribute('src');
          video.__reelSource = '';
        });
        applyPreviewEdits();
        openFlow();
      } catch (error) {
        file.value = '';
        selectedVideo = null;
        reelMessage(root, error.message);
      }
    });
    publish.addEventListener('click', async function () {
      const selected = file.files && file.files[0];
      if (!selected || publish.disabled) return;
      publish.disabled = true;
      publish.textContent = 'Posting…';
      try {
        const video = selectedVideoData || await fileData(selected);
        const detectedMimeType = /^data:([^;,]+)/i.exec(video)?.[1] || selected.type || 'video/mp4';
        const audience = flow.querySelector('input[name="reelAudience"]:checked')?.value || 'followers';
        await api('/api/reels', { method: 'POST', body: JSON.stringify({ video: video, mimeType: detectedMimeType, caption: caption.value.trim(), visibility: audience, allowComments: allowComments.checked, editData: editState }) });
        await loadLatestReel();
        closeFlow();
        reelMessage(root, 'Reel posted');
      } catch (error) {
        reelMessage(root, error.message);
      } finally {
        publish.textContent = 'Post reel';
        publish.disabled = false;
      }
    });
    flow.addEventListener('click', function (event) {
      const action = event.target.closest('[data-reel-flow-action]');
      const tool = event.target.closest('[data-reel-tool]');
      if (action) {
        const name = action.dataset.reelFlowAction;
        if (name === 'close') closeFlow();
        else if (name === 'preview' || name === 'edit' || name === 'caption') showStage(name);
        else if (name === 'settings') { settings.classList.add('is-open'); settings.setAttribute('aria-hidden', 'false'); }
        else if (name === 'close-settings') { settings.classList.remove('is-open'); settings.setAttribute('aria-hidden', 'true'); }
        else if (name === 'share') {
          if (typeof window.openReelsShareMenu === 'function') window.openReelsShareMenu();
          else reelMessage(root, 'Share menu is unavailable.');
        } else if (name === 'toggle-edit-play') {
          const video = flow.querySelector('#reelEditVideo');
          if (video.paused) video.play().catch(function () {}); else video.pause();
        }
      } else if (tool) {
        const name = tool.dataset.reelTool;
        if (name === 'sound') {
          const muted = !previewVideos[0].muted;
          previewVideos.forEach(function (video) { video.muted = muted; });
          tool.textContent = muted ? '♪  Add sound' : '🔊  Sound on';
        } else if (name === 'layout') {
          const historyBefore = captureEditorSnapshot();
          editState.fit = editState.fit === 'contain' ? 'cover' : 'contain';
          applyPreviewEdits();
          recordEditorChange(historyBefore);
          reelMessage(root, editState.fit === 'cover' ? 'Video fills the frame' : 'Full video is visible');
        } else if (name === 'effects' || name === 'filters' || name === 'magic') {
          const historyBefore = captureEditorSnapshot();
          editState.effect = effectOrder[(effectOrder.indexOf(editState.effect) + 1) % effectOrder.length];
          applyPreviewEdits();
          recordEditorChange(historyBefore);
          reelMessage(root, editState.effect === 'none' ? 'Effect removed' : editState.effect.charAt(0).toUpperCase() + editState.effect.slice(1) + ' effect');
        } else if (name === 'stickers') {
          const historyBefore = captureEditorSnapshot();
          editState.sticker = stickers[(stickers.indexOf(editState.sticker) + 1) % stickers.length];
          applyPreviewEdits();
          recordEditorChange(historyBefore);
        } else if (name === 'captions') {
          const historyBefore = captureEditorSnapshot();
          editState.captions = !editState.captions;
          applyPreviewEdits();
          recordEditorChange(historyBefore);
          reelMessage(root, editState.captions ? 'Captions enabled' : 'Captions removed');
        } else if (name === 'overlay') {
          const historyBefore = captureEditorSnapshot();
          editState.overlay = !editState.overlay;
          applyPreviewEdits();
          recordEditorChange(historyBefore);
          reelMessage(root, editState.overlay ? 'Overlay added' : 'Overlay removed');
        } else if (name === 'text') {
          const wrap = document.createElement('div');
          const input = document.createElement('input');
          input.className = 'reel-tool-text-input'; input.maxLength = 100; input.placeholder = 'Add text to your reel'; input.value = editState.text;
          const save = document.createElement('button'); save.type = 'button'; save.className = 'reel-tool-save'; save.textContent = 'Apply text';
          save.addEventListener('click', function () { const historyBefore = captureEditorSnapshot(); editState.text = input.value.trim(); applyPreviewEdits(); recordEditorChange(historyBefore); closeToolPanel(); });
          wrap.append(input, save); openToolPanel('Text', wrap); input.focus();
        } else if (name === 'adjust') {
          const wrap = document.createElement('div');
          wrap.append(rangeControl('Brightness', 'brightness', .5, 1.5, .05), rangeControl('Contrast', 'contrast', .5, 1.5, .05), rangeControl('Saturation', 'saturation', 0, 2, .05));
          openToolPanel('Adjust', wrap);
        } else if (name === 'edit') {
          const wrap = document.createElement('div');
          const duration = Number.isFinite(editVideo.duration) ? editVideo.duration : 60;
          editState.trimEnd = editState.trimEnd || Math.floor(duration);
          wrap.append(rangeControl('Start', 'trimStart', 0, Math.max(0, duration - .1), .1), rangeControl('End', 'trimEnd', .1, duration, .1));
          openToolPanel('Trim video', wrap);
        } else if (name === 'autocut') {
          const duration = Number.isFinite(previewVideos[0].duration) ? previewVideos[0].duration : 15;
          editState.trimStart = 0; editState.trimEnd = Math.min(duration, 15);
          reelMessage(root, 'AutoCut set to ' + Math.round(editState.trimEnd) + ' seconds');
        } else if (name === 'add-clip') {
          file.click();
        } else if (name === 'story') {
          reelMessage(root, 'Use Next to add a caption and post your video.');
        }
      }
    });
    flow.querySelectorAll('input[name="reelAudience"]').forEach(function (radio) {
      radio.addEventListener('change', function () {
        const names = { followers: 'Followers', friends: 'Friends', 'only-me': 'Only you' };
        audienceLabel.textContent = names[radio.value];
      });
    });
    allowComments.addEventListener('change', function () { commentsLabel.textContent = allowComments.checked ? 'Allowed' : 'Turned off'; });
    caption.addEventListener('input', applyPreviewEdits);
    publishedVideo.addEventListener('timeupdate', function () {
      const start = Number(publishedVideo.dataset.trimStart || 0);
      const end = Number(publishedVideo.dataset.trimEnd || 0);
      if (end > start && publishedVideo.currentTime >= end) publishedVideo.currentTime = start;
    });
    settings.addEventListener('click', function (event) {
      if (event.target === settings) {
        settings.classList.remove('is-open');
        settings.setAttribute('aria-hidden', 'true');
      }
    });
    root.addEventListener('click', async function (event) {
      const like = event.target.closest('[data-reel-action="like"]');
      if (!like) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!currentReel || like.disabled) return reelMessage(root, 'Post a reel first.');
      like.disabled = true;
      try {
        const data = await api('/api/reels/' + encodeURIComponent(currentReel.id) + '/like', { method: 'POST', body: '{}' });
        currentReel.likedByMe = data.liked;
        currentReel.likeCount = data.likeCount;
        like.classList.toggle('is-active', data.liked);
        const image = like.querySelector('img');
        if (image && window.__reelReactionIcons) image.src = data.liked ? window.__reelReactionIcons.liked : window.__reelReactionIcons.outline;
        setReelCount(root, 'like', data.likeCount);
      } catch (error) { reelMessage(root, error.message); }
      finally { like.disabled = false; }
    }, true);
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const input = form.querySelector('input');
      const submit = form.querySelector('button');
      const value = input.value.trim();
      if (!currentReel) return reelMessage(root, 'Post a reel first.');
      if (!value || submit.disabled) return;
      submit.disabled = true;
      try {
        const data = await api('/api/reels/' + encodeURIComponent(currentReel.id) + '/comments', { method: 'POST', body: JSON.stringify({ body: value }) });
        currentReel.comments.push(data.comment);
        renderReelComments(root, currentReel.comments);
        setReelCount(root, 'comments', currentReel.comments.length);
        input.value = '';
      } catch (error) { reelMessage(root, error.message); }
      finally { submit.disabled = false; }
    }, true);
  }

  function installPostSaving() {
    document.addEventListener('click', async function (event) {
      const action = event.target.closest('[data-home-action]');
      if (action) {
        if (action.dataset.homeAction === 'create-story') composerMode = 'story';
        else if (['composer', 'create', 'photo'].includes(action.dataset.homeAction)) composerMode = 'post';
        const title = document.querySelector('.fb-dialog-title');
        const publishButton = document.querySelector('#fbPublishPost');
        if (title) title.textContent = composerMode === 'story' ? 'Create story' : 'Create post';
        if (publishButton) publishButton.textContent = composerMode === 'story' ? 'Share to story' : 'Post';
      }
      const button = event.target.closest('#fbPublishPost');
      if (!button || button.disabled) return;
      const text = document.querySelector('#fbComposerText');
      const preview = document.querySelector('#fbComposerPreview');
      const body = text ? text.value.trim() : '';
      const image = preview && preview.style.display !== 'none' && /^data:image\//.test(preview.src) ? preview.src : '';
      if (composerMode === 'story') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!image) return message('Choose a photo for your story.');
        button.disabled = true;
        let published = false;
        try {
          await api('/api/stories', { method: 'POST', body: JSON.stringify({ caption: body, image: image }) });
          published = true;
          if (typeof window.__resetFacebookHomeComposer === 'function') window.__resetFacebookHomeComposer();
          composerMode = 'post';
          document.querySelector('.fb-dialog-title').textContent = 'Create post';
          button.textContent = 'Post';
          await loadStories();
          message('Story published');
        } catch (error) {
          message(error.message);
        } finally {
          if (!published) button.disabled = false;
        }
        return;
      }
      api('/api/posts', { method: 'POST', body: JSON.stringify({ body: body, image: image }) })
        .then(function () { setTimeout(loadPosts, 250); })
        .catch(function (error) { message(error.message); });
    }, true);
  }

  function installCreationShortcuts() {
    const profilePage = document.querySelector('.app-page[data-page-content="profile"]');
    if (!profilePage || profilePage.dataset.creationShortcutsReady) return;
    profilePage.dataset.creationShortcutsReady = 'true';
    const story = profilePage.querySelector('.action-buttons .btn-blue');
    const post = profilePage.querySelector('.post-input-row');
    const reel = Array.from(profilePage.querySelectorAll('.chip-btn')).find(function (button) { return button.textContent.trim() === 'Reel'; });
    if (story) story.addEventListener('click', function () {
      setActivePage('home');
      requestAnimationFrame(function () { document.querySelector('[data-home-action="create-story"]')?.click(); });
    });
    if (post) post.addEventListener('click', function () {
      setActivePage('home');
      requestAnimationFrame(function () { document.querySelector('[data-home-action="composer"]')?.click(); });
    });
    if (reel) reel.addEventListener('click', function () {
      setActivePage('reels');
      requestAnimationFrame(function () { document.querySelector('[data-reel-action="camera"]')?.click(); });
    });
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
      installCreationShortcuts();
      installReels();
      await Promise.all([loadPosts(), loadStories(), loadLatestReel()]);
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
