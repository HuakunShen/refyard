/**
* | output |
* | --- |
* | "New terminal" |
*
* @param {Terminal_NewInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const terminal_new: ((inputs?: Terminal_NewInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Terminal_NewInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Terminal_NewInputs = {};
