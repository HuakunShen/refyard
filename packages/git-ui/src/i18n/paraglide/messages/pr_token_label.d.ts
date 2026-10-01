/**
* | output |
* | --- |
* | "GitHub personal access token" |
*
* @param {Pr_Token_LabelInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const pr_token_label: ((inputs?: Pr_Token_LabelInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Pr_Token_LabelInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Pr_Token_LabelInputs = {};
