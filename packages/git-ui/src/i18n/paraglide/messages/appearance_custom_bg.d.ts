/**
* | output |
* | --- |
* | "Custom background URL" |
*
* @param {Appearance_Custom_BgInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const appearance_custom_bg: ((inputs?: Appearance_Custom_BgInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Appearance_Custom_BgInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Appearance_Custom_BgInputs = {};
