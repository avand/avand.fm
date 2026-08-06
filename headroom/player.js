/*
 * Headroom video player.
 *
 * A custom player over HLS. Videos are served as an adaptive ladder
 * (360/540/720/1080p) so quality tracks the viewer's connection instead of
 * being fixed at load time.
 *
 * Safari plays HLS natively. Everywhere else needs hls.js, which is ~150KB, so
 * it is fetched on the first play rather than on page load — a visitor who
 * never presses play never pays for it. Nothing is requested for a video until
 * it is played, which matters on a page carrying eleven of them.
 *
 * Players marked data-autoplay start muted when they scroll into view and stop
 * when they leave, with captions on by default since muted video is silent
 * video. A prominent unmute control is the way back to sound.
 */
(function () {
  "use strict";

  // Swap this one string to move the video to a CDN later; nothing else in the
  // page knows where the media lives.
  var VIDEO_BASE = "https://avand.github.io/headroom-video/";

  // Served from localhost? Use the local video server that serve.sh starts, so
  // previewing works without hand-editing this file.
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
    VIDEO_BASE = "http://127.0.0.1:8101/";
  }

  var HLS_LIB = "hls.min.js";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var hlsPromise = null;

  function loadHlsLibrary() {
    if (hlsPromise) return hlsPromise;
    hlsPromise = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = HLS_LIB;
      s.onload = resolve;
      s.onerror = function () {
        reject(new Error("Could not load the video library"));
      };
      document.head.appendChild(s);
    });
    return hlsPromise;
  }

  function formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) seconds = 0;
    var m = Math.floor(seconds / 60);
    var s = Math.floor(seconds % 60);
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  var players = [];
  var bySlug = {};

  function Player(root) {
    this.root = root;
    this.slug = root.dataset.video;
    this.autoplay = root.hasAttribute("data-autoplay");
    this.ready = false;
    this.hls = null;
    this.hideTimer = null;

    // Once someone pauses deliberately, stop resuming on their behalf.
    this.userPaused = false;
    // Once someone touches the volume, stop deciding it for them.
    this.userSetSound = false;

    this.render();
    this.build();
    this.bind();
    this.lazyPoster();
    this.watchViewport();

    players.push(this);
    bySlug[this.slug] = this;
  }

  /* Eleven posters at ~88KB each is about a megabyte of images, most of which a
     visitor never scrolls to. Load each one only as it approaches the viewport. */
  Player.prototype.lazyPoster = function () {
    var self = this;
    var url = VIDEO_BASE + this.slug + "/poster.jpg";

    if (!("IntersectionObserver" in window)) {
      this.video.poster = url;
      return;
    }

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          self.video.poster = url;
          observer.disconnect();
        });
      },
      { rootMargin: "400px" }
    );
    observer.observe(this.root);
  };

  var ICONS = {
    play: '<path d="M8 5v14l11-7z"/>',
    pause: '<path d="M6 5h4v14H6zm8 0h4v14h-4z"/>',
    restart:
      '<path d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z"/>',
    loud:
      '<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 2v2a8 8 0 0 1 0 16v2a10 10 0 0 0 0-20z"/>',
    muted:
      '<path d="M3 9v6h4l5 5V4L7 9H3zm18.6 3l2.1-2.1-1.4-1.4-2.1 2.1-2.1-2.1-1.4 1.4 2.1 2.1-2.1 2.1 1.4 1.4 2.1-2.1 2.1 2.1 1.4-1.4z"/>',
    fs: '<path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>',
    cc:
      '<path d="M3 5h18a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zm4.5 4.8a2.2 2.2 0 0 0-2.2 2.2 2.2 2.2 0 0 0 2.2 2.2c.8 0 1.5-.4 1.9-1l-1.1-.6a.9.9 0 0 1-.8.4 1 1 0 0 1 0-2c.35 0 .65.16.8.42l1.1-.62a2.2 2.2 0 0 0-1.9-1zm7 0a2.2 2.2 0 0 0-2.2 2.2 2.2 2.2 0 0 0 2.2 2.2c.8 0 1.5-.4 1.9-1l-1.1-.6a.9.9 0 0 1-.8.4 1 1 0 0 1 0-2c.35 0 .65.16.8.42l1.1-.62a2.2 2.2 0 0 0-1.9-1z"/>',
  };

  function svg(path, cls) {
    return (
      '<svg viewBox="0 0 24 24" aria-hidden="true"' +
      (cls ? ' class="' + cls + '"' : "") +
      ">" +
      path +
      "</svg>"
    );
  }

  /* The player's chrome is identical for all eleven videos, so it is built here
     rather than repeated in the markup. A player in the page is one line:
       <div class="player" data-video="brand" data-autoplay data-label="..."></div> */
  Player.prototype.render = function () {
    var label = this.root.dataset.label || "video";
    var captions = this.root.hasAttribute("data-captions");

    // The caption file is fetched and attached as a blob rather than pointed at
    // with a src, so it works whatever Content-Type the host decides to send
    // for .vtt -- browsers reject a text track that isn't text/vtt. It also
    // means the video element needs no crossorigin attribute.
    var html =
      "<video playsinline preload=\"none\"></video>" +
      '<button class="pl-bigplay" aria-label="Play video: ' +
      label +
      '"><span>' +
      svg(ICONS.play) +
      "</span></button>" +
      '<button class="pl-unmute" aria-label="Turn on sound">' +
      svg(ICONS.muted) +
      "<span>Tap for sound</span></button>" +
      '<div class="pl-captions is-empty" aria-live="off"></div>' +
      '<div class="pl-spinner" aria-hidden="true"></div>' +
      '<div class="pl-error" role="alert"></div>' +
      '<div class="pl-controls">' +
      '<div class="pl-bar" role="slider" tabindex="0" aria-label="Seek"' +
      ' aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">' +
      '<div class="pl-buffered"></div><div class="pl-played"></div><div class="pl-knob"></div>' +
      "</div>" +
      '<div class="pl-row">' +
      '<button class="pl-btn pl-restart" aria-label="Start from the beginning">' +
      svg(ICONS.restart) +
      "</button>" +
      '<button class="pl-btn pl-play" aria-label="Play">' +
      svg(ICONS.play, "pl-icon-play") +
      svg(ICONS.pause, "pl-icon-pause") +
      "</button>" +
      '<span class="pl-time"><span class="pl-time-now">0:00</span> / <span class="pl-time-total">0:00</span></span>' +
      '<span class="pl-spacer"></span>' +
      (captions
        ? '<button class="pl-btn pl-cc" aria-label="Captions" aria-pressed="false">' +
          svg(ICONS.cc) +
          "</button>"
        : "") +
      '<button class="pl-btn pl-mute" aria-label="Mute">' +
      svg(ICONS.loud, "pl-icon-loud") +
      svg(ICONS.muted, "pl-icon-muted") +
      "</button>" +
      '<input class="pl-vol" type="range" min="0" max="1" step="0.05" value="1" aria-label="Volume">' +
      '<button class="pl-btn pl-fs" aria-label="Fullscreen">' +
      svg(ICONS.fs) +
      "</button>" +
      "</div></div>";

    this.root.innerHTML = html;
    this.root.setAttribute("tabindex", "0");
    this.root.setAttribute("role", "region");
    this.root.setAttribute("aria-label", "Video: " + label);
  };

  Player.prototype.build = function () {
    var r = this.root;

    this.video = r.querySelector("video");
    this.bigPlay = r.querySelector(".pl-bigplay");
    this.controls = r.querySelector(".pl-controls");
    this.playBtn = r.querySelector(".pl-play");
    this.restartBtn = r.querySelector(".pl-restart");
    this.muteBtn = r.querySelector(".pl-mute");
    this.ccBtn = r.querySelector(".pl-cc");
    this.fsBtn = r.querySelector(".pl-fs");
    this.unmuteBtn = r.querySelector(".pl-unmute");
    this.bar = r.querySelector(".pl-bar");
    this.played = r.querySelector(".pl-played");
    this.buffered = r.querySelector(".pl-buffered");
    this.knob = r.querySelector(".pl-knob");
    this.timeNow = r.querySelector(".pl-time-now");
    this.timeTotal = r.querySelector(".pl-time-total");
    this.errorEl = r.querySelector(".pl-error");
    this.captionBox = r.querySelector(".pl-captions");
    this.volRange = r.querySelector(".pl-vol");
  };

  /*
   * Captions are parsed and rendered by hand rather than handed to a <track>
   * element.
   *
   * hls.js manages the media element's native text tracks for CEA-608/708
   * captions, and clears ones it did not create — so a track appended around
   * the time it attaches loads successfully and then ends up with zero cues.
   * Owning the rendering sidesteps that entirely, and along the way avoids
   * depending on the host's Content-Type for .vtt, lets the captions sit above
   * the control bar instead of behind it, and lets them be styled to match the
   * rest of the page, which ::cue only partly allows.
   */
  function parseTime(stamp) {
    // "00:01:02.500" or "01:02.500", possibly followed by cue settings.
    var parts = stamp.trim().split(/\s+/)[0].split(":");
    var seconds = 0;
    for (var i = 0; i < parts.length; i++) {
      seconds = seconds * 60 + parseFloat(parts[i]);
    }
    return isFinite(seconds) ? seconds : 0;
  }

  function parseVtt(text) {
    var cues = [];
    var blocks = text.replace(/\r/g, "").split(/\n{2,}/);

    blocks.forEach(function (block) {
      var lines = block.split("\n").filter(function (l) {
        return l.trim() !== "";
      });
      var timingIndex = -1;
      for (var i = 0; i < lines.length; i++) {
        if (lines[i].indexOf("-->") !== -1) {
          timingIndex = i;
          break;
        }
      }
      if (timingIndex === -1) return;

      var halves = lines[timingIndex].split("-->");
      var body = lines
        .slice(timingIndex + 1)
        .join(" ")
        .replace(/<[^>]+>/g, "") // strip any inline cue markup
        .trim();
      if (!body) return;

      cues.push({
        start: parseTime(halves[0]),
        end: parseTime(halves[1]),
        text: body,
      });
    });

    return cues;
  }

  Player.prototype.loadCaptions = function () {
    if (!this.root.hasAttribute("data-captions") || this.captionsLoaded) return;
    this.captionsLoaded = true;

    var self = this;
    fetch(VIDEO_BASE + this.slug + "/captions.vtt")
      .then(function (res) {
        if (!res.ok) throw new Error("no captions");
        return res.text();
      })
      .then(function (text) {
        self.cues = parseVtt(text);
        if (!self.cues.length) return;
        self.root.classList.add("has-cc");
        self.syncCaptions();
        self.renderCue();
      })
      .catch(function () {
        /* Captions are an enhancement; a missing file just means none. */
      });
  };

  Player.prototype.renderCue = function () {
    if (!this.captionBox || !this.cues || !this.cues.length) return;

    var t = this.video.currentTime;
    var current = null;
    // Cues are in order and playback is mostly linear, so start from the last
    // match rather than rescanning a few hundred cues every timeupdate.
    var i = this.cueIndex || 0;
    if (i >= this.cues.length || this.cues[i].start > t) i = 0;
    for (; i < this.cues.length; i++) {
      var cue = this.cues[i];
      if (cue.start > t) break;
      if (t <= cue.end) {
        current = cue;
        this.cueIndex = i;
        break;
      }
    }

    var text = current ? current.text : "";
    if (text !== this.shownCue) {
      this.shownCue = text;
      this.captionBox.textContent = text;
      this.captionBox.classList.toggle("is-empty", !text);
    }
  };

  /* Attach a source. Called on first play, not on page load. */
  Player.prototype.attach = function () {
    if (this.ready) return Promise.resolve();
    this.ready = true;

    var self = this;
    var src = VIDEO_BASE + this.slug + "/master.m3u8";

    this.loadCaptions();

    // Safari plays HLS in the media element itself, and does it better than
    // hls.js can (hardware decoding, AirPlay), so prefer native there.
    //
    // canPlayType alone is not enough to decide this: Chrome answers "maybe"
    // for HLS and then fails with MEDIA_ERR_SRC_NOT_SUPPORTED the moment you
    // hand it a playlist. The vendor check is what separates the browsers that
    // mean it from the one that doesn't.
    var isApple = (navigator.vendor || "").indexOf("Apple") === 0;
    var canNative = !!this.video.canPlayType("application/vnd.apple.mpegurl");

    if (canNative && isApple) {
      this.video.src = src;
      return Promise.resolve();
    }

    return loadHlsLibrary()
      .then(function () {
        if (!window.Hls || !window.Hls.isSupported()) {
          // No MSE. If the browser claims native HLS after all, take it.
          if (canNative) {
            self.video.src = src;
            return;
          }
          throw new Error("This browser can't play the video");
        }
        self.hls = new window.Hls({
          startLevel: -1,
          capLevelToPlayerSize: true,
          maxBufferLength: 30,
        });
        self.hls.loadSource(src);
        self.hls.attachMedia(self.video);

        self.hls.on(window.Hls.Events.ERROR, function (_e, data) {
          if (!data.fatal) return;
          if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
            self.hls.startLoad();
          } else if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) {
            self.hls.recoverMediaError();
          } else {
            self.fail("This video didn't load. Please try again.");
          }
        });
      })
      .catch(function (err) {
        self.fail(err.message || "This video didn't load.");
        throw err;
      });
  };

  Player.prototype.fail = function (message) {
    this.root.classList.add("is-failed");
    if (this.errorEl) this.errorEl.textContent = message;
    this.setBusy(false);
  };

  Player.prototype.setBusy = function (busy) {
    this.root.classList.toggle("is-busy", !!busy);
  };

  Player.prototype.play = function (opts) {
    var self = this;
    var silent = opts && opts.muted;

    // Only one video at a time; two soundtracks at once is never what anyone
    // wanted. A muted autoplay should not interrupt something already audible.
    players.forEach(function (p) {
      if (p === self || p.video.paused) return;
      if (silent && !p.video.muted) return;
      p.pause({ auto: true });
    });

    if (silent && !this.userSetSound) this.video.muted = true;

    this.setBusy(true);
    return Promise.resolve(this.attach())
      .then(function () {
        return self.video.play();
      })
      .then(function () {
        self.userPaused = false;
      })
      .catch(function () {
        self.setBusy(false);
        // Autoplay refused (iOS Low Power Mode, for instance). Fall back to
        // showing the play button rather than a video that silently does
        // nothing.
        self.root.classList.remove("is-playing");
      });
  };

  Player.prototype.pause = function (opts) {
    if (!(opts && opts.auto)) this.userPaused = true;
    this.video.pause();
  };

  Player.prototype.toggle = function () {
    if (this.video.paused) {
      this.userPaused = false;
      this.play();
    } else {
      this.pause();
    }
  };

  Player.prototype.restart = function () {
    this.video.currentTime = 0;
    if (this.video.paused) this.play();
    this.nudgeControls();
  };

  Player.prototype.unmute = function () {
    this.userSetSound = true;
    this.video.muted = false;
    if (this.video.volume === 0) this.video.volume = 1;
    if (this.video.paused) this.play();
  };

  /* Autoplay when scrolled into view, stop when out of view. Videos driven by
     the curriculum scroller opt out with data-manual, since that controller
     decides which one is on screen. */
  Player.prototype.watchViewport = function (force) {
    var self = this;
    if (!("IntersectionObserver" in window)) return;
    if (this.viewportWatched) return;
    // Slides in the pinned curriculum are stacked at the same position, so all
    // of them would read as "in view" at once. That controller opts out here
    // and drives playback itself; when it falls back to a plain list it calls
    // this with force to hand control back.
    if (this.root.hasAttribute("data-manual") && !force) return;
    this.viewportWatched = true;

    // A quarter visible is enough to start. The brand video is deliberately
    // pulled up into the fold, so at rest on load it is only about 44% on
    // screen — a half-visible threshold would leave it sitting there stopped,
    // which is exactly the thing it is not supposed to do.
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.25) {
            if (self.autoplay && !self.userPaused && self.video.paused) {
              self.play({ muted: true });
            }
          } else if (!entry.isIntersecting && !self.video.paused) {
            // Leaving the viewport: stop, so a visitor further down the page
            // isn't still pulling segments for a video they left behind.
            self.pause({ auto: true });
          }
        });
      },
      { threshold: [0, 0.25] }
    );
    observer.observe(this.root);
  };

  Player.prototype.seekFromPointer = function (clientX) {
    var rect = this.bar.getBoundingClientRect();
    var pct = (clientX - rect.left) / rect.width;
    pct = Math.min(1, Math.max(0, pct));
    if (isFinite(this.video.duration)) {
      this.video.currentTime = pct * this.video.duration;
    }
  };

  Player.prototype.renderProgress = function () {
    var d = this.video.duration;
    var pct = isFinite(d) && d > 0 ? (this.video.currentTime / d) * 100 : 0;
    this.played.style.width = pct + "%";
    this.knob.style.left = pct + "%";
    this.timeNow.textContent = formatTime(this.video.currentTime);

    this.bar.setAttribute("aria-valuenow", Math.round(pct));
    this.bar.setAttribute(
      "aria-valuetext",
      formatTime(this.video.currentTime) + " of " + formatTime(d)
    );

    if (this.video.buffered.length && isFinite(d) && d > 0) {
      var end = this.video.buffered.end(this.video.buffered.length - 1);
      this.buffered.style.width = (end / d) * 100 + "%";
    }
  };

  Player.prototype.nudgeControls = function () {
    var self = this;
    this.root.classList.add("show-controls");
    clearTimeout(this.hideTimer);
    if (!this.video.paused) {
      this.hideTimer = setTimeout(function () {
        if (!self.root.contains(document.activeElement)) {
          self.root.classList.remove("show-controls");
        }
      }, 2600);
    }
  };

  /* Captions default on whenever sound is off, and off once sound is on —
     matching what the viewer can actually perceive. */
  Player.prototype.syncCaptions = function (force) {
    if (!this.cues || !this.cues.length) return;
    var on = force === undefined ? this.video.muted : force;
    this.root.classList.toggle("cc-on", on);
    if (this.ccBtn) this.ccBtn.setAttribute("aria-pressed", on ? "true" : "false");
  };

  Player.prototype.hasCaptions = function () {
    return !!(this.cues && this.cues.length);
  };

  Player.prototype.bind = function () {
    var self = this;
    var v = this.video;

    this.bigPlay.addEventListener("click", function () {
      self.userPaused = false;
      self.userSetSound = true; // an explicit press means they want it properly
      v.muted = false;
      self.play();
    });

    this.playBtn.addEventListener("click", function () {
      self.toggle();
    });

    if (this.restartBtn) {
      this.restartBtn.addEventListener("click", function () {
        self.restart();
      });
    }

    if (this.unmuteBtn) {
      this.unmuteBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        self.unmute();
      });
    }

    v.addEventListener("click", function () {
      // While muted-autoplaying, a tap on the picture should turn sound on —
      // the behaviour people already expect from a muted feed video.
      if (!v.paused && v.muted && !self.userSetSound) self.unmute();
      else self.toggle();
    });

    v.addEventListener("play", function () {
      self.root.classList.add("is-playing", "has-started");
      self.playBtn.setAttribute("aria-label", "Pause");
      self.nudgeControls();
    });
    v.addEventListener("pause", function () {
      self.root.classList.remove("is-playing");
      self.playBtn.setAttribute("aria-label", "Play");
      self.root.classList.add("show-controls");
      clearTimeout(self.hideTimer);
    });
    v.addEventListener("ended", function () {
      self.root.classList.remove("is-playing");
      self.root.classList.add("is-ended");
    });
    v.addEventListener("playing", function () {
      self.setBusy(false);
      self.root.classList.remove("is-ended");
    });
    v.addEventListener("waiting", function () {
      self.setBusy(true);
    });
    v.addEventListener("timeupdate", function () {
      self.renderProgress();
      self.renderCue();
    });
    v.addEventListener("progress", function () {
      self.renderProgress();
    });
    v.addEventListener("loadedmetadata", function () {
      self.timeTotal.textContent = formatTime(v.duration);
      self.renderProgress();
      self.syncCaptions();
    });
    v.addEventListener("volumechange", function () {
      var muted = v.muted || v.volume === 0;
      self.root.classList.toggle("is-muted", muted);
      self.muteBtn.setAttribute("aria-label", muted ? "Unmute" : "Mute");
      if (self.volRange) self.volRange.value = muted ? 0 : v.volume;
      self.syncCaptions();
    });

    this.muteBtn.addEventListener("click", function () {
      self.userSetSound = true;
      v.muted = !v.muted;
      if (!v.muted && v.volume === 0) v.volume = 1;
    });

    if (this.ccBtn) {
      this.ccBtn.addEventListener("click", function () {
        self.syncCaptions(!self.root.classList.contains("cc-on"));
      });
    }

    if (this.volRange) {
      this.volRange.addEventListener("input", function () {
        self.userSetSound = true;
        v.volume = parseFloat(self.volRange.value);
        v.muted = v.volume === 0;
      });
    }

    this.fsBtn.addEventListener("click", function () {
      var doc = document;
      if (doc.fullscreenElement || doc.webkitFullscreenElement) {
        (doc.exitFullscreen || doc.webkitExitFullscreen).call(doc);
      } else if (self.root.requestFullscreen) {
        self.root.requestFullscreen();
      } else if (self.root.webkitRequestFullscreen) {
        self.root.webkitRequestFullscreen();
      } else if (v.webkitEnterFullscreen) {
        // iPhone Safari only allows the video element itself to go fullscreen.
        v.webkitEnterFullscreen();
      }
    });

    var dragging = false;
    this.bar.addEventListener("pointerdown", function (e) {
      dragging = true;
      self.bar.setPointerCapture(e.pointerId);
      self.seekFromPointer(e.clientX);
    });
    this.bar.addEventListener("pointermove", function (e) {
      if (dragging) self.seekFromPointer(e.clientX);
    });
    this.bar.addEventListener("pointerup", function (e) {
      dragging = false;
      self.bar.releasePointerCapture(e.pointerId);
    });

    this.bar.addEventListener("keydown", function (e) {
      var step = e.shiftKey ? 10 : 5;
      if (e.key === "ArrowRight") {
        v.currentTime = Math.min(v.duration || 0, v.currentTime + step);
      } else if (e.key === "ArrowLeft") {
        v.currentTime = Math.max(0, v.currentTime - step);
      } else if (e.key === "Home") {
        v.currentTime = 0;
      } else if (e.key === "End") {
        v.currentTime = v.duration || 0;
      } else {
        return;
      }
      e.preventDefault();
    });

    this.root.addEventListener("keydown", function (e) {
      if (e.target !== self.root) return;
      var handled = true;
      switch (e.key) {
        case " ":
        case "k":
          self.toggle();
          break;
        case "ArrowRight":
          v.currentTime = Math.min(v.duration || 0, v.currentTime + 5);
          break;
        case "ArrowLeft":
          v.currentTime = Math.max(0, v.currentTime - 5);
          break;
        case "ArrowUp":
          v.volume = Math.min(1, v.volume + 0.1);
          break;
        case "ArrowDown":
          v.volume = Math.max(0, v.volume - 0.1);
          break;
        case "m":
          self.userSetSound = true;
          v.muted = !v.muted;
          break;
        case "f":
          self.fsBtn.click();
          break;
        case "0":
          self.restart();
          break;
        default:
          handled = false;
      }
      if (handled) {
        e.preventDefault();
        self.nudgeControls();
      }
    });

    ["pointermove", "pointerdown", "focusin"].forEach(function (evt) {
      self.root.addEventListener(evt, function () {
        self.nudgeControls();
      });
    });
    this.root.addEventListener("pointerleave", function () {
      if (!v.paused && !self.root.contains(document.activeElement)) {
        self.root.classList.remove("show-controls");
      }
    });
  };

  function init() {
    document.querySelectorAll(".player").forEach(function (el) {
      new Player(el);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // The curriculum scroller drives its own videos.
  window.Headroom = {
    players: players,
    get: function (slug) {
      return bySlug[slug];
    },
    reduceMotion: reduceMotion,
  };
})();
