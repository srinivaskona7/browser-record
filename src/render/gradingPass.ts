import type { ClipEffects, ColorWheelValue, HslColorBand, ToneCurvePoint } from '../project/types';
import {
  buildProcedural3dLattice,
  evaluateToneCurve,
  HSL_COLOR_BANDS,
  type CinematicLutSpec,
} from '../effects/catalog';

/**
 * GPU colour-grading pass.
 *
 * The CPU implementation in `applyPixelGradingToImageData` is the reference
 * (and the fallback in tests and browsers without WebGL2), but a 4K frame is
 * 8.3 million pixels: a per-pixel JavaScript loop cannot keep up with playback
 * or a real export. This module runs the identical math on the GPU and hands
 * back a canvas the compositor can draw with the normal transform/clip stack.
 *
 * Returning `null` is always a safe answer; callers fall back to the CPU path.
 */

const VERTEX_SHADER = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp sampler3D;

in vec2 v_uv;
uniform sampler2D u_src;
uniform vec4 u_crop;          // x, y, width, height in normalized source space
uniform bool u_flipX;
uniform bool u_flipY;

uniform bool u_hasLut;
uniform sampler3D u_lut;
uniform vec3 u_domainMin;
uniform vec3 u_domainMax;
uniform float u_lutStrength;

uniform vec4 u_wheels[4];     // shadows, midtones, highlights, global (rgb shift, a = luma shift)
uniform bool u_hasWheels;

uniform vec4 u_hsl[8];        // hue shift degrees, sat, luma, band center degrees
uniform bool u_hasHsl;

uniform sampler2D u_curveR;
uniform sampler2D u_curveG;
uniform sampler2D u_curveB;
uniform sampler2D u_curveRGB;
uniform bool u_hasCurveR;
uniform bool u_hasCurveG;
uniform bool u_hasCurveB;
uniform bool u_hasCurveRGB;

out vec4 fragColor;

