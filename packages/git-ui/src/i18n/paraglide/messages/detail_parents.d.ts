/**
* | output |
* | --- |
* | "parents" |
*
* @param {Detail_ParentsInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const detail_parents: ((inputs?: Detail_ParentsInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Detail_ParentsInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Detail_ParentsInputs = {};
