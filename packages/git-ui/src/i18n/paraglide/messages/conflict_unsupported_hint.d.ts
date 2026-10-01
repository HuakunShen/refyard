/**
* | output |
* | --- |
* | "This build does not support continuing or aborting this operation. Finish it with Git or the tool that started it; writes stay blocked in this worktree until..." |
*
* @param {Conflict_Unsupported_HintInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const conflict_unsupported_hint: ((inputs?: Conflict_Unsupported_HintInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Conflict_Unsupported_HintInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Conflict_Unsupported_HintInputs = {};
