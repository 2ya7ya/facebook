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
    timelineSoundLabel.innerHTML = '<span class="reel-add-sound-label-inner"><img class="reel-add-sound-note" src="/reel-add-sound-note.png" alt="">Add sound</span>';
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
