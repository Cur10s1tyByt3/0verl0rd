// Browser ↔ agent direct WebRTC peer client.
//
// Signaling is multiplexed onto the existing Remote Desktop WS:
//   browser → server: { type: "webrtc_p2p_offer", sdp }
//                     { type: "webrtc_p2p_ice",   candidate, sdpMid, sdpMLineIndex }
//                     { type: "webrtc_p2p_stop" }
//   server → browser: { type: "webrtc_p2p_answer", sdp }
//                     { type: "webrtc_p2p_ice", ... }
//
// The server proxies these to the agent via its existing WS command channel
// (sessionId is server-side state, not visible to the browser).
//
import { WebRTCStatsSampler } from "./webrtc-stats.js";

// Once SDP + ICE settle, the <video> element receives frames directly from
// the agent — MediaMTX is not involved.

export class P2PClient {
  /**
   * @param {object} opts
   * @param {HTMLVideoElement} [opts.videoEl]
   * @param {HTMLAudioElement} [opts.audioEl]
   * @param {(msg: object) => void} opts.send  Send a JSON-encodable msg over the viewer's WS.
   * @param {(state: string) => void} [opts.onState]
   * @param {(stats: object) => void} [opts.onStats]
   * @param {RTCIceServer[]} [opts.iceServers] Optional explicit ICE configuration.
   */
  constructor(opts) {
    this.videoEl = opts.videoEl || null;
    this.audioEl = opts.audioEl || null;
    this.send = opts.send;
    this.onState = opts.onState || (() => {});
    this.onStats = opts.onStats || (() => {});
    this.onInputState = opts.onInputState || (() => {});
    this.iceServers = Array.isArray(opts.iceServers) ? opts.iceServers : null;
    this.enableInput = opts.enableInput === true;
    this.pc = null;
    this.reliableInput = null;
    this.motionInput = null;
    this.inputReady = false;
    this.pendingRemoteCandidates = [];
    this.statsSampler = null;
  }

  async start() {
    if (this.pc) await this.stop();

    const iceServers = await this.resolveIceServers();
    const pc = new RTCPeerConnection({
      iceServers,
    });
    this.pc = pc;
    this.statsSampler = new WebRTCStatsSampler(pc, this.onStats);

    if (this.videoEl) pc.addTransceiver("video", { direction: "recvonly" });
    if (this.audioEl) pc.addTransceiver("audio", { direction: "recvonly" });
    if (this.enableInput) {
      this.reliableInput = pc.createDataChannel("overlord-input-reliable", { ordered: true });
      this.motionInput = pc.createDataChannel("overlord-input-motion", { ordered: false, maxRetransmits: 0 });
      this.reliableInput.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data || ""));
          if (message?.type === "input_ready" && message?.version === 1) {
            this.inputReady = true;
            this.onInputState(true);
          }
        } catch {}
      };
      this.reliableInput.onclose = () => {
        this.inputReady = false;
        this.onInputState(false);
      };
    }

    pc.ontrack = (ev) => {
      this.applyLowLatencyReceiverHints();
      const stream = ev.streams[0] || new MediaStream([ev.track]);
      if (ev.track.kind === "video" && this.videoEl) {
        this.videoEl.srcObject = stream;
        this.videoEl.play().catch(() => {});
      } else if (ev.track.kind === "audio" && this.audioEl) {
        this.audioEl.srcObject = stream;
        this.audioEl.play().catch(() => {});
      }
    };
    pc.onicecandidate = (ev) => {
      // Trickle ICE: empty candidate signals end-of-gathering — we don't
      // forward it (Pion infers it on its own).
      if (!ev.candidate || !ev.candidate.candidate) return;
      this.send({
        type: "webrtc_p2p_ice",
        candidate: ev.candidate.candidate,
        sdpMid: ev.candidate.sdpMid || "",
        sdpMLineIndex: ev.candidate.sdpMLineIndex || 0,
      });
    };
    pc.onconnectionstatechange = () => {
      this.onState(pc.connectionState);
      if (pc.connectionState === "connected") this.statsSampler?.start();
      if (["failed", "closed", "disconnected"].includes(pc.connectionState)) this.statsSampler?.stop();
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.send({ type: "webrtc_p2p_offer", sdp: pc.localDescription.sdp });
  }

  async resolveIceServers() {
    if (this.iceServers) return this.iceServers;
    const clientId = new URLSearchParams(window.location.search).get("clientId");
    if (!clientId) return [];
    try {
      const response = await fetch(`/api/webrtc/ice-config?clientId=${encodeURIComponent(clientId)}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      return Array.isArray(body?.iceServers) ? body.iceServers : [];
    } catch (error) {
      console.warn("p2p: failed to load self-hosted ICE configuration; using host candidates only", error);
      return [];
    }
  }

  /** Handle an SDP answer relayed from the agent. */
  async onAnswer(sdp) {
    if (!this.pc || !sdp) return;
    await this.pc.setRemoteDescription({ type: "answer", sdp });
    this.applyLowLatencyReceiverHints();
    // Drain any ICE candidates that arrived before the answer.
    const drain = this.pendingRemoteCandidates;
    this.pendingRemoteCandidates = [];
    for (const c of drain) {
      try { await this.pc.addIceCandidate(c); } catch (e) { console.warn("p2p: queued ice add failed", e); }
    }
  }

  applyLowLatencyReceiverHints() {
    if (!this.pc) return;
    for (const receiver of this.pc.getReceivers()) {
      if (receiver.track?.kind !== "video") continue;
      try {
        if ("playoutDelayHint" in receiver) receiver.playoutDelayHint = 0;
        if ("jitterBufferTarget" in receiver) receiver.jitterBufferTarget = 0;
      } catch (error) {
        console.debug("p2p: browser rejected low-latency receiver hint", error);
      }
    }
  }

  sendInput(message) {
    if (!this.enableInput || !this.inputReady || !message || typeof message.type !== "string") return false;
    const motion = message.type === "mouse_move";
    const channel = motion ? this.motionInput : this.reliableInput;
    if (!channel || channel.readyState !== "open") return false;
    // Never build a motion backlog. Reliable key/button events are tiny and
    // must stay on one ordered path so a key-up cannot overtake a key-down.
    if (motion && channel.bufferedAmount > 64 * 1024) return true;
    try {
      channel.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  /** Add a remote ICE candidate from the agent. */
  async onRemoteCandidate(msg) {
    if (!this.pc) return;
    if (!msg || typeof msg.candidate !== "string" || !msg.candidate) return;
    const init = {
      candidate: msg.candidate,
      sdpMid: typeof msg.sdpMid === "string" ? msg.sdpMid : null,
      sdpMLineIndex: Number.isInteger(msg.sdpMLineIndex) ? msg.sdpMLineIndex : null,
    };
    // If remote description hasn't been set yet, queue.
    if (!this.pc.remoteDescription) {
      this.pendingRemoteCandidates.push(init);
      return;
    }
    try { await this.pc.addIceCandidate(init); } catch (e) { console.warn("p2p: ice add failed", e); }
  }

  async stop() {
    const pc = this.pc;
    this.pc = null;
    this.statsSampler?.stop();
    this.statsSampler = null;
    this.pendingRemoteCandidates = [];
    this.reliableInput = null;
    this.motionInput = null;
    this.inputReady = false;
    this.onInputState(false);
    if (pc) {
      try { pc.close(); } catch {}
    }
    try { this.send({ type: "webrtc_p2p_stop" }); } catch {}
    if (this.videoEl) this.videoEl.srcObject = null;
    if (this.audioEl) this.audioEl.srcObject = null;
  }
}
