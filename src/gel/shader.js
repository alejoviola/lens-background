// Capsula-style refraction: three passes.
//   colorFrag  -> saturated procedural colour fields (offscreen RT)
//   blurFrag   -> slight separable box blur of that RT
//   heightFrag -> per-capsule grayscale lens height + packed normal (half res)
//   finalFrag  -> refracts the colour texture through the normal map, then a
//                 restrained surface layer (rim, fresnel, soft highlight, glow)
const prelude = `
  precision highp float;

  float hash(vec2 p){
    p = fract(p * vec2(233.34, 851.73));
    p += dot(p, p + 23.45);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float fbm(vec2 p, float oct){
    float s = 0.0, n = 0.0, a = 0.5;
    for(int i = 0; i < 5; i++){
      float w = clamp(oct - float(i), 0.0, 1.0);
      s += a * w * vnoise(p);
      n += a * w;
      p = mat2(1.62, 1.18, -1.18, 1.62) * p + 11.3;
      a *= 0.52;
    }
    return s / max(n, 1e-4);
  }
  vec3 rgb2hsv(vec3 c){
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
  }
  vec3 hsv2rgb(vec3 c){
    vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
  }
  float sdRound(vec2 p, vec2 b, float r){
    vec2 q = abs(p) - b + r;
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
  }
`

