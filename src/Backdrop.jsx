import React, { useEffect, useRef } from "react";

/* ------------------------------------------------------------------ */
/*  Backdrop — a soft wash of the palette's accent from the top-left    */
/*  corner of the content, fading into the page colour, so the          */
/*  background isn't flat. Nothing in the middle, nothing moving:       */
/*  students shouldn't be distracted.                                   */
/*                                                                      */
/*  Drawn in WebGL (with a touch of dither, so the long dark fade has   */
/*  no bands), once, and again only on resize or a palette/mode change. */
/*  Decoration only: no pointer events, hidden from assistive tech.     */
/*  Without WebGL the page keeps its plain colour.                      */
/* ------------------------------------------------------------------ */

const VERT = "attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}";

const FRAG = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 R;uniform float L0,RAD,GA;uniform vec3 BG,G;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
void main(){
  /* measured from the content's top-left corner (right of the sidebar or rail, L0 wide) */
  vec2 q=(gl_FragCoord.xy-vec2(L0,R.y))/RAD;
  /* a little wider than tall, strongest in the corner, a long soft tail */
  float w=1.-smoothstep(0.,1.,length(q*vec2(.75,1.)));w*=w;
  gl_FragColor=vec4(mix(BG,G,w*GA)+(hash(gl_FragCoord.xy)-.5)*.006,1.);}`;

function hexToRgb(v) {
  const s = (v || "").trim();
  const m = /^#?([0-9a-f]{6})$/i.exec(s);
  if (!m) return [0.5, 0.5, 0.5];
  const n = parseInt(m[1], 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function readColours() {
  const cs = getComputedStyle(document.documentElement);
  const bg = hexToRgb(cs.getPropertyValue("--bg"));
  const dark = cs.getPropertyValue("color-scheme").includes("dark") || (bg[0] + bg[1] + bg[2]) / 3 < 0.35;
  return { bg, dark, accent: hexToRgb(cs.getPropertyValue("--accent")) };
}

/* left: the width (CSS px) of the navigation on the left, so the wash
   starts at the content's corner rather than behind the sidebar or rail */
export default function Backdrop({ left = 0 }) {
  const ref = useRef(null);
  const leftRef = useRef(left);
  const redrawRef = useRef(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return undefined;
    const gl = cv.getContext("webgl", { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: "low-power", preserveDrawingBuffer: true });
    if (!gl) { cv.style.display = "none"; return undefined; }

    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { cv.style.display = "none"; return undefined; }
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "a");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = Object.fromEntries(["R", "L0", "RAD", "GA", "BG", "G"].map((n) => [n, gl.getUniformLocation(prog, n)]));

    let pending = 0;
    const draw = () => {
      pending = 0;
      // half resolution is plenty for something this soft
      const scale = 0.5 * Math.min(1.5, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(window.innerWidth * scale));
      const h = Math.max(1, Math.round(window.innerHeight * scale));
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      gl.viewport(0, 0, w, h);
      const c = readColours();
      const l0 = Math.min(w - 1, leftRef.current * scale);
      gl.uniform2f(U.R, w, h);
      gl.uniform1f(U.L0, l0);
      // how far the wash reaches: most of a phone's width, at most 620px on a big screen
      gl.uniform1f(U.RAD, Math.max(1, Math.min((w - l0) * 0.9, h * 0.8, 620 * scale)));
      gl.uniform3fv(U.BG, c.bg);
      gl.uniform3fv(U.G, c.accent);
      // how strong it is in the corner: soft, never bright
      gl.uniform1f(U.GA, c.dark ? 0.2 : 0.12);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const redraw = () => { if (!pending) pending = requestAnimationFrame(draw); };
    redrawRef.current = redraw;

    // palette, mode, or the device's light/dark changing: draw it again in the new colours
    const mo = new MutationObserver(redraw);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-palette"] });
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    mq?.addEventListener("change", redraw);
    window.addEventListener("resize", redraw);

    draw();
    return () => {
      cancelAnimationFrame(pending);
      mo.disconnect();
      mq?.removeEventListener("change", redraw);
      window.removeEventListener("resize", redraw);
    };
  }, []);

  // the navigation appearing, or switching between rail and sidebar
  useEffect(() => { leftRef.current = left; redrawRef.current?.(); }, [left]);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh", zIndex: 0, pointerEvents: "none", display: "block" }}
    />
  );
}
