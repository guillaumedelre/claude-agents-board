// Shaders des astres : surfaces procédurales des planètes, soleil, couronne, disque d'accrétion, étoiles, nébuleuses.
// Les couleurs sortent parfois au-delà de 1 : le bloom (optionnel) ne fait briller que ces zones.
import * as THREE from "three"
import type { StationId } from "./map"

// Bruit de valeur 3D et fbm, assez pour des surfaces qui bougent doucement
const NOISE = /* glsl */ `
float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float noise3(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
float fbm(vec3 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * noise3(p); p *= 2.03; a *= 0.5; }
  return s;
}
// Distance au centre de cellule le plus proche (cratères, facettes)
float cells(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  float d = 1.0;
  for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 o = vec3(hash3(i + g), hash3(i + g + 17.0), hash3(i + g + 41.0));
    d = min(d, length(g + o - f));
  }
  return d;
}
`

const SPHERE_VERTEX = /* glsl */ `
varying vec3 vObj;
varying vec3 vNormal;
varying vec3 vWorld;
varying vec2 vUv;
void main() {
  vObj = normalize(position);
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`

// Une surface par station : la forme dit ce qu'est la planète, même sans icône
export const KIND: Record<StationId, number> = { model: 0, memory: 1, files: 2, shell: 3, web: 4, browser: 5, skills: 6, hooks: 7, agents: 8, you: 0 }

