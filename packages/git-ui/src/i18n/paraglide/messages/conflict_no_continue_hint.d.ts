/**
* | output |
* | --- |
* | "This backend cannot continue this operation. Finish it with Git or the tool that started it." |
*
* @param {Conflict_No_Continue_HintInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const conflict_no_continue_hint: ((inputs?: Conflict_No_Continue_HintInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Conflict_No_Continue_HintInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Conflict_No_Continue_HintInputs = {};
