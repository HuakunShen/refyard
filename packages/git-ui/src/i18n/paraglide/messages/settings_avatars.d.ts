/**
* | output |
* | --- |
* | "Avatars" |
*
* @param {Settings_AvatarsInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const settings_avatars: ((inputs?: Settings_AvatarsInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Settings_AvatarsInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Settings_AvatarsInputs = {};
