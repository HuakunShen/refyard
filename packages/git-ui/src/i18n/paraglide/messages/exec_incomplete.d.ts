/**
* | output |
* | --- |
* | "incomplete" |
*
* @param {Exec_IncompleteInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const exec_incomplete: ((inputs?: Exec_IncompleteInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Exec_IncompleteInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Exec_IncompleteInputs = {};
