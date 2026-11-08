import { TICKS_PER_SECOND, type Tick } from '../core/time';
import type { Clip, Project } from '../project/types';
import { activeClipAt, clipGain, instantaneousSpeed, sourceTicks } from '../render/compositorQuery';
import type { DrawableSource } from '../render/compose';
import { buildProcessingChain, DEFAULT_CHAIN } from '../audio/chain';

export interface PlayerAssetProvider {
  getFile(path: string): Promise<File>;
}

const VOICE_TRACK_HINT = /voice|mic|narration/i;

interface ClipAudioRoute {
  gainNode: GainNode;
  pannerNode?: StereoPannerNode;
  processed: boolean;
}

/**
 * Preview playback. A single clock drives the playhead; media elements are
 * slaved to it, so cuts and captions stay together even if a video element
 * stalls on its own.
 *
 * Parity guarantees:
 * 1. Independent media elements per `clip.id` (`clipElements`) when two
 *    simultaneous clips on different tracks reuse the same `assetId` with
 *    different source offsets (`inTicks` / `startTicks`).
 * 2. Live `playbackRate` (`instantaneousSpeed`), `preservesPitch`,
 *    voice-triggered ducking (`-12 dB` / `0.25×` when a voice clip is active),
 *    and WebAudio routing (`buildProcessingChain` + `StereoPannerNode` +
 *    `GainNode` supporting linear gain `0..4`) so preview audio matches export.
 */
export class PreviewPlayer {
  private elements = new Map<string, HTMLMediaElement>();
  private clipElements = new Map<string, HTMLMediaElement>();
  private assetUrls = new Map<string, string>();
  private images = new Map<string, HTMLImageElement>();
  private urls: string[] = [];
  private audioCtx: AudioContext | null = null;
  private audioRoutes = new Map<HTMLMediaElement, ClipAudioRoute>();
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

  private createMediaElementForAsset(assetId: string): HTMLMediaElement | null {
    const asset = this.project.assets.find((a) => a.id === assetId);
    const url = this.assetUrls.get(assetId);
    if (!asset || !url || typeof document === 'undefined') return null;
    const element = document.createElement(asset.kind === 'audio' ? 'audio' : 'video');
    element.src = url;
    element.preload = 'auto';
    element.muted = true;
    if (asset.kind === 'video') {
      const video = element as HTMLVideoElement;
      video.playsInline = true;
      video.disablePictureInPicture = true;
    }
    return element;
  }

  /**
   * Returns a dedicated media element for `clip.id` when multiple clips reuse
   * the same `assetId` simultaneously, or reuses the primary asset element for
   * the first clip referencing that asset.
   */
  getOrCreateClipElement(clip: Clip): HTMLMediaElement | undefined {
    if (!clip.assetId) return undefined;
    const existing = this.clipElements.get(clip.id);
    if (existing) return existing;

    const baseElement = this.elements.get(clip.assetId);
    const primaryOwner = Array.from(this.clipElements.values()).includes(baseElement as HTMLMediaElement);
    if (baseElement && !primaryOwner) {
      this.clipElements.set(clip.id, baseElement);
      return baseElement;
    }

    const cloned = this.createMediaElementForAsset(clip.assetId);
    if (cloned) {
      this.clipElements.set(clip.id, cloned);
      return cloned;
    }
    return baseElement;
  }

