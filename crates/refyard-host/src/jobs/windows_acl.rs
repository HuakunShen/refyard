//! Native Windows ACL policy for durable Refyard state.
use std::mem::size_of;
use std::os::windows::ffi::OsStrExt;
use std::os::windows::io::{FromRawHandle, RawHandle};
use std::path::Path;
use std::ptr::{null, null_mut};
use std::{fs::File, io};

use refyard_contract::problem::{Problem, ProblemCode};
use windows_sys::Win32::Foundation::{CloseHandle, LocalFree, HANDLE, INVALID_HANDLE_VALUE};
use windows_sys::Win32::Foundation::{ERROR_FILE_EXISTS, GENERIC_READ, GENERIC_WRITE};
use windows_sys::Win32::Security::Authorization::{
    GetSecurityInfo, SetEntriesInAclW, SetSecurityInfo, EXPLICIT_ACCESS_W, NO_MULTIPLE_TRUSTEE,
    SET_ACCESS, SE_FILE_OBJECT, TRUSTEE_IS_SID, TRUSTEE_IS_USER, TRUSTEE_IS_WELL_KNOWN_GROUP,
    TRUSTEE_W,
};
use windows_sys::Win32::Security::{
    CreateWellKnownSid, EqualSid, GetAce, GetSecurityDescriptorControl, GetTokenInformation,
    InitializeSecurityDescriptor, IsValidAcl, IsValidSid, SetSecurityDescriptorControl,
    SetSecurityDescriptorDacl, SetSecurityDescriptorOwner, TokenUser, WinLocalSystemSid,
    ACCESS_ALLOWED_ACE, ACL, CONTAINER_INHERIT_ACE, DACL_SECURITY_INFORMATION, OBJECT_INHERIT_ACE,
    OWNER_SECURITY_INFORMATION, PROTECTED_DACL_SECURITY_INFORMATION, PSID, SECURITY_ATTRIBUTES,
    SECURITY_DESCRIPTOR, SE_DACL_PRESENT, SE_DACL_PROTECTED, TOKEN_QUERY, TOKEN_USER,
};
use windows_sys::Win32::Storage::FileSystem::{
    CreateFileW, FileAttributeTagInfo, GetFileInformationByHandleEx, ReOpenFile, CREATE_NEW,
    FILE_ALL_ACCESS, FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_NORMAL, FILE_ATTRIBUTE_REPARSE_POINT,
    FILE_ATTRIBUTE_TAG_INFO, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT,
    FILE_READ_ATTRIBUTES, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
    READ_CONTROL, WRITE_DAC, WRITE_OWNER,
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
        format!("private state path {}: {reason}", path.display()),
    )
}