const PLANET_FRAGMENT = /* glsl */ `
uniform int kind;
uniform float time;
uniform float heat;
uniform float alarm;
uniform float worn;
uniform vec3 base;
uniform vec3 accent;
uniform vec3 atmosphere;
uniform vec3 sun;
uniform sampler2D icon;
uniform vec3 iconColor;
uniform float ground;
varying vec3 vObj;
varying vec3 vNormal;
varying vec3 vWorld;
varying vec2 vUv;
${NOISE}
void main() {
  vec3 p = vObj;
  vec3 col = base;
  float glow = 0.0;
  if (kind == 0) {
    // Cœur pulsant : veines en fusion qui battent avec l'activité
    float v = fbm(p * 3.0 + vec3(0.0, time * 0.15, 0.0));
    float veins = smoothstep(0.48, 0.52, v) - smoothstep(0.52, 0.6, v);
    col = mix(base * 0.5, accent, smoothstep(0.35, 0.7, v));
    glow = veins * (0.6 + 1.6 * heat * (0.6 + 0.4 * sin(time * 5.0)));
  } else if (kind == 1) {
    // Glace : plaques claires et fissures fines
    float r = 1.0 - abs(fbm(p * 4.0) * 2.0 - 1.0);
    col = mix(base, vec3(0.92, 0.98, 1.0), smoothstep(0.55, 0.95, fbm(p * 2.0 + 3.0)));
    col = mix(col, base * 0.55, smoothstep(0.86, 0.96, r));
  } else if (kind == 2) {
    // Roche à cratères
    float d = cells(p * 3.5);
    float rim = smoothstep(0.32, 0.36, d) - smoothstep(0.36, 0.42, d);
    col = base * (0.75 + 0.35 * fbm(p * 6.0));
    col *= mix(0.7, 1.0, smoothstep(0.2, 0.34, d));
    col += rim * 0.12;
  } else if (kind == 3) {
    // Terminal : surface sombre striée de lignes qui défilent
    float lines = step(0.55, fract(p.y * 18.0 - time * 0.4)) * step(0.35, noise3(vec3(floor(p.y * 18.0), floor(p.x * 6.0 + time * 0.6), 0.0)));
    col = base * 0.45;
    glow = lines * (0.25 + 1.2 * heat);
    col += accent * lines * 0.35;
  } else if (kind == 4) {
    // Géante gazeuse à bandes tourbillonnantes
    float b = sin(p.y * 9.0 + fbm(p * 3.0 + vec3(time * 0.05, 0.0, 0.0)) * 3.0);
    col = mix(base, accent, 0.5 + 0.5 * b);
    col *= 0.85 + 0.25 * fbm(p * 8.0);
  } else if (kind == 5) {
    // Océan et continents
    float land = fbm(p * 2.5 + 7.0);
    vec3 sea = vec3(0.12, 0.32, 0.55);
    col = mix(sea, mix(vec3(0.35, 0.5, 0.25), vec3(0.6, 0.5, 0.32), fbm(p * 6.0)), smoothstep(0.5, 0.53, land));
  } else if (kind == 6) {
    // Cristal : facettes et éclats
    float d = cells(p * 4.0);
    col = mix(base, accent, d);
    glow = pow(1.0 - d, 8.0) * (0.4 + 0.6 * sin(time * 3.0 + d * 20.0)) * (0.4 + heat);
  } else if (kind == 7) {
    // Métal brossé
    float brush = noise3(vec3(p.y * 60.0, p.x * 2.0, p.z * 2.0));
    col = base * (0.7 + 0.35 * brush);
  } else {
    // Agents : géante pâle, l'anneau est dessiné à part
    col = mix(base, accent, 0.25 + 0.25 * sin(p.y * 6.0 + fbm(p * 2.0) * 2.0));
  }
  // Icône gravée sur une face : elle passe devant quand la planète tourne sur elle-même
  vec2 iu = vec2((vUv.x - 0.42) / 0.16, (vUv.y - 0.34) / 0.32);
  if (iu.x > 0.0 && iu.x < 1.0 && iu.y > 0.0 && iu.y < 1.0) {
    float a = texture2D(icon, iu).a;
    col = mix(col, iconColor, a * 0.9);
    glow += a * 0.25 * heat;
  }
  vec3 n = normalize(vNormal);
  vec3 l = normalize(sun - vWorld);
  vec3 v = normalize(cameraPosition - vWorld);
  // Thème sombre : lumière contrastée venue du soleil ; thème clair : ambiance forte et ombres douces, pour rester lisible
  float facing = max(dot(n, l), 0.0);
  float diffuse = mix(0.25 + 0.75 * facing, 0.72 + 0.28 * facing, ground);
  vec3 lit = col * diffuse;
  // Usure : une braise reste sur les planètes qui ont beaucoup servi
  lit += accent * worn * 0.12;
  // Atmosphère : un liseré qui s'avive et respire pendant un appel
  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  float breath = heat > 0.0 ? 0.75 + 0.25 * sin(time * 4.0) : 1.0;
  lit += atmosphere * rim * (0.45 + 1.4 * heat * breath) * (1.0 - 0.45 * ground);
  lit += accent * glow;
  // Erreur : des fissures rouges qui vacillent
  float crack = smoothstep(0.9, 0.97, 1.0 - abs(fbm(p * 5.0 + 11.0) * 2.0 - 1.0));
  lit = mix(lit, vec3(2.2, 0.35, 0.25), crack * alarm * (0.55 + 0.45 * step(0.0, sin(time * 22.0))));
  // Fond clair : couleurs légèrement éclaircies et saturées, sans virer au pastel
  lit = mix(lit, lit * 1.12 + 0.04, ground);
  gl_FragColor = vec4(lit, 1.0);
}
`

// Soleil, inspiré de « Matrix Galaxy » (andrewray, ShaderFrog) : fond indigo-violet traversé de traînées
// magenta, rouges et vertes qui tourbillonnent, caractères clairs sur toute la surface, bosses de Voronoi,
// rendu brillant (reflet et liseré). Code écrit pour ce projet.
export const SUN_VERTEX = /* glsl */ `
uniform float time;
uniform float bumps;
varying vec3 vObj;
varying vec3 vNormal;
varying vec3 vWorld;
varying vec2 vUv;
varying float vCell;
varying vec3 vSmooth;
${NOISE}
float bump(vec3 n) { return 1.0 - cells(n * 2.6 + vec3(0.0, time * 0.04, 0.0)); }
void main() {
  vec3 n = normalize(position);
  vObj = n;
  vUv = uv;
  float h = bump(n);
  vCell = h;
  // Normale de la surface bosselée, par différences finies le long de deux tangentes
  vec3 t1 = normalize(cross(n, abs(n.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 t2 = cross(n, t1);
  float e = 0.03;
  float r = length(position);
  vec3 p0 = n * (r + h * bumps);
  vec3 n1 = normalize(n + t1 * e);
  vec3 n2 = normalize(n + t2 * e);
  vec3 p1 = n1 * (r + bump(n1) * bumps);
  vec3 p2 = n2 * (r + bump(n2) * bumps);
  vec3 bent = normalize(cross(p1 - p0, p2 - p0));
  if (dot(bent, n) < 0.0) bent = -bent;
  vec4 w = modelMatrix * vec4(p0, 1.0);
  vWorld = w.xyz;
  vNormal = normalize(mat3(modelMatrix) * bent);
  vSmooth = normalize(mat3(modelMatrix) * n);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`

