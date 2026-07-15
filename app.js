class M3U8Player {
  constructor() {
    this.hls = null;
    this.channels = [];
    this.currentChannel = null;
    this.video = document.getElementById('video');
    this.placeholder = document.getElementById('placeholder');
    this.errorOverlay = document.getElementById('errorOverlay');
    this.loadingSpinner = document.getElementById('loadingSpinner');
    this.channelList = document.getElementById('channelList');
    this.errorDetail = document.getElementById('errorDetail');
    this.retryBtn = document.getElementById('retryBtn');
    this.playBtn = document.getElementById('playBtn');
    this.fullscreenBtn = document.getElementById('fullscreenBtn');
    this.playOverlay = document.getElementById('playOverlay');
    this.currentTimeEl = document.getElementById('currentTime');
    this.durationEl = document.getElementById('duration');
    this.volumeSlider = document.getElementById('volumeSlider');
    this.volumeBtn = document.getElementById('volumeBtn');
    this.qualitySelect = document.getElementById('qualitySelect');
    this.progressFill = document.getElementById('progressFill');
    this.progressBuffer = document.getElementById('progressBuffer');
    this.progressWrap = document.getElementById('progressWrap');

    this.retryCount = 0;
    this.maxRetries = 3;
    this.isPlaying = false;
    this.isSafari = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);
    this.isMobile = /Mobi|Android|iPhone|iPad|iPod/.test(navigator.userAgent);

    this.init();
  }

  async init() {
    await this.loadChannels();
    this.setupEventListeners();
    this.handleQueryParam();

    const stored = localStorage.getItem('señales-canal');
    if (stored && !this.currentChannel) {
      const found = this.channels.find(c => c.nombre === stored);
      if (found) this.selectChannel(found);
    }

    if (!this.currentChannel && this.channels.length > 0) {
      // Don't auto-select, show placeholder
    }
  }

  async loadChannels() {
    try {
      const res = await fetch('canales.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.channels = await res.json();
      this.renderChannelList();
      document.getElementById('channelCount').textContent = this.channels.length;
    } catch (err) {
      this.showError(`No se pudieron cargar los canales: ${err.message}`);
    }
  }

  renderChannelList() {
    this.channelList.innerHTML = '';
    this.channels.forEach((ch, i) => {
      const el = document.createElement('div');
      el.className = 'channel-item';
      el.dataset.index = i;
      el.innerHTML = `
        <div class="indicator"></div>
        <div class="info">
          <div class="name">${this.escapeHtml(ch.nombre)}</div>
          <div class="status-text">${this.currentChannel?.nombre === ch.nombre ? 'Reproduciendo' : 'Disponible'}</div>
        </div>
      `;
      el.addEventListener('click', () => this.selectChannel(ch));
      this.channelList.appendChild(el);
    });
  }

  updateChannelList() {
    const items = this.channelList.querySelectorAll('.channel-item');
    items.forEach((el, i) => {
      const ch = this.channels[i];
      const active = this.currentChannel?.nombre === ch.nombre;
      el.classList.toggle('active', active);
      const status = el.querySelector('.status-text');
      if (status) status.textContent = active ? 'Reproduciendo' : 'Disponible';
    });
  }

  selectChannel(channel) {
    if (this.currentChannel?.nombre === channel.nombre) return;
    this.currentChannel = channel;
    this.retryCount = 0;
    localStorage.setItem('señales-canal', channel.nombre);
    this.updateChannelList();
    this.playStream(channel.url);
  }

  playStream(url) {
    this.destroyHls();
    this.hideError();
    this.hidePlayOverlay();
    this.placeholder.classList.add('hidden');
    this.loadingSpinner.classList.remove('hidden');
    this.qualitySelect.innerHTML = '<option value="auto">Auto</option>';

    const mimeType = 'application/vnd.apple.mpegurl';

    if (this.isSafari && this.video.canPlayType(mimeType)) {
      this.video.src = url;
      this.video.load();
      this.video.play().catch(() => {
        if (this.isMobile) this.showPlayOverlay();
      });
    } else if (window.Hls && Hls.isSupported()) {
      this.hls = new Hls({
        enableWorker: !this.isMobile,
        lowLatencyMode: false,
        backbufferLength: 30,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        liveSyncDurationCount: 3,
        fragLoadingTimeOut: 20000,
        manifestLoadingTimeOut: 20000,
        levelLoadingTimeOut: 20000,
        fragLoadingMaxRetry: this.maxRetries,
        manifestLoadingMaxRetry: this.maxRetries,
        levelLoadingMaxRetry: this.maxRetries,
        startLevel: -1,
      });

      this.hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        this.hls.loadSource(url);
      });

      this.hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
        this.loadingSpinner.classList.add('hidden');
        this.setupQualitySelector(data.levels);
        this.video.play().catch(() => {
          if (this.isMobile) this.showPlayOverlay();
        });
      });

      this.hls.on(Hls.Events.LEVEL_SWITCHED, (event, data) => {
        const level = this.hls.levels[data.level];
        if (level) {
          this.qualitySelect.value = String(data.level);
        }
      });

      this.hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              this.handleNetworkError(url);
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              this.handleMediaError();
              break;
            default:
              this.handleFatalError(url, data);
              break;
          }
        }
      });

      this.hls.attachMedia(this.video);
    } else {
      this.showError('Tu navegador no soporta reproducción HLS.');
    }

    this.video.addEventListener('loadeddata', () => {
      this.loadingSpinner.classList.add('hidden');
    }, { once: true });

    this.video.addEventListener('waiting', () => {
      this.loadingSpinner.classList.remove('hidden');
    });

    this.video.addEventListener('playing', () => {
      this.loadingSpinner.classList.add('hidden');
      this.hideError();
    });
  }

  setupQualitySelector(levels) {
    this.qualitySelect.innerHTML = '<option value="auto">Auto</option>';
    if (!levels || levels.length <= 1) {
      this.qualitySelect.style.display = 'none';
      return;
    }
    this.qualitySelect.style.display = 'inline-block';
    levels.forEach((level, i) => {
      const height = level.height || 0;
      const bitrate = Math.round((level.bitrate || 0) / 1000);
      const label = height ? `${height}p (${bitrate}kbps)` : `${bitrate}kbps`;
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = label;
      this.qualitySelect.appendChild(opt);
    });
  }

  handleNetworkError(url) {
    this.retryCount++;
    if (this.retryCount < this.maxRetries) {
      setTimeout(() => this.playStream(url), 2000 * this.retryCount);
    } else {
      this.showError('No se pudo conectar con el servidor después de varios intentos. Verifica que la URL sea correcta.');
    }
  }

  handleMediaError() {
    this.destroyHls();
    this.showError('Error de reproducción. El codec de video no es compatible con este navegador.');
  }

  handleFatalError(url, data) {
    const msg = data.response?.message || data.details || 'Error desconocido';
    this.showError(`Error al reproducir el stream: ${msg}`);
  }

  destroyHls() {
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    this.video.removeAttribute('src');
    this.video.load();
  }

  showPlayOverlay() {
    this.playOverlay.classList.remove('hidden');
    this.playOverlay.classList.add('visible');
  }

  hidePlayOverlay() {
    this.playOverlay.classList.remove('visible');
    this.playOverlay.classList.add('hidden');
  }

  showError(msg) {
    this.loadingSpinner.classList.add('hidden');
    this.errorDetail.textContent = msg;
    this.errorOverlay.classList.remove('hidden');
  }

  hideError() {
    this.errorOverlay.classList.add('hidden');
  }

  handleQueryParam() {
    const params = new URLSearchParams(window.location.search);
    const canalName = params.get('canal');
    if (canalName) {
      const found = this.channels.find(c =>
        c.nombre.toLowerCase() === canalName.toLowerCase()
      );
      if (found) {
        setTimeout(() => this.selectChannel(found), 100);
      }
    }
    const directUrl = params.get('url');
    if (directUrl) {
      this.currentChannel = { nombre: 'Stream directo', url: directUrl };
      this.playStream(directUrl);
    }
  }

  /* UI Event Listeners */
  setupEventListeners() {
    this.playBtn.addEventListener('click', () => this.togglePlay());
    this.fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());
    this.volumeSlider.addEventListener('input', (e) => this.setVolume(e.target.value));
    this.volumeBtn.addEventListener('click', () => this.toggleMute());
    this.qualitySelect.addEventListener('change', (e) => this.switchQuality(e.target.value));
    this.retryBtn.addEventListener('click', () => {
      if (this.currentChannel) {
        this.retryCount = 0;
        this.playStream(this.currentChannel.url);
      }
    });

    this.video.addEventListener('timeupdate', () => this.updateProgress());
    this.video.addEventListener('loadedmetadata', () => this.updateDuration());
    this.video.addEventListener('progress', () => this.updateBuffer());

    this.playOverlay.addEventListener('click', (e) => {
      e.stopPropagation();
      this.togglePlay();
    });

    this.progressWrap.addEventListener('click', (e) => this.seek(e));

    document.addEventListener('keydown', (e) => this.handleKeyboard(e));

    this.video.addEventListener('play', () => {
      this.isPlaying = true;
      this.playBtn.textContent = '⏸';
      this.playOverlay.classList.remove('visible');
      this.playOverlay.classList.add('hidden');
    });
    this.video.addEventListener('pause', () => {
      this.isPlaying = false;
      this.playBtn.textContent = '▶';
      this.showPlayOverlay();
    });
    this.video.addEventListener('ended', () => {
      this.showPlayOverlay();
    });
  }

  togglePlay() {
    if (this.video.paused) {
      this.video.play().catch(() => {});
    } else {
      this.video.pause();
    }
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.querySelector('.main').requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }

  setVolume(val) {
    const v = val / 100;
    this.video.volume = v;
    this.video.muted = v === 0;
    this.volumeBtn.textContent = v === 0 ? '🔇' : v < 0.5 ? '🔉' : '🔊';
  }

  toggleMute() {
    this.video.muted = !this.video.muted;
    this.volumeBtn.textContent = this.video.muted ? '🔇' : '🔊';
    if (this.video.muted) {
      this.volumeSlider.value = 0;
    } else {
      this.volumeSlider.value = this.video.volume * 100;
    }
  }

  switchQuality(level) {
    if (this.hls && level === 'auto') {
      this.hls.currentLevel = -1;
    } else if (this.hls) {
      this.hls.currentLevel = parseInt(level, 10);
    }
  }

  updateProgress() {
    if (this.video.duration) {
      const pct = (this.video.currentTime / this.video.duration) * 100;
      this.progressFill.style.width = `${pct}%`;
    }
    this.currentTimeEl.textContent = this.formatTime(this.video.currentTime);
  }

  updateDuration() {
    this.durationEl.textContent = this.formatTime(this.video.duration);
  }

  updateBuffer() {
    if (this.video.buffered.length > 0 && this.video.duration) {
      const end = this.video.buffered.end(this.video.buffered.length - 1);
      const pct = (end / this.video.duration) * 100;
      this.progressBuffer.style.width = `${pct}%`;
    }
  }

  seek(e) {
    const rect = this.progressWrap.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    if (this.video.duration) {
      this.video.currentTime = pct * this.video.duration;
    }
  }

  handleKeyboard(e) {
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT') return;

    switch (e.key) {
      case ' ':
        e.preventDefault();
        this.togglePlay();
        break;
      case 'f':
      case 'F':
        this.toggleFullscreen();
        break;
      case 'ArrowUp':
        e.preventDefault();
        this.setVolume(Math.min(100, parseInt(this.volumeSlider.value, 10) + 10));
        this.volumeSlider.value = this.video.volume * 100;
        break;
      case 'ArrowDown':
        e.preventDefault();
        this.setVolume(Math.max(0, parseInt(this.volumeSlider.value, 10) - 10));
        this.volumeSlider.value = this.video.volume * 100;
        break;
      case 'm':
      case 'M':
        this.toggleMute();
        break;
    }
  }

  formatTime(t) {
    if (!t || isNaN(t)) return '0:00';
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = Math.floor(t % 60);
    if (h > 0) {
      return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}

document.addEventListener('DOMContentLoaded', () => new M3U8Player());
