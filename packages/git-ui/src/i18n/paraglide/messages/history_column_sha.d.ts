/**
* | output |
* | --- |
* | "SHA" |
*
* @param {History_Column_ShaInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const history_column_sha: ((inputs?: History_Column_ShaInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<History_Column_ShaInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type History_Column_ShaInputs = {};
