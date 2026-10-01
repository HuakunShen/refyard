/**
* | output |
* | --- |
* | "This backend cannot abort this operation. Abort it with Git or the tool that started it." |
*
* @param {Conflict_No_Abort_HintInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const conflict_no_abort_hint: ((inputs?: Conflict_No_Abort_HintInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Conflict_No_Abort_HintInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Conflict_No_Abort_HintInputs = {};
