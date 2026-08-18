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

  /* Where the media lives -- the only place the page knows it, so moving hosts
     is this one string.

     Cloudflare R2 behind a custom domain: no egress charge, honours Range
     requests (which the byte-range HLS depends on -- each rendition is one file
     that players seek into by offset), and CORS allows any origin, so this
     works from the real site, localhost, a phone on the LAN, and the tunnel
     alike.

     Preview reads from the same bucket as production on purpose. Serving video
     out of a local directory meant only a machine that had built it could show
     the page, and the build needs the camera masters -- so a second machine, or
     a fresh clone, got a site with no video and no hint why. A new video is a
     new asset: upload it, then preview it. */
  var VIDEO_BASE = "https://video.avand.fm/";

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
    this.renderVolume();
    this.lazyPoster();
    this.watchViewport();

    /* Opt-in, one video only for now: render this player's captions as page
       text in the named element instead of as an overlay on the picture.
       See renderLyrics. */
    var into = root.dataset.captionsInto;
    this.lyricsBox = into ? document.getElementById(into) : null;
    if (this.lyricsBox) {
      root.classList.add("has-lyrics");
      /* They read as page copy now rather than as something that appears with
         playback, so the opening lines have to be on screen before the video
         is ever touched -- which means not waiting for attach() to fetch the
         cues on first play. */
      this.loadCaptions();
    }

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

  var SPEAKER_D =
    "M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z" +
    "M14 2v2a8 8 0 0 1 0 16v2a10 10 0 0 0 0-20z";

  var SLASH_D = "M3.4 2.8 21.2 20.6";

  /* The slash reads as cutting through the speaker rather than lying on top of
     it, which needs a gap around it. The gap is masked out rather than painted
     in a matching colour: the button sits on video and turns accent on hover,
     so there is no one colour to match. */
  function mutedIcon(uid) {
    return (
      '<defs><mask id="' + uid + '">' +
      '<rect width="24" height="24" fill="#fff"/>' +
      '<path d="' + SLASH_D + '" stroke="#000" stroke-width="4.6"' +
      ' stroke-linecap="round" fill="none"/>' +
      "</mask></defs>" +
      '<path d="' + SPEAKER_D + '" mask="url(#' + uid + ')"/>' +
      '<path d="' + SLASH_D + '" fill="none" stroke="currentColor"' +
      ' stroke-width="2.1" stroke-linecap="round"/>'
    );
  }

  var ICONS = {
    play: '<path d="M8 5v14l11-7z"/>',
    pause: '<path d="M6 5h4v14H6zm8 0h4v14h-4z"/>',
    // Skip-to-start (⏮) rather than a reload arrow: this returns to the
    // beginning of the video, it doesn't replay or refresh anything.
    restart: '<path d="M6 6h2.5v12H6zm3.8 6l8.7 6V6z"/>',
    loud: '<path d="' + SPEAKER_D + '"/>',
    /* A bare cone, with the room to its right given over to the sign. The
       full speaker's sound curves would crowd it at this size and read as
       decoration rather than as the direction the button goes. */
    volDown: '<path d="M2 9v6h4l5 5V4L6 9H2z"/><rect x="14" y="11" width="8" height="2" rx="1"/>',
    volUp:
      '<path d="M2 9v6h4l5 5V4L6 9H2z"/><rect x="14" y="11" width="8" height="2" rx="1"/>' +
      '<rect x="17" y="8" width="2" height="8" rx="1"/>',
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
      '<div class="pl-captions is-empty" aria-live="off"></div>' +
      '<div class="pl-spinner" aria-hidden="true"></div>' +
      '<div class="pl-error" role="alert"></div>' +
      /* Sits outside .pl-controls deliberately: that whole bar retires after
         a few seconds, and silent video with no visible way back to sound
         just looks broken. This one stays up for as long as the sound is
         off. */
      '<button class="pl-unmute" aria-label="Turn sound on">' +
      svg(ICONS.loud) +
      "<span>Sound on</span>" +
      "</button>" +
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
      /* Both are rendered; the stylesheet shows whichever suits the input.
         A touch device gets the single mute toggle -- iOS keeps the audio
         level on the hardware buttons, so stepped volume would be two
         controls that visibly do nothing. Deciding this in CSS rather than by
         probing the media element: a detached <video> answers the volume
         question differently from a playing one, which made the probe say
         "settable" on exactly the phones it was meant to catch. */
      '<button class="pl-btn pl-vol-down" aria-label="Volume down">' +
      svg(ICONS.volDown) +
      "</button>" +
      '<button class="pl-btn pl-vol-up" aria-label="Volume up">' +
      svg(ICONS.volUp) +
      "</button>" +
      '<button class="pl-btn pl-mute" aria-label="Unmute">' +
      svg(ICONS.loud, "pl-icon-loud") +
      svg(mutedIcon("mute-" + this.slug), "pl-icon-muted") +
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
    this.controls = r.querySelector(".pl-controls");
    this.playBtn = r.querySelector(".pl-play");
    this.restartBtn = r.querySelector(".pl-restart");
    this.volDownBtn = r.querySelector(".pl-vol-down");
    this.volUpBtn = r.querySelector(".pl-vol-up");
    this.muteBtn = r.querySelector(".pl-mute");
    this.unmuteBtn = r.querySelector(".pl-unmute");
    this.bar = r.querySelector(".pl-bar");
    this.played = r.querySelector(".pl-played");
    this.buffered = r.querySelector(".pl-buffered");
    this.knob = r.querySelector(".pl-knob");
    this.timeNow = r.querySelector(".pl-time-now");
    this.timeTotal = r.querySelector(".pl-time-total");

    /* How long the clip runs, before a byte of it has been fetched.
     *
     * The control bar is on show while a video is idle, so without this it
     * advertises "0:00 / 0:00" for the whole time the reader is deciding
     * whether to watch -- the one moment the length actually matters to them.
     * The real figure arrives with loadedmetadata and overwrites this, but
     * that costs a manifest and an init segment, and only after a tap.
     *
     * data-duration is in seconds, taken from the HLS manifests at build time
     * (sum the EXTINF values). If a clip is re-cut and the attribute is not,
     * the number is wrong until the reader presses play -- so it is written
     * next to the slug it belongs to in index.html, not in a table over here. */
    var declared = parseFloat(r.dataset.duration);
    if (isFinite(declared) && declared > 0) {
      this.timeTotal.textContent = formatTime(declared);
    }
    this.errorEl = r.querySelector(".pl-error");
    this.captionBox = r.querySelector(".pl-captions");
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
        self.renderLyrics();
      })
      .catch(function () {
        /* Captions are an enhancement; a missing file just means none. */
      });
  };

  Player.prototype.renderCue = function () {
    // One entry point: every existing caller (timeupdate, loadedmetadata, the
    // captions fetch) keeps working whichever presentation this player uses.
    if (this.lyricsBox) return this.renderLyrics();
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

  /*
   * Captions as page text, Spotify-lyrics style: the line being spoken plus
   * the one after it, with the words already said in full colour and the rest
   * knocked back.
   *
   * Two lines rather than one because the cues are short fragments broken
   * mid-sentence ("I think most people think that DJs are" / "sort of
   * mystical or magical"), so a single line would read as half a thought. The
   * pair also means there is always something on screen: the cues here run
   * end-to-start with no gaps, and before playback begins the opening two sit
   * there unhighlighted rather than leaving a hole in the page.
   *
   * The word highlight is interpolated, not measured -- a cue carries only a
   * start and an end, so its words are spread evenly across that span. It
   * tracks the voice closely enough to read as following along, and nothing
   * here is load-bearing if it drifts.
   */
  // Matches the transition on .cc-frame in the stylesheet; the outgoing lines
  // are removed once it has run.
  var LYRIC_FADE = 420;

  Player.prototype.renderLyrics = function () {
    var box = this.lyricsBox;
    if (!box || !this.cues || !this.cues.length) return;

    var cues = this.cues;
    var t = this.video.currentTime;

    // The last cue that has started; -1 before the first one has.
    var i = this.lyricScan || 0;
    if (i >= cues.length || cues[i].start > t) i = 0; // sought backwards
    var idx = -1;
    for (; i < cues.length && cues[i].start <= t; i++) idx = i;
    this.lyricScan = idx < 0 ? 0 : idx;

    var lead = idx < 0 ? 0 : idx;

    // Rebuild only when the line actually turns over -- the per-frame path
    // below is just class toggles on a handful of spans.
    if (lead !== this.lyricLead || !this.lyricWords) {
      var stepped = this.lyricLead === lead - 1; // the ordinary case: next line
      var previous = this.lyricLead;
      this.lyricLead = lead;
      this.lyricWords = [];

      var self = this;
      var frame = document.createElement("div");
      frame.className = "cc-frame";

      var now = document.createElement("p");
      now.className = "cc-line cc-now";
      cues[lead].text.split(/\s+/).forEach(function (word, n) {
        if (n) now.appendChild(document.createTextNode(" "));
        var span = document.createElement("span");
        span.className = "cc-word";
        span.textContent = word;
        now.appendChild(span);
        self.lyricWords.push(span);
      });
      frame.appendChild(now);

      /* Two lines of read-ahead, not one. The stylesheet steps each further
         back than the last so the three do not read as a block of grey. */
      for (var ahead = 1; ahead <= 2; ahead++) {
        if (!cues[lead + ahead]) break;
        var next = document.createElement("p");
        next.className = "cc-line cc-next";
        next.textContent = cues[lead + ahead].text;
        frame.appendChild(next);
      }

      var outgoing = this.lyricFrameEl;

      /* Only the ordinary line-to-line advance is worth animating. A seek --
         or the very first paint -- has no "previous line" the reader was
         following, so sliding something off screen there is just motion for
         its own sake. */
      var animate = stepped && outgoing && previous >= 0 && !reduceMotion;

      if (outgoing && !animate) box.removeChild(outgoing);

      if (animate) {
        /* Taken out of flow on the way out so the incoming lines can take
           their place immediately: left in flow, the two would stack and the
           block would double in height for the length of the transition. */
        outgoing.classList.add("is-out");
        window.setTimeout(function () {
          if (outgoing.parentNode) outgoing.parentNode.removeChild(outgoing);
        }, LYRIC_FADE);
        frame.classList.add("is-entering");
      }

      box.appendChild(frame);
      this.lyricFrameEl = frame;

      if (animate) {
        // Two frames: one for the entering state to be committed, one for the
        // change off it to read as a transition rather than a jump.
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            frame.classList.remove("is-entering");
          });
        });
      }

      this.lyricSaid = -1;
    }

    var cue = cues[lead];
    var length = Math.max(0.001, cue.end - cue.start);
    var through = idx < 0 ? 0 : Math.min(1, Math.max(0, (t - cue.start) / length));
    var said = Math.round(through * this.lyricWords.length);

    if (said !== this.lyricSaid) {
      this.lyricSaid = said;
      for (var w = 0; w < this.lyricWords.length; w++) {
        this.lyricWords[w].classList.toggle("is-said", w < said);
      }
    }
  };

  /* timeupdate only fires about four times a second, which is too coarse for
     words to light up with the voice. This runs while the video plays and
     stops with it; the work is a currentTime read and some arithmetic, and it
     touches the DOM only when the word count actually changes. */
  Player.prototype.startLyrics = function () {
    if (!this.lyricsBox || this.lyricFrame) return;
    var self = this;
    var step = function () {
      if (self.video.paused || self.video.ended) {
        self.lyricFrame = 0;
        return;
      }
      self.renderLyrics();
      self.lyricFrame = requestAnimationFrame(step);
    };
    this.lyricFrame = requestAnimationFrame(step);
  };

  Player.prototype.stopLyrics = function () {
    if (!this.lyricFrame) return;
    cancelAnimationFrame(this.lyricFrame);
    this.lyricFrame = 0;
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
          // Demux off the main thread, so parsing a segment cannot land in the
          // middle of an animation frame.
          enableWorker: true,
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

  /* Get everything ready without playing: fetch the library, the playlist and
     the first segments, and let the decoder warm up. Doing this at the moment
     a video is wanted costs a visible stall -- measured at about 110ms on a
     throttled phone, which lands as a stutter right where the eye is. Called
     early by whatever knows the video is coming. */
  Player.prototype.warm = function () {
    if (this.ready) return;
    this.video.preload = "auto";
    this.attach();
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

  // Turning sound on rewinds a little: whatever was just said went past in
  // silence, so this hands it back rather than making them scrub for it.
  var UNMUTE_REWIND = 5;

  // Five steps from silent to full, which is few enough to cross quickly and
  // fine enough to actually settle somewhere.
  var VOLUME_STEP = 0.2;

  Player.prototype.nudgeVolume = function (direction) {
    var v = this.video;
    this.userSetSound = true;
    // Muted counts as zero however loud the underlying volume is, so turning
    // it up from muted starts from silence rather than jumping back to
    // whatever it was before.
    var level = v.muted ? 0 : v.volume;
    level = level + direction * VOLUME_STEP;
    // Rounded, or repeated steps drift onto values like 0.6000000000000001
    // and the ends never compare equal.
    level = Math.round(Math.min(1, Math.max(0, level)) * 100) / 100;
    v.volume = level;
    v.muted = level === 0;
  };

  /* Both controls exist; only one is on screen. Keeping them both current is
     cheaper than working out which the stylesheet chose. */
  Player.prototype.renderVolume = function () {
    var level = this.video.muted ? 0 : this.video.volume;

    if (this.muteBtn) {
      this.muteBtn.setAttribute("aria-label", level === 0 ? "Unmute" : "Mute");
    }

    /* Greys out whichever end has been reached. Volume is the one control here
       with a limit the viewer can hit and keep pressing. */
    if (this.volDownBtn) {
      this.volDownBtn.disabled = level <= 0;
      this.volUpBtn.disabled = level >= 1;
    }
  };

  Player.prototype.toggleMute = function () {
    if (this.video.muted || this.video.volume === 0) this.unmute();
    else {
      this.userSetSound = true;
      this.video.muted = true;
    }
  };

  Player.prototype.unmute = function () {
    this.userSetSound = true;
    this.video.muted = false;
    if (this.video.volume === 0) this.video.volume = 1;
    if (this.video.currentTime > 0) {
      this.video.currentTime = Math.max(0, this.video.currentTime - UNMUTE_REWIND);
    }
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

    // A quarter visible is enough to start -- a half-visible threshold would
    // leave a video sitting there stopped for longer than it needs to.
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          // Remembered so that coming back to a backgrounded tab can tell
          // which videos are actually on screen -- the observer itself won't
          // fire again for one that never moved.
          self.inView = entry.isIntersecting && entry.intersectionRatio >= 0.25;
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

  /*
   * Control visibility, on the conventions a video player is expected to
   * follow: they appear on any sign of intent and retire after a few seconds
   * of stillness, but never while there is a reason to keep them.
   *
   * The cursor hides with them. Leaving an arrow floating over playing video
   * is the tell that a player was not finished.
   */
  var HIDE_DELAY = 3000;

  Player.prototype.holdControls = function (reason, held) {
    this.holds = this.holds || {};
    if (held) this.holds[reason] = true;
    else delete this.holds[reason];
    this.nudgeControls();
  };

  Player.prototype.isHeld = function () {
    // Reasons the controls must stay: nothing is playing, the pointer is on
    // them, a scrub is in progress, or they hold keyboard focus.
    if (this.video.paused) return true;
    if (this.holds) {
      for (var key in this.holds) {
        if (this.holds[key]) return true;
      }
    }

    var focused = document.activeElement;
    if (!focused || !this.root.contains(focused)) return false;

    /* Keyboard focus holds them; a mouse click does not. Clicking a button
       focuses it, so treating any focus as a hold meant that pressing pause or
       unmute pinned the controls open for good, however far the pointer then
       moved away. :focus-visible is exactly that distinction. */
    try {
      return focused.matches(":focus-visible");
    } catch (e) {
      return true; // no support: keep them, rather than strand a keyboard user
    }
  };

  Player.prototype.showControls = function () {
    this.root.classList.add("show-controls");
  };

  Player.prototype.hideControls = function () {
    if (this.isHeld()) return;
    this.root.classList.remove("show-controls");
  };

  Player.prototype.nudgeControls = function () {
    var self = this;
    this.showControls();
    clearTimeout(this.hideTimer);
    if (this.isHeld()) return;
    this.hideTimer = setTimeout(function () {
      self.hideControls();
    }, HIDE_DELAY);
  };

  /* Captions default on whenever sound is off, and off once sound is on —
     matching what the viewer can actually perceive. */
  /* Captions are on exactly when the sound is off. Muted video is silent
     video, so they carry it; once sound is on they are noise. */
  Player.prototype.syncCaptions = function () {
    if (!this.cues || !this.cues.length) return;
    this.root.classList.toggle("cc-on", this.video.muted);
  };

  Player.prototype.hasCaptions = function () {
    return !!(this.cues && this.cues.length);
  };

  Player.prototype.bind = function () {
    var self = this;
    var v = this.video;

    this.playBtn.addEventListener("click", function () {
      if (v.paused && !self.root.classList.contains("has-started")) {
        self.userSetSound = true;
        v.muted = false;
      }
      self.toggle();
    });

    if (this.restartBtn) {
      this.restartBtn.addEventListener("click", function () {
        self.restart();
      });
    }

    var lastPointerType = "mouse";
    var revealTap = false;
    this.root.addEventListener(
      "pointerdown",
      function (e) {
        lastPointerType = e.pointerType || "mouse";
        /* Captured here, in the capture phase, before the plain "pointerdown
           -> nudgeControls" listener below (bubble phase, same event) gets a
           chance to turn show-controls on. Checking the class from inside the
           click handler instead always saw it already-on -- that listener
           runs after pointerdown has finished dispatching.

           "Controls are currently hidden" is not the same as "show-controls
           is absent": the stylesheet also shows them for anything that isn't
           playing (.player:not(.is-playing) .pl-controls), which covers every
           video before its first play, after it ends, and when autoplay was
           refused. Without the is-playing term here, the first tap on a
           stopped video is swallowed as a reveal and it takes two taps to
           start anything. */
        revealTap =
          lastPointerType === "touch" &&
          self.root.classList.contains("is-playing") &&
          !self.root.classList.contains("show-controls");
      },
      true
    );

    v.addEventListener("click", function () {
      // On a touch screen there is no hover, so the first tap is how the
      // controls are summoned; it should not also do something.
      if (revealTap) {
        revealTap = false;
        self.nudgeControls();
        return;
      }
      if (!v.paused && v.muted && !self.userSetSound) self.unmute();
      else self.toggle();
    });

    v.addEventListener("play", function () {
      self.root.classList.add("is-playing", "has-started");
      self.playBtn.setAttribute("aria-label", "Pause");
      self.nudgeControls();
      self.startLyrics();
    });
    v.addEventListener("pause", function () {
      self.root.classList.remove("is-playing");
      self.playBtn.setAttribute("aria-label", "Play");
      self.root.classList.add("show-controls");
      clearTimeout(self.hideTimer);
      self.stopLyrics();
      // Nothing is loading towards playback any more, so the spinner has no
      // business still being up.
      self.setBusy(false);
    });
    v.addEventListener("ended", function () {
      self.root.classList.remove("is-playing");
      self.root.classList.add("is-ended");
      self.stopLyrics();
    });
    v.addEventListener("seeked", function () {
      // Scrubbing while paused should still move the lines.
      self.renderLyrics();
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
      /* Only if it is a real number. Under hls.js the duration can still be
         NaN or Infinity at this point, and formatTime turns both into "0:00" --
         so an accurate figure seeded from data-duration would be replaced by a
         wrong one the moment the reader pressed play, which is worse than the
         state the seeding was added to fix. */
      if (isFinite(v.duration) && v.duration > 0) {
        self.timeTotal.textContent = formatTime(v.duration);
      }
      self.renderProgress();
      self.syncCaptions();
    });
    v.addEventListener("volumechange", function () {
      var muted = v.muted || v.volume === 0;
      self.root.classList.toggle("is-muted", muted);
      self.syncCaptions();
      self.renderVolume();
    });

    if (this.unmuteBtn) {
      this.unmuteBtn.addEventListener("click", function (e) {
        // Not a tap on the picture, which would toggle playback.
        e.stopPropagation();
        self.unmute();
      });
    }

    if (this.volDownBtn) {
      this.volDownBtn.addEventListener("click", function () {
        self.nudgeVolume(-1);
      });
      this.volUpBtn.addEventListener("click", function () {
        self.nudgeVolume(1);
      });
    }

    if (this.muteBtn) {
      this.muteBtn.addEventListener("click", function () {
        self.toggleMute();
      });
    }

    var dragging = false;
    this.bar.addEventListener("pointerdown", function (e) {
      dragging = true;
      self.holdControls("scrub", true);
      self.bar.setPointerCapture(e.pointerId);
      self.seekFromPointer(e.clientX);
    });
    this.bar.addEventListener("pointermove", function (e) {
      if (dragging) self.seekFromPointer(e.clientX);
    });
    this.bar.addEventListener("pointerup", function (e) {
      dragging = false;
      self.holdControls("scrub", false);
      self.bar.releasePointerCapture(e.pointerId);
    });

    this.controls.addEventListener("pointerenter", function () {
      self.holdControls("hover", true);
    });
    this.controls.addEventListener("pointerleave", function () {
      self.holdControls("hover", false);
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
        case "m":
          self.toggleMute();
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
      // Touch has no hover, so a tap's pointerup is immediately followed by a
      // synthetic pointerleave -- the pointer isn't "over" anything once
      // contact ends. Acting on that would hide the controls the instant
      // every tap lands, before the click that's supposed to reveal them.
      // Keyed off lastPointerType (set from the real pointerdown) rather than
      // this event's own pointerType, which isn't reliably populated on a
      // synthetic pointerleave across engines.
      if (lastPointerType === "touch") return;

      /* The pointer is off the player entirely, so it cannot be on the
         controls. Clearing the hold outright means a missing pointerleave from
         the controls -- the pointer leaving the window, or a curriculum slide
         hiding beneath it -- cannot strand them open. */
      self.holdControls("hover", false);
      clearTimeout(self.hideTimer);
      self.hideControls();
    });

    this.root.addEventListener("focusout", function () {
      // Focus may be moving between controls; let it settle first.
      setTimeout(function () {
        self.nudgeControls();
      }, 0);
    });
  };

  function init() {
    document.querySelectorAll(".player").forEach(function (el) {
      new Player(el);
    });
  }

  /*
   * Coming back to the page after it has been in the background.
   *
   * iOS suspends media in a backgrounded tab, and what it tears down does not
   * necessarily come back on its own: the play() that set the spinner never
   * settles, so the video sits there spinning forever. Nothing else recovers
   * this -- the viewport observer only fires on a crossing, and a video that
   * never moved has not crossed anything.
   *
   * So on the way back: clear any spinner that no longer has a play behind
   * it, and restart whatever was playing by itself before.
   */
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) return;
    players.forEach(function (p) {
      if (p.video.paused) p.setBusy(false);
      if (p.autoplay && p.inView && !p.userPaused && p.video.paused) {
        p.play({ muted: true });
      }
    });
  });

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
