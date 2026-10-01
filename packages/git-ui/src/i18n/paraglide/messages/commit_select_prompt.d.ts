/**
* | output |
* | --- |
* | "Select a commit to read it." |
*
* @param {Commit_Select_PromptInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const commit_select_prompt: ((inputs?: Commit_Select_PromptInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Commit_Select_PromptInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Commit_Select_PromptInputs = {};
