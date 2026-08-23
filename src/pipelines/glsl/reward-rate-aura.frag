/*
 * SPDX-FileCopyrightText: 2026 Pagefault Games
 *
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

// Narrow band around the row's semantic hue.
vec3 hueBand(float hue, float t) {
    float h = fract((hue + sin(t * 1.25664) * 9.0) / 360.0);
    vec3 p = abs(fract(vec3(h) + vec3(0.0, 0.6667, 0.3333)) * 6.0 - 3.0);
    return 0.35 + 0.65 * clamp(p - 1.0, 0.0, 1.0);
}

float gradeBand(float grade, float target) {
    return step(target - 0.5, grade) * (1.0 - step(target + 0.5, grade));
}

float pointGlow(vec2 uv, vec2 center, float radius) {
    return 1.0 - smoothstep(0.0, radius, distance(uv, center));
}

void main(void) {
    // Same convention as sprite-frag-shader: each flushed batch binds its own
    // texture at unit 0, and WebGL1 %count% indexing disallows varying indices.
    vec4 tex = texture2D(uMainSampler[0], outTexCoord);
    if (tex.a <= 0.0039) {
        discard;
    }

    float motion = 1.0 - uReducedMotion;
    float t = time * motion;
    vec2 uv = outTexCoord;
    float normalizedRate = clamp((uRate - 1.0) / max(uRateCap - 1.0, 1.0), 0.0, 1.0);
    float grade = uVisualGrade;
    vec3 semantic = hueBand(uSemanticHue, t + uPhaseOffset);
    vec3 rainbow = wheelColor(fract(t / 5.0 + uv.x * 0.16 + uPhaseOffset * 0.11));
    vec3 highColor = mix(semantic, rainbow, 0.62);

    // The panel frame supplies the stable silhouette; row fills stay translucent.
    vec3 col = mix(vec3(0.043, 0.039, 0.067), vec3(0.078, 0.071, 0.114), uv.y);

    // Static edge strength increases with the integer magnitude.
    float edge = pow(abs(uv.x - 0.5) * 2.0, 3.5);
    float staticAura = step(2.0, grade) * (0.035 + normalizedRate * 0.115);
    col = mix(col, semantic, edge * staticAura);

    // x4-5: a restrained four-second sheen.
    float sheenPhase = fract(uv.x - t * 0.25 + uPhaseOffset * 0.07);
    float sheen = smoothstep(0.90, 0.98, sheenPhase) * (1.0 - smoothstep(0.98, 1.0, sheenPhase));
    col += semantic * sheen * gradeBand(grade, 4.0) * 0.055;

    // x6-9: at most a .06 alpha pulse plus one slow mote.
    float pulse = (0.5 + 0.5 * sin(t * 1.25664 + uPhaseOffset)) * gradeBand(grade, 5.0);
    col = mix(col, semantic, pulse * 0.06);
    vec2 moteCenter = vec2(fract(t * 0.055 + uPhaseOffset * 0.13), 0.28 + 0.30 * sin(t * 0.7 + uPhaseOffset));
    col += semantic * pointGlow(uv, moteCenter, 0.045) * gradeBand(grade, 5.0) * 0.10;

    // x10-14: moving edge highlight and two sparse sparks.
    float movingEdge = smoothstep(0.93, 1.0, fract(uv.x - t * 0.12 + uPhaseOffset * 0.09)) * edge;
    float emberBand = gradeBand(grade, 6.0);
    col += semantic * movingEdge * emberBand * 0.12;
    col += semantic * pointGlow(uv, vec2(fract(t * 0.07 + uPhaseOffset), 0.22), 0.035) * emberBand * 0.12;
    col += semantic * pointGlow(uv, vec2(fract(0.65 - t * 0.05 + uPhaseOffset), 0.78), 0.035) * emberBand * 0.12;

    // x15-19: stronger edge bloom with a slow energy flow.
    float crimsonBand = gradeBand(grade, 7.0);
    float energy = 0.5 + 0.5 * sin(uv.x * 12.566 + t * 0.9 + uPhaseOffset);
    col = mix(col, semantic, edge * crimsonBand * (0.10 + energy * 0.08));

    // x20-29: dual-colour edge with a one-logical-pixel-equivalent fringe.
    float magentaBand = gradeBand(grade, 8.0);
    vec3 companion = wheelColor(fract(uSemanticHue / 360.0 + 0.12));
    float leftEdge = pow(1.0 - uv.x, 5.0);
    float rightEdge = pow(uv.x, 5.0);
    col = mix(col, semantic, leftEdge * magentaBand * 0.16);
    col = mix(col, companion, rightEdge * magentaBand * 0.16);

    // x30-49: semantic-prismatic blend, slow rainbow sweep, sparse star motes.
    float prismaticBand = step(8.5, grade) * (1.0 - step(10.5, grade));
    float sweep = 0.5 + 0.5 * sin(uv.x * 6.283 + t * 1.25664 + uPhaseOffset);
    col = mix(col, highColor, edge * prismaticBand * (0.10 + sweep * 0.08));
    float stars = pointGlow(uv, vec2(fract(t * 0.035 + uPhaseOffset), 0.24), 0.028)
        + pointGlow(uv, vec2(fract(0.72 - t * 0.025 + uPhaseOffset), 0.76), 0.028);
    col += highColor * stars * prismaticBand * 0.13;

    // x40-49: white-hot edge and a cool aurora fringe; the panel adds its double rim.
    float stellarBand = gradeBand(grade, 10.0);
    col = mix(col, vec3(0.94, 0.98, 1.0), edge * stellarBand * 0.20);
    col += highColor * (0.5 + 0.5 * sin(uv.x * 9.425 - t * 0.8)) * edge * stellarBand * 0.10;

    // x50: dark core, white-gold/prismatic rim, and four slow corner sparks.
    float capBand = gradeBand(grade, 11.0);
    col = mix(col, vec3(0.025, 0.020, 0.052), capBand * 0.88);
    vec3 capRim = mix(vec3(1.0, 0.88, 0.46), highColor, 0.52);
    col = mix(col, capRim, edge * capBand * 0.26);
    float capSparks = pointGlow(uv, vec2(0.03, 0.12), 0.05)
        + pointGlow(uv, vec2(0.97, 0.12), 0.05)
        + pointGlow(uv, vec2(0.03, 0.88), 0.05)
        + pointGlow(uv, vec2(0.97, 0.88), 0.05);
    col += capRim * capSparks * capBand * (0.08 + 0.04 * sin(t * 1.0 + uPhaseOffset));

    gl_FragColor = vec4(col * outTint.rgb, tex.a * outTint.a * 0.78);
}
