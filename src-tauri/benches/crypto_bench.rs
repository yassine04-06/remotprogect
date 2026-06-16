//! Crypto hot-path benchmarks. Run with: `cargo bench`.
//!
//! These cover the two paths that dominate perceived latency:
//!   - Argon2id key derivation (runs once per unlock; tune cost params here)
//!   - encrypt_v2 / decrypt_auto round-trip (runs per credential on connect)

use criterion::{criterion_group, criterion_main, Criterion};
use remote_manager_lib::encryption::{decrypt_auto, derive_key_params, encrypt_v2, KdfParams};
use std::hint::black_box;

fn bench_argon2id(c: &mut Criterion) {
    let salt = [0x42u8; 16];
    let params = KdfParams::default_argon2id();
    c.bench_function("argon2id_derive_key", |b| {
        b.iter(|| derive_key_params(black_box("correct horse battery staple"), black_box(&salt), &params))
    });
}

fn bench_encrypt_decrypt(c: &mut Criterion) {
    let key = [0x11u8; 32];
    let plaintext = "s3cr3t-password-value-of-typical-length";

    c.bench_function("encrypt_v2", |b| {
        b.iter(|| encrypt_v2(black_box(plaintext), black_box(&key)).unwrap())
    });

    let ct = encrypt_v2(plaintext, &key).unwrap();
    c.bench_function("decrypt_auto", |b| {
        b.iter(|| decrypt_auto(black_box(&ct), black_box(&key)).unwrap())
    });
}

criterion_group!(benches, bench_argon2id, bench_encrypt_decrypt);
criterion_main!(benches);
