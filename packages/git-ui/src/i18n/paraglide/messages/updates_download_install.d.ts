/**
* | output |
* | --- |
* | "Download and install" |
*
* @param {Updates_Download_InstallInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const updates_download_install: ((inputs?: Updates_Download_InstallInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Updates_Download_InstallInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Updates_Download_InstallInputs = {};
