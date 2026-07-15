class Player {
  constructor() {
    this.video = document.getElementById('video');
    this.channelList = document.getElementById('channelList');
    this.placeholder = document.getElementById('placeholder');
    this.spinner = document.getElementById('spinner');
    this.playOverlay = document.getElementById('playOverlay');
    this.errorOverlay = document.getElementById('errorOverlay');
    this.errorMsg = document.getElementById('errorMsg');
    this.retryBtn = document.getElementById('retryBtn');
    this.playBtn = document.getElementById('playBtn');
    this.time = document.getElementById('time');
    this.volSlider = document.getElementById('volSlider');
    this.volumeBtn = document.getElementById('volumeBtn');
    this.fullBtn = document.getElementById('fullBtn');
    this.toggleBtn = document.getElementById('toggleBtn');
    this.sidebar = document.getElementById('sidebar');
    this.container = document.querySelector('.container');

    this.hls = null;
    this.currentChannel = null;
    this.isSafari = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);
    this.isMobile = /Mobi|Android|iPhone|iPad|iPod/.test(navigator.userAgent);

    this.init();
  }

  async init() {
    await this.loadChannels();
    this.listen();
    this.restore();
    const last = localStorage.getItem('last');
    if (last) {
      const found = this.channels.find(c => c.nombre === last);
      if (found) this.select(found);
    }
  }

  async loadChannels() {
    try {
      const r = await fetch('canales.json');
      if (!r.ok) throw Error('HTTP ' + r.status);
      this.channels = await r.json();
      document.getElementById('channelCount').textContent = this.channels.length;
      this.channelList.innerHTML = this.channels.map((ch, i) =>
        `<div class="channel-item" data-i="${i}">
          <div class="dot"></div>
          <div class="info"><div class="name">${this.esc(ch.nombre)}</div><div class="status">Disponible</div></div>
        </div>`
      ).join('');
      this.channelList.querySelectorAll('.channel-item').forEach((el, i) => {
        el.addEventListener('click', () => this.select(this.channels[i]));
      });
    } catch (e) {
      this.error('Error cargando canales: ' + e.message);
    }
  }

  select(ch) {
    if (this.currentChannel?.nombre === ch.nombre) return;
    this.currentChannel = ch;
    this.retryCount = 0;
    localStorage.setItem('last', ch.nombre);
    this.channelList.querySelectorAll('.channel-item').forEach((el, i) => {
      const a = this.channels[i].nombre === ch.nombre;
      el.classList.toggle('active', a);
      el.querySelector('.status').textContent = a ? 'Reproduciendo' : 'Disponible';
    });
    this.placeholder.classList.add('hidden');
    this.play(ch.url);
    if (this.isMobile) {
      this.sidebar.classList.add('collapsed');
    }
  }

  play(url) {
    if (this.hls) { this.hls.destroy(); this.hls = null; }
    this.errorOverlay.classList.add('hidden');
    this.playOverlay.classList.remove('visible');
    this.playOverlay.classList.add('hidden');
    this.spinner.classList.remove('hidden');

    const mime = 'application/vnd.apple.mpegurl';

    if (this.isSafari && this.video.canPlayType(mime)) {
      this.video.src = url;
      this.video.load();
      this.video.play().catch(() => { this.showPlay(); });
    } else if (window.Hls && Hls.isSupported()) {
      this.hls = new Hls({ enableWorker: !this.isMobile, startLevel: -1 });
      this.hls.on(Hls.Events.MEDIA_ATTACHED, () => this.hls.loadSource(url));
      this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
        this.spinner.classList.add('hidden');
        this.video.play().catch(() => { this.showPlay(); });
      });
      this.hls.on(Hls.Events.LEVEL_SWITCHED, (e, d) => {
        // nothing
      });
      this.hls.on(Hls.Events.ERROR, (e, d) => {
        if (d.fatal) {
          if (d.type === Hls.ErrorTypes.NETWORK_ERROR && this.retryCount < 3) {
            this.retryCount++;
            setTimeout(() => this.play(url), 2000);
          } else if (d.type === Hls.ErrorTypes.MEDIA_ERROR) {
            this.hls.destroy();
            this.hls = null;
            this.spinner.classList.add('hidden');
            this.error('Error de reproducción. Codec no soportado.');
          } else {
            this.spinner.classList.add('hidden');
            this.error('Error: el stream no pudo cargarse.');
          }
        }
      });
      this.hls.attachMedia(this.video);
    } else {
      this.error('Tu navegador no soporta HLS.');
    }

    this.video.addEventListener('playing', () => {
      this.spinner.classList.add('hidden');
      this.hidePlay();
    }, { once: true });
  }

  showPlay() {
    this.playOverlay.classList.remove('hidden');
    this.playOverlay.classList.add('visible');
  }

  hidePlay() {
    this.playOverlay.classList.remove('visible');
    this.playOverlay.classList.add('hidden');
  }

  error(msg) {
    this.spinner.classList.add('hidden');
    this.errorMsg.textContent = msg;
    this.errorOverlay.classList.remove('hidden');
  }

  esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  restore() {
    const state = localStorage.getItem('side');
    if (state === '0') this.sidebar.classList.add('collapsed');
  }

  toggleSide() {
    this.sidebar.classList.toggle('collapsed');
    localStorage.setItem('side', this.sidebar.classList.contains('collapsed') ? '0' : '1');
  }

  listen() {
    this.playOverlay.addEventListener('click', () => this.togglePlay());
    this.playBtn.addEventListener('click', () => this.togglePlay());
    this.fullBtn.addEventListener('click', () => this.toggleFull());
    this.volSlider.addEventListener('input', (e) => {
      const v = e.target.value / 100;
      this.video.volume = v;
      this.video.muted = v === 0;
      this.volumeBtn.textContent = v === 0 ? '🔇' : v < 0.5 ? '🔉' : '🔊';
    });
    this.volumeBtn.addEventListener('click', () => {
      this.video.muted = !this.video.muted;
      this.volSlider.value = this.video.muted ? 0 : this.video.volume * 100;
      this.volumeBtn.textContent = this.video.muted ? '🔇' : '🔊';
    });
    this.toggleBtn.addEventListener('click', () => this.toggleSide());
    this.retryBtn.addEventListener('click', () => {
      if (this.currentChannel) this.play(this.currentChannel.url);
    });

    this.video.addEventListener('play', () => {
      this.playBtn.textContent = '⏸';
      this.hidePlay();
    });
    this.video.addEventListener('pause', () => {
      this.playBtn.textContent = '▶';
      this.showPlay();
    });
    this.video.addEventListener('timeupdate', () => {
      if (this.video.duration) {
        const t = this.fmt(this.video.currentTime);
        const d = this.fmt(this.video.duration);
        this.time.textContent = t + ' / ' + d;
      }
    });
    this.video.addEventListener('ended', () => { this.showPlay(); this.playBtn.textContent = '▶'; });
  }

  togglePlay() {
    if (this.video.paused) { this.video.play().catch(() => {}); }
    else { this.video.pause(); }
  }

  toggleFull() {
    if (!document.fullscreenElement) { document.querySelector('.main').requestFullscreen().catch(() => {}); }
    else { document.exitFullscreen().catch(() => {}); }
  }

  fmt(t) {
    if (!t || isNaN(t)) return '0:00';
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = Math.floor(t % 60);
    return h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${m}:${String(s).padStart(2,'0')}`;
  }
}

document.addEventListener('DOMContentLoaded', () => new Player());
