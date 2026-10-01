/**
* | output |
* | --- |
* | "Squash into parent" |
*
* @param {Squash_IntoInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const squash_into: ((inputs?: Squash_IntoInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Squash_IntoInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Squash_IntoInputs = {};
