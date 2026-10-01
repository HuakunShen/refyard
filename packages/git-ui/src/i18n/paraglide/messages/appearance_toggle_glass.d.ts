/**
* | output |
* | --- |
* | "Toggle frosted glass" |
*
* @param {Appearance_Toggle_GlassInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const appearance_toggle_glass: ((inputs?: Appearance_Toggle_GlassInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Appearance_Toggle_GlassInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Appearance_Toggle_GlassInputs = {};