vec3 rgb2hsl(vec3 c) {
  float maxC = max(max(c.r, c.g), c.b);
  float minC = min(min(c.r, c.g), c.b);
  float l = (maxC + minC) * 0.5;
  if (maxC == minC) return vec3(0.0, 0.0, l);
  float d = maxC - minC;
  float s = l > 0.5 ? d / (2.0 - maxC - minC) : d / (maxC + minC);
  float h;
  if (maxC == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
  else if (maxC == c.g) h = (c.b - c.r) / d + 2.0;
  else h = (c.r - c.g) / d + 4.0;
  return vec3(mod(h * 60.0, 360.0), s, l);
}

float hue2rgb(float p, float q, float t) {
  if (t < 0.0) t += 1.0;
  if (t > 1.0) t -= 1.0;
  if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
  if (t < 0.5) return q;
  if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
  return p;
}

vec3 hsl2rgb(vec3 hsl) {
  float h = mod(hsl.x, 360.0) / 360.0;
  float s = clamp(hsl.y, 0.0, 1.0);
  float l = clamp(hsl.z, 0.0, 1.0);
  if (s <= 0.0) return vec3(l);
  float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
  float p = 2.0 * l - q;
  return vec3(hue2rgb(p, q, h + 1.0 / 3.0), hue2rgb(p, q, h), hue2rgb(p, q, h - 1.0 / 3.0));
}

vec3 applyWheel(vec3 c, vec4 wheel, float weight) {
  if (weight <= 0.0 || (wheel.x == 0.0 && wheel.y == 0.0 && wheel.z == 0.0 && wheel.w == 0.0)) return c;
  return clamp(c + vec3(wheel.x + wheel.w, wheel.y + wheel.w, wheel.z + wheel.w) * weight, 0.0, 1.0);
}

void main() {
  vec2 uv = v_uv;
  if (u_flipX) uv.x = 1.0 - uv.x;
  if (u_flipY) uv.y = 1.0 - uv.y;
  vec2 srcUv = u_crop.xy + uv * u_crop.zw;

  vec4 texel = texture(u_src, srcUv);
  vec3 rgb = texel.rgb;

  if (u_hasLut) {
    vec3 domain = max(u_domainMax - u_domainMin, vec3(0.000001));
    vec3 lutUv = clamp((rgb - u_domainMin) / domain, 0.0, 1.0);
    vec3 graded = texture(u_lut, lutUv).rgb;
    rgb = mix(rgb, graded, clamp(u_lutStrength, 0.0, 1.0));
  }

  if (u_hasWheels) {
    float l = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
    float wShadow = (1.0 - l) * (1.0 - l);
    float wMid = max(0.0, 1.0 - abs(2.0 * l - 1.0));
    float wHigh = l * l;
    rgb = applyWheel(rgb, u_wheels[3], 1.0);
    rgb = applyWheel(rgb, u_wheels[0], wShadow);
    rgb = applyWheel(rgb, u_wheels[1], wMid);
    rgb = applyWheel(rgb, u_wheels[2], wHigh);
  }

  if (u_hasHsl) {
    vec3 hsl = rgb2hsl(rgb);
    float dHue = 0.0;
    float dSat = 0.0;
    float dLuma = 0.0;
    for (int i = 0; i < 8; i++) {
      vec4 band = u_hsl[i];
      if (band.x == 0.0 && band.y == 0.0 && band.z == 0.0) continue;
      float diff = abs(hsl.x - band.w);
      if (diff > 180.0) diff = 360.0 - diff;
      if (diff < 45.0) {
        float w = cos((diff / 45.0) * 1.57079632679) * hsl.y;
        dHue += band.x * w;
        dSat += band.y * w;
        dLuma += band.z * w;
      }
    }
    if (dHue != 0.0 || dSat != 0.0 || dLuma != 0.0) {
      hsl.x = mod(hsl.x + dHue + 360.0, 360.0);
      hsl.y = clamp(hsl.y + dSat * 0.5, 0.0, 1.0);
      hsl.z = clamp(hsl.z + dLuma * 0.35, 0.0, 1.0);
      rgb = hsl2rgb(hsl);
    }
  }

  if (u_hasCurveR) rgb.r = texture(u_curveR, vec2(rgb.r, 0.5)).r;
  if (u_hasCurveG) rgb.g = texture(u_curveG, vec2(rgb.g, 0.5)).r;
  if (u_hasCurveB) rgb.b = texture(u_curveB, vec2(rgb.b, 0.5)).r;
  if (u_hasCurveRGB) {
    rgb.r = texture(u_curveRGB, vec2(rgb.r, 0.5)).r;
    rgb.g = texture(u_curveRGB, vec2(rgb.g, 0.5)).r;
    rgb.b = texture(u_curveRGB, vec2(rgb.b, 0.5)).r;
  }

  fragColor = vec4(clamp(rgb, 0.0, 1.0), texel.a);
}`;

export interface GradingSource {
  image: CanvasImageSource;
  /** Normalized crop inside the source (0..1). */
  crop: { x: number; y: number; width: number; height: number };
  width: number;
  height: number;
}

interface LutState {
  key: string;
  texture: WebGLTexture;
  size: number;
  domainMin: [number, number, number];
  domainMax: [number, number, number];
}

interface CurveState {
  key: string;
  texture: WebGLTexture;
}

const NO_LUT_KEY = 'none';

function wheelShift(wheel: ColorWheelValue | undefined): [number, number, number, number] {
  if (!wheel) return [0, 0, 0, 0];
  const rad = (wheel.hueDeg * Math.PI) / 180;
  const shiftX = Math.cos(rad) * wheel.sat * 0.35;
  const shiftY = Math.cos(rad - (2 * Math.PI) / 3) * wheel.sat * 0.35;
  const shiftZ = Math.cos(rad - (4 * Math.PI) / 3) * wheel.sat * 0.35;
  return [shiftX, shiftY, shiftZ, wheel.luma * 0.35];
}

function lutSpecFor(effects: ClipEffects): CinematicLutSpec | null {
  // Built-in cinematic looks stay on the stylized CSS/split-tone path; only
  // imported .cube lattices are evaluated on real pixels.
  if ((effects.lutStrength ?? 1) <= 0) return null;
  if (effects.customLutData) {
    const data = effects.customLutData;
    return {
      id: data.id,
      name: data.name,
      description: '',
      contrast: 0,
      saturation: 0,
      temperature: 0,
      gamma: 1,
      shadowsHex: '#000000',
      highlightsHex: '#FFFFFF',
      tintStrength: 0,
      latticeSize: data.size,
      domainMin: data.domainMin,
      domainMax: data.domainMax,
      lattice: data.lattice,
    };
  }
  return null;
}

function curveKey(points: readonly ToneCurvePoint[] | undefined): string {
  if (!points || points.length === 0) return '';
  return points.map((point) => `${point.x.toFixed(4)}:${point.y.toFixed(4)}`).join(',');
}

class GradingPass {
  private canvas: HTMLCanvasElement | OffscreenCanvas | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private sourceTexture: WebGLTexture | null = null;
  private lutState: LutState | null = null;
  private curveTextures: Record<'r' | 'g' | 'b' | 'rgb', CurveState | null> = {
    r: null,
    g: null,
    b: null,
    rgb: null,
  };
  private identityCurve: WebGLTexture | null = null;
  private identityLut: WebGLTexture | null = null;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private width = 0;
  private height = 0;

  private ensureContext(width: number, height: number): boolean {
    if (!this.canvas) {
      try {
        this.canvas =
          typeof OffscreenCanvas !== 'undefined'
            ? new OffscreenCanvas(Math.max(1, width), Math.max(1, height))
            : document.createElement('canvas');
      } catch {
        return false;
      }
    }
    if (!this.gl) {
      const gl = (this.canvas as HTMLCanvasElement).getContext?.('webgl2', {
        alpha: true,
        premultipliedAlpha: false,
        preserveDrawingBuffer: false,
        antialias: false,
        depth: false,
        stencil: false,
      }) as WebGL2RenderingContext | null;
      if (!gl) return false;
      this.gl = gl;
      if (!this.buildProgram()) {
        this.gl = null;
        return false;
      }
    }
    if (this.width < width || this.height < height) {
      this.width = Math.max(this.width, width);
      this.height = Math.max(this.height, height);
      this.canvas.width = this.width;
      this.canvas.height = this.height;
    }
    return true;
  }

  private buildProgram(): boolean {
    const gl = this.gl;
    if (!gl) return false;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.warn('Grading shader failed to compile:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };
    const vertex = compile(gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    if (!vertex || !fragment) return false;
    const program = gl.createProgram();
    if (!program) return false;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn('Grading program failed to link:', gl.getProgramInfoLog(program));
      return false;
    }
    this.program = program;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const location = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
    this.vao = vao;

    const names = [
      'u_src',
      'u_crop',
      'u_flipX',
      'u_flipY',
      'u_hasLut',
      'u_lut',
      'u_domainMin',
      'u_domainMax',
      'u_lutStrength',
      'u_wheels',
      'u_hasWheels',
      'u_hsl',
      'u_hasHsl',
      'u_curveR',
      'u_curveG',
      'u_curveB',
      'u_curveRGB',
      'u_hasCurveR',
      'u_hasCurveG',
      'u_hasCurveB',
      'u_hasCurveRGB',
    ];
    for (const name of names) this.uniforms[name] = gl.getUniformLocation(program, name);

    this.sourceTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);

    this.identityCurve = this.makeCurveTexture(new Uint8Array(256).map((_, index) => index));
    this.identityLut = this.makeLutTexture(1, new Float32Array([0, 0, 0]));
    return true;
  }

  private makeCurveTexture(values: Uint8Array): WebGLTexture | null {
    const gl = this.gl;
    if (!gl) return null;
    const texture = gl.createTexture();
    if (!texture) return null;
    const data = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i += 1) {
      const value = values[i] ?? i;
      data[i * 4] = value;
      data[i * 4 + 1] = value;
      data[i * 4 + 2] = value;
      data[i * 4 + 3] = 255;
    }
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  private makeLutTexture(size: number, lattice: ArrayLike<number>): WebGLTexture | null {
    const gl = this.gl;
    if (!gl) return null;
    const texture = gl.createTexture();
    if (!texture) return null;
    const data = new Uint8Array(size * size * size * 4);
    for (let i = 0; i < size * size * size; i += 1) {
      data[i * 4] = Math.round(Math.max(0, Math.min(1, lattice[i * 3] ?? 0)) * 255);
      data[i * 4 + 1] = Math.round(Math.max(0, Math.min(1, lattice[i * 3 + 1] ?? 0)) * 255);
      data[i * 4 + 2] = Math.round(Math.max(0, Math.min(1, lattice[i * 3 + 2] ?? 0)) * 255);
      data[i * 4 + 3] = 255;
    }
    gl.bindTexture(gl.TEXTURE_3D, texture);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, size, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    return texture;
  }

  private updateLut(spec: CinematicLutSpec | null): void {
    const gl = this.gl;
    if (!gl) return;
    const size = spec?.latticeSize ?? 2;
    const key = spec
      ? `${spec.id}:${size}:${spec.lattice ? spec.lattice.length : 'proc'}:${spec.domainMin?.join(',')}:${spec.domainMax?.join(',')}`
      : NO_LUT_KEY;
    if (this.lutState?.key === key) return;
    if (this.lutState?.texture) gl.deleteTexture(this.lutState.texture);
    if (!spec) {
      this.lutState = this.identityLut
        ? { key, texture: this.identityLut, size: 1, domainMin: [0, 0, 0], domainMax: [1, 1, 1] }
        : null;
      return;
    }
    const lattice = spec.lattice ?? buildProcedural3dLattice(spec, size);
    const texture = this.makeLutTexture(size, lattice);
    if (!texture) return;
    this.lutState = {
      key,
      texture,
      size,
      domainMin: spec.domainMin ?? [0, 0, 0],
      domainMax: spec.domainMax ?? [1, 1, 1],
    };
  }

  private updateCurve(channel: 'r' | 'g' | 'b' | 'rgb', points: readonly ToneCurvePoint[] | undefined): boolean {
    const gl = this.gl;
    if (!gl) return false;
    const key = curveKey(points);
    if (!key) {
      this.curveTextures[channel] = null;
      return false;
    }
    if (this.curveTextures[channel]?.key === key) return true;
    if (this.curveTextures[channel]?.texture) gl.deleteTexture(this.curveTextures[channel]!.texture);
    const values = new Uint8Array(256);
    for (let i = 0; i < 256; i += 1) {
      values[i] = Math.round(evaluateToneCurve(points, i / 255) * 255);
    }
    const texture = this.makeCurveTexture(values);
    if (!texture) return false;
    this.curveTextures[channel] = { key, texture };
    return true;
  }

  /**
   * Render a graded copy of `source` at `width`×`height`. Returns the WebGL
   * canvas, or null when GPU grading is unavailable.
   */
  render(
    source: GradingSource,
    effects: ClipEffects,
    options: { flipX?: boolean; flipY?: boolean } = {},
  ): HTMLCanvasElement | OffscreenCanvas | null {
    if (!hasGpuGradingWork(effects)) return null;
    const width = Math.max(1, Math.round(source.width));
    const height = Math.max(1, Math.round(source.height));
    if (!this.ensureContext(width, height) || !this.gl || !this.program) return null;
    const gl = this.gl;
    gl.viewport(0, 0, width, height);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);

    // Source texture (uploaded per frame; this is what makes live video work).
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source.image as TexImageSource);
    } catch {
      return null;
    }
    gl.uniform1i(this.uniforms.u_src ?? null, 0);
    gl.uniform4f(this.uniforms.u_crop ?? null, source.crop.x, source.crop.y, source.crop.width, source.crop.height);
    gl.uniform1i(this.uniforms.u_flipX ?? null, options.flipX ? 1 : 0);
    gl.uniform1i(this.uniforms.u_flipY ?? null, options.flipY ? 1 : 0);

    const lutSpec = lutSpecFor(effects);
    this.updateLut(lutSpec);
    if (this.lutState) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_3D, this.lutState.texture);
      gl.uniform1i(this.uniforms.u_lut ?? null, 1);
      gl.uniform3fv(this.uniforms.u_domainMin ?? null, this.lutState.domainMin);
      gl.uniform3fv(this.uniforms.u_domainMax ?? null, this.lutState.domainMax);
      gl.uniform1i(this.uniforms.u_hasLut ?? null, lutSpec ? 1 : 0);
      gl.uniform1f(this.uniforms.u_lutStrength ?? null, Math.max(0, Math.min(1, effects.lutStrength ?? 1)));
    } else {
      gl.uniform1i(this.uniforms.u_hasLut ?? null, 0);
    }

    const wheels = effects.colorWheels;
    const wheelData = new Float32Array(16);
    if (wheels) {
      const order: Array<keyof NonNullable<ClipEffects['colorWheels']>> = [
        'shadows',
        'midtones',
        'highlights',
        'global',
      ];
      order.forEach((scope, index) => {
        wheelData.set(wheelShift(wheels[scope]), index * 4);
      });
    }
    gl.uniform4fv(this.uniforms.u_wheels ?? null, wheelData);
    gl.uniform1i(this.uniforms.u_hasWheels ?? null, wheels ? 1 : 0);

    const hsl = effects.hslBands;
    const hslData = new Float32Array(32);
    let hasHsl = false;
    if (hsl) {
      HSL_COLOR_BANDS.forEach((band, index) => {
        const adjustment = hsl[band.id as HslColorBand];
        if (!adjustment) return;
        if (adjustment.hue !== 0 || adjustment.sat !== 0 || adjustment.luma !== 0) hasHsl = true;
        hslData[index * 4] = adjustment.hue;
        hslData[index * 4 + 1] = adjustment.sat;
        hslData[index * 4 + 2] = adjustment.luma;
        hslData[index * 4 + 3] = band.centerDeg;
      });
    }
    gl.uniform4fv(this.uniforms.u_hsl ?? null, hslData);
    gl.uniform1i(this.uniforms.u_hasHsl ?? null, hasHsl ? 1 : 0);

    const curves = effects.toneCurves;
    const hasR = this.updateCurve('r', curves?.red);
    const hasG = this.updateCurve('g', curves?.green);
    const hasB = this.updateCurve('b', curves?.blue);
    const hasRgb = this.updateCurve('rgb', curves?.rgb);
    const bindCurve = (unit: number, flag: string, uniform: string, channel: 'r' | 'g' | 'b' | 'rgb', active: boolean) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      const texture = active ? this.curveTextures[channel]?.texture ?? this.identityCurve : this.identityCurve;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(this.uniforms[uniform] ?? null, unit);
      gl.uniform1i(this.uniforms[flag] ?? null, active ? 1 : 0);
    };
    bindCurve(2, 'u_hasCurveR', 'u_curveR', 'r', hasR);
    bindCurve(3, 'u_hasCurveG', 'u_curveG', 'g', hasG);
    bindCurve(4, 'u_hasCurveB', 'u_curveB', 'b', hasB);
    bindCurve(5, 'u_hasCurveRGB', 'u_curveRGB', 'rgb', hasRgb);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return this.canvas;
  }
}

/** True when the GPU pass has anything to do for these effects. */
export function hasGpuGradingWork(effects: ClipEffects): boolean {
  if (effects.customLutData && (effects.lutStrength ?? 1) > 0) return true;
  if (effects.colorWheels) {
    const { global, shadows, midtones, highlights } = effects.colorWheels;
    for (const wheel of [global, shadows, midtones, highlights]) {
      if (wheel && (wheel.sat !== 0 || wheel.luma !== 0)) return true;
    }
  }
  if (effects.hslBands) {
    for (const band of Object.values(effects.hslBands)) {
      if (band && (band.hue !== 0 || band.sat !== 0 || band.luma !== 0)) return true;
    }
  }
  if (effects.toneCurves) {
    const curves = effects.toneCurves;
    for (const points of [curves.rgb, curves.red, curves.green, curves.blue]) {
      if (points && points.length > 0) return true;
    }
  }
  return false;
}

let sharedPass: GradingPass | null = null;

/**
 * Grade `source` on the GPU. Returns null when WebGL2 is unavailable or the
 * effect set has no grading work; callers must fall back to the CPU path.
 */
export function renderGradedSource(
  source: GradingSource,
  effects: ClipEffects,
  options: { flipX?: boolean; flipY?: boolean } = {},
): HTMLCanvasElement | OffscreenCanvas | null {
  if (typeof document === 'undefined' && typeof OffscreenCanvas === 'undefined') return null;
  sharedPass ??= new GradingPass();
  return sharedPass.render(source, effects, options);
}

/** Test hook: drop the shared GL context between suites. */
export function resetGradingPass(): void {
  sharedPass = null;
}