  async load(assets: Project['assets'] = this.project.assets): Promise<void> {
    await Promise.all(
      assets.map(async (asset) => {
        if (asset.kind === 'image') {
          try {
            const file = await this.provider.getFile(asset.path);
            const url = URL.createObjectURL(file);
            this.urls.push(url);
            this.assetUrls.set(asset.id, url);
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
          this.assetUrls.set(asset.id, url);
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
      const element = this.getOrCreateClipElement(clip);
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

  getClipElement(clipId: string): HTMLMediaElement | undefined {
    return this.clipElements.get(clipId);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    for (const element of this.elements.values()) element.muted = muted;
    for (const element of this.clipElements.values()) element.muted = muted;
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
    const allElements = new Set([...this.elements.values(), ...this.clipElements.values()]);
    for (const element of allElements) {
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
    const allElements = new Set([...this.elements.values(), ...this.clipElements.values()]);
    for (const element of allElements) element.pause();
  }

  isPlaying(): boolean {
    return this.running;
  }

  private applyAudioRouting(element: HTMLMediaElement, clip: Clip, effectiveGain: number): void {
    const processed = clip.audio.processed;
    const needsRouting = processed || clip.audio.pan !== 0 || effectiveGain > 1 || this.audioRoutes.has(element);
    if (typeof AudioContext !== 'undefined' && !this.muted && needsRouting) {
      try {
        this.audioCtx ??= new AudioContext();
        if (this.audioCtx.state === 'suspended') void this.audioCtx.resume().catch(() => undefined);
        let route = this.audioRoutes.get(element);
        // A clip whose processing flag changed needs a new graph; a
        // MediaElementSource can only be created once per element.
        if (route && route.processed !== processed) {
          route.gainNode.disconnect();
          route.pannerNode?.disconnect();
          this.audioRoutes.delete(element);
          route = undefined;
        }
        if (!route) {
          // Mirror the offline mixdown order exactly: gain -> pan -> chain.
          const mediaSource = this.audioCtx.createMediaElementSource(element);
          const gainNode = this.audioCtx.createGain();
          const pannerNode =
            typeof this.audioCtx.createStereoPanner === 'function'
              ? this.audioCtx.createStereoPanner()
              : undefined;
          let tail: AudioNode = gainNode;
          mediaSource.connect(gainNode);
          if (pannerNode) {
            gainNode.connect(pannerNode);
            tail = pannerNode;
          }
          if (processed) {
            // DEFAULT_CHAIN is exactly what the exporter's mixdown uses when no
            // explicit chain is requested, so preview and export agree.
            const chain = buildProcessingChain(this.audioCtx, DEFAULT_CHAIN);
            tail.connect(chain.input);
            chain.output.connect(this.audioCtx.destination);
            route = { gainNode, pannerNode, processed };
          } else {
            tail.connect(this.audioCtx.destination);
            route = { gainNode, pannerNode, processed };
          }
          this.audioRoutes.set(element, route);
        }
        route.gainNode.gain.value = Math.max(0, Math.min(4, effectiveGain));
        if (route.pannerNode) {
          route.pannerNode.pan.value = Math.max(-1, Math.min(1, clip.audio.pan ?? 0));
        }
        element.volume = 1;
        element.muted = this.muted || effectiveGain <= 0;
        return;
      } catch {
        // Fallback to native HTMLMediaElement volume below.
      }
    }
    // Once WebAudio owns the element, native volume is bypassed; keep mute
    // behaviour honest instead of silently leaving the routed graph audible.
    element.volume = Math.max(0, Math.min(1, effectiveGain));
    element.muted = this.muted || effectiveGain <= 0;
  }

  /**
   * Push the clock into every active clip element, Compute ducking, speed
   * `playbackRate`, and `preservesPitch`, and pause inactive elements.
   */
  syncElements(ticks: Tick, hard: boolean): void {
    const activeElements = new Set<HTMLMediaElement>();

    // Determine if any voice/narration clip is active at `ticks` for ducking
    let voiceActiveAtTick = false;
    for (const track of this.project.tracks) {
      if (track.kind !== 'audio' || track.muted) continue;
      const clip = activeClipAt(track, ticks);
      if (!clip || clip.audio.muted) continue;
      if (clip.audio.processed || VOICE_TRACK_HINT.test(track.name)) {
        if (clipGain(clip, ticks) * track.volume > 0.01) {
          voiceActiveAtTick = true;
          break;
        }
      }
    }

    for (const track of this.project.tracks) {
      if (track.kind === 'caption') continue;
      const clip = activeClipAt(track, ticks);
      if (!clip?.assetId) continue;
      const element = this.getOrCreateClipElement(clip);
      if (!element) continue;
      activeElements.add(element);

      // Sync playbackRate and preservesPitch with clip speed / speedCurve
      const rate = Math.max(0.1, Math.min(16, Math.abs(instantaneousSpeed(clip, ticks)) || 1));
      if (Math.abs(element.playbackRate - rate) > 0.01) {
        try {
          element.playbackRate = rate;
        } catch {
          // Ignore unsupported playbackRate bounds
        }
      }
      const preservePitch = clip.audio.preservePitch !== false;
      const pitchEl = element as HTMLMediaElement & { preservesPitch?: boolean; webkitPreservesPitch?: boolean };
      if (pitchEl.preservesPitch !== undefined) pitchEl.preservesPitch = preservePitch;
      if (pitchEl.webkitPreservesPitch !== undefined) pitchEl.webkitPreservesPitch = preservePitch;

      const target = sourceTicks(clip, ticks) / TICKS_PER_SECOND;
      const drift = Math.abs(element.currentTime - target);
      if (hard || clip.reverse || drift > 0.12) {
        try {
          element.currentTime = target;
        } catch {
          /* seeking before metadata is ready */
        }
      }
      if (track.kind === 'audio' || (!clip.audio.muted && track.kind === 'video')) {
        const duckFactor = clip.audio.duckUnderVoice && voiceActiveAtTick ? 0.25 : 1;
        const gain = this.muted
          ? 0
          : clipGain(clip, ticks) * track.volume * (track.muted ? 0 : 1) * duckFactor;
        this.applyAudioRouting(element, clip, gain);
      } else {
        element.muted = true;
      }
    }

    const allElements = new Set([...this.elements.values(), ...this.clipElements.values()]);
    for (const element of allElements) {
      if (activeElements.has(element)) continue;
      if (!element.paused) element.pause();
    }
  }

  /**
   * Current source images for the active clips, ready for the renderer.
   * Accepts optional `clipId` so two simultaneous clips sharing an `assetId`
   * each resolve their own independent decoded `HTMLVideoElement`.
   */
  sourceLookup(): (assetId: string, atTicks: Tick, clipId?: string) => DrawableSource | null {
    return (assetId, _atTicks, clipId) => {
      const image = this.images.get(assetId);
      const asset = this.project.assets.find((a) => a.id === assetId);
      if (image) {
        if (!image.complete || image.naturalWidth === 0) return null;
        return { image, width: image.naturalWidth, height: image.naturalHeight };
      }
      const element = (clipId ? this.clipElements.get(clipId) : undefined) ?? this.elements.get(assetId);
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
    const allElements = new Set([...this.elements.values(), ...this.clipElements.values()]);
    for (const element of allElements) {
      element.removeAttribute('src');
      element.load();
    }
    this.elements.clear();
    this.clipElements.clear();
    this.assetUrls.clear();
    this.audioRoutes.clear();
    if (this.audioCtx) {
      void this.audioCtx.close().catch(() => undefined);
      this.audioCtx = null;
    }
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