export const GEL_SHADER = {
  quadVert: `
    varying vec2 vUv;
    void main(){
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,

  // ---- pass 1: colour fields ---------------------------------------------
  colorFrag: prelude + `
    uniform float uTime;
    uniform float uHue;
    uniform float uOct;
    uniform float uNScale;      // noiseScale: size of the cloudy masses
    uniform float uNWarp;       // noiseWarp: domain-warp amount
    uniform float uNContrast;   // noiseContrast
    uniform float uNSpeed;      // noiseSpeed
    uniform float uNMix;        // noiseColorSpread: how far across the palette
    varying vec2 vUv;

    uniform vec3  uPal[10];
    uniform float uPalN;

    // the editable palette, wrapped into a cyclic ramp: the shared texture is
    // an interpolation across these stops, so every element sees the same one
    vec3 palStop(float idx){
      float k = mod(floor(idx + 0.5), uPalN);
      vec3 c = vec3(0.0);
      for(int i = 0; i < 10; i++){
        c += uPal[i] * step(abs(float(i) - k), 0.5);
      }
      return c;
    }
    vec3 field(float k){
      float t = fract(k) * uPalN;
      float i = floor(t);
      float f = smoothstep(0.0, 1.0, fract(t));
      return mix(palStop(i), palStop(i + 1.0), f);
    }

    void main(){
      float t = uTime * uNSpeed;
      vec2 uv = vUv;
      vec2 q = uv * uNScale;

      // domain-warped fractal noise -> big cloudy boundaries
      vec2 w = vec2(
        fbm(q * 0.75 + vec2(0.0, t * 0.024), uOct),
        fbm(q * 0.80 + vec2(6.4 - t * 0.020, 2.1), uOct)
      ) - 0.5;
      float a = fbm(q * 1.15 + w * (2.2 * uNWarp) + vec2(t * 0.017, -t * 0.021), uOct);
      float b = fbm(q * 0.60 - w * (1.4 * uNWarp) + vec2(-t * 0.013, t * 0.016), uOct - 1.0);

      // which colour field, and how much cloud density inside it
      float k = uHue + (a * 0.72 + b * 0.34) * uNMix + t * 0.006;
      vec3 col = field(k);
      col = mix(col, field(k + 0.055), smoothstep(0.35, 0.85, b));

      float mid = 0.54;
      float lo = clamp(mid - 0.28 / max(uNContrast, 0.05), 0.0, 1.0);
      float hi = clamp(mid + 0.28 / max(uNContrast, 0.05), 0.0, 1.0);
      float dens = clamp(smoothstep(lo, hi, a) * 0.78 + 0.20, 0.0, 1.30);
      col *= dens;
      col = mix(vec3(dot(col, vec3(0.3, 0.45, 0.25))), col, 1.18);   // punch
      gl_FragColor = vec4(col, 1.0);
    }
  `,

  blurFrag: `
    precision highp float;
    uniform sampler2D uTex;
    uniform vec2 uTexel;
    uniform vec2 uDir;
    uniform float uRadius;
    varying vec2 vUv;
    void main(){
      vec4 s = vec4(0.0);
      for(int i = -6; i <= 6; i++){
        s += texture2D(uTex, vUv + uDir * uTexel * (float(i) * uRadius));
      }
      gl_FragColor = s / 13.0;
    }
  `,

  // ---- pass 2: lens height map + packed normal ----------------------------
  heightFrag: prelude + `
    uniform vec2  uRes;
    uniform float uElemW;
    uniform float uElemH;
    uniform float uRadius;
    uniform float uCols;
    uniform float uRows;
    uniform float uGapX;
    uniform float uGapY;
    uniform float uTime;
    uniform float uBreath;      // 0..1 sweep progress, 0 = idle
    uniform float uBreathAmt;   // breatheStrength (scale delta at the crest)
    uniform float uReduced;
    uniform float uIntro;
    varying vec2 vUv;

    float heightAt(vec2 p, vec2 hs, float rad, vec2 id, float t){
      float d = sdRound(p, hs, rad);
      float depth = clamp(-d / (hs.x * 0.95), 0.0, 1.0);
      float dome = sqrt(max(0.0, 1.0 - (1.0 - depth) * (1.0 - depth)));
      vec2 q = p / hs;
      float lump  = fbm(q * 1.05 + id * 4.7 + vec2(t * 0.028, -t * 0.022), 4.0) - 0.5;
      float lump2 = fbm(q * 0.48 + id * 2.3 + vec2(-t * 0.018, t * 0.020), 3.0) - 0.5;
      return dome * 0.78 + (lump * 0.80 + lump2 * 1.15) * smoothstep(0.0, 0.40, depth);
    }

    void main(){
      vec2 frag = vUv * uRes;
      vec2 mid = uRes * 0.5;
      float t = uTime * mix(1.0, 0.25, uReduced);

      // fixed-size rounded rectangles on a centred columns x rows grid
      vec2 pitch = vec2(uElemW + uGapX, uElemH + uGapY);
      vec2 off = vec2(uCols - 1.0, uRows - 1.0) * 0.5;
      vec2 gpos = (frag - mid) / pitch + off;
      vec2 id = clamp(floor(gpos + 0.5), vec2(0.0), vec2(uCols - 1.0, uRows - 1.0));
      vec2 local = frag - mid - (id - off) * pitch;


      // intro: each element expands into place on a diagonal stagger
      float ord = (id.x + id.y) / max(uCols + uRows - 2.0, 1.0);
      float ip = clamp((uIntro - ord * 0.55) / 0.45, 0.0, 1.0);
      float pb = ip - 1.0;
      float grow = max(1.0 + 2.70158 * pb * pb * pb + 1.70158 * pb * pb, 0.02);

      // breathing sweep: one slow, subtle size pulse per cycle, travelling
      // from the bottom-left corner to the top-right one
      float bDiag = (id.x + id.y) / max(uCols + uRows - 2.0, 1.0);
      float bPos = uBreath * 2.6 - 0.80;
      float bAmp = exp(-pow((bDiag - bPos) / 0.30, 2.0)) * step(0.0001, uBreath);
      grow *= 1.0 - bAmp * uBreathAmt;   // the crest shrinks: zoom out

      vec2 hs = vec2(uElemW, uElemH) * 0.5 * grow;
      float rad = min(uRadius * grow, min(uElemW * grow * 0.199, min(hs.x, hs.y) * 0.85));

      float e = max(pitch.x * 0.02, 2.0);
      float h  = heightAt(local, hs, rad, id, t);
      float hx = heightAt(local + vec2(e, 0.0), hs, rad, id, t)
               - heightAt(local - vec2(e, 0.0), hs, rad, id, t);
      float hy = heightAt(local + vec2(0.0, e), hs, rad, id, t)
               - heightAt(local - vec2(0.0, e), hs, rad, id, t);

      vec2 grad = vec2(hx, hy) / (2.0 * e) * hs.x * 2.6;
      vec3 n = normalize(vec3(-grad, 1.0));
      gl_FragColor = vec4(n.xy * 0.5 + 0.5, clamp(h, 0.0, 1.5) / 1.5, 1.0);
    }
  `,

  // ---- pass 3: refraction + surface --------------------------------------
  finalFrag: prelude + `
    uniform sampler2D uColor;
    uniform sampler2D uHeight;
    uniform vec2  uRes;
    uniform float uElemW;
    uniform float uElemH;
    uniform float uRadius;
    uniform float uCols;
    uniform float uRows;
    uniform float uGapX;
    uniform float uGapY;
    uniform float uTime;
    uniform float uFocus;
    uniform float uGlow;
    uniform float uHilite;
    uniform float uRefract;
    uniform float uVoidRX;      // voidRadiusX (normalised capsule UV)
    uniform float uVoidRY;      // voidRadiusY
    uniform float uStretch;     // textureStretch for the annular remap
    uniform float uIntro;       // 0..1 entrance progress
    uniform float uLupeZoom;    // magnification inside the lens
    uniform float uSphere;      // sphericalRefraction strength
    uniform float uLensGrad;    // lensGradient: how far the core simplifies
    uniform float uBulge;       // how far the dome normal tips at the rim
    uniform float uIOR;         // index of refraction
    uniform float uVoidSoft;    // voidSoftness on the boundary
    uniform vec2  uMouse;       // cursor in render pixels (y up)
    uniform float uMouseIn;     // 0 when the pointer left the stage
    uniform float uTilt;        // tilt3D strength
    uniform float uVignette;    // vignette depth
    uniform float uBreath;      // 0..1 sweep progress, 0 = idle
    uniform float uBreathAmt;   // breatheStrength (scale delta at the crest)
    uniform float uReduced;
    uniform float uDebug;
    varying vec2 vUv;

    void main(){
      // uDebug: 1 = colour texture, 2 = refraction map, 3 = void mask
      if(uDebug > 1.5 && uDebug < 2.5){
        gl_FragColor = vec4(vec3(texture2D(uHeight, vUv).b), 1.0);
        return;
      }
      if(uDebug > 0.5 && uDebug < 1.5){
        gl_FragColor = vec4(texture2D(uColor, vUv).rgb, 1.0);
        return;
      }

      vec2 frag = vUv * uRes;
      vec2 mid = uRes * 0.5;
      float t = uTime;

      // fixed-size rounded rectangles on a centred columns x rows grid
      vec2 pitch = vec2(uElemW + uGapX, uElemH + uGapY);
      vec2 off = vec2(uCols - 1.0, uRows - 1.0) * 0.5;
      vec2 gpos = (frag - mid) / pitch + off;
      vec2 id = clamp(floor(gpos + 0.5), vec2(0.0), vec2(uCols - 1.0, uRows - 1.0));
      vec2 local = frag - mid - (id - off) * pitch;

      float central = 1.0 - smoothstep(0.0, 1.15, length(id - off));

      // intro: each element expands into place on a diagonal stagger
      float ord = (id.x + id.y) / max(uCols + uRows - 2.0, 1.0);
      float ip = clamp((uIntro - ord * 0.55) / 0.45, 0.0, 1.0);
      float pb = ip - 1.0;
      float grow = max(1.0 + 2.70158 * pb * pb * pb + 1.70158 * pb * pb, 0.02);

      // breathing sweep: one slow, subtle size pulse per cycle, travelling
      // from the bottom-left corner to the top-right one
      float bDiag = (id.x + id.y) / max(uCols + uRows - 2.0, 1.0);
      float bPos = uBreath * 2.6 - 0.80;
      float bAmp = exp(-pow((bDiag - bPos) / 0.30, 2.0)) * step(0.0001, uBreath);
      grow *= 1.0 - bAmp * uBreathAmt;   // the crest shrinks: zoom out

      vec2 hs = vec2(uElemW, uElemH) * 0.5 * grow;
      float rad = min(uRadius * grow, min(uElemW * grow * 0.199, min(hs.x, hs.y) * 0.85));

      // ---- dynamic targeting: each element tilts toward the cursor -------
      vec2 elemCentre = mid + (id - off) * pitch;
      vec2 mv = (uMouse - elemCentre) / max(hs, vec2(1.0));
      float hover = exp(-dot(mv, mv) * 0.17) * uMouseIn * uTilt;
      vec2 tilt = clamp(mv * 0.55, vec2(-1.6), vec2(1.6)) * hover * 0.55;

      // projective foreshortening: the side facing the cursor swells towards
      // the viewer, the opposite side compresses away from it
      float w = 1.0 + 0.62 * dot(tilt, local / max(hs, vec2(1.0)));
      local /= max(w, 0.25);
      local *= 1.0 + 0.11 * hover;                    // the slab recedes: zoom out

      float d = sdRound(local, hs, rad);
      float aa = mix(pitch.x * 0.09, 1.6, uFocus);
      float mask = smoothstep(aa, -aa, d);
      float depth = clamp(-d / (hs.x * 0.85), 0.0, 1.0);
      vec2 u = local / hs;

      // ---- finite rounded-rectangle void, identical in every element -----
      // same proportions and corner style as the outer shape
      // fully linear response: the void can grow past the shape itself, so the
      // rim thins out continuously instead of hitting a ceiling
      vec2 voidHalf = max(hs * vec2(uVoidRX, uVoidRY) * 1.575, vec2(2.0));
      float voidRad = min(rad * (voidHalf.x / hs.x), min(voidHalf.x, voidHalf.y) * 0.85);
      float dv = sdRound(local, voidHalf, voidRad);

      // pixel antialias plus a slight uniform softness on the boundary
      float aaV = max(1.25, min(voidHalf.x, voidHalf.y) * 0.02);
      float softV = max(aaV, uVoidSoft * min(voidHalf.x, voidHalf.y) * 0.6);
      float voidOut = clamp(dv / softV + 0.5, 0.0, 1.0);

      if(uDebug > 2.5){
        float line = 1.0 - clamp(abs(dv) / (aaV * 1.6), 0.0, 1.0);   // lens boundary
        gl_FragColor = vec4(vec3(line), 1.0);
        return;
      }

      // ---- lens (lupe) remap ---------------------------------------------
      // inside the rounded-rect boundary the texture is magnified as if seen
      // through a thick glass lens; the last stretch before the rim compresses
      // hard, which is what reads as the glass edge
      vec2 dir = local / max(length(local), 1e-3);
      float r = length(local);
      float boundary = max(r - dv, 1e-3);              // rim distance along the ray
      float sIn = clamp(r / boundary, 0.0, 1.0);
      float z = max(uLupeZoom, 0.05);
      float core = pow(sIn, 1.0 + z * 0.55) / z;      // extreme central blow-up
      float lensS = mix(core, sIn, smoothstep(0.90, 1.0, sIn));
      vec2 insideLocal = dir * lensS * boundary;

      // outside the lens the content still eases outward, unmagnified
      float outerDistance = max(dv, 0.0);
      vec2 outsideLocal = dir * (boundary + outerDistance * uStretch);

      vec2 sourceLocal = mix(insideLocal, outsideLocal, step(0.0, dv));
      vec2 uW = sourceLocal / hs;

      // ---- spherical refraction (Snell through a bulging glass dome) -----
      // the element interior is treated as a sphere: the view ray bends by the
      // dome normal, so the sampled UVs compress hard towards the contour
      vec2 eN = local / hs;
      float rr = min(length(eN), 1.0);
      float zS = sqrt(max(0.0, 1.0 - rr * rr));
      vec3 Nsph = normalize(vec3(eN * uBulge, max(zS, 0.02)));
      vec3 Rr = refract(vec3(0.0, 0.0, -1.0), Nsph, 1.0 / max(uIOR, 1.001));
      // total internal reflection at the grazing rim: fall back to the normal
      Rr = length(Rr) < 0.5 ? vec3(Nsph.xy, -0.4) : Rr;
      float insideLens = 1.0 - step(0.0, dv);
      vec2 sphOff = Rr.xy / max(abs(Rr.z), 0.25) * uSphere * 0.42 * insideLens;
      // barrel magnification from the same dome: centre swells, rim squeezes
      float mag = mix(1.0, 1.0 / (1.0 + uSphere * 1.15), zS * insideLens);
      uW = uW * mag + sphOff;

      // glass edge of the lens: a thin bright ring with a darker shoulder
      float ringW = max(softV * 1.9, aaV * 3.2);
      float ring = 1.0 - clamp(abs(dv) / ringW, 0.0, 1.0);
      ring = pow(ring, 1.6);
      float shoulder = clamp(1.0 - abs(dv - ringW * 1.5) / (ringW * 1.8), 0.0, 1.0);

      // lens normal + height from pass 2
      vec4 hm = texture2D(uHeight, vUv);
      vec3 N = normalize(vec3(hm.rg * 2.0 - 1.0, 1.0));
      float H = hm.b * 1.5;

      // each capsule looks into its own region of the colour texture
      vec2 centre = vec2(0.22 + hash(id + 3.7) * 0.56, 0.22 + hash(id + 61.3) * 0.56);
      vec2 uvBase = centre + uW * 0.072;
      // refraction: swollen, magnified colour seen through a thick gel lens
      float amt = uRefract * (0.085 + 0.110 * (1.0 - depth));
      vec2 uvR = uvBase + N.xy * amt + uW * H * 0.045;

      vec3 col = texture2D(uColor, uvR).rgb;
      // slight chromatic spread along the same refraction direction
      col.r = texture2D(uColor, uvR + N.xy * amt * 0.045).r;
      col.b = texture2D(uColor, uvR - N.xy * amt * 0.045).b;

      // ---- the lens core resolves into a simple gradient ------------------
      // magnifying the full noise grabs every colour at once; instead the
      // centre fades to a two-stop gradient taken from the same texture, so it
      // stays palette-true but calm. Detail survives near the contour.
      vec2 gA = centre + vec2(-0.105, -0.125);
      vec2 gB = centre + vec2( 0.115,  0.135);
      vec3 cA = texture2D(uColor, gA).rgb;
      vec3 cB = texture2D(uColor, gB).rgb;
      float gT = clamp(0.5 + (eN.y * 0.66 + eN.x * 0.30) * 0.5, 0.0, 1.0);
      vec3 grad = mix(cA, cB, smoothstep(0.0, 1.0, gT));
      // the core follows the rounded-rectangle lens field, not a circle, and
      // covers the whole interior: no noise survives inside the glass
      float coreFeather = max(softV * 1.6, aaV * 4.0);
      float lensCore = clamp(-dv / coreFeather, 0.0, 1.0);
      col = mix(col, grad, uLensGrad * lensCore);


      // perimeter: saturated and punchy, no grey overlay
      float lum = dot(col, vec3(0.30, 0.45, 0.25));
      vec3 rimCol = mix(vec3(lum), col, 1.18);
      rimCol = clamp((rimCol - 0.5) * 1.15 + 0.5, 0.0, 4.0) * 0.98;
      col = rimCol;

      // ---- restrained surface layer -------------------------------------
      float dome = sqrt(max(0.0, 1.0 - (1.0 - depth) * (1.0 - depth)));
      float fres = pow(1.0 - clamp(N.z * dome, 0.0, 1.0), 3.0);
      float rim  = smoothstep(0.34, 0.0, depth);

      vec3 L = normalize(vec3(-0.45, -0.70, 0.58));
      float sheen = pow(clamp(dot(N, normalize(L + vec3(0.0, 0.0, 1.0))), 0.0, 1.0), 3.5);

      vec3 inside = col * (1.10 + 0.22 * dome);
      inside *= 1.0 - 0.30 * rim;                       // dark contour
      inside += col * fres * 0.26;                      // soft fresnel edge
      inside += mix(vec3(0.92, 0.91, 0.88), col, 0.55) * sheen * 0.10 * uHilite;
      // one broad, blurred specular near the upper curve (side varies by seed)
      float side = hash(id + 77.1) < 0.5 ? -1.0 : 1.0;
      vec2 sq = (u - vec2(side * 0.42, 0.52)) / vec2(0.52, 0.34);
      float lobe = exp(-dot(sq, sq) * 1.25) * (0.55 + 0.45 * dome);
      inside += mix(vec3(0.90, 0.89, 0.86), col, 0.60) * lobe * 0.16 * uHilite;
      // solid slab: one flat face value across the whole element, from the
      // rigid face normal turning against the fixed light
      vec3 faceN = normalize(vec3(-tilt * 1.9, 1.0));
      float face = clamp(dot(faceN, L) * 0.5 + 0.5, 0.0, 1.0);
      inside *= mix(1.0, 0.62 + 0.95 * face, clamp(hover, 0.0, 1.0));

      // crisp bevel: the edge turned towards the light catches a hard line
      vec2 tdir = tilt / max(length(tilt), 1e-4);
      float edge = smoothstep(0.26, 0.0, depth);
      float lead = clamp(dot(tdir, u), -1.0, 1.0);
      inside += vec3(0.95, 0.94, 0.92) * edge * clamp(lead, 0.0, 1.0) * length(tilt) * 0.55;
      inside *= 1.0 - edge * clamp(-lead, 0.0, 1.0) * length(tilt) * 0.45;
      inside *= 1.0 + hover * 0.10;                    // targeted slab sits forward
      inside *= mix(1.0, 1.06, central);

      // faint outer glow, tinted by what the capsule refracts
      vec3 glow = vec3(0.0);
      for(int j = -1; j <= 1; j++){
        for(int i = -1; i <= 1; i++){
          vec2 nid = id + vec2(float(i), float(j));
          float inB = step(-0.5, nid.x) * step(nid.x, uCols - 0.5)
                    * step(-0.5, nid.y) * step(nid.y, uRows - 0.5);
          float cn = 1.0 - smoothstep(0.0, 1.15, length(nid - off));
          vec2 lp = frag - mid - (nid - off) * pitch;
          float nd = sdRound(lp, hs, rad);
          float gg = exp(-max(nd, 0.0) / mix(hs.x * 0.55, hs.x * 0.30, uFocus)) * inB;
          vec2 nc = vec2(0.22 + hash(nid + 3.7) * 0.56, 0.22 + hash(nid + 61.3) * 0.56);
          glow += texture2D(uColor, nc).rgb * gg * gg * mix(0.85, 1.15, cn);
        }
      }
      glow *= uGlow * mix(0.16, 0.07, uFocus);

      vec3 outCol = glow * (1.0 - mask * 0.85) + inside * mask;

      vec2 sv = (vUv - 0.5) * vec2(uRes.x / max(uRes.y, 1.0), 1.0);
      // vignette: smooth falloff from the centre towards the corners
      float vig = 1.0 - smoothstep(0.18, 0.92, length(sv) / 0.78) * uVignette;
      outCol *= vig * (1.0 - 0.14 * dot(sv, sv));
      outCol += (hash(frag + fract(t)) - 0.5) * 0.012;
      outCol = max(outCol, 0.0);
      outCol = 1.0 - exp(-outCol * 1.30);
      gl_FragColor = vec4(pow(outCol, vec3(0.95)), 1.0);
    }
  `
}
