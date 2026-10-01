/**
* | output |
* | --- |
* | "authored" |
*
* @param {Detail_AuthoredInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const detail_authored: ((inputs?: Detail_AuthoredInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Detail_AuthoredInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Detail_AuthoredInputs = {};
