/**
* | output |
* | --- |
* | "Commit carries a signature." |
*
* @param {Commit_SignedInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const commit_signed: ((inputs?: Commit_SignedInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Commit_SignedInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Commit_SignedInputs = {};
