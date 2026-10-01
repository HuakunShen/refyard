/**
* | output |
* | --- |
* | "committer" |
*
* @param {Detail_CommitterInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const detail_committer: ((inputs?: Detail_CommitterInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Detail_CommitterInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Detail_CommitterInputs = {};
