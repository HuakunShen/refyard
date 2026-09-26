//! Native Windows private-directory policy for the durable journal.
use std::mem::size_of;
use std::os::windows::ffi::OsStrExt;
use std::path::Path;
use std::ptr::{null, null_mut};

use refyard_contract::problem::{Problem, ProblemCode};
use windows_sys::Win32::Foundation::{CloseHandle, LocalFree, HANDLE, INVALID_HANDLE_VALUE};
use windows_sys::Win32::Security::Authorization::{
    GetSecurityInfo, SetEntriesInAclW, SetSecurityInfo, EXPLICIT_ACCESS_W, NO_MULTIPLE_TRUSTEE,
    SET_ACCESS, SE_FILE_OBJECT, TRUSTEE_IS_SID, TRUSTEE_IS_USER, TRUSTEE_IS_WELL_KNOWN_GROUP,
    TRUSTEE_W,
};
use windows_sys::Win32::Security::{
    CreateWellKnownSid, EqualSid, GetAce, GetSecurityDescriptorControl, GetTokenInformation,
    IsValidAcl, IsValidSid, TokenUser, WinLocalSystemSid, ACCESS_ALLOWED_ACE, ACL,
    CONTAINER_INHERIT_ACE, DACL_SECURITY_INFORMATION, OBJECT_INHERIT_ACE,
    OWNER_SECURITY_INFORMATION, PROTECTED_DACL_SECURITY_INFORMATION, PSID, SE_DACL_PRESENT,
    SE_DACL_PROTECTED, TOKEN_QUERY, TOKEN_USER,
};
use windows_sys::Win32::Storage::FileSystem::{
    CreateFileW, FileAttributeTagInfo, GetFileInformationByHandleEx, FILE_ALL_ACCESS,
    FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_REPARSE_POINT, FILE_ATTRIBUTE_TAG_INFO,
    FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_DELETE, FILE_SHARE_READ,
    FILE_SHARE_WRITE, OPEN_EXISTING, READ_CONTROL, WRITE_DAC, WRITE_OWNER,
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

struct LocalOwned<T>(*mut T);
impl<T> Drop for LocalOwned<T> {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe {
                LocalFree(self.0.cast());
            }
        }
    }
}

struct Identity {
    _token: Handle,
    user: Vec<usize>,
    system: Vec<usize>,
}

impl Identity {
    fn acquire(path: &Path) -> Result<Self, Problem> {
        let mut token = null_mut();
        if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
            return Err(unavailable(
                path,
                format!("open process token: {}", std::io::Error::last_os_error()),
            ));
        }
        let token = Handle(token);
        let mut length = 0u32;
        unsafe {
            GetTokenInformation(token.0, TokenUser, null_mut(), 0, &mut length);
        }
        if length < size_of::<TOKEN_USER>() as u32 {
            return Err(unavailable(path, "query process user SID size"));
        }
        let mut user = vec![0usize; (length as usize).div_ceil(size_of::<usize>())];
        if unsafe {
            GetTokenInformation(
                token.0,
                TokenUser,
                user.as_mut_ptr().cast(),
                length,
                &mut length,
            )
        } == 0
        {
            return Err(unavailable(
                path,
                format!("read process user SID: {}", std::io::Error::last_os_error()),
            ));
        }
        let mut system = vec![0usize; 68usize.div_ceil(size_of::<usize>())];
        let mut system_length = (system.len() * size_of::<usize>()) as u32;
        if unsafe {
            CreateWellKnownSid(
                WinLocalSystemSid,
                null_mut(),
                system.as_mut_ptr().cast(),
                &mut system_length,
            )
        } == 0
        {
            return Err(unavailable(
                path,
                format!("make LocalSystem SID: {}", std::io::Error::last_os_error()),
            ));
        }
        let identity = Self {
            _token: token,
            user,
            system,
        };
        if unsafe { IsValidSid(identity.user_sid()) } == 0
            || unsafe { IsValidSid(identity.system_sid()) } == 0
        {
            return Err(unavailable(path, "invalid process or LocalSystem SID"));
        }
        Ok(identity)
    }

    fn user_sid(&self) -> PSID {
        unsafe { (*self.user.as_ptr().cast::<TOKEN_USER>()).User.Sid }
    }

    fn system_sid(&self) -> PSID {
        self.system.as_ptr() as PSID
    }
}

fn unavailable(path: &Path, reason: impl std::fmt::Display) -> Problem {
    Problem::new(
        ProblemCode::Unavailable,
        format!("private journal directory {}: {reason}", path.display()),
    )
}

fn open_directory(path: &Path) -> Result<Handle, Problem> {
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let raw = unsafe {
        CreateFileW(
            wide.as_ptr(),
            READ_CONTROL | WRITE_DAC | WRITE_OWNER,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            null(),
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
            null_mut(),
        )
    };
    if raw == INVALID_HANDLE_VALUE {
        return Err(unavailable(
            path,
            format!("open directory: {}", std::io::Error::last_os_error()),
        ));
    }
    let handle = Handle(raw);
    let mut info = FILE_ATTRIBUTE_TAG_INFO {
        FileAttributes: 0,
        ReparseTag: 0,
    };
    if unsafe {
        GetFileInformationByHandleEx(
            handle.0,
            FileAttributeTagInfo,
            (&mut info as *mut FILE_ATTRIBUTE_TAG_INFO).cast(),
            size_of::<FILE_ATTRIBUTE_TAG_INFO>() as u32,
        )
    } == 0
    {
        return Err(unavailable(
            path,
            format!(
                "read directory attributes: {}",
                std::io::Error::last_os_error()
            ),
        ));
    }
    if info.FileAttributes & FILE_ATTRIBUTE_DIRECTORY == 0
        || info.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
    {
        return Err(unavailable(path, "not an ordinary directory"));
    }
    Ok(handle)
}

