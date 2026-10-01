/**
* | output |
* | --- |
* | "At least 4 hex digits" |
*
* @param {Filters_Sha_PlaceholderInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const filters_sha_placeholder: ((inputs?: Filters_Sha_PlaceholderInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Filters_Sha_PlaceholderInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Filters_Sha_PlaceholderInputs = {};
