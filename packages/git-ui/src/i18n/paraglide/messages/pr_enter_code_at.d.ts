/**
* | output |
* | --- |
* | "Enter this code at" |
*
* @param {Pr_Enter_Code_AtInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const pr_enter_code_at: ((inputs?: Pr_Enter_Code_AtInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Pr_Enter_Code_AtInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Pr_Enter_Code_AtInputs = {};
