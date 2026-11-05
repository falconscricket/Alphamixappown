(function(){
  var started=false;
  function start(){ if(started) return; started=true;
/* ALPHA Mic Booster — V30 audio engine (runs in page main-world) */
(function () {
  if (window.__ALPHA_ENGINE__) return;
  window.__ALPHA_ENGINE__ = true;
  const TAG = "ALPHA";

  // ---- ALPHA V30 heavy noise generators (shared text: inject.js + content.js) ----
  function alphaNoiseBuf(c, kind) {
    const sr = c.sampleRate, n = Math.floor(sr * 4), buf = c.createBuffer(1, n, sr), d = buf.getChannelData(0);
    let last = 0, b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, brown = 0, pop = 0, burstLeft = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1; let v;
      if (kind === "hiss") v = w * .55;
      else if (kind === "harsh") v = Math.tanh(w * 4) * (Math.random() > .997 ? 1 : .7);
      else if (kind === "all") { last = .7 * last + .3 * w; v = (w * .5 + last * .7) * (Math.random() > .992 ? 1.8 : .8); }
      else if (kind === "white") v = w * .9;
      else if (kind === "pink") {
        b0 = .99886 * b0 + w * .0555179; b1 = .99332 * b1 + w * .0750759; b2 = .969 * b2 + w * .153852;
        b3 = .8665 * b3 + w * .3104856; b4 = .55 * b4 + w * .5329522; b5 = -.7616 * b5 - w * .016898;
        v = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * .5362) * .2; b6 = w * .115926;
      }
      else if (kind === "brown") { brown = (brown + .02 * w) / 1.02; v = brown * 4; }
      else if (kind === "crackle") { pop *= .985; if (Math.random() > .999) pop = (Math.random() < .5 ? -1 : 1) * (.6 + Math.random() * .4); v = pop + w * .05; }
      else if (kind === "burst") { if (burstLeft <= 0 && Math.random() > .99993) burstLeft = Math.floor(sr * (.05 + Math.random() * .3)); v = burstLeft > 0 ? (burstLeft--, w) : w * .1; }
      else if (kind === "heavy") { brown = (brown + .02 * w) / 1.02; v = Math.tanh((w * 1.2 + brown * 7) * 3) * .95; }
      else { last = .82 * last + .18 * w; v = (w * .7 + last * .6) * (Math.random() > .985 ? 1.4 : .6); }
      d[i] = v > 1 ? 1 : v < -1 ? -1 : v;
    }
    return buf;
  }
  function alphaDistCurve(amount) {
    const n = 2048, cv = new Float32Array(n), k = Math.max(0, Math.min(100, Number(amount) || 0)) / 100 * 40;
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; cv[i] = k < 0.5 ? x : Math.tanh(k * x) / Math.tanh(k); }
    return cv;
  }

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------
  let state = {
    enabled: true,
    noiseMicEnabled: false,
    noiseMicOnly: true,
    noiseMicGain: 4,
    noiseMicKind: "heavy",
    noiseMicDist: 35,
    noiseMicBright: 9000,
    noiseMicEcho: true,
    noiseMicFrequency: 1000,
    noiseMicToneEnabled: false,

    // Gain / Booster
    autoGainMax: false,          // 1-100x secondary multiplier ("Volume Booster")

    disableAGC: true,
    disableNS: true,

    // 5-band EQ, now -24..+24 dB per band

    // Noise gate
    gateEnabled: true,
    gateThreshold: -200,

    mode: "ALPHA",

    // Default ALPHA reset state
    intensity: 100,
    boosterX: 100,
    voiceVolume: 200,
    autoGainMax: true,
    disableAGC: true,
    disableNS: true,
    eq60: -24, eq250: -24, eq1k: 24, eq4k: -24, eq12k: -24,
    gateEnabled: true,
    gateThreshold: -200,
    heavyEnabled: true,

    // Heavy / distortion
    heavyDrive: 2000,

    // Echo — driven by "repeats" 0-9. Each step raises both the feedback
    // (how many audible repeats) and the wet mix (how loud those repeats
    // are), capped at safe values so it never runs away into feedback howl.
    echoEnabled: false,
    echoDelay: 250,
    echoRepeats: 4,        // capped at 4 audible repeats
    echoFeedback: 0,       // derived, kept for state-sync/back-compat
    echoMix: 0,            // derived, kept for state-sync/back-compat

    // Voice / pitch — widened to +/-24 semitones (2 octaves)
    pitchEnabled: false,
    pitchSemitones: 0,
    voicePreset: "Normal",

    // Soundboard
    sbFxEnabled: false,
    sbVolume: 2000,
    soundboardEnabled: false,
    soundAutoPlay: false,
    songLoop: false,
    muteBypass: true,      // keep the song audible in the call even if the call app mutes the mic
    autoUnmute: false,     // AUTO-UNMUTE ON MUTE: re-enable own track after an app mute (visible in status)
    userMicWant: false,    // set by MANUAL UNMUTE; the user's explicit request for a live mic
    songFx: { echo: false, echoRepeats: 4, echoDelay: 300, reverb: false, chorus: false, tremolo: false,
              distortion: false, babyVoice: false, robot: false, telephone: false, bass: false, speed: 1000 }
  };

  let ctx = null;
  let engines = [];      // one per hooked getUserMedia() call stream
  let testEngine = null; // engine for the local "Test My Mic" loopback

  let sbBuffer = null;        // decoded AudioBuffer for the loaded soundboard clip
  let sbStartAt = 0, sbStartOffset = 0, sbRate = 1;
  let sbSourceNode = null;    // currently-playing BufferSource (soundboard)
  let recorder = null;
  let recordedChunks = [];

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------
  function dbToGain(db) { return Math.pow(10, db / 20); }
  function intensityToGain(v) { return 1 + (v / 100) * 999; } // 0-100 -> 1x..1000x
  function semitonesToRatio(st) { return Math.pow(2, st / 12); }

  function echoParamsFromRepeats(n) {
    n = Math.max(0, Math.min(4, Number(n) || 0));
    const t = n / 4;
    return {
      feedback: n === 0 ? 0 : Math.min(0.85, 0.15 + t * 0.7),
      mix: n === 0 ? 0 : Math.min(0.45, 0.12 + t * 0.33)
    };
  }

  function getCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  }

  function makeFilter(c, freq, type) {
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    if (type === "peaking") f.Q.value = 1;
    f.gain.value = 0;
    return f;
  }

  // Waveshaper-based "Heavy Sound" distortion with a bit of sub-bass lift
  function makeHeavy(c) {
    const shaper = c.createWaveShaper();
    shaper.oversample = "2x";
    shaper._setDrive = function (amount) {
      const curve = new Float32Array(1024);
      const k = amount * 180;
      for (let i = 0; i < 1024; i++) {
        const x = (i / 1023) * 2 - 1;
        curve[i] = k === 0 ? x : ((1 + k) * x) / (1 + k * Math.abs(x));
      }
      shaper.curve = curve;
    };
    shaper._setDrive(0);
    const subBass = makeFilter(c, 90, "lowshelf");
    subBass.gain.value = 0;
    const makeup = c.createGain(); makeup.gain.value = 1;
    shaper.connect(makeup); makeup.connect(subBass);
    return { input: shaper, output: subBass, shaper, subBass, makeup };
  }

  // Granular pitch shifter (ScriptProcessor based, dependency-free)
  function makePitchShifter(c) {
    // Granular pitch shifter: two overlapping read heads with Hann crossfade.
    // Each read head trails the write head by a delay inside [minDelay, minDelay+grain),
    // so it never reads samples that have not been written yet.
    const node = c.createScriptProcessor(2048, 1, 1);
    const bufSize = 16384;
    const buf = new Float32Array(bufSize);
    let writeIdx = 0;
    const grain = 3072;
    const minDelay = 128;
    let dA = minDelay + grain * 0.25;   // distance behind the write head
    let dB = minDelay + grain * 0.75;
    node._ratio = 1;
    function hann(p) { return 0.5 - 0.5 * Math.cos(2 * Math.PI * p); }
    function wrap(d) {
      while (d < minDelay) d += grain;
      while (d >= minDelay + grain) d -= grain;
      return d;
    }
    node.onaudioprocess = (ev) => {
      const input = ev.inputBuffer.getChannelData(0);
      const output = ev.outputBuffer.getChannelData(0);
      const ratio = node._ratio || 1;
      for (let i = 0; i < input.length; i++) {
        buf[writeIdx] = input[i];
        writeIdx = (writeIdx + 1) % bufSize;
        // Per sample the write head moves 1 and the read head moves `ratio`
        dA = wrap(dA + (1 - ratio));
        dB = wrap(dB + (1 - ratio));
        const wA = hann((dA - minDelay) / grain);
        const wB = hann((dB - minDelay) / grain);
        const wSum = wA + wB || 1;
        const idxA = ((writeIdx - Math.floor(dA)) % bufSize + bufSize) % bufSize;
        const idxB = ((writeIdx - Math.floor(dB)) % bufSize + bufSize) % bufSize;
        output[i] = (buf[idxA] * wA + buf[idxB] * wB) / wSum;
      }
    };
    return node;
  }

  // Noise gate (ScriptProcessor based)
  function makeGate(c) {
    const node = c.createScriptProcessor(1024, 1, 1);
    node._gateEnabled = false;
    node._thresholdDb = -50;
    node._envelope = 0;
    node.onaudioprocess = (ev) => {
      const input = ev.inputBuffer.getChannelData(0);
      const output = ev.outputBuffer.getChannelData(0);
      if (!node._gateEnabled) { output.set(input); return; }
      const thresh = dbToGain(node._thresholdDb);
      for (let i = 0; i < input.length; i++) {
        const s = input[i];
        node._envelope = Math.max(Math.abs(s), node._envelope * 0.999);
        output[i] = node._envelope > thresh ? s : s * 0.02;
      }
    };
    return node;
  }

  // Apply current `state` to one live engine graph
  function applyState(e) {
    if (!e) return;
    const on = state.enabled;
    const t = ctx.currentTime;

    // GAIN and Booster sliders always apply while the main switch is on (AUTO GAIN MAX is a separate compressor)
    const gainOn = on;
    e.gainNode.gain.setTargetAtTime((state.noiseMicEnabled && state.noiseMicOnly) ? 0 : (gainOn ? intensityToGain(state.intensity) : 1), t, 0.05);
    if (e.noiseSource && e._noiseKind !== (state.noiseMicKind || "heavy")) {
      const kind = state.noiseMicKind || "heavy";
      try { e.noiseSource.stop(); } catch (_) {} try { e.noiseSource.disconnect(); } catch (_) {}
      const ns = ctx.createBufferSource(); ns.buffer = alphaNoiseBuf(ctx, kind); ns.loop = true; ns.connect(e.noiseLP || e.noiseGain); ns.start();
      e.noiseSource = ns; e._noiseKind = kind;
    }
    if (e.noiseGain) e.noiseGain.gain.setTargetAtTime(state.noiseMicEnabled ? Math.max(0, Math.min(40, Number(state.noiseMicGain ?? 4))) : 0, t, 0.05);
    if (e.noiseLP) e.noiseLP.frequency.setTargetAtTime(Math.max(200, Math.min(20000, Number(state.noiseMicBright ?? 9000))), t, 0.05);
    if (e.noiseDist && e._noiseDistAmt !== Number(state.noiseMicDist ?? 35)) { e._noiseDistAmt = Number(state.noiseMicDist ?? 35); e.noiseDist.curve = alphaDistCurve(e._noiseDistAmt); }
    if (e.noiseToneGain) e.noiseToneGain.gain.setTargetAtTime(state.noiseMicEnabled && state.noiseMicToneEnabled ? 0.12 : 0, t, 0.05);
    if (e.noiseOsc) e.noiseOsc.frequency.setTargetAtTime(Math.max(20, Math.min(20000, Number(state.noiseMicFrequency ?? 1000))), t, 0.05);
    if (e.noiseEchoWet) e.noiseEchoWet.gain.setTargetAtTime(state.noiseMicEnabled && state.noiseMicEcho ? 0.35 : 0, t, 0.05);
    const voiceMultiplier = Math.max(0, Math.min(10000, Number(state.voiceVolume ?? 100))) / 100;
    e.boosterGain.gain.setTargetAtTime((gainOn ? state.boosterX : 10), t, 0.05);
    if (e.voiceOut) e.voiceOut.gain.setTargetAtTime(voiceMultiplier, t, 0.05);
    if (e.gBands) e.gBands.forEach((b, k) => b.gain.setTargetAtTime(Math.max(-48, Math.min(48, Number(state["g" + k] ?? 0))), t, 0.05));
    if (e.autoComp) {
      e.autoComp.threshold.setTargetAtTime(state.autoGainMax && on ? -30 : -100, t, 0.05);
      e.autoComp.knee.setTargetAtTime(state.autoGainMax && on ? 24 : 0, t, 0.05);
      e.autoComp.ratio.setTargetAtTime(state.autoGainMax && on ? 20 : 1, t, 0.05);
      if (e.autoMakeup) e.autoMakeup.gain.setTargetAtTime(state.autoGainMax && on ? 4 : 1, t, 0.05);
      e.autoComp.attack.setTargetAtTime(0.003, t, 0.01);
      e.autoComp.release.setTargetAtTime(0.12, t, 0.01);
    }

    e.eq60.gain.setTargetAtTime(on ? state.eq60 : 0, t, 0.05);
    e.eq250.gain.setTargetAtTime(on ? state.eq250 : 0, t, 0.05);
    e.eq1k.gain.setTargetAtTime(on ? state.eq1k : 0, t, 0.05);
    e.eq4k.gain.setTargetAtTime(on ? state.eq4k : 0, t, 0.05);
    e.eq12k.gain.setTargetAtTime(on ? state.eq12k : 0, t, 0.05);

    const heavyOn = on && state.heavyEnabled;
    e.heavy.shaper._setDrive(heavyOn ? state.heavyDrive / 1000 : 0);
    e.heavy.subBass.gain.setTargetAtTime(heavyOn ? 10 : 0, t, 0.05);
    e.heavy.makeup.gain.setTargetAtTime(heavyOn ? 3 : 1, t, 0.05);

    const pitchOn = on && state.pitchEnabled;
    e.pitchNode._ratio = semitonesToRatio(state.pitchSemitones / 10);
    e.pitchDry.gain.setTargetAtTime(pitchOn ? 0 : 1, t, 0.03);
    e.pitchWet.gain.setTargetAtTime(pitchOn ? 1 : 0, t, 0.03);

    const echoOn = on && state.echoEnabled;
    const ep = echoParamsFromRepeats(state.echoRepeats);
    state.echoFeedback = ep.feedback;
    state.echoMix = ep.mix;
    e.echoDelay.delayTime.setTargetAtTime(Math.max(0.01, state.echoDelay / 1000), t, 0.05);
    e.echoFeedback.gain.setTargetAtTime(echoOn ? ep.feedback : 0, t, 0.05);
    e.echoWet.gain.setTargetAtTime(echoOn ? ep.mix : 0, t, 0.05);

    e.gate._gateEnabled = on && state.gateEnabled;
    e.gate._thresholdDb = state.gateThreshold / 10;

    if (e.sbGain) e.sbGain.gain.setTargetAtTime((state.sbVolume / 1000), t, 0.02);
  }

  // Build the full processing graph for one MediaStream, return the engine object
  function buildEngine(stream) {
    const c = getCtx();
    const source = c.createMediaStreamSource(stream);
    const gainNode = c.createGain();
    const boosterGain = c.createGain();
    const autoComp = c.createDynamicsCompressor();
    const autoMakeup = c.createGain();

    const eq60 = makeFilter(c, 60, "lowshelf");
    const eq250 = makeFilter(c, 250, "peaking");
    const eq1k = makeFilter(c, 1000, "peaking");
    const eq4k = makeFilter(c, 4000, "peaking");
    const eq12k = makeFilter(c, 12000, "highshelf");

    const heavy = makeHeavy(c);

    const pitchIn = c.createGain();
    const pitchDry = c.createGain();
    const pitchWet = c.createGain(); pitchWet.gain.value = 0;   // granular path muted until a pitch preset turns it on
    const pitchOut = c.createGain();
    const pitchNode = makePitchShifter(c);
    pitchIn.connect(pitchDry);
    pitchDry.connect(pitchOut);
    pitchIn.connect(pitchNode);
    pitchNode.connect(pitchWet);
    pitchWet.connect(pitchOut);

    const echoIn = c.createGain();
    const echoOut = c.createGain();
    const echoDelay = c.createDelay(2);
    const echoFeedback = c.createGain();
    const echoWet = c.createGain(); echoWet.gain.value = 0;    // echo muted until enabled
    echoIn.connect(echoOut);          // dry path
    echoIn.connect(echoDelay);
    echoDelay.connect(echoFeedback);
    echoFeedback.connect(echoDelay);  // feedback loop = repeats
    echoDelay.connect(echoWet);
    echoWet.connect(echoOut);

    const gate = makeGate(c);
    const analyser = c.createAnalyser();
    analyser.fftSize = 512;

    const dest = c.createMediaStreamDestination();

    // Soundboard mixing point — volume node, routed dynamically at play()
    // time to either the EQ input (FX applied) or straight to dest (dry).
    const sbGain = c.createGain();
    sbGain.gain.value = (state.sbVolume / 1000);

    // Main mic chain: source -> gain -> booster -> EQ -> heavy -> pitch -> echo -> gate -> analyser -> dest
    source.connect(gainNode);
    gainNode.connect(gate); gate.connect(boosterGain);
    boosterGain.connect(autoComp);
    autoComp.connect(autoMakeup);
    autoMakeup.connect(eq60);
    eq60.connect(eq250);
    eq250.connect(eq1k);
    eq1k.connect(eq4k);
    eq4k.connect(eq12k);
    eq12k.connect(heavy.input);
    const voiceBody = c.createBiquadFilter(); voiceBody.type = "lowshelf"; voiceBody.frequency.value = 180; voiceBody.gain.value = 6;
    const outLim = c.createDynamicsCompressor(); outLim.threshold.value = -1; outLim.knee.value = 2; outLim.ratio.value = 20; outLim.attack.value = 0.002; outLim.release.value = 0.1;
    heavy.output.connect(voiceBody); voiceBody.connect(pitchIn);
    pitchOut.connect(echoIn);
    const outMakeup = c.createGain(); outMakeup.gain.value = 2;   // +6 dB before the limiter
    echoOut.connect(outMakeup); outMakeup.connect(outLim);
    // Final stage: master voice volume, then a smooth soft-clipper so loud levels saturate gently instead of hard-clipping
    const voiceOut = c.createGain(); voiceOut.gain.value = 1;
    const softClip = c.createWaveShaper(); softClip.oversample = "4x";
    const clipCurve = new Float32Array(4096), clipK = 3;
    for (let n = 0; n < 4096; n++) { const x = (n / 4095) * 2 - 1; clipCurve[n] = Math.tanh(clipK * x) / Math.tanh(clipK); }
    softClip.curve = clipCurve;
    // Global 10-band frequency stage: mic, noise and soundboard all pass through it together
    const globalIn = c.createGain();
    const gBands = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000].map((f) => {
      const b = c.createBiquadFilter(); b.type = "peaking"; b.frequency.value = f; b.Q.value = 1.2; b.gain.value = 0; return b;
    });
    outLim.connect(voiceOut); voiceOut.connect(softClip); softClip.connect(globalIn);
    globalIn.connect(gBands[0]);
    for (let k = 0; k < gBands.length - 1; k++) gBands[k].connect(gBands[k + 1]);
    gBands[gBands.length - 1].connect(analyser);
    analyser.connect(dest);

    // Dedicated looping noise source mixed directly into the outgoing stream.
    function makeNoiseBuffer(kind) { return alphaNoiseBuf(c, kind); }
    const noiseSource = c.createBufferSource(); noiseSource.buffer = makeNoiseBuffer(state.noiseMicKind || "heavy"); noiseSource.loop = true;
    const noiseGain = c.createGain(); noiseGain.gain.value = 0;
    const noiseLimiter = c.createDynamicsCompressor();
    noiseLimiter.threshold.value = -4; noiseLimiter.ratio.value = 8; noiseLimiter.attack.value = 0.003; noiseLimiter.release.value = 0.15;
    const noiseTone = c.createOscillator(); noiseTone.type="sine"; noiseTone.frequency.value=Number(state.noiseMicFrequency||1000);
    const noiseToneGain = c.createGain(); noiseToneGain.gain.value=0;
    const noiseEcho = c.createDelay(1.5); noiseEcho.delayTime.value=.28;
    const noiseEchoWet = c.createGain(); noiseEchoWet.gain.value=0;
    const noiseEchoFeedback = c.createGain(); noiseEchoFeedback.gain.value=.22;
    const noiseLP = c.createBiquadFilter(); noiseLP.type = "lowpass"; noiseLP.frequency.value = Number(state.noiseMicBright || 9000);
    const noiseDist = c.createWaveShaper(); noiseDist.oversample = "2x";
    noiseSource.connect(noiseLP); noiseLP.connect(noiseGain); noiseGain.connect(noiseDist); noiseDist.connect(noiseLimiter);
    noiseLimiter.connect(outLim);
    noiseLimiter.connect(noiseEcho); noiseEcho.connect(noiseEchoWet); noiseEchoWet.connect(dest); noiseEcho.connect(noiseEchoFeedback); noiseEchoFeedback.connect(noiseEcho);
    noiseTone.connect(noiseToneGain); noiseToneGain.connect(noiseLimiter);
    noiseSource.start(); noiseTone.start();

    const engine = {
      _noiseKind: state.noiseMicKind || "heavy",
      source, gainNode, boosterGain, autoComp, autoMakeup,
      eq60, eq250, eq1k, eq4k, eq12k,
      heavy,
      pitchIn, pitchDry, pitchWet, pitchOut, pitchNode,
      echoIn, echoOut, echoDelay, echoFeedback, echoWet,
      gate, analyser, dest,
      noiseSource, noiseLP, noiseGain, noiseDist, noiseOsc: noiseTone, noiseLimiter, noiseTone, noiseToneGain, noiseEchoWet,
      sbGain, voiceOut, globalIn, gBands,
      sourceStream: stream
    };
    applyState(engine);
    return engine;
  }

  // ---------------------------------------------------------------------
  // Level meter (for the panel VU bar)
  // ---------------------------------------------------------------------
  function meterLoop() {
    const e = engines[engines.length - 1] || testEngine;
    if (e && e.analyser) {
      const buf = new Uint8Array(e.analyser.fftSize);
      e.analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buf.length);
      const level = Math.min(100, Math.round(rms * 260));
      window.postMessage({ type: TAG + "_LEVEL", level }, "*");
    }
    requestAnimationFrame(meterLoop);
  }
  requestAnimationFrame(meterLoop);

  // ---------------------------------------------------------------------
  // Hook getUserMedia so every call (Discord/WhatsApp/Instagram Web etc.)
  // is routed through the engine
  // ---------------------------------------------------------------------
  const origGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = function (constraints) {
    if (!(constraints && constraints.audio)) return origGUM(constraints);
    const patched = Object.assign({}, constraints, {
      audio: Object.assign({}, typeof constraints.audio === "object" ? constraints.audio : {}, {
        autoGainControl: !state.disableAGC,
        noiseSuppression: !state.disableNS
      })
    });
    return origGUM(patched).then((stream) => {
      try {
        const engine = buildEngine(stream);
        engines.push(engine);
        const outStream = engine.dest.stream;
        stream.getVideoTracks().forEach((vt) => outStream.addTrack(vt));
        window.postMessage({ type: TAG + "_HOOKED" }, "*");
        return outStream;
      } catch (err) {
        window.postMessage({ type: TAG + "_ERROR", message: (err && err.message) || "engine error" }, "*");
        return stream;
      }
    });
  };

  // ---------------------------------------------------------------------
  // Local mic test loopback
  // ---------------------------------------------------------------------
  function stopTest() {
    if (testEngine) {
      testEngine.sourceStream.getTracks().forEach((t) => t.stop());
      if (testEngine.audioEl) { testEngine.audioEl.pause(); testEngine.audioEl.srcObject = null; }
      testEngine = null;
    }
  }
  function startTest() {
    stopTest();
    // Create and resume the shared AudioContext while the user's click is still active,
    // otherwise Chrome keeps it suspended and Test My Mic plays silence.
    getCtx();
    origGUM({ audio: { autoGainControl: !state.disableAGC, noiseSuppression: !state.disableNS } })
      .then((stream) => {
        getCtx();
        testEngine = buildEngine(stream);
        const audioEl = new Audio();
        audioEl.srcObject = testEngine.dest.stream;
        audioEl.autoplay = true;
        testEngine.audioEl = audioEl;
        audioEl.play().catch(() => window.postMessage({ type: TAG + "_ERROR", message: "Tap Test My Mic again to hear yourself" }, "*"));
      })
      .catch((err) => {
        const name = (err && err.name) || "Error";
        const hint = name === "NotAllowedError" ? "mic blocked (allow Microphone for this site and in Android app settings)"
          : name === "NotFoundError" ? "no microphone found"
          : name === "NotReadableError" ? "mic is busy in another app"
          : (err && err.message) || "unknown error";
        window.postMessage({ type: TAG + "_ERROR", message: "Test failed: " + name + " — " + hint }, "*");
      });
  }

  // ---------------------------------------------------------------------
  // Soundboard — load an audio file, then play it mixed into the live call
  // ---------------------------------------------------------------------
  function loadSoundboard(arrayBuffer) {
    const c = getCtx();
    c.decodeAudioData(arrayBuffer.slice(0)).then((buf) => {
      sbBuffer = buf;
      window.postMessage({ type: TAG + "_SB_LOADED", duration: buf.duration }, "*");
    }).catch((err) => {
      window.postMessage({ type: TAG + "_ERROR", message: "Couldn't decode sound file: " + (err && err.message) }, "*");
    });
  }

  // ---------------------------------------------------------------------
  // Song playback: effect chain, loop, and the independent song/mic recorder
  // ---------------------------------------------------------------------
  let sbNodes = [];
  let sbVolNode = null;       // live volume node of the playing song
  function track(n) { sbNodes.push(n); return n; }
  function disposeSongFx() {
    sbNodes.forEach((n) => {
      try { if (typeof n.stop === "function") n.stop(); } catch (_) {}
      try { n.disconnect(); } catch (_) {}
    });
    sbNodes = [];
  }
  function lfo(c, freq, depth, target) {
    const osc = track(c.createOscillator());
    osc.frequency.value = freq;
    const g = track(c.createGain());
    g.gain.value = depth;
    osc.connect(g); g.connect(target);
    osc.start();
    return osc;
  }
  function makeImpulse(c, seconds) {
    const len = Math.max(1, Math.floor(c.sampleRate * seconds));
    const buf = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    return buf;
  }
  function distortionCurve(k) {
    const n = 44100, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = ((3 + k) * x * 20 * (Math.PI / 180)) / (Math.PI + k * Math.abs(x));
    }
    return curve;
  }

  // Builds the effect chain for one playback. Serial effects first, then
  // parallel wet effects (echo, reverb, chorus) mixed with the dry signal.
  function buildSongFx(c, out, tapRec) {
    const fx = Object.assign({ echo: false, echoRepeats: 4, echoDelay: 300, reverb: false, chorus: false,
      tremolo: false, distortion: false, babyVoice: false, robot: false, telephone: false, bass: false, speed: 1000 }, state.songFx || {});
    const input = track(c.createGain());
    let node = input;
    const serial = (n) => { node.connect(n); node = n; };

    if (fx.babyVoice) {
      // Baby preset: +9 semitones with normal speed, then a clarity lift so the voice stays crisp
      const bp = track(makePitchShifter(c));
      bp._ratio = semitonesToRatio(9);
      serial(bp);
      const clear = track(c.createBiquadFilter());
      clear.type = "highshelf"; clear.frequency.value = 3000; clear.gain.value = 4;
      serial(clear);
    }
    if (fx.distortion) {
      const ws = track(c.createWaveShaper());
      ws.curve = distortionCurve(60); ws.oversample = "4x";
      const g = track(c.createGain()); g.gain.value = 2.5;
      serial(ws); serial(g);
    }
    if (fx.bass) {
      const b = track(c.createBiquadFilter());
      b.type = "lowshelf"; b.frequency.value = 150; b.gain.value = 10;
      serial(b);
    }
    if (fx.telephone) {
      const bp = track(c.createBiquadFilter());
      bp.type = "bandpass"; bp.frequency.value = 1400; bp.Q.value = 1.2;
      serial(bp);
    }
    if (fx.robot) {
      const ring = track(c.createGain());
      ring.gain.value = 0;
      lfo(c, 45, 1, ring.gain);           // ring modulation = robotic voice
      serial(ring);
    }
    if (fx.tremolo) {
      const trem = track(c.createGain());
      trem.gain.value = 0.5;
      lfo(c, 5, 0.5, trem.gain);
      serial(trem);
    }

    const mix = track(c.createGain());
    mix.connect(out);
    if (tapRec) mix.connect(recSongTap);
    node.connect(mix);                     // dry

    if (fx.echo) {
      const delay = track(c.createDelay(2));
      delay.delayTime.value = Math.min(2, Math.max(0.05, Number(fx.echoDelay) / 1000));
      const fb = track(c.createGain());
      fb.gain.value = Math.min(0.85, 0.15 + Number(fx.echoRepeats) * 0.08);
      const wet = track(c.createGain()); wet.gain.value = 0.6;
      node.connect(delay); delay.connect(fb); fb.connect(delay);
      delay.connect(wet); wet.connect(mix);
    }
    if (fx.reverb) {
      const conv = track(c.createConvolver());
      conv.buffer = makeImpulse(c, 2.5);
      const wet = track(c.createGain()); wet.gain.value = 0.5;
      node.connect(conv); conv.connect(wet); wet.connect(mix);
    }
    if (fx.chorus) {
      const d = track(c.createDelay(0.1));
      d.delayTime.value = 0.02;
      lfo(c, 0.8, 0.004, d.delayTime);
      const wet = track(c.createGain()); wet.gain.value = 0.5;
      node.connect(d); d.connect(wet); wet.connect(mix);
    }
    return input;
  }

  function stopSoundboard() {
    if (sbSourceNode) {
      try { sbSourceNode.stop(); } catch (_) {}
      sbSourceNode = null;
    }
    disposeSongFx();
  }

  // Baby voice raises the playback pitch clearly; combined with the user's speed control.
  // Dependency-free, chipmunk-style effect for soundboard clips.
  function songRate() {
    const fxState = state.songFx || {};
    const speed = Number(fxState.speed || 1000) / 1000;
    return Math.min(2.5, Math.max(0.5, speed));
  }

  function playSoundboard(offset = 0) {
    const engine = engines[engines.length - 1] || testEngine;
    if (!state.soundboardEnabled) return;
    if (!sbBuffer) {
      window.postMessage({ type: TAG + "_ERROR", message: "No song loaded" }, "*");
      return;
    }
    stopSoundboard();
    const c = getCtx();
    const src = c.createBufferSource();
    src.buffer = sbBuffer;
    src.loop = !!state.songLoop;
    src.playbackRate.value = songRate();

    let target;
    let viaMicChain = false;
    if (c.state === "suspended") { try { c.resume(); } catch (_) {} }
    if (!engine) {
      // No call / mic engine: the song gets its own volume node, so the slider and
      // effects work on their own, without the main ALPHA switch.
      const vol = track(c.createGain());
      vol.gain.value = (state.sbVolume / 1000);
      vol.connect(c.destination);
      sbVolNode = vol;
      target = vol;
    } else {
      try { engine.sbGain.disconnect(); } catch (_) {}
      viaMicChain = !!state.sbFxEnabled;
      engine.sbGain.connect(viaMicChain ? engine.eq60 : engine.globalIn);
      target = engine.sbGain;
      sbVolNode = null;             // engine's applyState() already controls this volume
    }
    // The mic chain already reaches the recorder through its analyser tap,
    // so the song is tapped separately only when it bypasses that chain.
    const tapRec = !!recSongTap && !viaMicChain;

    src.connect(buildSongFx(c, target, tapRec));
    src.onended = () => {
      if (sbSourceNode === src) {
        sbSourceNode = null;
        disposeSongFx();
        window.postMessage({ type: TAG + "_SB_ENDED" }, "*");
      }
    };
    sbRate = src.playbackRate.value;
    sbStartOffset = Math.max(0, Math.min(offset, sbBuffer.duration - 0.05));
    sbStartAt = c.currentTime;
    src.start(0, sbStartOffset);
    sbSourceNode = src;
    window.postMessage({ type: TAG + "_SB_PLAYING" }, "*");
  }

  // Recorder: its own destination, fed by every mic engine's output and by the
  // song, so it records whatever is actually being heard, call or no call.
  let recSongTap = null;
  let recDest = null;
  let recTapped = [];
  function teardownRecTaps() {
    recTapped.forEach((n) => { try { n.disconnect(recDest); } catch (_) {} });
    try { if (recSongTap) recSongTap.disconnect(); } catch (_) {}
    recTapped = []; recSongTap = null; recDest = null;
  }
  function startRecording() {
    if (recorder && recorder.state !== "inactive") return;
    const all = engines.concat(testEngine ? [testEngine] : []);
    if (!all.length && !sbSourceNode) {
      window.postMessage({ type: TAG + "_ERROR", message: "Start Test My Mic, join a call or play a song before recording" }, "*");
      return;
    }
    try {
      const c = getCtx();
      recDest = c.createMediaStreamDestination();
      recSongTap = c.createGain();
      recSongTap.connect(recDest);
      all.forEach((e) => { if (e && e.analyser) { e.analyser.connect(recDest); recTapped.push(e.analyser); } });

      recordedChunks = [];
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : (MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "");
      recorder = mime ? new MediaRecorder(recDest.stream, { mimeType: mime }) : new MediaRecorder(recDest.stream);
      recorder.ondataavailable = (ev) => { if (ev.data && ev.data.size) recordedChunks.push(ev.data); };
      recorder.onstop = () => {
        const blob = new Blob(recordedChunks, { type: "audio/webm" });
        teardownRecTaps();
        window.postMessage({ type: TAG + "_REC_DONE", blob }, "*");
      };
      recorder.start(250);
      window.postMessage({ type: TAG + "_REC_STARTED" }, "*");
    } catch (err) {
      teardownRecTaps();
      window.postMessage({ type: TAG + "_ERROR", message: "Recorder failed: " + (err && err.message) }, "*");
    }
  }
  function stopRecording() {
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }

  // ---------------------------------------------------------------------
  // Mic management for the extension-created outgoing track only.
  // - Explicit extension changes use the original MediaStreamTrack setter.
  // - The app's last requested value is remembered (rec.want), so restoring
  //   after a song stops never changes the app's own mute decision.
  // - Nothing here touches other participants, WhatsApp DOM, or other tracks.
  // ---------------------------------------------------------------------
  const TRACK_ENABLED_DESC = Object.getOwnPropertyDescriptor(MediaStreamTrack.prototype, "enabled");
  const guardedTracks = new WeakMap();   // track -> { want, muteAttempts }

  // Force-on rule: song bypass (existing MUTE BYPASS) or AUTO-UNMUTE while the user wants a live mic.
  function shouldForceOn() {
    const songPlaying = !!sbSourceNode;
    return (!!state.muteBypass && songPlaying) || (!!state.autoUnmute && (songPlaying || !!state.userMicWant));
  }
  function outgoingTrack() {
    const e = engines[engines.length - 1];
    return (e && e.dest && e.dest.stream.getAudioTracks()[0]) || null;
  }
  function guardOutgoingTrack(t) {
    let g = guardedTracks.get(t);
    if (g) return g;                       // already guarded: no duplicate defineProperty
    g = { want: t.enabled !== false, muteAttempts: 0 };
    guardedTracks.set(t, g);
    Object.defineProperty(t, "enabled", {
      configurable: true,
      get() { return TRACK_ENABLED_DESC.get.call(this); },
      set(v) {
        const rec = guardedTracks.get(this);
        if (rec) { rec.want = !!v; if (!v) rec.muteAttempts++; }
        TRACK_ENABLED_DESC.set.call(this, shouldForceOn() ? true : !!v);
      }
    });
    return g;
  }
  function computeMicStatus() {
    const t = outgoingTrack();
    if (!t) return "Mic: no call track yet (join a call)";
    const g = guardOutgoingTrack(t);
    const appMuted = g.want === false;
    const holding = appMuted && shouldForceOn();
    return "Mic: " + (t.enabled ? "LIVE" : "MUTED")
      + " | Song: " + (sbSourceNode ? "PLAYING" : "STOPPED")
      + " | Auto-Unmute: " + (state.autoUnmute ? "ON" : "OFF")
      + " | User request: " + (state.userMicWant ? "LIVE" : "none")
      + " | Track enabled: " + t.enabled
      + " | App mute: " + (appMuted ? "YES" : "no")
      + (holding ? " | Holding LIVE against app mute" : "")
      + " | Mute requests: " + (g.muteAttempts || 0);
  }
  let lastMicStatusText = "";
  function postMicStatus(force) {
    const text = computeMicStatus();
    if (force || text !== lastMicStatusText) {
      lastMicStatusText = text;
      window.postMessage({ type: TAG + "_MIC_STATUS", text }, "*");
    }
  }
  // Watchdog (200ms): corrects only real mismatches, then reports status.
  setInterval(() => {
    const target0 = shouldForceOn();
    engines.forEach((e) => {
      const t = e && e.dest && e.dest.stream.getAudioTracks()[0];
      if (!t) return;
      const g = guardOutgoingTrack(t);
      const target = target0 ? true : g.want;
      if (t.enabled !== target) TRACK_ENABLED_DESC.set.call(t, target);
    });
    postMicStatus(false);
  }, 200);

  // ---------------------------------------------------------------------
  // Message bridge (content script <-> page engine)
  // ---------------------------------------------------------------------
  const MODE_PRESETS = {
    ALPHA: {
      enabled: true,
      intensity: 100, boosterX: 100, voiceVolume: 200, autoGainMax: true, disableAGC: true, disableNS: true,
      eq60: -24, eq250: -24, eq1k: 24, eq4k: -24, eq12k: -24,
      gateEnabled: true, gateThreshold: -200,
      heavyEnabled: true, heavyDrive: 2000,
      echoEnabled: false, echoRepeats: 4, echoDelay: 250,
      pitchEnabled: false, pitchSemitones: 0, voicePreset: "Normal",
      soundboardEnabled: false, soundAutoPlay: false, sbFxEnabled: false, sbVolume: 2000,
      slot1: false, slot2: false, slot3: false, slot4: false,
      slot5: false, slot6: false, slot7: false, slot8: false
    },
    GOD:   { intensity: 80, boosterX: 100, eq60: -2, eq250: 1, eq1k: 4, eq4k: 5, eq12k: 3, gateEnabled: true, gateThreshold: -480, heavyEnabled: true, heavyDrive: 350 },
    BEAST: { intensity: 100, boosterX: 250, eq60: -1, eq250: 2, eq1k: 5, eq4k: 7, eq12k: 4, gateEnabled: true, gateThreshold: -550, heavyEnabled: true, heavyDrive: 650 },
    LORD:  { intensity: 100, boosterX: 100, eq60: 0, eq250: 3, eq1k: 7, eq4k: 9, eq12k: 6, gateEnabled: true, gateThreshold: -600, heavyEnabled: true, heavyDrive: 900, autoGainMax: true }
  };

  const VOICE_PRESETS = {
    Normal: { pitchEnabled: false, pitchSemitones: 0 },
    Male: { pitchEnabled: true, pitchSemitones: -60 },
    Deep: { pitchEnabled: true, pitchSemitones: -90 },
    Female: { pitchEnabled: true, pitchSemitones: 70 },
    Baby: { pitchEnabled: true, pitchSemitones: 90, heavyEnabled: false, heavyDrive: 0, echoEnabled: false, eq60: 0, eq250: 0, eq1k: 0, eq4k: 2, eq12k: 1, gateEnabled: false, gateThreshold: -50 },
    Chipmunk: { pitchEnabled: true, pitchSemitones: 120 },
    Robot: { pitchEnabled: true, pitchSemitones: -120, heavyEnabled: true, heavyDrive: 750 }
  };

  window.addEventListener("message", (ev) => {
    if (ev.source !== window || !ev.data) return;
    const msg = ev.data;

    if (msg.type === TAG + "_SET_STATE") {
      const prevFx = JSON.stringify([state.songFx, state.sbFxEnabled]);
      state = Object.assign({}, state, msg.value || {});
      state.songFx = Object.assign({}, state.songFx || {});
      // Effect changed while a song is playing: restart it at the current position so the effect applies now
      if (sbSourceNode && sbBuffer && JSON.stringify([state.songFx, state.sbFxEnabled]) !== prevFx) {
        let pos = sbStartOffset + (ctx.currentTime - sbStartAt) * sbRate;
        if (state.songLoop) pos = pos % sbBuffer.duration;
        if (pos < sbBuffer.duration) playSoundboard(pos);
      }
      if (sbSourceNode) {
        sbSourceNode.loop = !!state.songLoop;
        // Apply speed / baby voice changes to a song that is already playing
        sbSourceNode.playbackRate.value = songRate();
      }
      if (sbVolNode && ctx) sbVolNode.gain.setTargetAtTime((Number(state.sbVolume ?? 1000) / 1000), ctx.currentTime, 0.02);
      if (state.soundboardEnabled === false) {
        stopSoundboard();
        engines.forEach((engine) => { try { engine.sbGain.disconnect(); } catch (_) {} });
      }
      engines.forEach(applyState);
      if (testEngine) applyState(testEngine);
      window.postMessage({ type: TAG + "_STATE_SYNC", value: state }, "*");

    } else if (msg.type === TAG + "_APPLY_MODE") {
      const preset = MODE_PRESETS[msg.name];
      if (preset) {
        state = Object.assign({}, state, preset, { mode: msg.name });
        engines.forEach(applyState);
        if (testEngine) applyState(testEngine);
        window.postMessage({ type: TAG + "_STATE_SYNC", value: state }, "*");
      }

    } else if (msg.type === TAG + "_APPLY_VOICE") {
      const preset = VOICE_PRESETS[msg.name];
      if (preset) {
        state = Object.assign({}, state, preset, { voicePreset: msg.name });
        engines.forEach(applyState);
        if (testEngine) applyState(testEngine);
        window.postMessage({ type: TAG + "_STATE_SYNC", value: state }, "*");
      }

    } else if (msg.type === TAG + "_GET_STATE") {
      window.postMessage({ type: TAG + "_STATE_SYNC", value: state }, "*");

    } else if (msg.type === TAG + "_PING") {
      window.postMessage({ type: TAG + "_PONG", hooked: engines.length > 0 }, "*");

    } else if (msg.type === TAG + "_START_TEST") {
      startTest();
    } else if (msg.type === TAG + "_STOP_TEST") {
      stopTest();

    } else if (msg.type === TAG + "_MANUAL_UNMUTE") {
      state.userMicWant = true;
      const t = outgoingTrack();
      if (t) {
        guardOutgoingTrack(t).want = true;
        TRACK_ENABLED_DESC.set.call(t, true);
      }
      window.postMessage({ type: TAG + "_STATE_SYNC", value: state }, "*");
      postMicStatus(true);

    } else if (msg.type === TAG + "_SB_LOAD") {
      loadSoundboard(msg.buffer);
    } else if (msg.type === TAG + "_SB_PLAY") {
      playSoundboard();
    } else if (msg.type === TAG + "_SB_STOP") {
      stopSoundboard();

    } else if (msg.type === TAG + "_REC_TEST") {
      // Test recorder: runs until you press Stop, then the panel plays it back
      startRecording();
    } else if (msg.type === TAG + "_REC_START") {
      startRecording();
    } else if (msg.type === TAG + "_REC_STOP") {
      stopRecording();
    }
  });
})();

  }
  window.addEventListener('alpha-start-engine', start);
})();
