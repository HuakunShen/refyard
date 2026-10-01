/**
* | output |
* | --- |
* | "Repository navigation" |
*
* @param {Nav_AriaInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const nav_aria: ((inputs?: Nav_AriaInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Nav_AriaInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Nav_AriaInputs = {};
