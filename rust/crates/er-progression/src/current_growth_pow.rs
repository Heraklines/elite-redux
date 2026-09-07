/*
 * Adapted from fdlibm via libm 0.2.16 and V8 in Node v22.23.2.
 * Copyright (C) 2004 by Sun Microsystems, Inc. All rights reserved.
 * Permission to use, copy, modify, and distribute this software is freely
 * granted, provided that this notice is preserved.
 * V8 modifications: Copyright 2016 the V8 project authors.
 */
//! Pinned V8 power evaluation for positive u16 levels above 100 and powers 3/4.
//! This bounded domain cannot encounter subnormals, overflow, or negative inputs.
//! Preserve the fdlibm constants and operation order, including V8's correction
//! inside the final denominator; system pow/powi and libm do not round identically.
//! Source: nodejs/node v22.23.2, deps/v8/src/base/ieee754.cc, pow.
#![allow(clippy::excessive_precision, clippy::approx_constant)]

const BP: [f64; 2] = [1.0, 1.5];
const DP_H: [f64; 2] = [0.0, 5.84962487220764160156e-01]; /* 0x3fe2b803_40000000 */
const DP_L: [f64; 2] = [0.0, 1.35003920212974897128e-08]; /* 0x3E4CFDEB, 0x43CFD006 */

// poly coefs for (3/2)*(log(x)-2s-2/3*s**3:
const L1: f64 = 5.99999999999994648725e-01; /* 0x3fe33333_33333303 */
const L2: f64 = 4.28571428578550184252e-01; /* 0x3fdb6db6_db6fabff */
const L3: f64 = 3.33333329818377432918e-01; /* 0x3fd55555_518f264d */
const L4: f64 = 2.72728123808534006489e-01; /* 0x3fd17460_a91d4101 */
const L5: f64 = 2.30660745775561754067e-01; /* 0x3fcd864a_93c9db65 */
const L6: f64 = 2.06975017800338417784e-01; /* 0x3fca7e28_4a454eef */
const P1: f64 = 1.66666666666666019037e-01; /* 0x3fc55555_5555553e */
const P2: f64 = -2.77777777770155933842e-03; /* 0xbf66c16c_16bebd93 */
const P3: f64 = 6.61375632143793436117e-05; /* 0x3f11566a_af25de2c */
const P4: f64 = -1.65339022054652515390e-06; /* 0xbebbbd41_c5d26bf1 */
const P5: f64 = 4.13813679705723846039e-08; /* 0x3e663769_72bea4d0 */
const LG2: f64 = 6.93147180559945286227e-01; /* 0x3fe62e42_fefa39ef */
const LG2_H: f64 = 6.93147182464599609375e-01; /* 0x3fe62e43_00000000 */
const LG2_L: f64 = -1.90465429995776804525e-09; /* 0xbe205c61_0ca86c39 */
const CP: f64 = 9.61796693925975554329e-01; /* 0x3feec709_dc3a03fd =2/(3ln2) */
const CP_H: f64 = 9.61796700954437255859e-01; /* 0x3feec709_e0000000 =(float)cp */
const CP_L: f64 = -7.02846165095275826516e-09; /* 0xbe3e2fe0_145b01f5 =tail of cp_h*/

