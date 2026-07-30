import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("Canvas presents only the latest decoded video frame per browser refresh", async ({ page }) => {
  await login(page);
  await page.addInitScript(() => {
    const counters = { decoded: 0, drawn: 0, closed: 0 };
    Object.defineProperty(window, "__rdPresentationCounters", { value: counters, configurable: true });

    class FakeWebSocket extends EventTarget {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSING = 2;
      static readonly CLOSED = 3;
      readonly CONNECTING = 0;
      readonly OPEN = 1;
      readonly CLOSING = 2;
      readonly CLOSED = 3;
      readyState = FakeWebSocket.OPEN;
      bufferedAmount = 0;
      binaryType: BinaryType = "blob";

      constructor(_url: string | URL) {
        super();
        Object.defineProperty(window, "__rdSocket", { value: this, configurable: true });
        queueMicrotask(() => this.dispatchEvent(new Event("open")));
      }

      send() {}

      close() {
        this.readyState = FakeWebSocket.CLOSED;
        this.dispatchEvent(new CloseEvent("close"));
      }
    }

    class FakeVideoDecoder extends EventTarget {
      static async isConfigSupported(config: VideoDecoderConfig) {
        return { supported: true, config };
      }

      decodeQueueSize = 0;
      private output: (frame: VideoFrame) => void;

      constructor(init: VideoDecoderInit) {
        super();
        this.output = init.output;
      }

      configure() {}

      decode() {
        counters.decoded += 1;
        const frame = {
          displayWidth: 1920,
          displayHeight: 1080,
          codedWidth: 1920,
          codedHeight: 1080,
          close() {
            counters.closed += 1;
          },
        } as unknown as VideoFrame;
        this.output(frame);
      }

      close() {}
    }

    class FakeEncodedVideoChunk {
      constructor(_init: EncodedVideoChunkInit) {}
    }

    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (contextId: string, ...args: unknown[]) {
      if (this.id === "frameCanvas" && contextId === "2d") {
        return {
          drawImage() {
            counters.drawn += 1;
          },
          putImageData() {},
        } as unknown as CanvasRenderingContext2D;
      }
      return originalGetContext.call(this, contextId as "2d", ...args as []) as CanvasRenderingContext2D;
    } as typeof HTMLCanvasElement.prototype.getContext;

    Object.defineProperty(window, "WebSocket", { value: FakeWebSocket, configurable: true });
    Object.defineProperty(window, "VideoDecoder", { value: FakeVideoDecoder, configurable: true });
    Object.defineProperty(window, "EncodedVideoChunk", { value: FakeEncodedVideoChunk, configurable: true });
  });

  await page.goto("/remotedesktop?clientId=canvas-presentation-test");

  await page.evaluate(async () => {
    const packet = new Uint8Array(18);
    packet.set([0x46, 0x52, 0x4d, 2, 0, 240, 5, 0]);
    new DataView(packet.buffer).setUint16(8, 1920, true);
    new DataView(packet.buffer).setUint16(10, 1080, true);
    packet.set([0, 0, 0, 1, 38, 1], 12);
    const socket = (window as typeof window & { __rdSocket: EventTarget }).__rdSocket;

    for (let i = 0; i < 4; i++) {
      socket.dispatchEvent(new MessageEvent("message", { data: packet.buffer.slice(0) }));
      await Promise.resolve();
      await Promise.resolve();
    }
  });

  await expect.poll(() => page.evaluate(() => (
    window as typeof window & {
      __rdPresentationCounters: { decoded: number; drawn: number; closed: number };
    }
  ).__rdPresentationCounters)).toEqual({
    decoded: 4,
    drawn: 1,
    closed: 4,
  });
  await expect(page.locator("#diagDropped")).toHaveText("0 / 3");
});