export const SUN_FRAGMENT = /* glsl */ `
uniform float time;
uniform float activity;
uniform float attention;
uniform float brightness;
uniform float light;
uniform vec3 amber;
varying vec3 vObj;
varying vec3 vNormal;
varying vec3 vWorld;
varying vec2 vUv;
varying float vCell;
varying vec3 vSmooth;
${NOISE}
vec3 swirl(vec3 p, float a) {
  float k = a * (1.2 - abs(p.y));
  float c = cos(k), s = sin(k);
  return vec3(c * p.x - s * p.z, p.y, s * p.x + c * p.z);
}
// Caractères 3×5 (une ligne de 3 bits par rang, du haut vers le bas) : les dix chiffres, puis douze katakana
// demi-largeur retournés en miroir comme dans la pluie de Matrix (ﾃ ﾆ ﾐ ｷ ｼ ﾘ ﾊ ｸ ｻ ﾅ ｴ ﾂ)
const int GLYPHS[22] = int[22](
  31599, 11415, 29671, 29647, 23497, 31183, 31215, 29257, 31727, 31695,
  29137, 28679, 14563, 11962, 22627, 23394, 1389, 27409, 24418, 29841, 29847, 23331);
float glyph(vec2 cell, vec2 f, float t) {
  if (f.x < 0.2 || f.x > 0.8 || f.y < 0.12 || f.y > 0.88) return 0.0;
  ivec2 g = ivec2(floor((f - vec2(0.2, 0.12)) / vec2(0.6, 0.76) * vec2(3.0, 5.0)));
  int code = GLYPHS[int(floor(hash3(vec3(cell * 1.31, floor(t))) * 21.99))];
  return float((code >> (g.y * 3 + (2 - g.x))) & 1);
}
// Bruit doux à trois octaves : de larges traînées, sans grain fin
float fbmSoft(vec3 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) { s += a * noise3(p); p *= 2.0; a *= 0.5; }
  return s / 0.875;
}
void main() {
  float speed = 0.05 + 0.2 * activity;
  // Traînées de galaxie : domaine déformé puis étiré dans le sens de la rotation
  vec3 p = swirl(vObj, time * speed * 1.5 + 3.0);
  vec3 q = vec3(fbmSoft(p * 1.2 + time * speed), fbmSoft(p * 1.2 - time * speed + 4.3), fbmSoft(p * 1.2 + 8.1));
  float streak = fbmSoft(vec3(p.x * 0.9, p.y * 3.0, p.z * 0.9) + q * 1.8);
  // Thème clair : la palette lumineuse de la référence (bleu-indigo vif) ; thème sombre : plus profonde
  vec3 indigo = mix(vec3(0.07, 0.06, 0.3), vec3(0.2, 0.26, 0.82), light);
  vec3 violet = mix(vec3(0.28, 0.12, 0.6), vec3(0.45, 0.3, 0.92), light);
  vec3 magenta = mix(vec3(0.85, 0.18, 0.5), vec3(0.98, 0.32, 0.62), light);
  vec3 red = mix(vec3(0.9, 0.25, 0.2), vec3(1.0, 0.38, 0.32), light);
  vec3 green = mix(vec3(0.15, 0.72, 0.36), vec3(0.25, 0.85, 0.5), light);
  vec3 col = mix(indigo, violet, smoothstep(0.3, 0.6, q.x));
  col = mix(col, magenta, smoothstep(0.55, 0.72, streak) * 0.85);
  col = mix(col, red, smoothstep(0.66, 0.8, streak) * 0.7);
  col = mix(col, green, smoothstep(0.7, 0.82, q.z) * 0.6);
  // La session qui t'attend vire à l'ambre
  col = mix(col, amber * 0.9, attention * 0.55);
  // Pluie de caractères : par colonne, une tête claire qui tombe et une traîne qui s'efface derrière elle
  vec2 grid = vec2(24.0, 16.0);
  vec2 uv = vUv * grid;
  vec2 cell = floor(uv);
  float column = cell.x;
  float rate = (0.5 + hash3(vec3(column, 1.0, 7.0))) * (0.2 + 0.8 * activity);
  float head = fract(-time * rate * 0.12 + hash3(vec3(column, 2.0, 5.0)));
  float behind = fract((cell.y + 0.5) / grid.y - head);
  float tail = 1.0 - smoothstep(0.0, 0.5, behind);
  float isHead = 1.0 - smoothstep(0.0, 1.0 / grid.y, behind);
  float g = glyph(cell, fract(uv), time * (1.0 + 4.0 * activity) + column * 0.37 + cell.y);
  vec3 ink = mix(vec3(0.95, 0.55, 0.85), vec3(1.0, 0.95, 1.0), isHead);
  // Pas de caractères près des pôles, où la grille se resserre
  float band = 1.0 - smoothstep(0.75, 0.9, abs(vObj.y));
  col = mix(col, ink, g * tail * band * (0.8 + 0.2 * activity));
  // Rendu brillant : lumière, reflet spéculaire, liseré bleuté
  vec3 n = normalize(vNormal);
  vec3 v = normalize(cameraPosition - vWorld);
  vec3 l = normalize(vec3(0.4, 0.9, 0.5));
  float diffuse = mix(0.55 + 0.45 * max(dot(n, l), 0.0), 0.82 + 0.18 * max(dot(n, l), 0.0), light);
  float rim = pow(1.0 - max(dot(n, v), 0.0), 2.5);
  col = col * diffuse * (0.7 + 0.4 * vCell) + vec3(0.6, 0.65, 1.0) * rim * mix(0.3, 0.55, light);
  // Rendu vitreux en thème clair : reflet doux du ciel et petit reflet net, calculés sur la normale lisse
  vec3 s = normalize(vSmooth);
  float sky = pow(max(dot(reflect(-v, s), vec3(0.0, 1.0, 0.0)), 0.0), 6.0);
  float glint = pow(max(dot(reflect(-l, s), v), 0.0), 80.0);
  col += light * (vec3(0.85, 0.92, 1.0) * sky * 0.35 + vec3(1.0) * glint * 0.6);
  gl_FragColor = vec4(col * (0.85 + 0.25 * activity) * brightness, 1.0);
}
`

