use zeroize::Zeroize;

/// Heap-allocated 32-byte key that is memory-locked to prevent the OS from
/// paging it to disk. The page is unlocked and the bytes are zeroed on drop.
pub struct MlockedKey(Box<[u8; 32]>);

impl MlockedKey {
    pub fn new(key: [u8; 32]) -> Self {
        let boxed = Box::new(key);
        // Best-effort: lock the page. Failure is logged but not fatal —
        // Drop::drop always zeroes before unlocking regardless.
        unsafe { sys_mlock(boxed.as_ptr(), 32) };
        Self(boxed)
    }

    #[inline]
    pub fn expose(&self) -> &[u8; 32] {
        &self.0
    }
}

impl Zeroize for MlockedKey {
    fn zeroize(&mut self) {
        self.0.zeroize();
    }
}

impl Drop for MlockedKey {
    fn drop(&mut self) {
        // Zero first, then unlock — the bytes are gone before the page is released.
        self.0.zeroize();
        unsafe { sys_munlock(self.0.as_ptr(), 32) };
    }
}

// ── Platform-specific memory-lock primitives ─────────────────────────────────

#[cfg(windows)]
unsafe fn sys_mlock(ptr: *const u8, len: usize) {
    use windows_sys::Win32::System::Memory::VirtualLock;
    if VirtualLock(ptr as *const core::ffi::c_void, len) == 0 {
        tracing::warn!("VirtualLock failed — master key may be swappable to disk");
    }
}

#[cfg(windows)]
unsafe fn sys_munlock(ptr: *const u8, len: usize) {
    use windows_sys::Win32::System::Memory::VirtualUnlock;
    VirtualUnlock(ptr as *const core::ffi::c_void, len);
}

#[cfg(unix)]
unsafe fn sys_mlock(ptr: *const u8, len: usize) {
    extern "C" {
        fn mlock(addr: *const core::ffi::c_void, len: usize) -> i32;
    }
    if mlock(ptr.cast(), len) != 0 {
        tracing::warn!("mlock failed — master key may be swappable to disk");
    }
}

#[cfg(unix)]
unsafe fn sys_munlock(ptr: *const u8, len: usize) {
    extern "C" {
        fn munlock(addr: *const core::ffi::c_void, len: usize) -> i32;
    }
    munlock(ptr.cast(), len);
}

#[cfg(not(any(windows, unix)))]
unsafe fn sys_mlock(_ptr: *const u8, _len: usize) {}

#[cfg(not(any(windows, unix)))]
unsafe fn sys_munlock(_ptr: *const u8, _len: usize) {}
