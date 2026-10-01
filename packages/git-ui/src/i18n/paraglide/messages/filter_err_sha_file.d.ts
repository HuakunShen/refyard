/**
* | output |
* | --- |
* | "SHA and file filters cannot be combined" |
*
* @param {Filter_Err_Sha_FileInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const filter_err_sha_file: ((inputs?: Filter_Err_Sha_FileInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Filter_Err_Sha_FileInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Filter_Err_Sha_FileInputs = {};
