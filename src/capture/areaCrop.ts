import { planAreaCrop, type AreaRect, type Size } from './areaSelection';

/**
 * Crops an entire-screen capture to the selected area.
 *
 * Chromium crops each frame as it arrives (MediaStreamTrackProcessor → VideoFrame visibleRect
 * → MediaStreamTrackGenerator), so the recording keeps its frame rate while this tab is hidden
 * or covered by the app being recorded. Elsewhere frames are copied through a canvas: a
 * requestAnimationFrame loop while the page is visible and a timer while it is hidden, which
 * the browser throttles; `frameDriven` lets the caller say so.
 */
export interface AreaCrop {
  /** Video-only stream of the selected region, for MediaRecorder. */
  stream: MediaStream;
  width: number;
  height: number;
  /** The entire-screen track. Its `ended` event is the browser's "Stop sharing" button. */
  sourceTrack: MediaStreamTrack;
  /** True when frames are cropped as they arrive rather than by a page-driven loop. */
  frameDriven: boolean;
  /** Stops the crop, the cropped track and the entire-screen capture. */
  stop(): void;
}

interface TrackProcessor {
  readable: ReadableStream<VideoFrame>;
}
type TrackProcessorCtor = new (init: { track: MediaStreamTrack }) => TrackProcessor;
type TrackGenerator = MediaStreamTrack & { writable: WritableStream<VideoFrame> };
type TrackGeneratorCtor = new (init: { kind: 'video' }) => TrackGenerator;

function frameApis(): { Processor: TrackProcessorCtor; Generator: TrackGeneratorCtor } | null {
  const scope = globalThis as typeof globalThis & {
    MediaStreamTrackProcessor?: TrackProcessorCtor;
    MediaStreamTrackGenerator?: TrackGeneratorCtor;
  };
  if (!scope.MediaStreamTrackProcessor || !scope.MediaStreamTrackGenerator || typeof VideoFrame !== 'function') return null;
  return { Processor: scope.MediaStreamTrackProcessor, Generator: scope.MediaStreamTrackGenerator };
}

/** Whether area recordings keep full frame rate while the page is hidden. */
export function supportsFrameDrivenCrop(): boolean {
  return frameApis() !== null;
}

export async function startAreaCrop(source: MediaStream, rect: AreaRect, frameRate: number): Promise<AreaCrop> {
  const sourceTrack = source.getVideoTracks()[0];
  if (!sourceTrack) throw new Error('Area capture returned no video track.');
  const apis = frameApis();
  const settings = sourceTrack.getSettings();
  if (apis && settings.width && settings.height) {
    return frameDrivenCrop(apis, source, sourceTrack, rect, { width: settings.width, height: settings.height });
  }
  return canvasCrop(source, sourceTrack, rect, frameRate);
}

function stopAll(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

function frameDrivenCrop(
  apis: { Processor: TrackProcessorCtor; Generator: TrackGeneratorCtor },
  source: MediaStream,
  sourceTrack: MediaStreamTrack,
  rect: AreaRect,
  size: Size,
): AreaCrop {
  // The output size is fixed from the first plan so the encoder never sees a resolution change;
  // a screen that changes size mid-take is re-planned per frame and scaled into it.
  const output = planAreaCrop(rect, size);
  const processor = new apis.Processor({ track: sourceTrack });
  const generator = new apis.Generator({ kind: 'video' });
  const abort = new AbortController();
  let warned = false;
  const crop = new TransformStream<VideoFrame, VideoFrame>({
    transform(frame, controller) {
      try {
        const visible = frame.visibleRect ?? { x: 0, y: 0, width: frame.codedWidth, height: frame.codedHeight };
        const plan = planAreaCrop(rect, { width: visible.width, height: visible.height });
        controller.enqueue(
          new VideoFrame(frame, {
            visibleRect: { x: visible.x + plan.sx, y: visible.y + plan.sy, width: plan.sw, height: plan.sh },
            displayWidth: output.sw,
            displayHeight: output.sh,
          }),
        );
      } catch (error) {
        // One unusable frame (an odd-sized surface mid-resize) is dropped, not fatal to the take;
        // say so once, so a crop that fails on every frame is diagnosable.
        if (!warned) {
          warned = true;
          console.warn('Area capture dropped a frame it could not crop.', error);
        }
      } finally {
        frame.close();
      }
    },
  });
  void processor.readable
    .pipeThrough(crop, { signal: abort.signal })
    .pipeTo(generator.writable, { signal: abort.signal })
    .catch(() => undefined);
  const stream = new MediaStream([generator]);
  return {
    stream,
    width: output.sw,
    height: output.sh,
    sourceTrack,
    frameDriven: true,
    stop: () => {
      abort.abort();
      stopAll(stream);
      stopAll(source);
    },
  };
}

async function canvasCrop(source: MediaStream, sourceTrack: MediaStreamTrack, rect: AreaRect, frameRate: number): Promise<AreaCrop> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = source;
  await video.play().catch(() => undefined);
  const settings = sourceTrack.getSettings();
  const size = {
    width: video.videoWidth || settings.width || 1920,
    height: video.videoHeight || settings.height || 1080,
  };
  const output = planAreaCrop(rect, size);
  const canvas = document.createElement('canvas');
  canvas.width = output.sw;
  canvas.height = output.sh;
  const context = canvas.getContext('2d');
  if (!context) {
    video.srcObject = null;
    throw new Error('Area capture needs a 2D canvas, which this browser did not provide.');
  }
  const stream = canvas.captureStream(frameRate);
  let stopped = false;
  let frame = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const draw = () => {
    if (stopped) return;
    if (video.videoWidth && video.videoHeight) {
      const plan = planAreaCrop(rect, { width: video.videoWidth, height: video.videoHeight });
      context.drawImage(video, plan.sx, plan.sy, plan.sw, plan.sh, 0, 0, canvas.width, canvas.height);
    }
    // requestAnimationFrame never fires in a hidden page; a timer keeps (throttled) frames coming.
    if (document.hidden) timer = setTimeout(draw, 1000 / frameRate);
    else frame = requestAnimationFrame(draw);
  };
  const reschedule = () => {
    cancelAnimationFrame(frame);
    clearTimeout(timer);
    draw();
  };
  document.addEventListener('visibilitychange', reschedule);
  draw();
  return {
    stream,
    width: output.sw,
    height: output.sh,
    sourceTrack,
    frameDriven: false,
    stop: () => {
      stopped = true;
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', reschedule);
      stopAll(stream);
      stopAll(source);
      video.srcObject = null;
    },
  };
}
