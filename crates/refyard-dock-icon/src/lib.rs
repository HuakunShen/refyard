//! An appearance-aware Dock icon for the macOS shells.
//!
//! macOS switches an app's Dock icon with the system appearance only when the bundle
//! carries an appearance-aware asset catalog — a bare `.icns` has no light/dark
//! concept. The desktop bundles ship that catalog as of the macOS 26 icon format
//! (the checked-in `AppIcon.icon` document, compiled into `Assets.car`), and on
//! macOS 26+ the system owns the
//! icon whether the app is running or not, so this crate stands down there. On
//! older macOS, where the catalog is ignored, this crate does what the catalog
//! would do at run time: apply the icon for the current appearance to
//! `NSApplication`, and re-apply on the system's
//! `AppleInterfaceThemeChangedNotification`, which is the same signal the system's
//! own appearance observers use.
//!
//! `install` must be called on the main thread before the run loop starts serving the
//! user, with the two PNGs the bundle carries (light tile, dark tile). If either file
//! is missing the call is a no-op: the bundle's default icon stays, which is a correct
//! answer for one appearance and a tolerable one for the other.
#![deny(unsafe_op_in_unsafe_fn)]

/// The user default macOS sets to `"Dark"` while dark appearance is active. Its
/// absence (any other value, or no value) means light.
#[cfg(target_os = "macos")]
const APPEARANCE_DEFAULT: &str = "AppleInterfaceStyle";
/// The distributed notification the system posts when that default changes.
#[cfg(target_os = "macos")]
const APPEARANCE_CHANGED: &str = "AppleInterfaceThemeChangedNotification";

/// [`install`] with the main-thread marker asserted here, for callers that are
/// already on the main thread and would rather not reach for `objc2` themselves.
#[cfg(target_os = "macos")]
pub fn install_on_current_thread(
    light: &std::path::Path,
    dark: &std::path::Path,
) -> Result<DockIcon, String> {
    let Some(mtm) = objc2::MainThreadMarker::new() else {
        return Err("install_on_current_thread ran off the main thread".to_owned());
    };
    install(mtm, light, dark)
}

/// Everything needed to keep the Dock icon in step with the appearance.
#[cfg(target_os = "macos")]
pub struct DockIcon;

/// Everything needed to keep the Dock icon in step with the appearance.
#[cfg(not(target_os = "macos"))]
#[derive(Default)]
pub struct DockIcon;

/// Apply the icon for the current appearance and observe future changes.
///
/// `light` and `dark` are the bundle's two tiles. Call on the main thread. On macOS
/// 26+ this returns without touching anything: the bundle's asset catalog owns the
/// icon there, and painting a PNG over it would also freeze the user's chosen icon
/// style (light/dark/tinted/clear) for as long as the app runs. A missing tile
/// leaves the bundle icon alone and returns the explanation — for the caller's
/// log, never a user-facing surface.
#[cfg(target_os = "macos")]
pub fn install(
    mtm: objc2::MainThreadMarker,
    light: &std::path::Path,
    dark: &std::path::Path,
) -> Result<DockIcon, String> {
    use objc2::sel;
    use objc2_app_kit::{NSApplication, NSImage};
    use objc2_foundation::{ns_string, NSDistributedNotificationCenter, NSProcessInfo, NSString};

    use crate::imp::ThemeObserver;

    let system = NSProcessInfo::processInfo().operatingSystemVersion();
    if system.majorVersion >= 26 {
        return Ok(DockIcon {});
    }

    if !light.exists() || !dark.exists() {
        return Err(format!(
            "icon tiles missing (light: {}, dark: {}); the bundle icon stays",
            light.display(),
            dark.display()
        ));
    }

    fn appearance_is_dark() -> bool {
        let defaults = objc2_foundation::NSUserDefaults::standardUserDefaults();
        defaults
            .stringForKey(ns_string!(APPEARANCE_DEFAULT))
            .is_some_and(|value| value.to_string() == "Dark")
    }

    fn apply_icon(mtm: objc2::MainThreadMarker, path: &std::path::Path) -> Result<(), String> {
        let file_name = NSString::from_str(&path.to_string_lossy());
        let image = NSImage::initWithContentsOfFile(mtm.alloc(), &file_name);
        match image {
            Some(image) => {
                // SAFETY: The signature is correct; main-thread-only by AppKit contract.
                unsafe {
                    NSApplication::sharedApplication(mtm).setApplicationIconImage(Some(&image));
                }
                Ok(())
            }
            None => Err(format!("the icon at {} could not be read", path.display())),
        }
    }

    let dark_now = appearance_is_dark();
    let chosen = if dark_now { dark } else { light };
    apply_icon(mtm, chosen)?;

    let center = NSDistributedNotificationCenter::defaultCenter();
    let observer = ThemeObserver::new(mtm, light.to_path_buf(), dark.to_path_buf());
    // SAFETY: `observer` is our own object carrying the registered selector;
    // `applyForThemeChange:` is a valid selector.
    unsafe {
        center.addObserver_selector_name_object(
            &observer,
            sel!(applyForThemeChange:),
            Some(ns_string!(APPEARANCE_CHANGED)),
            None,
        );
    }
    // The observer is intentionally leaked: it serves the process's whole life, and
    // the distributed notification center holds no strong reference of its own.
    std::mem::forget(observer);
    Ok(DockIcon {})
}

