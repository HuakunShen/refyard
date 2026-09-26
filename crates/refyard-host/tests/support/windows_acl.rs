//! Independent Win32 readback oracle for the embedding privacy contract.
use std::ffi::c_void;
use std::os::windows::ffi::OsStrExt;
use std::path::Path;
use std::ptr::{null, null_mut};

use windows_sys::Win32::Foundation::{CloseHandle, LocalFree, HANDLE, INVALID_HANDLE_VALUE};
use windows_sys::Win32::Security::Authorization::{
    GetSecurityInfo, SetSecurityInfo, SE_FILE_OBJECT,
};
use windows_sys::Win32::Security::{
    CreateWellKnownSid, EqualSid, GetAce, GetSecurityDescriptorControl, GetTokenInformation,
    TokenUser, WinLocalSystemSid, ACCESS_ALLOWED_ACE, ACL, CONTAINER_INHERIT_ACE,
    DACL_SECURITY_INFORMATION, OBJECT_INHERIT_ACE, OWNER_SECURITY_INFORMATION,
    PROTECTED_DACL_SECURITY_INFORMATION, PSID, SE_DACL_PRESENT, SE_DACL_PROTECTED, TOKEN_QUERY,
    TOKEN_USER,
};
use windows_sys::Win32::Storage::FileSystem::{
    CreateFileW, FILE_ALL_ACCESS, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT,
    FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING, READ_CONTROL, WRITE_DAC,
};
use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

struct Handle(HANDLE);
impl Drop for Handle {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}

struct Descriptor(*mut c_void);
impl Drop for Descriptor {
    fn drop(&mut self) {
        unsafe {
            LocalFree(self.0);
        }
    }
}

fn directory(path: &Path) -> Handle {
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let handle = unsafe {
        CreateFileW(
            wide.as_ptr(),
            READ_CONTROL | WRITE_DAC,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            null(),
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
            null_mut(),
        )
    };
    assert_ne!(
        handle,
        INVALID_HANDLE_VALUE,
        "open {}: {}",
        path.display(),
        std::io::Error::last_os_error()
    );
    Handle(handle)
}

fn identity() -> (Handle, Vec<usize>, Vec<usize>) {
    let mut raw = null_mut();
    assert_ne!(
        unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut raw) },
        0
    );
    let token = Handle(raw);
    let mut len = 0u32;
    unsafe {
        GetTokenInformation(token.0, TokenUser, null_mut(), 0, &mut len);
    }
    assert!(len >= std::mem::size_of::<TOKEN_USER>() as u32);
    let mut user = vec![0usize; (len as usize).div_ceil(std::mem::size_of::<usize>())];
    assert_ne!(
        unsafe { GetTokenInformation(token.0, TokenUser, user.as_mut_ptr().cast(), len, &mut len) },
        0
    );
    let mut system = vec![0usize; 68usize.div_ceil(std::mem::size_of::<usize>())];
    let mut system_len = (system.len() * std::mem::size_of::<usize>()) as u32;
    assert_ne!(
        unsafe {
            CreateWellKnownSid(
                WinLocalSystemSid,
                null_mut(),
                system.as_mut_ptr().cast(),
                &mut system_len,
            )
        },
        0
    );
    (token, user, system)
}

pub fn assert_private(path: &Path) {
    let directory = directory(path);
    let (_token, user, system) = identity();
    let user_sid = unsafe { (*(user.as_ptr().cast::<TOKEN_USER>())).User.Sid };
    let system_sid = system.as_ptr() as PSID;
    let mut owner: PSID = null_mut();
    let mut dacl: *mut ACL = null_mut();
    let mut descriptor = null_mut();
    let result = unsafe {
        GetSecurityInfo(
            directory.0,
            SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
            &mut owner,
            null_mut(),
            &mut dacl,
            null_mut(),
            &mut descriptor,
        )
    };
    assert_eq!(result, 0, "read security {}: {result}", path.display());
    let _descriptor = Descriptor(descriptor);
    assert!(
        !owner.is_null() && !dacl.is_null(),
        "missing owner/DACL: {}",
        path.display()
    );
    assert_ne!(
        unsafe { EqualSid(owner, user_sid) },
        0,
        "wrong owner: {}",
        path.display()
    );
    let mut control = 0u16;
    let mut revision = 0u32;
    assert_ne!(
        unsafe { GetSecurityDescriptorControl(descriptor, &mut control, &mut revision) },
        0
    );
    assert_eq!(
        control & (SE_DACL_PRESENT | SE_DACL_PROTECTED),
        SE_DACL_PRESENT | SE_DACL_PROTECTED
    );
    assert_eq!(
        unsafe { (*dacl).AceCount },
        2,
        "extra or missing ACE: {}",
        path.display()
    );
    let mut seen_user = false;
    let mut seen_system = false;
    for index in 0..2 {
        let mut entry = null_mut();
        assert_ne!(unsafe { GetAce(dacl, index, &mut entry) }, 0);
        let ace = entry as *const ACCESS_ALLOWED_ACE;
        assert_eq!(
            unsafe { (*ace).Header.AceType },
            0,
            "ACE must explicitly allow"
        );
        assert_eq!(
            unsafe { (*ace).Header.AceFlags },
            (OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE) as u8,
            "ACE must have exactly OI+CI flags"
        );
        assert_eq!(
            unsafe { (*ace).Mask },
            FILE_ALL_ACCESS,
            "ACE must grant exact file full control"
        );
        let sid = unsafe { std::ptr::addr_of!((*ace).SidStart) as PSID };
        if unsafe { EqualSid(sid, user_sid) } != 0 {
            assert!(!seen_user, "duplicate user ACE");
            seen_user = true;
        } else if unsafe { EqualSid(sid, system_sid) } != 0 {
            assert!(!seen_system, "duplicate SYSTEM ACE");
            seen_system = true;
        } else {
            panic!("unexpected ACE SID in {}", path.display());
        }
    }
    assert!(seen_user && seen_system, "user/SYSTEM ACEs required");
}

pub fn loosen_dacl(path: &Path) {
    let directory = directory(path);
    let result = unsafe {
        SetSecurityInfo(
            directory.0,
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
            null_mut(),
            null_mut(),
            null(),
            null(),
        )
    };
    assert_eq!(result, 0, "loosen test DACL {}: {result}", path.display());
}