fn trustee(sid: PSID, kind: i32) -> TRUSTEE_W {
    TRUSTEE_W {
        pMultipleTrustee: null_mut(),
        MultipleTrusteeOperation: NO_MULTIPLE_TRUSTEE,
        TrusteeForm: TRUSTEE_IS_SID,
        TrusteeType: kind,
        ptstrName: sid.cast(),
    }
}

fn entry(sid: PSID, kind: i32) -> EXPLICIT_ACCESS_W {
    EXPLICIT_ACCESS_W {
        grfAccessPermissions: FILE_ALL_ACCESS,
        grfAccessMode: SET_ACCESS,
        grfInheritance: OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE,
        Trustee: trustee(sid, kind),
    }
}

fn apply(handle: &Handle, identity: &Identity, path: &Path) -> Result<(), Problem> {
    let entries = [
        entry(identity.user_sid(), TRUSTEE_IS_USER),
        entry(identity.system_sid(), TRUSTEE_IS_WELL_KNOWN_GROUP),
    ];
    let mut raw_acl: *mut ACL = null_mut();
    let result = unsafe { SetEntriesInAclW(2, entries.as_ptr(), null(), &mut raw_acl) };
    let acl = LocalOwned(raw_acl);
    if result != 0 {
        return Err(unavailable(
            path,
            format!("build ACL: Win32 error {result}"),
        ));
    }
    if raw_acl.is_null() {
        return Err(unavailable(path, "ACL builder returned no DACL"));
    }
    let result = unsafe {
        SetSecurityInfo(
            handle.0,
            SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION
                | DACL_SECURITY_INFORMATION
                | PROTECTED_DACL_SECURITY_INFORMATION,
            identity.user_sid(),
            null_mut(),
            acl.0,
            null(),
        )
    };
    if result != 0 {
        return Err(unavailable(
            path,
            format!("apply ACL: Win32 error {result}"),
        ));
    }
    Ok(())
}

fn verify(handle: &Handle, identity: &Identity, path: &Path) -> Result<(), Problem> {
    let mut owner: PSID = null_mut();
    let mut dacl: *mut ACL = null_mut();
    let mut raw_descriptor = null_mut();
    let result = unsafe {
        GetSecurityInfo(
            handle.0,
            SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
            &mut owner,
            null_mut(),
            &mut dacl,
            null_mut(),
            &mut raw_descriptor,
        )
    };
    let descriptor = LocalOwned(raw_descriptor);
    if result != 0 {
        return Err(unavailable(
            path,
            format!("read back ACL: Win32 error {result}"),
        ));
    }
    if raw_descriptor.is_null() {
        return Err(unavailable(
            path,
            "readback returned no security descriptor",
        ));
    }
    if owner.is_null()
        || dacl.is_null()
        || unsafe { IsValidSid(owner) } == 0
        || unsafe { EqualSid(owner, identity.user_sid()) } == 0
        || unsafe { IsValidAcl(dacl) } == 0
    {
        return Err(unavailable(path, "readback owner or DACL mismatch"));
    }
    let mut control = 0u16;
    let mut revision = 0u32;
    if unsafe { GetSecurityDescriptorControl(descriptor.0, &mut control, &mut revision) } == 0
        || control & (SE_DACL_PRESENT | SE_DACL_PROTECTED) != SE_DACL_PRESENT | SE_DACL_PROTECTED
    {
        return Err(unavailable(
            path,
            "readback DACL is not present and protected",
        ));
    }
    if unsafe { (*dacl).AceCount } != 2 {
        return Err(unavailable(
            path,
            "readback DACL must contain exactly two ACEs",
        ));
    }
    let mut user_seen = false;
    let mut system_seen = false;
    for index in 0..2 {
        let mut raw_ace = null_mut();
        if unsafe { GetAce(dacl, index, &mut raw_ace) } == 0 {
            return Err(unavailable(
                path,
                format!(
                    "readback ACE {index} failed: {}",
                    std::io::Error::last_os_error()
                ),
            ));
        }
        let ace = raw_ace as *const ACCESS_ALLOWED_ACE;
        let header = unsafe { &(*ace).Header };
        if header.AceType != 0
            || header.AceFlags != (OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE) as u8
            || usize::from(header.AceSize) < size_of::<ACCESS_ALLOWED_ACE>()
            || unsafe { (*ace).Mask } != FILE_ALL_ACCESS
        {
            return Err(unavailable(
                path,
                "readback ACE type, flags, or rights mismatch",
            ));
        }
        let sid = unsafe { std::ptr::addr_of!((*ace).SidStart) as PSID };
        if unsafe { IsValidSid(sid) } == 0 {
            return Err(unavailable(path, "readback ACE has invalid SID"));
        }
        if unsafe { EqualSid(sid, identity.user_sid()) } != 0 {
            if user_seen {
                return Err(unavailable(path, "duplicate user ACE"));
            }
            user_seen = true;
        } else if unsafe { EqualSid(sid, identity.system_sid()) } != 0 {
            if system_seen {
                return Err(unavailable(path, "duplicate SYSTEM ACE"));
            }
            system_seen = true;
        } else {
            return Err(unavailable(path, "unexpected readback ACE identity"));
        }
    }
    if !user_seen || !system_seen {
        return Err(unavailable(path, "user or SYSTEM ACE missing"));
    }
    Ok(())
}

pub(super) fn secure_private_directory(path: &Path) -> Result<(), Problem> {
    let identity = Identity::acquire(path)?;
    let handle = open_directory(path)?;
    apply(&handle, &identity, path)?;
    verify(&handle, &identity, path)
}
