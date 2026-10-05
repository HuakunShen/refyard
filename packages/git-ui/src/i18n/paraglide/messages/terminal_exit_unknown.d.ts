/**
* | output |
* | --- |
* | "Exited" |
*
* @param {Terminal_Exit_UnknownInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const terminal_exit_unknown: ((inputs?: Terminal_Exit_UnknownInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Terminal_Exit_UnknownInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Terminal_Exit_UnknownInputs = {};
