/**
* | output |
* | --- |
* | "Frosted Glass Effect" |
*
* @param {Appearance_FrostedInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const appearance_frosted: ((inputs?: Appearance_FrostedInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Appearance_FrostedInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Appearance_FrostedInputs = {};
