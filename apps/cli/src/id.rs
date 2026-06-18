//! ULID generation, dependency-free. Matches the shape of the TypeScript
//! `newId()` (Crockford base32, 26 chars, time-ordered) so CLI-written records
//! sort and read identically to app-written ones. Randomness is derived from a
//! high-resolution clock mixed through splitmix64 plus a process counter — more
//! than enough entropy for unique ids in a single-user local CLI.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

const CROCKFORD: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
static COUNTER: AtomicU64 = AtomicU64::new(0);

fn splitmix64(mut x: u64) -> u64 {
    x = x.wrapping_add(0x9E37_79B9_7F4A_7C15);
    let mut z = x;
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

/// Encode `count` 5-bit groups of `value` (big-endian, low `count*5` bits) into
/// Crockford base32, most-significant group first.
fn encode(value: u128, count: usize, out: &mut String) {
    let mut buf = vec![0u8; count];
    let mut v = value;
    for slot in buf.iter_mut().rev() {
        *slot = CROCKFORD[(v & 0x1f) as usize];
        v >>= 5;
    }
    out.push_str(std::str::from_utf8(&buf).expect("crockford alphabet is ascii"));
}

/// Generate a 26-character ULID string.
pub fn new_id() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos() as u64)
        .unwrap_or(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let rand_hi = splitmix64(now ^ nanos.wrapping_mul(0x100_0001).wrapping_add(n));
    let rand_lo = splitmix64(rand_hi ^ n.wrapping_mul(0x9E37_79B9));

    let mut out = String::with_capacity(26);
    // 48-bit timestamp -> 10 base32 chars.
    encode((now as u128) & 0xFFFF_FFFF_FFFF, 10, &mut out);
    // 80-bit randomness -> 16 base32 chars.
    let randomness: u128 =
        (((rand_hi as u128) << 16) | ((rand_lo as u128) & 0xFFFF)) & ((1u128 << 80) - 1);
    encode(randomness, 16, &mut out);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_26_crockford_chars_and_unique() {
        let mut seen = std::collections::HashSet::new();
        for _ in 0..1000 {
            let id = new_id();
            assert_eq!(id.len(), 26, "ulid must be 26 chars: {id}");
            assert!(
                id.bytes().all(|b| CROCKFORD.contains(&b)),
                "non-crockford char in {id}"
            );
            assert!(seen.insert(id), "duplicate id generated");
        }
    }
}