// Couronne : coquille additive plus large que le soleil, avec des jets qui varient
export const CORONA_FRAGMENT = /* glsl */ `
uniform float time;
uniform float activity;
uniform float brightness;
uniform vec3 color;
varying vec3 vObj;
varying vec3 vNormal;
varying vec3 vWorld;
${NOISE}
void main() {
  vec3 v = normalize(cameraPosition - vWorld);
  float rim = 1.0 - abs(dot(normalize(vNormal), v));
  float jets = fbm(vObj * 5.0 + vec3(0.0, time * (0.2 + 0.5 * activity), 0.0));
  float a = pow(rim, 2.5) * (0.35 + 0.9 * jets) * (0.5 + 0.8 * activity);
  gl_FragColor = vec4(color * 1.8 * brightness, a * brightness);
}
`

// Disque d'accrétion de Toi : plan horizontal, donc déformé par la perspective comme le reste
export const DISK_VERTEX = /* glsl */ `
varying vec2 vPos;
void main() {
  vPos = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

export const DISK_FRAGMENT = /* glsl */ `
uniform float time;
uniform float inner;
uniform float outer;
uniform vec3 color;
uniform float boost;
varying vec2 vPos;
${NOISE}
void main() {
  float r = length(vPos);
  if (r < inner || r > outer) discard;
  float t = (r - inner) / (outer - inner);
  float a = atan(vPos.y, vPos.x);
  // Spirales qui tournent plus vite près du centre
  float swirl = fbm(vec3(cos(a - time * (0.6 / (0.3 + t))) * 2.0, sin(a - time * (0.6 / (0.3 + t))) * 2.0, r * 3.0));
  float glow = pow(1.0 - t, 2.2) * (0.5 + 0.8 * swirl);
  float alpha = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.75, 1.0, t)) * glow;
  gl_FragColor = vec4(color * (1.0 + 1.5 * boost) * (0.6 + glow), alpha);
}
`

// Anneau de la planète Agents : bandes concentriques
export const RING_FRAGMENT = /* glsl */ `
uniform float inner;
uniform float outer;
uniform vec3 color;
varying vec2 vPos;
${NOISE}
void main() {
  float r = length(vPos);
  if (r < inner || r > outer) discard;
  float t = (r - inner) / (outer - inner);
  float bands = 0.5 + 0.5 * sin(t * 40.0 + noise3(vec3(t * 12.0, 0.0, 0.0)) * 4.0);
  float alpha = (0.15 + 0.35 * bands) * smoothstep(0.0, 0.1, t) * (1.0 - smoothstep(0.85, 1.0, t));
  gl_FragColor = vec4(color, alpha);
}
`

// Étoiles qui scintillent, chacune à sa phase
export const STAR_VERTEX = /* glsl */ `
attribute float phase;
uniform float time;
uniform float size;
varying float vTwinkle;
void main() {
  vTwinkle = 0.55 + 0.45 * sin(time * (0.6 + fract(phase * 7.0) * 2.0) + phase * 6.2831);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * (0.6 + fract(phase * 13.0)) * (300.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}
`

export const STAR_FRAGMENT = /* glsl */ `
uniform vec3 color;
varying float vTwinkle;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  gl_FragColor = vec4(color * vTwinkle, (1.0 - d * 2.0) * vTwinkle);
}
`

export { SPHERE_VERTEX, PLANET_FRAGMENT }

// Icônes des stations en texture (blanc sur transparent), une fois pour toutes
const iconCache = new Map<string, THREE.CanvasTexture>()

export function iconTexture(path: string) {
  let tex = iconCache.get(path)
  if (tex) return tex
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = 128
  const ctx = canvas.getContext("2d")!
  ctx.translate(64, 64)
  ctx.scale(4.2, 4.2)
  ctx.strokeStyle = "#fff"
  ctx.lineWidth = 1.7
  ctx.lineCap = "round"
  ctx.lineJoin = "round"
  ctx.stroke(new Path2D(path))
  tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.NoColorSpace
  iconCache.set(path, tex)
  return tex
}

type PlanetUniforms = {
  time: { value: number }
  heat: { value: number }
  alarm: { value: number }
  worn: { value: number }
  sun: { value: THREE.Vector3 }
}

// Réglage des uniforms d'une planète à chaque image, par sa référence
export function setPlanet(mesh: THREE.Mesh | null, values: { time: number; heat: number; alarm: number; worn: number; sun: THREE.Vector3 }) {
  if (!mesh) return
  const u = (mesh.material as THREE.ShaderMaterial).uniforms as unknown as PlanetUniforms
  u.time.value = values.time
  u.heat.value = values.heat
  u.alarm.value = values.alarm
  u.worn.value = values.worn
  u.sun.value.copy(values.sun)
}


// Liaison soleil-planète en particules lumineuses (à la manière d'un nœud torique en points) :
// les grains avancent du soleil vers la planète en spirale autour de l'axe
export const FLOW_VERTEX = /* glsl */ `
attribute float along;
attribute float angle;
attribute float spread;
uniform vec3 from;
uniform vec3 to;
uniform float time;
uniform float speed;
uniform float radius;
uniform float size;
varying float vEdge;
void main() {
  float t = fract(along + time * speed);
  vec3 dir = to - from;
  vec3 d = normalize(dir);
  vec3 up = abs(d.y) > 0.95 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 n1 = normalize(cross(d, up));
  vec3 n2 = cross(d, n1);
  float a = angle + t * 9.0;
  vec3 p = from + dir * t + (cos(a) * n1 + sin(a) * n2) * radius * spread;
  // Les grains naissent et meurent en douceur aux deux bouts
  vEdge = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.9, 1.0, t));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = size * (300.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}
