import { TICKS_PER_SECOND, type Tick } from '../core/time';
import type { Project } from '../project/types';
import { activeClipAt, clipGain, sourceTicks } from '../render/compositorQuery';
import type { DrawableSource } from '../render/compose';

export interface PlayerAssetProvider {
  getFile(path: string): Promise<File>;
}

/**
 * Preview playback. A single clock drives the playhead; media elements are
 * slaved to it, so cuts and captions stay together even if a video element
 * stalls on its own.
 */
export class PreviewPlayer {
  private elements = new Map<string, HTMLMediaElement>();
  private images = new Map<string, HTMLImageElement>();
  private urls: string[] = [];
  private project: Project;
  private provider: PlayerAssetProvider;
  private anchorWallMs = 0;
  private anchorTicks = 0;
  private raf: number | null = null;
  private running = false;
  private muted = true;
  private onTick: (ticks: Tick) => void;
  private onEnded: () => void;
  private onReady: () => void;
  private warned = new Set<string>();

  constructor(options: {
    project: Project;
    provider: PlayerAssetProvider;
    onTick: (ticks: Tick) => void;
    onEnded?: () => void;
    /** Called once the first frame is actually drawable, so the editor can repaint. */
    onReady?: () => void;
  }) {
    this.project = options.project;
    this.provider = options.provider;
    this.onTick = options.onTick;
    this.onEnded = options.onEnded ?? (() => undefined);
    this.onReady = options.onReady ?? (() => undefined);
  }

  /**
   * The editor store replaces the project object on every edit. The player
   * caches one, so without this a trim, split or mute change would keep
   * syncing against the previous timeline until the page was reloaded.
   */
  updateProject(project: Project): void {
    this.project = project;
  }

  async load(assets: Project['assets'] = this.project.assets): Promise<void> {
    await Promise.all(
      assets.map(async (asset) => {
        if (asset.kind === 'image') {
          // Images need their own element: a <video> cannot decode them, and
          // skipping them made every image clip render black in the preview.
          try {
            const file = await this.provider.getFile(asset.path);
            const url = URL.createObjectURL(file);
            this.urls.push(url);
            const image = new Image();
            image.src = url;
            await waitForImage(image);
            this.images.set(asset.id, image);
          } catch (error) {
            console.warn(`Preview: cannot load ${asset.name}`, error);
          }
          return;
        }
        try {
          const file = await this.provider.getFile(asset.path);
          const url = URL.createObjectURL(file);
          this.urls.push(url);
          const element = document.createElement(asset.kind === 'audio' ? 'audio' : 'video');
          element.src = url;
          element.preload = 'auto';
          element.muted = true;
          if (asset.kind === 'video') {
            const video = element as HTMLVideoElement;
            video.playsInline = true;
            video.disablePictureInPicture = true;
          }
          await waitForMetadata(element);
          this.elements.set(asset.id, element);
        } catch (error) {
          console.warn(`Preview: cannot load ${asset.name}`, error);
        }
      }),
    );
    // Elements exist now, but a <video> is not drawable until a seek has
    // settled. Seeking right after load and repainting avoids a black preview
    // that only a user drag of the playhead would fix.
    await this.settleActive(this.anchorTicks);
    this.onReady();
  }

  /** Seek the clips active at `ticks` and wait until they can be drawn. */
  private async settleActive(ticks: Tick): Promise<void> {
    const waits: Promise<void>[] = [];
    for (const track of this.project.tracks) {
      if (track.kind === 'caption') continue;
      const clip = activeClipAt(track, ticks);
      if (!clip?.assetId) continue;
      const element = this.elements.get(clip.assetId);
      if (!element || element.readyState >= 2) continue;
      try {
        element.currentTime = sourceTicks(clip, ticks) / TICKS_PER_SECOND;
      } catch {
        continue;
      }
      waits.push(waitForDrawable(element));
    }
    await Promise.all(waits);
  }

  isLoaded(): boolean {
    return this.elements.size + this.images.size > 0;
  }

  getElement(assetId: string): HTMLMediaElement | undefined {
    return this.elements.get(assetId);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    for (const element of this.elements.values()) element.muted = muted;
  }

  isMuted(): boolean {
    return this.muted;
  }

  seek(ticks: Tick): void {
    this.anchorTicks = Math.max(0, ticks);
    this.anchorWallMs = performance.now();
    this.syncElements(this.anchorTicks, true);
    this.onTick(this.anchorTicks);
  }

