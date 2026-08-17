/*
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Reward-rate row aura — renders each panel row's near-black fill, semantic
 * grade colouring, corner accents, and grade-driven motion treatments. One
 * shared MultiPipeline instance serves all rows; each row feeds uniforms
 * through RewardRatePipelineData at batch time.
 *
 * Motion budget (spec): pulse alpha <= 0.06, rainbow cycle >= 5 s, no
 * flashing; reducedMotion freezes every time-varying term at t = 0.
 */

#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform sampler2D uMainSampler[%count%];
uniform float time;

varying vec2 outTexCoord;
varying float outTexId;
varying vec2 outPosition;
varying float outTintEffect;
varying vec4 outTint;

uniform float uRate;
uniform float uRateCap;
uniform float uSemanticHue;
uniform float uVisualGrade;
uniform float uPhaseOffset;
uniform float uReducedMotion;

// Cheap hue-wheel used by the Luminous rainbow — cycles like HSV(0..1, ~.8, 1).
vec3 wheelColor(float t) {
    vec3 p = abs(fract(vec3(t) + vec3(0.0, 0.6667, 0.3333)) * 6.0 - 3.0);
    return clamp(p - 1.0, 0.0, 1.0);
}

// Narrow band around the row's semantic hue (Ember / Crimson / Prismatic+).
vec3 hueBand(float hue, float t) {
    float h = fract((hue + sin(t * 1.88496) * 9.0) / 360.0); // ±9° wobble, ~3.3 s
    vec3 p = abs(fract(vec3(h) + vec3(0.0, 0.6667, 0.3333)) * 6.0 - 3.0);
    return 0.35 + 0.65 * clamp(p - 1.0, 0.0, 1.0);
}

void main(void) {
    // Same convention as sprite-frag-shader: each flushed batch binds its own
    // texture at unit 0, and WebGL1 %count% indexing disallows varying indices.
    vec4 tex = texture2D(uMainSampler[0], outTexCoord);
    if (tex.a <= 0.0039) {
        discard;
    }

    float t = mix(time, 0.0, uReducedMotion);
    vec2 uv = outTexCoord;
    float rateRatio = clamp(uRate / max(uRateCap, 1.0), 0.0, 1.0);
    float grade = uVisualGrade;

    // Near-black fill at alpha .78 — glyphs are alpha-holes so the artwork shows through.
    vec3 col = mix(vec3(0.043, 0.039, 0.067), vec3(0.078, 0.071, 0.114), uv.y);

    // Grade aura: edge falloff stops before v = 0/1 so separator pixels stay pure.
    float edge = pow(abs(uv.x - 0.5) * 2.0, 3.5);
    float auraStrength = (0.04 + rateRatio * 0.10) * step(2.0, grade);
    float pulse = 1.0 + 0.06 * sin(t * 2.0 + uPhaseOffset);
    float isLuminous = 1.0 - min(abs(grade - 9.0), 1.0); // 1.0 only at grade 9
    float isEclipse = step(10.5, grade);                 // 1.0 only at grade 11 (x50 cap)
    vec3 semantic = hueBand(uSemanticHue, t + uPhaseOffset);
    vec3 auraColor = mix(semantic, wheelColor(fract(t / 5.0 + uPhaseOffset * 0.11)), isLuminous);
    col = mix(col, auraColor, edge * auraStrength * pulse);

    // Corner accents (grade >= 6, x10+): corner glow, separate from the edge aura.
    float cornerFn = pow(length(max(abs(uv - 0.5) * 2.0 - vec2(0.55, 0.20), vec2(0.0))) * 1.6, 3.0);
    float cornerGlow = (1.0 - clamp(cornerFn, 0.0, 1.0)) * step(6.0, grade);
    col = mix(col, auraColor, cornerGlow * 0.14);

    // Luminous (grade 9): slow traveling sparkle, max mix alpha .06 (≤60ms perceptual).
    float sparkBand = smoothstep(0.965, 1.0, fract(uv.x * 3.0 - t * 0.14 + uPhaseOffset * 0.17));
    col = mix(col, auraColor, sparkBand * isLuminous * 0.06);

    // Stellar (grade 10, x40-49): cool sheen drifting across the row (frozen under reduced motion).
    float sheenX = fract(uv.x - t * 0.045 + uPhaseOffset * 0.05);
    float sheen = smoothstep(0.94, 1.0, sheenX) * (1.0 - min(abs(grade - 10.0), 1.0));
    col += vec3(0.20, 0.30, 0.42) * sheen;

    // Eclipse (grade 11, x50): dark core + violet rim.
    vec3 eclipseRim = vec3(0.455, 0.408, 0.973); // #7468f8
    col = mix(col, vec3(0.031, 0.027, 0.059), isEclipse * 0.85);
    col = mix(col, eclipseRim, isEclipse * edge * 0.16);

    gl_FragColor = vec4(col * outTint.rgb, tex.a * outTint.a);
}
