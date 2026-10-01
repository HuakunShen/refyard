/**
* | output |
* | --- |
* | "Workbench Background" |
*
* @param {Appearance_BackgroundInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const appearance_background: ((inputs?: Appearance_BackgroundInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Appearance_BackgroundInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Appearance_BackgroundInputs = {};
