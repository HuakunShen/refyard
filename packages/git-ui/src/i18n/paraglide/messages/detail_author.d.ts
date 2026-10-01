/**
* | output |
* | --- |
* | "author" |
*
* @param {Detail_AuthorInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const detail_author: ((inputs?: Detail_AuthorInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Detail_AuthorInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Detail_AuthorInputs = {};
