import { describe, expect, test } from "bun:test";
import { P2PClient } from "./webrtc-p2p.js";
import { WebRTCStatsSampler } from "./webrtc-stats.js";

describe("WebRTC low-latency paths", () => {
  test("routes motion and reliable input over separate data channels", () => {
    const client = new P2PClient({ send: () => {}, enableInput: true });
    const motion: string[] = [];
    const reliable: string[] = [];
    client.motionInput = { readyState: "open", bufferedAmount: 0, send: (value: string) => motion.push(value) };
    client.reliableInput = { readyState: "open", bufferedAmount: 0, send: (value: string) => reliable.push(value) };

    client.inputReady = false;
    expect(client.sendInput({ type: "key_down", code: "KeyA" })).toBe(false);
    client.inputReady = true;
    expect(client.sendInput({ type: "mouse_move", x: 10, y: 20 })).toBe(true);
    expect(client.sendInput({ type: "key_down", code: "KeyA" })).toBe(true);
    expect(JSON.parse(motion[0])).toEqual({ type: "mouse_move", x: 10, y: 20 });
    expect(JSON.parse(reliable[0])).toEqual({ type: "key_down", code: "KeyA" });
  });

  test("reports interval jitter-buffer delay instead of lifetime average", async () => {
    let reportIndex = 0;
    const reports = [
      new Map([["video", {
        id: "video", type: "inbound-rtp", kind: "video", timestamp: 1000,
        bytesReceived: 1000, framesDecoded: 10, framesDropped: 0,
        packetsReceived: 10, packetsLost: 0, totalDecodeTime: 0,
        totalProcessingDelay: 0, jitterBufferDelay: 3, jitterBufferEmittedCount: 10,
      }]]),
      new Map([["video", {
        id: "video", type: "inbound-rtp", kind: "video", timestamp: 2000,
        bytesReceived: 2000, framesDecoded: 20, framesDropped: 0,
        packetsReceived: 20, packetsLost: 0, totalDecodeTime: 0,
        totalProcessingDelay: 0, jitterBufferDelay: 3.5, jitterBufferEmittedCount: 20,
      }]]),
    ];
    const samples: any[] = [];
    const sampler = new WebRTCStatsSampler({
      connectionState: "connected",
      getStats: async () => reports[Math.min(reportIndex++, reports.length - 1)],
    }, (sample: any) => samples.push(sample));

    await sampler.sample();
    await sampler.sample();
    expect(samples[0].video.jitterBufferMs).toBe(300);
    expect(samples[1].video.jitterBufferMs).toBe(50);
  });
});
