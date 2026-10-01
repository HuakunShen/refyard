/**
* | output |
* | --- |
* | "Toggle theme" |
*
* @param {Mode_Toggle_AriaInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const mode_toggle_aria: ((inputs?: Mode_Toggle_AriaInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Mode_Toggle_AriaInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Mode_Toggle_AriaInputs = {};
