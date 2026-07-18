(function () {
  'use strict';

  const fallbackAvatar = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#e4e6eb"/><circle cx="100" cy="76" r="40" fill="#7b8087"/><path d="M30 200c5-54 36-80 70-80s65 26 70 80" fill="#7b8087"/></svg>');
  let profile = null;
  const wiredEditDocuments = new WeakSet();
  const wiredEditFrames = new WeakSet();
  let photoSaveTimer = 0;

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
    document.querySelectorAll('[data-home-avatar]').forEach(function (image) { image.src = avatar; });
    document.querySelectorAll('.exact-bottom-nav img[alt="Profile"]').forEach(function (image) { image.src = avatar; });
    const mainPhoto = document.querySelector('#profile .avatar-default-photo');
    if (mainPhoto && profile.profilePhoto) {
      mainPhoto.src = profile.profilePhoto;
      mainPhoto.style.filter = 'none';
    }
    const cover = document.querySelector('#profile > .cover');
    if (cover && profile.coverPhoto) {
      cover.style.backgroundImage = 'url("' + profile.coverPhoto + '")';
    }
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
      if (overlay) overlay.classList.add('hidden');
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
      putStoredPhoto('profilePhoto', profile.profilePhoto || '');
      putStoredPhoto('pendingProfilePhoto', profile.profilePhoto || '');
      putStoredPhoto('coverPhoto', profile.coverPhoto || '');
      applyPhotos();
      message(changes.profilePhoto ? 'Profile picture saved' : 'Cover photo saved');
    } catch (error) {
      message(error.message);
    }
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
        if (!layer.classList.contains('is-open')) schedulePhotoSave(120);
      }).observe(layer, { attributes: true, attributeFilter: ['class', 'aria-hidden'] });
    }
    window.addEventListener('message', function (event) {
      if (event.data && event.data.type === 'closeMergedEditProfile') schedulePhotoSave(120);
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
      if (count) count.textContent = String(data.posts.filter(function (post) { return post.userId === profile.id; }).length);
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
    try {
      profile = await api('/api/profile');
      applyName();
      applyPhotos();
      installPhotoControls();
      installPostSaving();
      await loadPosts();
      new MutationObserver(function () { applyName(); applyPhotos(); }).observe(document.body, { childList: true, subtree: true });
    } catch (error) {
      console.error(error);
      message(error.message);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