/// Non-macOS platforms have no Dock icon to switch; the bundle icon is the answer.
#[cfg(not(target_os = "macos"))]
pub fn install(_light: &std::path::Path, _dark: &std::path::Path) -> Result<DockIcon, String> {
    Err("dock icon switching is macOS-only".to_owned())
}

/// The non-macOS twin of the macOS `install_on_current_thread`: same signature, same
/// answer, so a call site compiles on every platform the shells build for.
#[cfg(not(target_os = "macos"))]
pub fn install_on_current_thread(
    _light: &std::path::Path,
    _dark: &std::path::Path,
) -> Result<DockIcon, String> {
    Err("dock icon switching is macOS-only".to_owned())
}

#[cfg(target_os = "macos")]
pub(crate) mod imp {
    use std::path::{Path, PathBuf};

    use objc2::rc::Retained;
    use objc2::runtime::{NSObject, NSObjectProtocol};
    use objc2::{define_class, msg_send, DefinedClass, MainThreadMarker, MainThreadOnly};
    use objc2_app_kit::{NSApplication, NSImage};
    use objc2_foundation::{ns_string, NSNotification, NSString};

    pub(super) fn appearance_is_dark() -> bool {
        let defaults = objc2_foundation::NSUserDefaults::standardUserDefaults();
        defaults
            .stringForKey(ns_string!(super::APPEARANCE_DEFAULT))
            .is_some_and(|value| value.to_string() == "Dark")
    }

    pub(super) fn apply_icon(
        mtm: MainThreadMarker,
        path: &Path,
    ) -> Result<(), String> {
        let file_name = NSString::from_str(&path.to_string_lossy());
        let image = NSImage::initWithContentsOfFile(mtm.alloc(), &file_name);
        match image {
            Some(image) => {
                // SAFETY: The signature is correct; main-thread-only by AppKit contract.
                unsafe {
                    NSApplication::sharedApplication(mtm).setApplicationIconImage(Some(&image));
                }
                Ok(())
            }
            None => Err(format!("the icon at {} could not be read", path.display())),
        }
    }

    /// The ivars the observer carries: where the two tiles live.
    pub(crate) struct ThemeObserverIvars {
        pub(crate) light: PathBuf,
        pub(crate) dark: PathBuf,
    }

    define_class!(
        /// Watches the system appearance and re-applies the matching tile. Registered
        /// with the distributed notification center for the process's lifetime.
        #[unsafe(super = NSObject)]
        #[thread_kind = MainThreadOnly]
        #[ivars = ThemeObserverIvars]
        pub(crate) struct ThemeObserver;

        // SAFETY: `NSObjectProtocol` has no safety requirements.
        unsafe impl NSObjectProtocol for ThemeObserver {}

        impl ThemeObserver {
            // SAFETY: The signature matches `AppleInterfaceThemeChangedNotification`'s
            // observer shape: one argument, the notification.
            #[unsafe(method(applyForThemeChange:))]
            fn apply_for_theme_change(&self, _notification: &NSNotification) {
                let mtm = self.mtm();
                let (light, dark) = {
                    let ivars = self.ivars();
                    (ivars.light.clone(), ivars.dark.clone())
                };
                let chosen = if appearance_is_dark() { dark } else { light };
                if let Err(problem) = apply_icon(mtm, &chosen) {
                    eprintln!("refyard-dock-icon: {problem}");
                }
            }
        }
    );

    impl ThemeObserver {
        pub(super) fn new(
            mtm: MainThreadMarker,
            light: PathBuf,
            dark: PathBuf,
        ) -> Retained<Self> {
            let this = Self::alloc(mtm).set_ivars(ThemeObserverIvars { light, dark });
            // SAFETY: The signature of `NSObject`'s `init` is correct.
            unsafe { msg_send![super(this), init] }
        }
    }
}
