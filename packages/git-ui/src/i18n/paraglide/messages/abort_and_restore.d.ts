/**
* | output |
* | --- |
* | "Abort and restore the state it started from" |
*
* @param {Abort_And_RestoreInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const abort_and_restore: ((inputs?: Abort_And_RestoreInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Abort_And_RestoreInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Abort_And_RestoreInputs = {};