pub(super) fn growth_power(level: u16, exponent: u8) -> f64 {
    debug_assert!(level > 100 && matches!(exponent, 3 | 4));
    let x = f64::from(level);
    let y = f64::from(exponent);
    let mut ax = x;
    let mut ix = get_high_word(x) as i32;
    let mut n = (ix >> 20) - 0x3ff;
    let j = ix & 0x000fffff;

    /* determine interval */
    ix = j | 0x3ff00000; /* normalize ix */
    let k: i32 = if j <= 0x3988E {
        /* |x|<sqrt(3/2) */
        0
    } else if j < 0xBB67A {
        /* |x|<sqrt(3)   */
        1
    } else {
        n += 1;
        ix -= 0x00100000;
        0
    };
    ax = with_set_high_word(ax, ix as u32);

    /* compute ss = s_h+s_l = (x-1)/(x+1) or (x-1.5)/(x+1.5) */
    let u: f64 = ax - BP[k as usize]; /* bp[0]=1.0, bp[1]=1.5 */
    let v: f64 = 1.0 / (ax + BP[k as usize]);
    let ss: f64 = u * v;
    let s_h = with_set_low_word(ss, 0);

    /* t_h=ax+bp[k] High */
    let t_h: f64 = with_set_high_word(
        0.0,
        ((ix as u32 >> 1) | 0x20000000) + 0x00080000 + ((k as u32) << 18),
    );
    let t_l: f64 = ax - (t_h - BP[k as usize]);
    let s_l: f64 = v * ((u - s_h * t_h) - s_h * t_l);

    /* compute log(ax) */
    let s2: f64 = ss * ss;
    let mut r: f64 = s2 * s2 * (L1 + s2 * (L2 + s2 * (L3 + s2 * (L4 + s2 * (L5 + s2 * L6)))));
    r += s_l * (s_h + ss);
    let s2: f64 = s_h * s_h;
    let t_h: f64 = with_set_low_word(3.0 + s2 + r, 0);
    let t_l: f64 = r - ((t_h - 3.0) - s2);

    /* u+v = ss*(1+...) */
    let u: f64 = s_h * t_h;
    let v: f64 = s_l * t_h + t_l * ss;

    /* 2/(3log2)*(ss+...) */
    let p_h: f64 = with_set_low_word(u + v, 0);
    let p_l = v - (p_h - u);
    let z_h: f64 = CP_H * p_h; /* cp_h+cp_l = 2/(3*log2) */
    let z_l: f64 = CP_L * p_h + p_l * CP + DP_L[k as usize];

    /* log2(ax) = (ss+..)*2/(3*log2) = n + dp_h + z_h + z_l */
    let t: f64 = n as f64;
    let t1 = with_set_low_word(((z_h + z_l) + DP_H[k as usize]) + t, 0);
    let t2 = z_l - (((t1 - t) - DP_H[k as usize]) - z_h);

    /* split up y into y1+y2 and compute (y1+y2)*(t1+t2) */
    let y1: f64 = with_set_low_word(y, 0);
    let p_l: f64 = (y - y1) * t1 + y * t2;
    let mut p_h: f64 = y1 * t1;
    let z: f64 = p_l + p_h;
    let mut j: i32 = (z.to_bits() >> 32) as i32;

    /* compute 2**(p_h+p_l) */
    let i: i32 = j & 0x7fffffff_i32;
    let mut k = (i >> 20) - 0x3ff;
    let mut n: i32 = 0;

    if i > 0x3fe00000 {
        /* if |z| > 0.5, set n = [z+0.5] */
        n = j + (0x00100000 >> (k + 1));
        k = ((n & 0x7fffffff) >> 20) - 0x3ff; /* new k for n */
        let t: f64 = with_set_high_word(0.0, (n & !(0x000fffff >> k)) as u32);
        n = ((n & 0x000fffff) | 0x00100000) >> (20 - k);
        if j < 0 {
            n = -n;
        }
        p_h -= t;
    }

    let t: f64 = with_set_low_word(p_l + p_h, 0);
    let u: f64 = t * LG2_H;
    let v: f64 = (p_l - (t - p_h)) * LG2 + t * LG2_L;
    let mut z: f64 = u + v;
    let w: f64 = v - (z - u);
    let t: f64 = z * z;
    let t1: f64 = z - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
    let r: f64 = (z * t1) / ((t1 - 2.0) - (w + z * w));
    z = 1.0 - (r - z);
    j = get_high_word(z) as i32;
    j += n << 20;

    with_set_high_word(z, j as u32)
}

fn get_high_word(value: f64) -> u32 {
    (value.to_bits() >> 32) as u32
}

fn with_set_high_word(value: f64, high: u32) -> f64 {
    f64::from_bits((value.to_bits() & 0xffff_ffff) | (u64::from(high) << 32))
}

fn with_set_low_word(value: f64, low: u32) -> f64 {
    f64::from_bits((value.to_bits() & 0xffff_ffff_0000_0000) | u64::from(low))
}
