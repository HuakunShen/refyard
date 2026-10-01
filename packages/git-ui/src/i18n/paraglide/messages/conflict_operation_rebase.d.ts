/**
* | output |
* | --- |
* | "rebase" |
*
* @param {Conflict_Operation_RebaseInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const conflict_operation_rebase: ((inputs?: Conflict_Operation_RebaseInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Conflict_Operation_RebaseInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Conflict_Operation_RebaseInputs = {};
