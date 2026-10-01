/**
* | output |
* | --- |
* | "System" |
*
* @param {Mode_SystemInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const mode_system: ((inputs?: Mode_SystemInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Mode_SystemInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Mode_SystemInputs = {};
