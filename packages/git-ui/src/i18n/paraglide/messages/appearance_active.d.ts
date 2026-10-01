/**
* | output |
* | --- |
* | "Active" |
*
* @param {Appearance_ActiveInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const appearance_active: ((inputs?: Appearance_ActiveInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Appearance_ActiveInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Appearance_ActiveInputs = {};
