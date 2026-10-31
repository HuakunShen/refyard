/**
* | output |
* | --- |
* | "Refyard could not open a directory from the command line" |
*
* @param {Launch_RefusedInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const launch_refused: ((inputs?: Launch_RefusedInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Launch_RefusedInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Launch_RefusedInputs = {};
