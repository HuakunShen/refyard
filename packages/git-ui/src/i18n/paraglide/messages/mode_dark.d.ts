/**
* | output |
* | --- |
* | "Dark" |
*
* @param {Mode_DarkInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const mode_dark: ((inputs?: Mode_DarkInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Mode_DarkInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Mode_DarkInputs = {};
