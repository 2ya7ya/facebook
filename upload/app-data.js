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
    let previewUrl = '';
    const editVideo = flow.querySelector('#reelEditVideo');
    const editTime = flow.querySelector('#reelEditTime');
    function previewTime(value) {
      value = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
      return String(Math.floor(value / 60)).padStart(2, '0') + ':' + String(value % 60).padStart(2, '0');
    }
    editVideo.addEventListener('loadedmetadata', function () { editTime.textContent = previewTime(0) + '/' + previewTime(editVideo.duration); });
    editVideo.addEventListener('timeupdate', function () { editTime.textContent = previewTime(editVideo.currentTime) + '/' + previewTime(editVideo.duration); });
    function showStage(name) {
      flow.querySelectorAll('[data-reel-create-stage]').forEach(function (stage) { stage.classList.toggle('is-active', stage.dataset.reelCreateStage === name); });
      if (name === 'edit') flow.querySelector('#reelEditVideo').play().catch(function () {});
      else if (name === 'preview') flow.querySelector('#reelCreateVideo').play().catch(function () {});
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
      document.body.classList.remove('reel-create-open');
      previewVideos.forEach(function (video) { video.pause(); video.removeAttribute('src'); });
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = '';
      file.value = '';
      caption.value = '';
    }
    file.addEventListener('change', function () {
      const selected = file.files && file.files[0];
      if (!selected) return;
      if (selected.size > 7 * 1024 * 1024) {
        file.value = '';
        reelMessage(root, 'Choose a video smaller than 7 MB.');
        return;
      }
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(selected);
      previewVideos.forEach(function (video) { video.src = previewUrl; });
      openFlow();
    });
    publish.addEventListener('click', async function () {
      const selected = file.files && file.files[0];
      if (!selected || publish.disabled) return;
      publish.disabled = true;
      publish.textContent = 'Posting…';
      try {
        const video = await fileData(selected);
        const audience = flow.querySelector('input[name="reelAudience"]:checked')?.value || 'followers';
        await api('/api/reels', { method: 'POST', body: JSON.stringify({ video: video, mimeType: selected.type, caption: caption.value.trim(), visibility: audience, allowComments: allowComments.checked }) });
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
        reelMessage(root, tool.dataset.reelTool === 'story' ? 'Use Next to finish your video.' : 'Editing option selected');
      }
    });
    flow.querySelectorAll('input[name="reelAudience"]').forEach(function (radio) {
      radio.addEventListener('change', function () {
        const names = { followers: 'Followers', friends: 'Friends', 'only-me': 'Only you' };
        audienceLabel.textContent = names[radio.value];
      });
    });
    allowComments.addEventListener('change', function () { commentsLabel.textContent = allowComments.checked ? 'Allowed' : 'Turned off'; });
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
