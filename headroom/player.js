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
 */
(function () {
  "use strict";

  var VIDEO_BASE = "https://avand.github.io/headroom-video/";
  var HLS_LIB = "hls.min.js";

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

  function Player(root) {
    this.root = root;
    this.slug = root.dataset.video;
    this.video = root.querySelector("video");
    this.ready = false;
    this.hls = null;
    this.hideTimer = null;

    this.build();
    this.bind();
    this.lazyPoster();
    players.push(this);
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

  Player.prototype.build = function () {
    var r = this.root;

    this.bigPlay = r.querySelector(".pl-bigplay");
    this.controls = r.querySelector(".pl-controls");
    this.playBtn = r.querySelector(".pl-play");
    this.muteBtn = r.querySelector(".pl-mute");
    this.fsBtn = r.querySelector(".pl-fs");
    this.bar = r.querySelector(".pl-bar");
    this.played = r.querySelector(".pl-played");
    this.buffered = r.querySelector(".pl-buffered");
    this.knob = r.querySelector(".pl-knob");
    this.timeNow = r.querySelector(".pl-time-now");
    this.timeTotal = r.querySelector(".pl-time-total");
    this.spinner = r.querySelector(".pl-spinner");
    this.errorEl = r.querySelector(".pl-error");
    this.volRange = r.querySelector(".pl-vol");
  };

  /* Attach a source. Called on first play, not on page load. */
  Player.prototype.attach = function () {
    if (this.ready) return Promise.resolve();
    this.ready = true;

    var self = this;
    var src = VIDEO_BASE + this.slug + "/master.m3u8";

    // Safari (and iOS in general) handles HLS in the media element itself.
    if (this.video.canPlayType("application/vnd.apple.mpegurl")) {
      this.video.src = src;
      return Promise.resolve();
    }

    return loadHlsLibrary()
      .then(function () {
        if (!window.Hls || !window.Hls.isSupported()) {
          throw new Error("This browser can't play the video");
        }
        self.hls = new window.Hls({
          // Keep the first segment small so playback starts quickly, then let
          // the bandwidth estimator take over.
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

  Player.prototype.play = function () {
    var self = this;

    // Only one video at a time; two soundtracks at once is never what anyone
    // wanted.
    players.forEach(function (p) {
      if (p !== self && !p.video.paused) p.video.pause();
    });

    this.setBusy(true);
    Promise.resolve(this.attach())
      .then(function () {
        return self.video.play();
      })
      .catch(function () {
        self.setBusy(false);
      });
  };

  Player.prototype.toggle = function () {
    if (this.video.paused) this.play();
    else this.video.pause();
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

  /* Controls fade out during playback, and come back on any intent to use
     them — pointer movement, focus, or touch. */
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

  Player.prototype.bind = function () {
    var self = this;
    var v = this.video;

    this.bigPlay.addEventListener("click", function () {
      self.play();
    });
    this.playBtn.addEventListener("click", function () {
      self.toggle();
    });

    // Clicking the picture itself toggles playback, the way every other video
    // on the web behaves.
    v.addEventListener("click", function () {
      self.toggle();
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
    });
    v.addEventListener("progress", function () {
      self.renderProgress();
    });
    v.addEventListener("loadedmetadata", function () {
      self.timeTotal.textContent = formatTime(v.duration);
      self.renderProgress();
    });
    v.addEventListener("volumechange", function () {
      var muted = v.muted || v.volume === 0;
      self.root.classList.toggle("is-muted", muted);
      self.muteBtn.setAttribute("aria-label", muted ? "Unmute" : "Mute");
      if (self.volRange) self.volRange.value = muted ? 0 : v.volume;
    });

    this.muteBtn.addEventListener("click", function () {
      v.muted = !v.muted;
      if (!v.muted && v.volume === 0) v.volume = 1;
    });

    if (this.volRange) {
      this.volRange.addEventListener("input", function () {
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

    // Scrubbing.
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
      // Let the seek bar and the volume slider handle their own arrow keys.
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
          v.muted = !v.muted;
          break;
        case "f":
          self.fsBtn.click();
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

    // Stop the download when a video is scrolled well out of view, so a visitor
    // reading further down the page isn't still pulling segments for a video
    // they left behind.
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting && !v.paused) v.pause();
          });
        },
        { threshold: 0.15 }
      ).observe(this.root);
    }
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
})();