fn open_directory(path: &Path) -> Result<Handle, Problem> {
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let raw = unsafe {
        CreateFileW(
            wide.as_ptr(),
            READ_CONTROL | WRITE_DAC | WRITE_OWNER | FILE_READ_ATTRIBUTES,
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

#[derive(Clone, Copy)]
enum PrivateObjectKind {
    File,
    Directory,
}

impl PrivateObjectKind {
    const fn inheritance_flags(self) -> u32 {
        match self {
            Self::File => 0,
            Self::Directory => OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE,
        }
    }

    const fn readback_flags(self) -> u8 {
        self.inheritance_flags() as u8
    }
}

fn entry(sid: PSID, trustee_kind: i32, object_kind: PrivateObjectKind) -> EXPLICIT_ACCESS_W {
    EXPLICIT_ACCESS_W {
        grfAccessPermissions: FILE_ALL_ACCESS,
        grfAccessMode: SET_ACCESS,
        grfInheritance: object_kind.inheritance_flags(),
        Trustee: trustee(sid, trustee_kind),
    }
}

fn build_acl(
    identity: &Identity,
    path: &Path,
    object_kind: PrivateObjectKind,
) -> Result<LocalOwned<ACL>, Problem> {
    let entries = [
        entry(identity.user_sid(), TRUSTEE_IS_USER, object_kind),
        entry(
            identity.system_sid(),
            TRUSTEE_IS_WELL_KNOWN_GROUP,
            object_kind,
        ),
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
    Ok(acl)
}

fn describe_acl(acl: *const ACL) -> String {
    if acl.is_null() || unsafe { IsValidAcl(acl) } == 0 {
        return "<invalid ACL>".to_owned();
    }

    let count = unsafe { (*acl).AceCount };
    let mut entries = Vec::with_capacity(usize::from(count));
    for index in 0..count {
        let mut raw_ace = null_mut();
        if unsafe { GetAce(acl, u32::from(index), &mut raw_ace) } == 0 || raw_ace.is_null() {
            entries.push(format!("#{index}: <unreadable ACE>"));
            continue;
        }

        let ace = raw_ace as *const ACCESS_ALLOWED_ACE;
        let header = unsafe { &(*ace).Header };
        let mask = if header.AceType == 0
            && usize::from(header.AceSize) >= size_of::<ACCESS_ALLOWED_ACE>()
        {
            format!("0x{:08X}", unsafe { (*ace).Mask })
        } else {
            "<unavailable>".to_owned()
        };
        entries.push(format!(
            "#{index}: type=0x{:02X} flags=0x{:02X} size={} mask={mask}",
            header.AceType, header.AceFlags, header.AceSize
        ));
    }
    format!("[{}]", entries.join(", "))
}

fn apply(
    handle: &Handle,
    identity: &Identity,
    path: &Path,
    set_owner: bool,
    object_kind: PrivateObjectKind,
) -> Result<String, Problem> {
    let acl = build_acl(identity, path, object_kind)?;
    let requested_aces = describe_acl(acl.0);
    let mut information = DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION;
    if set_owner {
        information |= OWNER_SECURITY_INFORMATION;
    }
    let owner = if set_owner {
        identity.user_sid()
    } else {
        null_mut()
    };
    let result = unsafe {
        SetSecurityInfo(
            handle.0,
            SE_FILE_OBJECT,
            information,
            owner,
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
    Ok(requested_aces)
}

fn problem_to_io(problem: Problem) -> io::Error {
    io::Error::new(io::ErrorKind::PermissionDenied, problem.to_string())
}

fn create_private_file_handle(path: &Path, identity: &Identity) -> io::Result<Handle> {
    // Supply the owner and protected DACL to CREATE_NEW itself. An elevated process's
    // default owner can be a group SID, which would implicitly retain WRITE_DAC if we
    // created the file first and repaired it afterwards.
    let acl = build_acl(identity, path, PrivateObjectKind::File).map_err(problem_to_io)?;
    let mut descriptor = SECURITY_DESCRIPTOR::default();
    let descriptor_ptr = (&mut descriptor as *mut SECURITY_DESCRIPTOR).cast();
    if unsafe { InitializeSecurityDescriptor(descriptor_ptr, 1) } == 0
        || unsafe { SetSecurityDescriptorOwner(descriptor_ptr, identity.user_sid(), 0) } == 0
        || unsafe { SetSecurityDescriptorDacl(descriptor_ptr, 1, acl.0, 0) } == 0
        || unsafe {
            SetSecurityDescriptorControl(descriptor_ptr, SE_DACL_PROTECTED, SE_DACL_PROTECTED)
        } == 0
    {
        return Err(io::Error::last_os_error());
    }
    let attributes = SECURITY_ATTRIBUTES {
        nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: descriptor_ptr,
        bInheritHandle: 0,
    };
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let raw = unsafe {
        CreateFileW(
            wide.as_ptr(),
            READ_CONTROL | WRITE_DAC | GENERIC_READ | GENERIC_WRITE,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            &attributes,
            CREATE_NEW,
            FILE_ATTRIBUTE_NORMAL,
            null_mut(),
        )
    };
    if raw == INVALID_HANDLE_VALUE {
        return Err(io::Error::last_os_error());
    }
    let handle = Handle(raw);
    ensure_regular_file(&handle, path).map_err(problem_to_io)?;
    let requested_aces = describe_acl(acl.0);
    verify(
        &handle,
        identity,
        path,
        "after CreateFileW(CREATE_NEW)",
        Some(&requested_aces),
        PrivateObjectKind::File,
    )
    .map_err(problem_to_io)?;
    Ok(handle)
}

fn verify(
    handle: &Handle,
    identity: &Identity,
    path: &Path,
    stage: &str,
    requested_aces: Option<&str>,
    object_kind: PrivateObjectKind,
) -> Result<(), Problem> {
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
    let owner_matches = !owner.is_null()
        && unsafe { IsValidSid(owner) } != 0
        && unsafe { EqualSid(owner, identity.user_sid()) } != 0;
    if !owner_matches || dacl.is_null() || unsafe { IsValidAcl(dacl) } == 0 {
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
            || header.AceFlags != object_kind.readback_flags()
            || usize::from(header.AceSize) < size_of::<ACCESS_ALLOWED_ACE>()
            || unsafe { (*ace).Mask } != FILE_ALL_ACCESS
        {
            return Err(unavailable(
                path,
                format!(
                    "readback ACE {index} mismatch {stage}: requested={}, readback={}",
                    requested_aces.unwrap_or("<not captured>"),
                    describe_acl(dacl)
                ),
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
    let requested_aces = apply(
        &handle,
        &identity,
        path,
        true,
        PrivateObjectKind::Directory,
    )?;
    verify(
        &handle,
        &identity,
        path,
        "after SetSecurityInfo(directory)",
        Some(&requested_aces),
        PrivateObjectKind::Directory,
    )
}

fn open_state_file_io(path: &Path, disposition: u32, access: u32) -> io::Result<Handle> {
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let raw = unsafe {
        CreateFileW(
            wide.as_ptr(),
            access,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            null(),
            disposition,
            FILE_FLAG_OPEN_REPARSE_POINT,
            null_mut(),
        )
    };
    if raw == INVALID_HANDLE_VALUE {
        return Err(io::Error::last_os_error());
    }
    Ok(Handle(raw))
}

fn ensure_regular_file(handle: &Handle, path: &Path) -> Result<(), Problem> {
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
            format!("read state-file attributes: {}", io::Error::last_os_error()),
        ));
    }
    if info.FileAttributes & FILE_ATTRIBUTE_DIRECTORY != 0
        || info.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
    {
        return Err(unavailable(path, "not an ordinary file"));
    }
    Ok(())
}

fn verify_owner(handle: &Handle, identity: &Identity, path: &Path) -> Result<(), Problem> {
    let mut owner: PSID = null_mut();
    let mut raw_descriptor = null_mut();
    let result = unsafe {
        GetSecurityInfo(
            handle.0,
            SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION,
            &mut owner,
            null_mut(),
            null_mut(),
            null_mut(),
            &mut raw_descriptor,
        )
    };
    let descriptor = LocalOwned(raw_descriptor);
    if result != 0 {
        return Err(unavailable(
            path,
            format!("read state-file owner: Win32 error {result}"),
        ));
    }
    if raw_descriptor.is_null()
        || owner.is_null()
        || unsafe { IsValidSid(owner) } == 0
        || unsafe { EqualSid(owner, identity.user_sid()) } == 0
    {
        return Err(unavailable(
            path,
            "state-file owner is not the current user",
        ));
    }
    drop(descriptor);
    Ok(())
}

fn reopen_file(handle: &Handle, access: u32, path: &Path) -> Result<Handle, Problem> {
    // ReOpenFile binds the data handle to the already-validated file object. The first
    // handle denies delete sharing, so a path rename cannot swap the object between ACL
    // repair and data access.
    let raw = unsafe {
        ReOpenFile(
            handle.0,
            access,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            FILE_FLAG_OPEN_REPARSE_POINT,
        )
    };
    if raw == INVALID_HANDLE_VALUE {
        return Err(unavailable(
            path,
            format!("reopen state file: {}", io::Error::last_os_error()),
        ));
    }
    Ok(Handle(raw))
}

fn into_file(handle: Handle) -> File {
    let raw = handle.0;
    std::mem::forget(handle);
    unsafe { File::from_raw_handle(raw as RawHandle) }
}

fn secure_file_handle(handle: &Handle, identity: &Identity, path: &Path) -> Result<(), Problem> {
    ensure_regular_file(handle, path)?;
    // Existing authority files must already belong to the current user. Repair only their
    // DACL; never take ownership of an existing file.
    verify_owner(handle, identity, path)?;
    let requested_aces = apply(handle, identity, path, false, PrivateObjectKind::File)?;
    verify(
        handle,
        identity,
        path,
        "after SetSecurityInfo(file)",
        Some(&requested_aces),
        PrivateObjectKind::File,
    )
}

pub(crate) fn create_private_temporary_file(path: &Path) -> io::Result<File> {
    let identity = Identity::acquire(path).map_err(problem_to_io)?;
    let handle = create_private_file_handle(path, &identity)?;
    ensure_regular_file(&handle, path).map_err(problem_to_io)?;
    verify(
        &handle,
        &identity,
        path,
        "after private temporary-file creation",
        None,
        PrivateObjectKind::File,
    )
    .map_err(problem_to_io)?;
    Ok(into_file(handle))
}

pub(crate) fn open_private_file_for_read(path: &Path) -> io::Result<File> {
    let identity = Identity::acquire(path)
        .map_err(|problem| io::Error::new(io::ErrorKind::PermissionDenied, problem.to_string()))?;
    // Preserve NotFound so the journal can distinguish an absent legacy index from an
    // unreadable authority file.
    let handle = open_state_file_io(
        path,
        OPEN_EXISTING,
        READ_CONTROL | WRITE_DAC | FILE_READ_ATTRIBUTES,
    )?;
    secure_file_handle(&handle, &identity, path)
        .map_err(|problem| io::Error::new(io::ErrorKind::PermissionDenied, problem.to_string()))?;
    let reader = reopen_file(&handle, GENERIC_READ, path)
        .map_err(|problem| io::Error::new(io::ErrorKind::PermissionDenied, problem.to_string()))?;
    ensure_regular_file(&reader, path)
        .map_err(|problem| io::Error::new(io::ErrorKind::InvalidData, problem.to_string()))?;
    Ok(into_file(reader))
}

pub(crate) fn open_private_lock_file(path: &Path) -> Result<File, Problem> {
    let identity = Identity::acquire(path)?;
    let handle = match create_private_file_handle(path, &identity) {
        Ok(handle) => handle,
        Err(error) if error.raw_os_error() == Some(ERROR_FILE_EXISTS as i32) => open_state_file_io(
            path,
            OPEN_EXISTING,
            READ_CONTROL | WRITE_DAC | FILE_READ_ATTRIBUTES,
        )
        .map_err(|error| unavailable(path, format!("open state lock: {error}")))?,
        Err(error) => {
            return Err(unavailable(path, format!("create state lock: {error}")));
        }
    };
    secure_file_handle(&handle, &identity, path)?;
    let lock = reopen_file(&handle, GENERIC_READ | GENERIC_WRITE, path)?;
    ensure_regular_file(&lock, path)?;
    Ok(into_file(lock))
}