`

export const FLOW_FRAGMENT = /* glsl */ `
uniform vec3 color;
uniform float intensity;
uniform float light;
uniform float density;
varying float vEdge;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  // Sprite à dégradé radial : cœur blanc, halo de la couleur, bord transparent
  float core = 1.0 - smoothstep(0.0, 0.25, d);
  float halo = 1.0 - smoothstep(0.15, 1.0, d);
  // Thème clair : teinte éclaircie (l'orange de la palette claire est foncé), sans cœur blanc
  vec3 col = mix(mix(color, vec3(1.0, 0.92, 0.8), 0.35 * light), vec3(1.0), core * (1.0 - light));
  float a = (halo * 0.55 + core * 0.6) * vEdge * intensity;
  // Les grains restent sous 1 : le halo ne les élargit plus
  // En mélange additif, les grains superposés s'additionnent : plus le faisceau est dense, plus chaque grain est léger
  // Thème clair (mélange normal) : couleur pleine, sinon les grains virent au marron
  gl_FragColor = vec4(col * min(mix(0.6 + 0.3 * intensity, 1.0, light), 0.98), a * 0.85 * density);
}
`

// Fond de l'espace : nébuleuse en nuages colorés très lents et champ d'étoiles fines, derrière tout le reste.
// Les couleurs restent sous 1 : le halo ne s'y accroche pas.
export const SKY_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

export const SKY_FRAGMENT = /* glsl */ `
uniform float time;
uniform vec3 ground;
uniform vec3 tintA;
uniform vec3 tintB;
uniform vec3 tintC;
uniform vec3 starColor;
uniform float strength;
varying vec3 vDir;
${NOISE}
// Étoiles : une chance sur cinquante par cellule de direction, point fin qui scintille doucement
float stars(vec3 d, float scale, float density) {
  vec3 g = d * scale;
  vec3 cell = floor(g);
  float r = hash3(cell);
  if (r > density) return 0.0;
  vec3 center = cell + vec3(hash3(cell + 1.7), hash3(cell + 3.1), hash3(cell + 5.3));
  float dist = length(g - center);
  float twinkle = 0.65 + 0.35 * sin(time * (0.5 + r * 40.0) + r * 300.0);
  return smoothstep(0.35, 0.0, dist) * twinkle * (0.4 + 0.6 * fract(r * 97.0));
}
void main() {
  vec3 d = normalize(vDir);
  // Nuages : deux couches de bruit qui dérivent très lentement
  float a = fbm(d * 2.2 + vec3(time * 0.004, 0.0, time * 0.003));
  float b = fbm(d * 4.5 - vec3(0.0, time * 0.003, time * 0.002) + 8.0);
  float clouds = smoothstep(0.38, 0.85, a);
  float filaments = smoothstep(0.55, 0.85, b) * clouds;
  // Bande galactique inclinée, plus dense en nuages et en étoiles
  float band = exp(-pow(dot(d, normalize(vec3(0.25, 1.0, 0.35))) * 2.6, 2.0));
  vec3 neb = mix(tintA, tintB, smoothstep(0.3, 0.8, b));
  neb = mix(neb, tintC, filaments);
  float amount = strength * (0.55 * clouds + 0.35 * band * (0.5 + 0.5 * a) + 0.25 * filaments);
  vec3 col = mix(ground, neb, clamp(amount, 0.0, 0.9));
  float s = stars(d, 160.0, 0.035 + 0.05 * band) + 0.7 * stars(d, 380.0, 0.03 + 0.06 * band);
  col += starColor * s;
  col += (hash3(d * 512.0 + time) - 0.5) / 255.0;
  gl_FragColor = vec4(min(col, vec3(0.95)), 1.0);
}
`
