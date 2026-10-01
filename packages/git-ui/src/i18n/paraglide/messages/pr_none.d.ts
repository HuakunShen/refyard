/**
* | output |
* | --- |
* | "No open pull requests." |
*
* @param {Pr_NoneInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const pr_none: ((inputs?: Pr_NoneInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Pr_NoneInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Pr_NoneInputs = {};
