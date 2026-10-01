/**
* | output |
* | --- |
* | "Could not read stashes" |
*
* @param {Err_Read_StashesInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const err_read_stashes: ((inputs?: Err_Read_StashesInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Err_Read_StashesInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Err_Read_StashesInputs = {};
