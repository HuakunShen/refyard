/**
* | output |
* | --- |
* | "Reading pull requests…" |
*
* @param {Pr_ReadingInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const pr_reading: ((inputs?: Pr_ReadingInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Pr_ReadingInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Pr_ReadingInputs = {};
