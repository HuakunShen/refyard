/**
* | output |
* | --- |
* | "revert" |
*
* @param {Conflict_Operation_RevertInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const conflict_operation_revert: ((inputs?: Conflict_Operation_RevertInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Conflict_Operation_RevertInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Conflict_Operation_RevertInputs = {};
