/**
* | output |
* | --- |
* | "cherry-pick" |
*
* @param {Conflict_Operation_Cherry_PickInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const conflict_operation_cherry_pick: ((inputs?: Conflict_Operation_Cherry_PickInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Conflict_Operation_Cherry_PickInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Conflict_Operation_Cherry_PickInputs = {};
