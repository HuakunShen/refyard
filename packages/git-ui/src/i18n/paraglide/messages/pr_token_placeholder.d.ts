/**
* | output |
* | --- |
* | "GitHub token (github_pat_… or ghp_…)" |
*
* @param {Pr_Token_PlaceholderInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const pr_token_placeholder: ((inputs?: Pr_Token_PlaceholderInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Pr_Token_PlaceholderInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Pr_Token_PlaceholderInputs = {};
