/**
* | output |
* | --- |
* | "Accent Color" |
*
* @param {Appearance_AccentInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const appearance_accent: ((inputs?: Appearance_AccentInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Appearance_AccentInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Appearance_AccentInputs = {};