  play(ticks: Tick): void {
    if (this.running) return;
    this.anchorTicks = Math.max(0, ticks);
    this.anchorWallMs = performance.now();
    this.running = true;
    this.syncElements(this.anchorTicks, true);
    for (const element of this.elements.values()) {
      if (element.paused) void element.play().catch(() => undefined);
    }
    const loop = () => {
      if (!this.running) return;
      const elapsedTicks = ((performance.now() - this.anchorWallMs) / 1000) * TICKS_PER_SECOND;
      const ticks = this.anchorTicks + elapsedTicks;
      if (ticks >= this.project.durationTicks) {
        this.pause();
        this.onTick(this.project.durationTicks);
        this.onEnded();
        return;
      }
      this.syncElements(ticks, false);
      this.onTick(Math.round(ticks));
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  pause(): void {
    this.running = false;
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
    for (const element of this.elements.values()) element.pause();
  }

  isPlaying(): boolean {
    return this.running;
  }

  /**
   * Push the clock into every active element. `hard` seeks exactly; otherwise a
   * drift over 120 ms is corrected, which is small enough to never be seen and
   * large enough to stop progressive desync.
   */
  syncElements(ticks: Tick, hard: boolean): void {
    const activeIds = new Set<string>();
    for (const track of this.project.tracks) {
      if (track.kind === 'caption') continue;
      const clip = activeClipAt(track, ticks);
      if (!clip?.assetId) continue;
      const element = this.elements.get(clip.assetId);
      if (!element) continue;
      activeIds.add(clip.assetId);
      const target = sourceTicks(clip, ticks) / TICKS_PER_SECOND;
      const drift = Math.abs(element.currentTime - target);
      if (hard || drift > 0.12) {
        try {
          element.currentTime = target;
        } catch {
          /* seeking before metadata is ready */
        }
      }
      if (track.kind === 'audio') {
        const gain = this.muted ? 0 : clipGain(clip, ticks) * track.volume * (track.muted ? 0 : 1);
        element.volume = Math.max(0, Math.min(1, gain));
        element.muted = this.muted || gain <= 0;
      } else {
        element.muted = true;
      }
    }
    for (const [assetId, element] of this.elements) {
      if (activeIds.has(assetId)) continue;
      if (!element.paused) element.pause();
    }
  }

  /** Current source images for the active clips, ready for the renderer. */
  sourceLookup(): (assetId: string, atTicks: Tick) => DrawableSource | null {
    return (assetId) => {
      const image = this.images.get(assetId);
      const asset = this.project.assets.find((a) => a.id === assetId);
      if (image) {
        if (!image.complete || image.naturalWidth === 0) return null;
        return { image, width: image.naturalWidth, height: image.naturalHeight };
      }
      const element = this.elements.get(assetId);
      if (element instanceof HTMLVideoElement) {
        if (element.readyState < 2) {
          if (!this.warned.has(assetId)) {
            this.warned.add(assetId);
            console.info(`Preview waiting for ${asset?.name ?? assetId} to decode.`);
          }
          return null;
        }
        return {
          image: element,
          width: element.videoWidth || asset?.width || 1920,
          height: element.videoHeight || asset?.height || 1080,
        };
      }
      return null;
    };
  }

  dispose(): void {
    this.pause();
    for (const element of this.elements.values()) {
      element.removeAttribute('src');
      element.load();
    }
    this.elements.clear();
    this.images.clear();
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.urls = [];
  }
}

function waitForImage(image: HTMLImageElement): Promise<void> {
  if (image.complete && image.naturalWidth > 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      image.removeEventListener('load', onLoad);
      image.removeEventListener('error', onError);
    };
    const onLoad = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('Image could not be decoded by this browser.'));
    };
    image.addEventListener('load', onLoad, { once: true });
    image.addEventListener('error', onError, { once: true });
    setTimeout(() => {
      cleanup();
      resolve();
    }, 8000);
  });
}

function waitForDrawable(element: HTMLMediaElement): Promise<void> {
  if (element.readyState >= 2) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      element.removeEventListener('seeked', done);
      element.removeEventListener('loadeddata', done);
      element.removeEventListener('canplay', done);
      resolve();
    };
    element.addEventListener('seeked', done, { once: true });
    element.addEventListener('loadeddata', done, { once: true });
    element.addEventListener('canplay', done, { once: true });
    // A codec this browser cannot decode never fires any of them; do not block
    // the editor's first paint on it.
    setTimeout(done, 3000);
  });
}

function waitForMetadata(element: HTMLMediaElement): Promise<void> {
  if (element.readyState >= 1) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      element.removeEventListener('loadedmetadata', onReady);
      element.removeEventListener('error', onError);
    };
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('Media could not be decoded by this browser.'));
    };
    element.addEventListener('loadedmetadata', onReady, { once: true });
    element.addEventListener('error', onError, { once: true });
    setTimeout(() => {
      cleanup();
      resolve();
    }, 8000);
  });
}
